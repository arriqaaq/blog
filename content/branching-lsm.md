---
title: Git-style branching on an LSM key-value store
dek: How a fork, a diff and a merge are built out of one sequence number.
eyebrow: Storage Engines
slug: branching-lsm
date: 2026-08-17
ogImage: skv-ceiling
byline: "A build log on a personal experiment: adding git-style branching to an LSM key-value store, with each mechanism running live on the page."
---

Agents need somewhere to work that they can break. Handing one a scratch copy of a repository or a container is routine; the database is the part that is hard to hand over, because a copy of it costs a copy of the data.

This is an experiment in adding git-style branching to an LSM key-value store, on [my fork](https://github.com/arriqaaq/surrealkv) of [SurrealKV](https://github.com/surrealdb/surrealkv), an embedded key-value store. I wanted to know what it takes, and where the cost ends up.

Three cases want it. An **agent sandbox** lives for seconds or minutes, is thrown away, and has to be undoable. A **dev, test or preview environment** lives for hours or days, and you want tens of them at once. **Time travel and audit** wants to read the past, and wants it exactly. An approximation of "yesterday at 09:14" is worse than an error, because you cannot tell how wrong it is.

[[SVG:skv-use-cases]]

They differ in how long a branch lives, which is what the design has to be sized for: tens of short-lived branches, with a way out for the one that turns out to be permanent.

None of this is released, and names may still move. Every mechanism below is named with its real type and the file it lives in, so it can be checked against the fork.

## How an LSM tree works {#lsm-primer}

A key-value store has to put each write somewhere. A B-tree puts it in the page where the key belongs, which means small random writes scattered across the disk, which is the access pattern storage hardware handles worst. A **log-structured merge tree** (LSM tree) takes the opposite approach: never modify data where it sits, only ever append. Everything else in the structure follows from that one rule.

- A write is first appended to a **write-ahead log** (WAL) so it survives a crash.
- It then goes into the **memtable**, an in-memory buffer that keeps keys sorted so reads can be served from it.
- When the memtable fills, it is written to disk once, sequentially, as an **SSTable**: an immutable sorted file. Fresh tables form level 0 (L0), and their key ranges may overlap.
- Reads now have to check the memtable and every table that might hold the key. So a background process called **compaction** periodically merges overlapping tables into fewer, larger, non-overlapping ones in the levels below. L1, L2 and so on, each level typically about ten times the size of the one above it. Each table carries a **bloom filter**, a small summary that lets a read skip tables that certainly do not contain the key.
- A **delete** is also a write: it appends a **tombstone**, a marker that says "this key is gone". The old value stays on disk until a compaction removes both.

The widget below is that whole lifecycle, operable by hand. Put a few keys and watch the memtable flush. Put the same key twice and find both versions sitting on disk. Then compact, and watch the older one leave.

[[WIDGET:skv-lsm-basics]]

SurrealKV is an ordinary instance of this design: a skiplist memtable, a segmented write-ahead log, leveled compaction, a block cache, and bloom filters.

[[SVG:skv-lsm-anatomy]]

One side effect of appending is the property everything below depends on. Nothing is overwritten in place, so when you write `user:7` a second time, the first value is still on disk. It is superseded, not gone, and it stays readable until some later compaction decides nobody can reach it.

## Three primitives branching is built out of {#primitives}

Branching needs three things from the storage engine. Two of them an LSM tree already has.

[[SVG:skv-primitives]]

**A sequence number on every write.** Every commit draws one monotonically increasing integer. In SurrealKV that number does not sit beside the key. It sits inside it. The internal key is the user's key followed by two big-endian `u64`s:

```rust
// src/lib.rs
pub(crate) struct InternalKey {
	pub(crate) user_key: Key,
	pub(crate) timestamp: u64,   // nanoseconds since epoch
	pub(crate) trailer: u64,     // (seq_num << 8) | kind
}

// encoded = user_key ‖ trailer.to_be_bytes() ‖ timestamp.to_be_bytes()
pub(crate) fn make_trailer(seq_num: u64, kind: InternalKeyKind) -> u64 {
	(seq_num << 8) | kind as u64
}
```

That is 56 bits of sequence and 8 bits of kind: `Set`, `Delete`, `SoftDelete`, `Merge`, `RangeDelete` and a few more. The timestamp is a selector for time-travel queries; it does not order anything.

Internal keys sort by user key ascending, then by sequence **descending**. That layout puts all the versions of one key next to each other, newest first, so a reader that wants the current value of `user:7` seeks to `user:7` and takes the first entry it finds.

**Visibility is a filter on that number.** A read at sequence *s* ignores every version whose sequence is above *s*. This is not a branching feature. It is snapshot isolation: a reader is handed one sequence number, and every write committed after it stays invisible for the whole read. It is also why a long-running scan does not see writes that land while it runs.

**Compaction is the only thing that destroys data.** Reads destroy nothing. Writes destroy nothing, since a write adds a version and a delete adds a tombstone. Compaction is the single component that makes data unreachable, because it is the only one that decides a superseded version is no longer needed.

The first two primitives mean that reading the store as it was at sequence *s* already works, for any *s* whose versions still exist. The third is what is missing: nothing has promised that compaction will keep the versions *s* needs.

## Why a snapshot is not a branch {#snapshot-limits}

Say you have a 40 GB store in about 2,000 SSTables, and you want a copy you can write to.

A snapshot will not give you one. You get a sequence number to read at, and compaction agrees not to discard anything that number can see. But you cannot write to a number, and the snapshot is released as soon as your reader goes away. That release is on purpose. A forgotten reader would otherwise pin history forever.

SurrealKV already had the next thing along: a checkpoint, in `src/checkpoint.rs`. It flushes the mutable state, hard-links every SSTable the manifest references, and copies the level manifest and the metadata. Your 40 GB copy therefore links 2,000 files, so the work grows with the file count. Then the two stores share nothing. Every compaction on either side rewrites its own copy, and your 40 GB drifts toward 80 GB.

A fork of the same store writes one catalog record and links nothing. Read a key neither side has touched and it still comes from one shared table.

[[WIDGET:skv-checkpoint-vs-branch]]

The checkpoint costs you two other things. It gives you no diff and no merge back, because the two stores no longer share a sequence number to compare against. And it is whole-store, so you cannot check out part of one.

[[SVG:skv-checkpoint-vs-fork]]

A fork avoids the copy by keeping a read path into its parent. The parent can then no longer forget whatever that path reaches. Everything expensive about branching follows from that one sentence.

## Four ways to build a branch on an LSM tree {#options}

Four designs get used for this: tag every key with a branch id, copy the store, replace the LSM with a content-addressed tree, or cap the sequence counter. Judge each one on what it does to a fork, a read, a branch deletion, and compaction.

### A branch id in every key

The fork writes nothing at all, which is the appeal. The problems land everywhere else.

[[SVG:skv-design-prefix]]

Prefixing the key mixes every branch's rows into a single keyspace. A compaction job can no longer be scoped to one branch, because there is no physical boundary left between them, and deleting a branch stops being a metadata operation and becomes a range delete over live data.

The larger problem is that one key's versions are no longer contiguous on disk. `b1·user:7` and `b2·user:7` sort apart, so the newest-first walk that made a point read cheap now runs once per branch on the fork path, so a read at fork depth *d* becomes *d* scans. And a table's bloom filter can no longer answer "do you hold `user:7`" without being asked once per prefix. Those two are the read optimisations an LSM tree depends on, and the key format disables both.

### A copy per branch

[[SVG:skv-design-copy]]

Correct and fully isolated. The fork copies every row, so what it costs grows with the size of the store. That is the case the other three exist to avoid.

### A content-addressed tree

Every node is named by the hash of its contents, a branch is a root pointer, and a write copies the path from leaf to root while sharing every untouched subtree. This is roughly what Git itself does, and diff is cheap because equal subtrees have equal names.

[[SVG:skv-design-cat]]

It works. It also replaces an LSM tree instead of extending one, so you re-derive MVCC, compaction and crash recovery over a new address space.

### A ceiling on one counter

[[SVG:skv-design-ceiling]]

A branch is a maximum sequence number it is allowed to read. The fork writes one metadata record and no data, reads walk the branch's own components and then the parent's up to that number, and deleting a branch reclaims its own components. The cost moves into compaction, which now has to be told which superseded versions are still somebody's current value.

## How branching works {#overview}

Here is the whole thing before any one piece of it.

[[SVG:skv-architecture-map]]

Six parts do the work:

- The **sequence counter** issues a number to every commit in the store, on every branch. There is one of them.
- A branch's **fork anchor** is one of those numbers. It is the highest sequence the branch may read of anything it inherited.
- The **catalog** records which branches exist, who each one's parent is, and what its anchor is. It is the durable copy of that, and a fork is a write to it.
- Every branch has its **own components**, meaning its own memtable and level sets. They hold only the rows that branch wrote.
- A read walks the **layer stack**: your branch's components first, then each ancestor's, capped at the lowest anchor on the path.
- Compaction reads a **retention pin** built from the catalog. The pin lists superseded versions it may not discard.

[[WIDGET:skv-architecture]]

Step an operation and you can see which parts it touches. A fork writes the catalog and moves no data. A write lands in your branch's own components and takes its sequence from the shared counter. A read walks the stack. A merge reads a diff, commits the data, then records an edge.

## One clock for the whole store {#one-clock}

There is one global sequence counter for the whole store. Every commit on every branch draws the next number from it. Branches do not have their own clocks, and there is no per-branch head:

```rust
// src/branch.rs
/// Newest sequence this branch wrote ITSELF — not a per-branch head, which
/// a single global commit clock does not have. `None` means the branch has
/// never written, so it reads purely through its inherited view.
pub last_write_seq: Option<u64>,
```

One counter makes any two branches' sequence numbers directly comparable, and that comparability is why forking and merging can be cheap. With per-branch clocks, relating two branches needs a vector clock, a mapping table, or a causality graph. With one clock, everything a branch is allowed to see of everything it inherits is defined by a single integer.

[[SVG:skv-ceiling]]

A branch's view is a ceiling: a maximum sequence number the branch is allowed to read. Nothing is copied, and there is no second history to filter. There is one history, and a cap on how much of it this branch can see.

The widget below puts commits from several branches on the shared axis. Watch two things. No two dots anywhere share a horizontal position, because there is one ordering for the whole store; and every branch's own commits sit to the right of its own anchor.

[[WIDGET:skv-one-clock]]

A snapshot's read version is the same idea without the durability. A snapshot goes away with its reader. This ceiling survives the reader, survives restart, and you can write on top of it.

One clock also settles copy-on-write shadowing. When a child writes to a key it inherited, two versions of that key exist in two different component sets, and every read on the child has to prefer the child's. Implementations often track this explicitly, with a dirty set, a shadow table, a per-key override map, or a copied page. None of that is needed here: a child only writes after it forked, and every write draws from the one global counter, so a child's sequence numbers always exceed everything it inherited, including its own anchor. Its write to an inherited key is therefore the newest version of that key.

[[SVG:skv-shadow]]

Deletion works the same way. A tombstone in the child sits at a higher sequence than the parent's row, so it hides that row without the parent knowing, and a branch can delete a row it does not physically hold. One consequence comes back later: what a branch *owns* and what it *wrote* are different sets, because detach materialises inherited rows into the branch's own tables at their original sequences.

## Choosing the anchor {#fork-anchor}

When you fork, you have to say where. That number becomes the branch's anchor, and it is written to the catalog, so it survives every reader and every restart. That durability is what lets you write on top of it.

You name it one of three ways: at the parent's current head, at a specific sequence, or at a point in time.

```rust
// src/branch.rs
pub enum ForkPoint {
	/// The parent's visible head at the instant of the fork, established by
	/// draining the commit pipeline under the write fence.
	Head,
	/// A specific sequence, which must be at or below the drained head and at
	/// or above the parent's retention floor.
	AtVersion(u64),
	/// The highest sequence committed at or before this timestamp, resolved
	/// exactly or refused (`Error::TimestampBelowHorizon`).
	AtTimestamp(u64),
}
```

All three land on an exact sequence, never an approximation. `AtTimestamp` either resolves to the sequence committed at or before that moment, or it fails with `TimestampBelowHorizon`.

`Head` is the interesting one. It includes rows the parent has committed but not yet flushed, because your child resolves the parent's live state, memtables and all, instead of a set of files on disk. Nothing has to be flushed for your fork to be correct.

[[SVG:skv-fork-anchor]]

Fork a branch off a branch and the anchors stack. Each link contributes its own cap, and your effective ceiling is the lowest one on the path, so a grandchild can never see more of its grandparent than its parent could. That falls out of taking the minimum. No check enforces it.

Two selectors get refused. You cannot fork below the parent's own `created_at_seq`, because a child cannot predate its parent. And if you retry an `AtTimestamp` fork, it is resolved again from scratch: should that timestamp now map to a different sequence than the first attempt used, you get a refusal, not the old receipt.

## Ownership lives in metadata, not in keys {#no-branch-in-keys}

Branch identity rides in component metadata, and is never prefixed into a user key or an internal key, which is what keeps the read optimisations the first design broke. The definition says so:

```rust
// src/batch.rs
/// Physical owner of every row in a commit batch. Ownership stays in the
/// batch/component metadata and is not prefixed into user keys.
pub(crate) struct BatchOwner {
	pub(crate) branch: BranchId,
	pub(crate) generation: BranchGeneration,
}
```

A commit batch carries one owner. A memtable is branch-pure: it rejects a batch belonging to anyone else. Every SSTable records its owner in its own metadata, and loading the manifest fails closed if a level set's owner disagrees with what the table itself says. The level manifest is partitioned per owner, and a read selects one partition:

```rust
// src/levels/mod.rs
// Point reads address this by physical owner; branch count must not enter
// the lookup cost.
levels_by_owner: HashMap<BatchOwner, Levels>,
```

There is no owner-blind way to access levels at all, so a read path cannot accidentally mix owners. Lookup is by hash, which keeps the total branch count out of the cost of every point read and every layer of an inherited read.

[[SVG:skv-key-vs-metadata]]

Keeping keys owner-free pays off three times over. Compaction stays a single-owner operation because the components it reads have one owner, not because a rule says so. Deleting a branch reclaims a component set. No rows are deleted. And the key comparator never learns what a branch is, so a key's versions stay contiguous and newest-first, which is the layout the comparator, the bloom filters and every seek in the read path rely on.

## The write path {#fork-protocol}

Writing to a branch is the boring part, and that is the point. Your row goes into that branch's own memtable and takes its sequence from the shared counter, exactly as it would on main. There is no branch-aware write path.

Creating the branch is where the care goes. The whole fork is one publication to the catalog, and it copies no data.

```rust
// src/lsm.rs — fork_branch
/// The protocol is one durable step. Under the branch-op mutex: fence
/// writes, drain the commit pipeline so the visible head is exact, resolve
/// the fork sequence, release the fence, then publish ONE catalog version
/// naming the child, its parent link and its anchor. That publish is the
/// commit point — before it nothing durable mentions the child, after it the
/// child is fully readable with no further work, because its view is
/// computed from the parent's live state (design §3.2).
```

[[SVG:skv-fork-protocol]]

The fence stops write admission store-wide, then spins until the commit pipeline reports drained, so `visible_seq_num` is exactly the head. Without that drain, `ForkPoint::Head` would resolve to a number with in-flight commits on either side of it, and the child's view would be neither the head nor any other well-defined point. Missing the drain deadline gives `Error::ForkFenceTimeout`, which is retryable.

Publishing checks the ancestor chain against the depth budget, `MAX_VIEW_DEPTH = 64`, and then checks whether the parent can still answer at the resolved sequence:

```rust
// src/branch.rs
/// Either the cap is at or above the retention floor — no key has lost a
/// version that a view up there would need — or the cap is one of the pinned
/// anchors, where compaction preserved the answer on purpose. Any other cap
/// below the floor reads whatever happened to survive, which is a guess.
pub(crate) fn view_is_complete_at(&self, cap: u64, retained_floor: u64) -> bool {
	cap >= retained_floor || self.anchors.contains(&cap)
}
```

That predicate is what lets a historical fork be refused instead of approximated.

The fence is store-wide, not parent-wide. `ForkPoint::Head` briefly stalls every writer in the store, not only writers on the parent. One global clock is one global serialisation point. The metric `fork_drain_nanos` divided by `forks` is the average pause every writer took for somebody else's fork.

If you create branches in bulk, one case will bite you. At the catalog's cap of 4,096 records a fork stops to run a reclamation sweep first, so it blocks instead of failing.

## Where the promise is stored {#authority}

A fork's commit point is a single durable act, so it needs a primitive that either happens or does not. The usual answer in an LSM is a MANIFEST file: append to it, or rewrite it and rename the new one into place.

Rename is atomic in one sense: no reader sees a half-written file. But it is not compare-and-swap. It will happily clobber a version written by someone else, so it cannot express "publish this only if the state I read is still current".

So there is no MANIFEST file. There are three numbered, immutable metadata lineages, never rewritten in place:

```
<db>/catalog/<version>.catalog            magic SKBC   the branch catalog
<db>/branch/<branch-id>/<version>.state   magic SKBM   one branch's owned facts
<db>/root/<version>.root                  magic SKRT   global recovery facts
```

Each file is magic, version, body, CRC32. The publish primitive is a conditional create via `fs::hard_link`: linking to a name that already exists fails with `AlreadyExists`, at which point the publisher byte-compares the two and reports `AlreadyExistsSame` if the content matches.

[[SVG:skv-lineages]]

That gives a real compare-and-swap on a filesystem. Two concurrent publishers cannot silently overwrite each other. Whichever loses sees the other and fails closed. Retries are idempotent, because re-publishing identical bytes after an interrupted attempt is indistinguishable from having succeeded the first time, which is what you want when the commit point of a user-visible operation can be interrupted halfway. Four versions of each lineage are kept.

### A name is not an identity

The catalog is the sole authority for branch existence, generation, parentage, anchors and TTLs. Names are reusable; incarnations are not. Every physical owner names a `(BranchId, BranchGeneration)` pair, and generations are globally monotone. A handle to a deleted branch whose name has since been reused gets `BranchFenced`. It does not quietly rebind to whichever branch now owns the name. A merge edge naming a stale generation is not that branch's history either, and is discarded.

Deletion cannot simply drop a branch's catalog record. At that moment its runtimes may exist, its WAL segments may be pinned, and its level state, tables and authority lineage are all still on disk, so something durable has to say "this branch is going away" or a crash mid-teardown leaves orphans nothing will ever reclaim. Deletion therefore publishes a tombstone, and `BranchCatalog::retire_deleted()` removes it later in a fixed order: reclaim runtimes, WAL dependencies, level state and tables; then remove the state lineage directory and sync the parent directory; only then retire the tombstone in a new catalog publication. A failure anywhere before the last step leaves the tombstone in place, so the maintenance pass retries safely. Tombstones have to be retired at all because the catalog caps at 4,096 records. If they lived forever, that cap would count every branch ever created instead of the branches alive now.

### Four locks, one order

Branching added several operations that touch global state at once. A fork touches the catalog, the level manifest and the commit pipeline. A detach copies a dataset and publishes a catalog version. A checkpoint reads every table and needs metadata to stop moving. Compaction runs under the level manifest and has to be able to consult the catalog. Any two of these taking the same pair of locks in opposite orders is a deadlock.

[[SVG:skv-lock-order]]

The order is `branch_materialization`, then `catalog_publish`, then the commit pipeline write fence and the level manifest. `branch_materialization` is a plain `Mutex<()>` kept separate from `catalog_publish`, because detach copies everything a branch was inheriting and holding the catalog serialiser across a bulk copy would block every unrelated branch operation in the store for its duration. Detach materialises first, takes `catalog_publish` only for the final parent-link publication, and re-validates the owner afterwards in case it was fenced while the copy ran.

The order is enforced by a test that reads the source text and asserts `catalog_publish.lock()` appears before `level_manifest.read()`. That sounds like a strange test to write, and it is the only kind that works here: lock ordering lives in the shape of the code, not in any one execution, so running the code proves nothing about whether an inverted path exists somewhere else.

## The read path {#read-stack}

A branch owns only what it wrote. Everything else it can see belongs to an ancestor, and it may only see the part of that ancestor below its anchor. A read therefore has to consult several component sets, each with a different visibility rule.

So a snapshot here is not one filter. It is a stack of layers, walked nearest-first, where each layer carries its own cap:

```rust
// src/snapshot.rs — Snapshot::new_owned
let mut cap = seq_num;
for (branch, generation, fork_seq) in chain {
	cap = cap.min(fork_seq);
	layers.push(SnapshotLayer { owner: BatchOwner { branch, generation }, runtime: ..., cap });
}
```

Walk the parent chain nearest-first, narrowing the cap monotonically as you go. A layer's cap is `min(snapshot seq, every fork anchor on the path to that ancestor)`.

[[SVG:skv-read-stack-anatomy]]

Within a layer the search order is the ordinary one: active memtable, then immutable memtables newest-first, then L0 across all overlapping tables, then L1 and below by binary search. The one difference is that each layer seeks at its own cap, not at the snapshot sequence. The first visible version wins and the walk stops. A tombstone in a nearer layer hides every farther layer: a delete answers "absent" and does not step aside to let an ancestor answer.

Per-layer caps cannot be replaced by one filter on the merged stream. Every one of a layer's iterators is wrapped before it reaches the merge:

```rust
// src/snapshot.rs
// Every iterator of this layer is wrapped in a SeqCappedIterator
// BEFORE the merge: per-layer fork caps cannot be expressed by
// the merged stream's global snapshot filter.
```

Within one key, versions arrive sequence-descending, and a capped iterator walks past a key's above-cap versions down to its first visible one. A filter placed after the merge is consulted too late: by the time it runs, a different layer's row has already won the key. The row it admits is not just wrong, it is the answer the reader receives.

[[SVG:skv-cap-before-merge]]

Run the widget below both ways and look at the rows that leak through. Nothing about them looks wrong. They are correctly ordered and they sit below the snapshot's own sequence. The only thing wrong with them is which layer they came from, and once the streams interleave, that is no longer recoverable.

[[WIDGET:skv-per-layer-caps]]

## How compaction works with branching {#compaction}

A fork writes one record, so most of the cost of branching arrives here. Compaction exists to discard superseded versions, and a live fork anchor says that a particular superseded version is still somebody's current value. Compaction therefore has to be told what it may not discard. It has to be told durably, so a crash cannot lose the instruction, and without slowing down a store that has no branches at all.

[[SVG:skv-compaction-conflict]]

The widget runs a compaction job against a version chain with anchors in the way. Two toggles cover the cases worth seeing: a store with no branches at all, and an anchor that appears after the job has already started merging.

[[WIDGET:skv-compaction-pins]]

### What compaction must be told to keep {#anchor-set}

The failure modes pull in opposite directions. Drop the version a child's anchor needs, and the child's next read returns a newer row. No error, just a value that was never true at its fork point. Drop the version a merge's base sits at, and the next merge compares against the wrong base and overwrites. Keep everything, and one long-lived branch pins its parent's entire history for as long as it exists.

The natural first move is to keep one number per owner, the lowest sequence anybody still needs, and preserve everything at or above it. That is how a retention floor works, and it is the first thing I tried. It does not survive two branches forked at different points:

```rust
// src/branch.rs
/// Every sequence cap at which some durable reader still reads one owner
/// exactly — what its compaction must preserve (design §3.3a).
///
/// Three kinds, making the same promise. A live child's fork anchor: its
/// inherited view is re-resolved at that cap on every read. A live merge edge's
/// target-side head preserves durable edge history. And the edge's source-side
/// cursor preserves the actual three-way base: merging into a target never
/// mutates the source or incorporates target-only values into it.
///
/// A single anchor cannot stand in for several. Pinning only the lowest leaves
/// a child forked higher up reading a version that was never current at its
/// anchor; pinning only the highest drops what the lowest needs; range-pinning
/// to the highest retains the parent's whole history for as long as anything is
/// forked at head. So the set is kept as a set, and compaction preserves the
/// newest version at or below *each* of them.
pub(crate) struct RetentionAnchors { anchors: Vec<u64> }
```

Each cheaper policy fails in its own way. Pin only the lowest anchor, and a child forked higher up resolves to a version that was never current at its fork point. Pin only the highest, and the lower fork finds nothing at all. Range-pin everything below the highest, and one branch forked at head retains its parent's whole history for as long as it lives.

[[SVG:skv-anchor-kinds]]

Anchors do not only come from children. A live merge edge contributes two more: its target-side head, which preserves durable edge history, and its source-side cursor, which preserves the actual three-way base. A stale edge pins nothing at all: its source is gone, no future merge can measure from that base, and holding history for a deleted branch is how a store that churns sandbox branches would never reclaim anything.

The set is kept sorted descending and deduplicated, and it is never truncated to save space. Dropping an anchor because the set grew would drop the promise it represents.

Honouring *n* anchors over *m* versions looks like it costs *n × m* comparisons. It does not, because both lists are sorted the same way:

```rust
// src/branch.rs
/// Anchors descend and versions arrive newest-first, so one shared index is
/// enough: when a version's sequence drops at or below the highest anchor that
/// nothing has served yet, that version is the newest at or below it — every
/// version seen so far was higher — and it serves that anchor and any others it
/// has just passed.
pub(crate) fn serves(&mut self, seq: u64) -> bool {
	let before = self.next;
	while self.next < self.anchors.len() && self.anchors[self.next] >= seq {
		self.next += 1;
	}
	self.next > before
}
```

One index that never rewinds, so the pass costs `O(versions + anchors)` for any number of branches. One version can serve several anchors at once, which is what keeps the cost flat as branches accumulate.

[[SVG:skv-anchor-walker]]

The widget lets you place fork anchors between versions, which is the only case where the four policies disagree, and run each policy against the same version chain.

[[WIDGET:skv-anchor-policy]]

Both the set and the range answer every anchor correctly; only the retained count separates them. The argument for the set is a counter, not a correctness bug.

### Where the pins come from

Compaction needs to know which sequences it must preserve, and the tempting source is the live snapshot tracker: in memory, already there, and it knows exactly who is reading.

It is the wrong source. Compaction's output would then depend on who happened to be reading when the job ran, so two runs over identical inputs could produce different files, which makes the component unreproducible and its bugs unrepeatable. And a promise that exists only in a reader's memory does not survive a crash, while a fork anchor is durable so that a process which never saw the original reader can still honour it.

So retention pins come from the durable catalog, never from the snapshot tracker and never from child state manifests. Both pin shapes below are deterministic for the same reason: they depend on catalog anchors, and never on which snapshots happen to be live. It is also why compaction has to be able to read the catalog while holding the level manifest, which is what constrains the lock order.

### The pin can only turn a drop into a keep {#additive-pin}

Compaction already had rules for deciding whether to write a version out or discard it, and those rules know nothing about branches. The pin does not replace them. It is one extra condition OR'd onto the answer they give:

```rust
// src/iter.rs
// The inherited-view pin is an override layer over the rules above:
// it only ever adds retention, so parent-visible behaviour with no
// children is byte-identical to a store that never forked.
let should_output = output_ignoring_pin || pinned_by_child_view;
if pinned_by_child_view && !output_ignoring_pin {
	self.pin_retained_versions += 1;
}
```

`output_ignoring_pin` is the pre-branching answer. Because the pin can only flip a false to a true, it can turn a discard into a keep and never the reverse. Run a store with no branches and `pinned_by_child_view` is always false, so every byte compaction writes is what it would have written before branching existed. That is a property of the `||`, not something a test has to confirm.

The pin takes two shapes, depending on whether the parent keeps history at all:

```rust
// src/iter.rs
// A versioned parent pins the whole range below its highest anchor,
// because forks inherit full history and a view capped anywhere in
// that range may want any version under it. A non-versioned parent
// pins the newest version at or below each anchor separately, which
// is all a point-in-time reader can see — one version per anchor,
// not the range, which is what makes many branches affordable.
```

[[SVG:skv-pin-shapes]]

Two guards sit outside the pin. The first is `force_not_bottom`. A compaction may treat its highest level as the bottom of the read stack, where tombstones can be dropped entirely, only if nothing reads below it, and two unrelated conditions break that assumption: a branch that is forked from has anchored readers resolving below its tombstones, and a branch that is itself a fork child has ancestor layers sitting under its own bottom level.

[[SVG:skv-two-bottoms]]

Either way, the level that looks like the bottom is not the bottom. The second guard covers the bottom-level hard-delete shortcut: if a key's newest version is a hard delete, the whole key can leave the database, outputting nothing and dropping the tombstone too. Its precondition:

```rust
// src/iter.rs — hard_delete_may_drop_all
/// It is legal only when every reader that can still see an older version
/// also sees the tombstone that erases it. A reader boundary is a live
/// snapshot sequence or the inherited-view pin floor; a boundary landing in
/// `[oldest_seq, delete_seq)` reads data the tombstone does not cover for
/// it, so those versions — and the tombstone above them, which must keep
/// masking them for readers at or above `delete_seq` — have to survive.
```

A reader boundary is either a live snapshot sequence or a retention anchor, and both are checked by the same predicate. A fork anchor and a snapshot sequence are the same kind of object. One is durable, one is transient.

### Racing a fork against a compaction {#pin-races}

Anchors are durable, but they appear concurrently. A compaction job that has been merging for a while may already have discarded a version that an anchor published thirty milliseconds ago now requires, and a discarded version cannot be un-discarded.

The protocol: sample the anchor set when the job is created, re-check it under the publication lock, and refuse the output if anything appeared in between:

```rust
// src/branch.rs
/// A compaction job samples the anchor set before it merges and re-checks it
/// under the publication lock. An anchor that appeared in between may need a
/// version the job already discarded, so the output is refused. An anchor
/// that *vanished* is harmless: the job merely over-retained.
pub(crate) fn appeared_since(&self, sampled: &Self) -> Option<u64> {
	self.anchors.iter().copied().find(|anchor| !sampled.anchors.contains(anchor))
}
```

[[SVG:skv-pin-race]]

The asymmetry is deliberate. An anchor that appeared means refuse, with `Error::CompactionPinRaced { unsampled_anchor }`. The output is discarded and the inputs stay live for the next cycle. An anchor that vanished means publish anyway, since the job kept more than it needed. The fork never loses this race: a fork is a user-visible operation with a durable commit point, and a compaction is background work that can be redone.

The same discipline applies on the merge side. `record_merge_edge` holds the level manifest read guard across its catalog publication, because the edge becomes a retention anchor the instant it lands. `fork_branch` holds the same read guard across its own publish, so compaction cannot raise the retention floor underneath it. Whichever of the two publishes second sees the other and fails closed.

`compaction_pin_races` counts these refusals. A few are normal; a lot means forking against heavy compaction, and the discarded work is real.

## What a live branch costs {#cost-shapes}

None of this is benchmarked. What follows is how each cost scales, with the metric that would show it.

**Reads amplify with fork depth.** A chain *d* deep means *d* layers, each contributing its own capped iterators into one merge, so fan-in grows with depth and with each layer's live component count. `MAX_VIEW_DEPTH = 64` bounds it, and 64 is a budget, not a physical limit. A 64-layer merge is legal, and slow.

**Space grows with pinned versions.** This is the cost that accumulates. For a non-versioned parent it is roughly one extra version per anchor per touched key. `pin_retained_versions_total` counts versions that completed compactions kept solely because an anchor needed them, so it measures retention work, not live bytes on disk. It tells you whether branches are costing you.

**Runtime state is allocated lazily.** One WAL, one commit pipeline, one clock and one table-id allocator are shared by the whole store; memtables and level sets are per branch. Those arrive on a branch's first write, not at the fork, so an idle branch costs no arena.

[[SVG:skv-branch-runtimes]]

The write buffer is a `write_buffer_soft_limit`, not a hard budget, and the difference matters if you are sizing a host. Rotation does not release an immutable arena until its flush completes, and an oversized batch may need an arena larger than the configured number. A hard cap would need admission and back-pressure accounting across active, immutable and in-flight flush memory, which is a different allocator design rather than a renamed constant.

## Diff is a sequence filter {#diff}

A branch's own component set contains only rows it wrote, so scanning that set already costs what the diff costs, not what the data costs. No change journal is needed to make diff cheap.

Detach complicates it:

```rust
// src/diff.rs
//! What it is *not* is "everything the branch owns": detach
//! materializes inherited rows into the branch's own tables, so entries are
//! filtered by sequence against the fork anchor rather than assumed to be above
//! it. That filter is the difference between a diff and a lie.
```

So a diff reads through `Snapshot::own_only`, meaning the branch's own memtables and level set with no ancestor layers, and then still filters `seq > base`. Before a detach, that filter looks redundant: every owned row is above the anchor. Detach is what the filter is there for: it copies inherited rows into the branch's own tables at their original, below-anchor sequences.

[[SVG:skv-diff]]

The diff includes tombstones, because a delete is a change, and it is the change a merge most needs to be told about. It emits one entry per key, with the branch's newest write winning.

## Three-way merge against a base that moves {#merge-base}

A three-way merge needs three things per key: the value at the base, the value on the source now, and the value on the target now. The base is the last state the two branches agreed on.

The obvious choice of base is the fork anchor. That is right for the first merge and wrong for every one after it, because after a merge the two branches have agreed on something newer. If the base never moves, a second merge re-offers everything the first one applied, and re-raises conflicts that were already settled.

So the base is three sequences, not one:

```rust
// src/merge.rs
pub(crate) struct EffectiveBase {
	/// Source changes at or below this sequence have already been consumed.
	/// The source snapshot at this cap is the base side of the three-way comparison.
	pub(crate) source_through: u64,
	/// Target head produced by the previous merge. Retained as durable edge
	/// history and reported to callers; it is not a source-side base value.
	pub(crate) target_at: u64,
	/// Original divergence point. A scan probe must include every target write
	/// above this point, including target-only writes predating the last edge.
	pub(crate) fork_at: u64,
}
```

[[SVG:skv-merge-base]]

Why can't the target's head at the last merge be the base? Because merging into a target never mutates the source, so values that existed only on the target at that edge were never part of source history. Call the target-at-edge state the common base, and a later source edit to one of those keys looks uncontested, so it gets applied, and it overwrites a target value the source never knew about. The base side is therefore the source snapshot at `source_through`; `target_at` is kept as durable edge history and reported to callers, but it is not a base value. For the same reason, a scan probe covers target writes from `fork_at`, not from the last edge.

Absence is treated as an ordinary value throughout the classification, so delete-versus-delete resolves and delete-versus-modify conflicts without special cases:

[[SVG:skv-merge-verdicts]]

Some merges are refused outright. A merge is accepted only into the branch the source was forked from; siblings get `BranchesUnrelated`, because no common base is recorded and inventing one would be a guess. And a stale-generation edge is discarded, because a source deleted and recreated under the same id shares nothing with its predecessor.

Validation checks two retention floors, the target's and the source's, with the second gated on `source_through > fork_at`. A first merge's source-side base is the inherited fork view, whose parent-side anchor was already validated, and a source cannot own rows at or below its own birth.

The widget runs two successive merges with the promotion edge toggleable. Turn it off, merge, write on the target, and merge again. The second merge shows the re-offer problem the moving base exists to prevent.

[[WIDGET:skv-moving-base]]

## How a merge executes {#merge-execution}

**Which probe.** The question "has the target moved since the base?" can be answered per key, by point-reading the read stack, or once, by walking the target's own changes. Which is cheaper depends entirely on how many keys the merge touches, so the choice is made at `SCAN_PROBE_THRESHOLD = 256`. The two probes' verdict-equivalence is covered by a test, so a badly chosen threshold costs you time and never correctness. Preflight counts the source diff sequentially and switches at the same threshold instead of point-probing every changed key. There is also a fast path: a target nobody has touched matches the base on sequence alone, so planning that merge reads no values at all.

**Which commit path.** Merges go through the ordinary one. Conflict detection, the WAL and sequence allocation are handled by that path already, and there is no privileged bulk-apply path to keep correct separately. `preview_merge_into` shares the classification code with the real thing, so a preview cannot drift from what it previews.

**Whether it was atomic.** Writes are bounded at the memtable size, and `MergeOutcome::chunks` is the contract:

```rust
// src/merge.rs
/// How many transactions the merge took. One means it landed atomically;
/// more means each chunk is durable on its own and a failure part-way would
/// have left the earlier ones applied.
```

Zero means there was nothing to write. One means one transaction. More than one means the merge was resumable, not atomic. Nothing you pass to the call decides which you get. The size of the data does. So if atomicity matters, read `chunks`. A single entry above the budget is refused up front with `MergeTooLarge`.

[[WIDGET:skv-merge-chunks]]

One ordering rule governs the whole thing: data commits first, edge second.

```rust
// src/lsm.rs
// Data first, edge second. A crash in between re-offers what was already
// applied on the next merge, which converges or conflicts — never a silent
// overwrite. The opposite order would advance past changes that were never
// written and lose them.
```

[[SVG:skv-merge-commit-order]]

One order fails loudly and idempotently; the other fails silently. That is what makes the ordering a correctness property and not a preference. A scoped `merge_range` records no edge at all, on purpose: a partial apply has not earned the claim that the source is fully merged.

## Detach and revert {#detach-revert}

The ceiling model has one structural weakness: a branch that outlives its usefulness keeps taxing its parent through the retention pin. Two operations exist for that.

Detach materialises the inherited view into a single SSTable placed below the branch's own levels, then clears the parent link. The parent's retention pin is released and it can compact freely again. Detach costs a copy of everything the branch was inheriting, which is the opposite trade from forking, and it is the right answer for the one branch that turned out to be permanent.

[[SVG:skv-detach]]

The copy runs before `catalog_publish` is taken, and the owner is re-validated afterwards because it may have been fenced while the copy was running. Detach is also idempotent: if the parent link is already gone, it returns successfully instead of doing the work twice.

Revert is a compensating commit, not a rewrite. It diffs the branch's own writes in range, reads the inherited value at the anchor, skips keys already equal, and writes the rest back through an ordinary transaction. History stays append-only: the restored values are new writes at new sequences, and nothing that read the old values stops being able to.

`create_branch` is not a fork, which is the one API name worth double-checking. It creates an empty branch with no parent and no inherited view; `fork_branch` is the one that takes a `ForkPoint`.

---

So: a fork writes one catalog record and no data, at the price of a brief store-wide fence. Throwing a branch away reclaims a component set and retires a tombstone, deleting no rows, because the branch was never in the keys. Asking what changed reads the branch's own components filtered by sequence. Asking for an exact point in the past returns either that point or `TimestampBelowHorizon`. The bill for all of it lands in one place — compaction now has to be told what it may not forget — and that is the trade this design makes.

## References {#references}

### The LSM tree this is built on

- [The Log-Structured Merge-Tree (LSM-Tree)](https://www.cs.umb.edu/~poneil/lsmtree.pdf) — O'Neil, Cheng, Gawlick, O'Neil (1996). The original, and where the read and write amplification trade-off is first argued.
- [The Design and Implementation of a Log-Structured File System](https://people.eecs.berkeley.edu/~brewer/cs262/LFS.pdf) — Rosenblum & Ousterhout (1992). The ancestor idea: never overwrite, and make cleaning somebody's explicit job. Compaction is that cleaner under a new name.
- [Bigtable: A Distributed Storage System for Structured Data](https://research.google/pubs/pub27898/) — Chang et al. (OSDI 2006). Where the memtable, SSTable and compaction vocabulary comes from.
- [LSM-based storage techniques: a survey](https://link.springer.com/article/10.1007/s00778-019-00555-y) — Luo & Carey (VLDB Journal 2020). The map of the design space, and the best single survey of LSM variants.
- [Monkey: Optimal Navigable Key-Value Store](https://stratos.seas.harvard.edu/files/stratos/files/monkeykeyvaluestore.pdf) — Dayan, Athanassoulis, Idreos (SIGMOD 2017). How to reason about LSM cost analytically rather than by benchmark.
- [WiscKey: Separating Keys from Values in SSD-conscious Storage](https://www.usenix.org/system/files/conference/fast16/fast16-papers-lu.pdf) — Lu et al. (FAST 2016). Key and value separation, which the engine here no longer does.

### Versions, snapshots and reclaiming history

- [A Critique of ANSI SQL Isolation Levels](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-95-51.pdf) — Berenson et al. (1995). Where snapshot isolation is defined.
- [Multiversion Concurrency Control — Theory and Algorithms](https://dl.acm.org/doi/10.1145/319996.319998) — Bernstein & Goodman (1983). Versions as first-class, and what it means for one to still be needed.
- [An Empirical Evaluation of In-Memory Multi-Version Concurrency Control](https://www.vldb.org/pvldb/vol10/p781-Wu.pdf) — Wu et al. (VLDB 2017). Version-chain garbage collection, which is the retention-anchor problem from the other side.

### Determinism

- [Learning DST for testing our distributed transactional KV store](dst.html) — my earlier post on building a deterministic simulation tester.

### The code

In [my fork](https://github.com/arriqaaq/surrealkv):

- `docs/BRANCHING.md` — the user-facing semantics, and the source of the single-clock framing.
- `src/branch.rs` — `ForkPoint`, `RetentionAnchors`, `AnchorWalker`, and the catalog.
- `src/snapshot.rs` — the layer stack, the cap narrowing, and `SeqCappedIterator`.
- `src/iter.rs` — compaction's retention decision, the additive pin, and the hard-delete guard.
- `src/compaction/compactor.rs` — `force_not_bottom`, and where pins may come from.
- `src/merge.rs` and `src/diff.rs` — `EffectiveBase`, the classification, the two probes, and the sequence filter.
- `src/authority/` — the three lineages and the hard-link publish primitive.
- `docs/KNOWN_GAPS.md` — worth stealing the format: what, why, what it would take, and what would raise its priority.
