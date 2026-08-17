---
title: Git-style branching on an LSM key-value store
dek: Fork anchors, retention pins, and three-way merges — how a branch is built out of one sequence number.
eyebrow: Storage Engines
slug: branching-lsm
date: 2026-08-17
ogImage: skv-ceiling
byline: A build log on an experiment in branching SurrealKV — how a fork, a diff and a merge are built out of one sequence number, with each mechanism running live on the page.
---

Over the past year we've been building [SurrealKV](https://github.com/surrealdb/surrealkv), an embedded key-value store, at [SurrealDB](https://surrealdb.com/).

This is an experiment I decided to try. It came from watching what people already fork: a repository before a risky change, a dataset before an analysis, an environment before running an agent in it. In each case they want a private copy they can break and then keep or discard. The database is usually the one part they cannot fork, so they copy it by hand or change it in place.

So: can a database be branched the way a repository is? Take a private, writable copy of the whole store, change it, then either keep the result or throw it away.

The obvious way is to copy the data, and the cost of copying is what makes it useless for most of the things people want it for. So the real question is whether a branch can be created without writing anything proportional to the size of the store.

An LSM tree is a reasonable place to try. It never overwrites data in place, so old versions of a key are already sitting on disk. It already answers reads by filtering on a sequence number, so reading the store as it was at an earlier point already works. What it does not have is any way to promise that a particular old version will still be readable later.

This post is about what it costs to make that promise.

[[SVG:skv-lsm-anatomy]]

Everything described here lives on SurrealKV's `v2` branch. It is not merged, not released, and the API may still move. There are no measured numbers anywhere in this post — I reason about the shape of costs rather than quoting figures I haven't measured. Where a mechanism is named, it is named with its real type name and the file it lives in, so you can go and check it.

Part I builds up the primitives. Part II covers the one decision the rest of the design follows from. Part III is where the promise is stored durably. Part IV is compaction, which is where branching gets expensive. Part V is diff and merge. Part VI collects the decisions in one table.

The widgets are interactive and deterministic — step them, play them, change the seed. Three of them let you pick a design that doesn't work and watch it produce a wrong answer.

# Part I — First principles

## Four things people want a fork for {#why-fork}

These are the four cases I kept seeing people fork for, and on the surface they look unrelated.

An **agent sandbox** lives for seconds or minutes, is thrown away, and has to be undoable. A **dev, test or preview environment** lives for hours or days, and you want tens of them at once. **Time travel and audit** wants to read the past, and wants it exactly — an approximation of "yesterday at 09:14" is worse than an error, because you cannot tell how wrong it is. **Multi-tenant copy-on-write** wants one base dataset and many private overlays, without letting one tenant's history bill the others.

[[SVG:skv-use-cases]]

They share exactly one requirement: the cost of creating a branch must not scale with the size of the store. That rules out copying, anything that rewrites existing data, and anything that walks the keyspace.

Where they disagree is lifetime, and that sets the design target. A handful of long-lived branches can carry almost any per-branch overhead. Many short-lived ones cannot. This design assumes churn — many branches that do not last — with an explicit way out for the one that turns out to be permanent.

## What an LSM tree actually is {#lsm-primer}

Storage hardware punishes small random writes. A B-tree does exactly that: to write one key it finds the page that key belongs to and modifies it where it sits.

The log-structured answer inverts the problem. Never write to a place you chose; only append to a place you are already writing.

That single constraint generates the rest of the structure. Buffer incoming writes in memory, sorted, so reads can be served from them. When the buffer fills, write it out once, sequentially, as an immutable sorted run. Now reads have to check many runs, so periodically merge runs into fewer, larger ones. Give the runs levels so the merging has a shape. Add a bloom filter per run so a read can skip runs that certainly do not hold the key. Add a write-ahead log, because the in-memory buffer is not durable.

SurrealKV is an ordinary instance of this: an arena-backed skiplist memtable, a segmented write-ahead log, SSTables in a format it calls `LSMV3`, leveled compaction, a block cache, and bloom filters.

The property that matters for branching is a side effect. Nothing is overwritten in place, so when you write `user:7` a second time the first value is still on disk. It is superseded, not gone, and it stays readable until some later merge decides nobody can reach it.

## Three primitives branching is built out of {#primitives}

Three things an LSM already has. I'll name them separately, because the rest of the post refers back to them.

[[SVG:skv-primitives]]

**A sequence number.** Every commit draws one monotonically increasing integer. In SurrealKV that number does not sit beside the key, it sits inside it. The internal key is the user's key followed by two big-endian `u64`s:

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

Fifty-six bits of sequence, eight bits of kind — `Set`, `Delete`, `SoftDelete`, `Merge`, `RangeDelete` and a few more. The timestamp is a selector for time-travel queries; it is not what orders anything.

Internal keys sort by user key ascending, then by sequence **descending**. All the versions of one key are contiguous, and within that run the newest comes first. A reader that wants the current value of `user:7` seeks to `user:7` and takes the first thing it finds. Four later sections depend on that ordering.

**Visibility is already a filter on that number.** A read at sequence *s* ignores every version whose sequence is above *s*. That is not a branching feature; it is how snapshot isolation works. It is also why a long-running scan does not see writes that land while it runs.

**Exactly one component destroys anything.** Reads destroy nothing. Writes destroy nothing — they add a version. Compaction is the only thing in the system that makes data unreachable, because it is the only thing that decides a superseded version is no longer needed.

Put those together and the conclusion is nearly automatic. The first two mean that reading the store as it was at sequence *s* already works, for any *s* whose versions still exist. The only thing between that and a branch is the third: nothing has promised compaction will keep serving that particular *s*.

> Recap: reading at a past sequence already works. Compaction is the only thing that destroys versions, so it is the only thing that has to be told to keep one.

## What a snapshot promises, and what it refuses to {#snapshot-limits}

If reading the past already works, the obvious move is to use a snapshot. A snapshot registers a sequence number, compaction agrees not to discard anything that sequence can see, and reads stay consistent for as long as it is held.

A snapshot is transient: it is released when its reader goes away, and the engine is deliberately built so that it can be, because otherwise a forgotten reader would pin history indefinitely. It is also read-only, because a snapshot is a number you read at rather than a place you can write to.

So the missing capability is narrow and specific. Keep this readable, permanently, and let me write to it.

SurrealKV already had something adjacent, in `src/checkpoint.rs`: flush the mutable state, copy or hard-link every SSTable the manifest references, take the level manifest and the metadata, and restore by reopening through normal recovery. It works, and it isn't a branch, for four reasons.

[[SVG:skv-checkpoint-vs-fork]]

Its cost tracks live file count rather than being constant. It produces a second store, so nothing is shared afterwards and divergence costs full space on both sides. There is no diff and no merge back, because the two sides no longer share a frame of reference. And it is whole-store, so you cannot check out part of one.

The arrow in that diagram is the difference. A fork keeps a read path into its parent, which is how it avoids copying, and the parent can then no longer forget whatever that arrow points at. That second constraint is where the cost of branching lives.

## Four ways to build a branch on this {#options}

Four techniques, scored against the one requirement from earlier.

**Put the branch id in every physical key.** A fork writes nothing at all. But every branch's rows then interleave in one keyspace, so a compaction job can never be scoped to a single branch. Deleting a branch becomes a range delete over live data. The comparator carries branch semantics permanently. A user key's version chain stops being contiguous, which is the assumption the newest-first walk and the bloom filters are both built on. And a scan at fork depth *d* becomes *d* scans, one per prefix.

**Give each branch its own engine, with a copy.** Trivially correct, and it fails the requirement outright.

**Keep a per-branch root over a content-addressed tree.** Structural sharing by digest, and diff becomes cheap because equal subtrees have equal names. This is a sound design and it is not an extension of an LSM tree — it is a replacement for one. MVCC, compaction and crash recovery all have to be re-derived over a new address space.

**Make a branch a ceiling on a shared sequence counter.** A fork writes one metadata record. All the difficulty moves into compaction and read amplification.

[[SVG:skv-options]]

All four are cheap to fork. They differ mainly in what they do to the component whose job is to forget things.

# Part II — The core decision: a ceiling on one clock

## One clock for the whole store {#one-clock}

There is one global sequence counter for the whole store. Every commit on every branch draws the next number from it. Branches do not have their own clocks, and there is no per-branch head:

```rust
// src/branch.rs
/// Newest sequence this branch wrote ITSELF — not a per-branch head, which
/// a single global commit clock does not have. `None` means the branch has
/// never written, so it reads purely through its inherited view.
pub last_write_seq: Option<u64>,
```

One counter makes two branches' sequence numbers directly comparable, and that comparability is why forking and merging can be cheap. With per-branch clocks, relating two branches needs a vector, a mapping table, or a causality graph. With one clock, everything a branch is allowed to see of everything it inherits is definable by a single integer.

[[SVG:skv-ceiling]]

A branch's view is therefore a cap on that number. Not a copy, and not a filter over a second history — a ceiling.

The widget below puts commits from several branches on the shared axis. Two things to watch: no two dots anywhere share a horizontal position, because there is one ordering for the whole store; and every branch's own commits sit to the right of its own anchor.

[[WIDGET:skv-one-clock]]

A transient read version is the same idea without the durability. What makes this a branch rather than a snapshot is that the ceiling survives the reader, survives restart, and can be written to.

## A fork anchor is not a snapshot {#fork-anchor}

A snapshot is a transient registration released when its reader leaves. A fork anchor is the branch's definition. It outlives every reader and survives restart, which is what makes the view writable.

There are three ways to choose one, and this is the complete list:

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

All three resolve exactly. `Head` is exact in a way that's easy to underestimate: it includes rows the parent has committed but not yet flushed. That works because the child resolves the parent's live state — memtables included — rather than a set of files. Nothing has to be flushed for a fork to be correct.

[[SVG:skv-fork-anchor]]

Each link on a fork chain contributes a cap, and the effective ceiling is the lowest anchor on the path. A grandchild can never see more of its grandparent than its parent could, and that holds structurally rather than by a check.

Two preconditions mark the boundary of what a selector will accept. A fork sequence below the parent's own `created_at_seq` is refused, because a child cannot predate its parent. And an `AtTimestamp` retry is re-resolved rather than trusted: if the same timestamp now maps to a different sequence than the existing fork used, the retry is refused instead of quietly returning the old receipt.

## Where the branch is not: ownership lives in metadata {#no-branch-in-keys}

Branch identity rides in component metadata, and is never prefixed into a user key or an internal key. The definition says so:

```rust
// src/batch.rs
/// Physical owner of every row in a commit batch. Ownership stays in the
/// batch/component metadata and is deliberately not prefixed into user keys.
pub(crate) struct BatchOwner {
	pub(crate) branch: BranchId,
	pub(crate) generation: BranchGeneration,
}
```

A commit batch carries one owner. A memtable is branch-pure and rejects a batch belonging to anyone else. An SSTable persists its owner in its table metadata — that is what the `LSMV3` format version is — and manifest load fails closed if a level set's owner disagrees with the table's persisted owner. The level manifest is partitioned per owner, and reads select one:

```rust
// src/levels/mod.rs
// Point reads address this by physical owner; branch count must not enter
// the lookup cost.
levels_by_owner: HashMap<BatchOwner, Levels>,
```

There is deliberately no owner-blind level access, so a read path cannot accidentally mix owners. The `HashMap` is recent; it was a `Vec` scanned linearly, which put total branch count into the cost of every point read and every layer of an inherited read.

[[SVG:skv-key-vs-metadata]]

Three things follow. Compaction stays a single-owner operation by construction rather than by discipline. Deleting a branch becomes reclaiming a component set rather than deleting rows. And the user key comparator never learns what a branch is, so a key's version chain stays contiguous and newest-first — which is what the comparator, the bloom filters and every seek in the read path rely on.

[[SVG:skv-key-ownership]]

## Reads: a stack of layers, each with its own ceiling {#read-stack}

A branch owns only what it wrote. Everything else it can see belongs to an ancestor, and it may only see the part of that ancestor below its anchor. So a read has to consult several component sets, each with a different visibility rule.

A snapshot is therefore not a filter but a stack of layers, walked nearest-first, where each layer carries its own cap:

```rust
// src/snapshot.rs — Snapshot::new_owned
let mut cap = seq_num;
for (branch, generation, fork_seq) in chain {
	cap = cap.min(fork_seq);
	layers.push(SnapshotLayer { owner: BatchOwner { branch, generation }, runtime: ..., cap });
}
```

Three lines, carrying the whole model: walk the parent chain nearest-first and narrow monotonically. A layer's cap is `min(snapshot seq, every fork anchor on the path to that ancestor)`.

[[SVG:skv-read-stack-anatomy]]

Within a layer the search order is the ordinary one: active memtable, then immutable memtables newest-first, then L0 across all overlapping tables, then L1 and below by binary search — each seeking at the layer's cap rather than the snapshot's. The first visible version wins and the walk stops. A tombstone in a nearer layer hides every farther layer: a delete answers "absent" rather than abstaining and letting an ancestor answer.

The part that took me longest to see is that per-layer caps cannot be expressed as one filter on the merged stream. Every one of a layer's iterators is wrapped before it reaches the merge:

```rust
// src/snapshot.rs
// Every iterator of this layer is wrapped in a SeqCappedIterator
// BEFORE the merge: per-layer fork caps cannot be expressed by
// the merged stream's global snapshot filter.
```

The reason is the ordering rule from earlier. Within a key, versions arrive sequence-descending. A capped iterator walks a key's above-cap versions down to its visible one. A filter placed after the merge has already let a different layer's row win the key before it is consulted, so it does not merely admit a wrong row — it admits a wrong row as the answer.

[[SVG:skv-cap-before-merge]]

The widget below runs the same three-layer merge both ways. Watch what the leaked rows look like: well formed, correctly ordered, and below the snapshot's own sequence. They are wrong only because of which layer supplied them.

[[WIDGET:skv-per-layer-caps]]

> Recap: a snapshot is a stack of layers, each with its own cap. The caps go on before the merge, because afterwards nobody knows which layer a row came from.

## Copy-on-write shadowing, for free {#cow-shadowing}

A child writes to a key it inherited. Now two versions of that key exist in two different component sets, and every read on the child has to prefer the child's. The usual solutions involve bookkeeping: a dirty set, a shadow table, a per-key override map, a copied page.

None of that exists here, because none of it is needed. A child only writes after it forked, and every write draws from the one global counter, so a child's sequences always exceed everything it inherited — including its own anchor. Its write to an inherited key is automatically the newest version of that key inside its own stack.

[[SVG:skv-shadow]]

Deletion works the same way. A tombstone in the child's layer at a higher sequence hides the parent's row without the parent knowing, so a branch can delete a row it does not physically hold.

One corollary matters later. What a branch *owns* and what a branch *wrote* are different sets, because detach materialises inherited rows into the branch's own tables at their original sequences. That is why the diff further down cannot simply say "everything in my own components".

## What a fork actually writes {#fork-protocol}

The commit point of a fork is a single catalog publication, and no data is copied.

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

The fence stops write admission store-wide and then spins until the commit pipeline reports drained, so `visible_seq_num` is exactly the head rather than approximately it. Without that, `ForkPoint::Head` would resolve to a number with in-flight commits on either side of it, and the child's view would be neither the head nor any other well-defined point. Missing the deadline gives `Error::ForkFenceTimeout`, which is retryable.

Before publishing, two things are checked. The ancestor chain depth budget, `MAX_VIEW_DEPTH = 64`. And whether the parent can still answer at the resolved sequence:

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

That predicate is why a historical fork can be refused rather than approximated.

The fence is store-wide, not parent-wide. `ForkPoint::Head` briefly stalls every writer in the store, not only writers on the parent. One global clock is one global serialisation point. The metric `fork_drain_nanos` divided by `forks` is the average pause every writer took for somebody else's fork.

One step now runs before the mutex: if the catalog is at its 4,096-record cap, a create or fork performs a synchronous reclamation sweep and blocks rather than failing. That is covered below.

> Recap: a fork fences writes store-wide, drains so the head is exact, then publishes one catalog version. That publish is the commit point, and no data is copied.

# Part III — Where the promise is stored

## No MANIFEST file: numbered lineages published by hard link {#authority}

If a fork's commit point is a single durable act, you need a primitive that either happens or does not. The usual answer in an LSM is a MANIFEST: append to it, or rewrite it and rename the new one into place.

Rename is atomic in the sense that no reader sees a half-written file. It is not compare-and-swap. It will happily clobber a version written by someone else, so it cannot express "publish this only if the state I read is still current".

So there is no MANIFEST file. There are three numbered, immutable metadata lineages, never rewritten in place:

```
<db>/catalog/<version>.catalog            magic SKBC   the branch catalog
<db>/branch/<branch-id>/<version>.state   magic SKBM   one branch's owned facts
<db>/root/<version>.root                  magic SKRT   global recovery facts
```

Each file is magic, version, body, CRC32. The publish primitive is a conditional create via `fs::hard_link`: linking to a name that already exists fails with `AlreadyExists`, at which point the publisher byte-compares and reports `AlreadyExistsSame` if the content matches.

[[SVG:skv-lineages]]

Two things follow. It is a real compare-and-swap on a filesystem, so two concurrent publishers cannot silently overwrite each other — whichever loses sees the other and fails closed. And retries become idempotent: re-publishing identical bytes after an interrupted attempt is indistinguishable from having succeeded the first time, which is what you want when the commit point of a user-visible operation might be interrupted. Four versions of each lineage are kept.

### Generations, and why a name is not an identity

The catalog is the sole authority for branch existence, generation, parentage, anchors and TTLs. Names are reusable; incarnations are not. Every physical owner names a `(BranchId, BranchGeneration)` pair, and generations are globally monotone. A handle to a deleted branch whose name has since been reused is fenced with `BranchFenced` rather than silently rebinding to a different branch that happens to share the name. For the same reason, a merge edge naming a stale generation is not that branch's history and is discarded.

> Recap: rename is not compare-and-swap, so metadata is published as numbered immutable versions created by hard link. Concurrent publishers fail closed, and retrying an identical publish is free.

## The catalog's lifecycle: tombstones are fences, not tenants {#catalog-lifecycle}

Deleting a branch cannot just drop its catalog record. At the moment you delete it, its runtimes may exist, its WAL segments may be pinned, and its level state, tables and own authority lineage all exist on disk. Something durable has to say "this branch is going away", so that a crash mid-teardown does not leave orphans nothing will ever reclaim.

So deletion publishes a tombstone. The tombstone then has to be retired, because the catalog has a hard format cap of `MAX_CATALOG_ENTRIES = 4096`. If every tombstone lived forever, what consumes the cap would be lifetime create count rather than concurrent live branches — a very different number for a store that churns sandbox branches.

`BranchCatalog::retire_deleted()` removes it, and the order matters.

[[SVG:skv-catalog-lifecycle]]

Reclaim runtimes, WAL dependencies, level state and tables first. Then remove the branch's state lineage directory and sync the parent directory. Only then retire the tombstone, in a new catalog publication. A failure anywhere before the last step leaves the tombstone in place, so maintenance retries safely — the ordering is what makes retirement crash-safe.

What still fences a reused id is not the tombstone but the generation: generations are globally monotone and a physical owner names its generation, so an old transaction or a stale WAL row stays fenced even if a `BranchId` is minted again.

That let a neighbouring invariant get smaller. `max_version_anchor` used to promise the maximum version anchor across all records including tombstones, so the recovered clock could never fall below a catalog-referenced sequence. It now promises only the maximum across records the latest catalog still represents, because retired records need no clock anchor: their data and authority lineage are already gone, and `next_generation` carries the fencing on its own.

One consequence of the synchronous sweep: `MAX_CATALOG_ENTRIES` now bounds not only how many branches can exist but how fast they can be created once you are near it.

> Recap: deletion writes a tombstone so a crash leaves no orphans, then retires it after reclamation so the 4,096-record cap counts live branches. Generations fence a reused id.

## Four locks, one order {#lock-order}

Branching added operations that touch several pieces of global state at once. A fork touches the catalog, the level manifest and the commit pipeline. A detach copies a dataset and publishes a catalog version. A checkpoint reads every table and needs metadata to stop moving. Any two of these taking the same pair of locks in opposite orders is a deadlock, not a rare race.

[[SVG:skv-lock-order]]

The order is `branch_materialization`, then `catalog_publish`, then the commit pipeline write fence and the level manifest.

`branch_materialization` is a plain `Mutex<()>` and is deliberately separate from `catalog_publish`. Detach copies everything a branch was inheriting, which is proportional to the dataset. Holding the catalog serialiser across that would block every unrelated branch operation in the store for the duration of a bulk copy. So detach materialises first, takes `catalog_publish` only for the final parent-link publication, and re-validates the owner afterwards, because it may have been fenced while the copy was running.

The order is enforced by a test that reads the source text of `record_merge_edge` and asserts that `catalog_publish.lock()` appears before `level_manifest.read()`. Lock ordering is a property of the code's shape rather than of any single execution, so no amount of running it proves the absence of the inverted path. Several architecture guards here work the same way — one checks that a removed engine's module has not reappeared, another that `levels_by_owner` is still a `HashMap` and not a linear scan.

## Pins come from the catalog and nowhere else {#catalog-authority}

Compaction needs to know which sequences it must preserve, and there is an obvious place to get that: the live snapshot tracker. It is in memory, it is already there, and it knows exactly who is reading.

It is the wrong source. Compaction's output would then depend on who happened to be reading when the job ran, so two runs over identical inputs could produce different files — which makes the component unreproducible and its bugs unrepeatable. Worse, a promise that exists only in a reader's memory does not survive a crash, and a fork anchor is durable precisely so it can be honoured by a process that never saw the reader who created it.

So retention pins come from the durable catalog, never from the snapshot tracker and never from child state manifests. Both pin forms are deterministic, because they depend on durable catalog anchors and not on which snapshots are live.

This is also what forces the lock order above: compaction lives under the level manifest and has to be able to consult the catalog.

# Part IV — The bill: compaction

## Compaction is where branching gets hard {#compaction-problem}

Everything so far has been cheap. This is the bill.

Compaction's purpose is to discard superseded versions. A live fork anchor says that some superseded version is still somebody's current. So the one component whose job is forgetting has to be told what it may not forget — durably, deterministically, and without making the no-branches case slower.

[[SVG:skv-compaction-conflict]]

The failure modes pull in opposite directions. Drop the version a child's anchor needs and the child reads a row that was never there at its anchor: a silent wrong answer, not an error. Drop the version a merge's base sits at and the next merge compares against the wrong thing and overwrites. Keep everything and a single long-lived branch pins its parent's entire history for as long as it exists.

## Why one anchor is not enough {#anchor-set}

The natural first move is to keep one number per owner: the lowest sequence anybody still needs, and preserve everything at or above it. That is how a retention floor works.

It does not survive two branches forked at different points. The doc comment states the argument compactly, so here it is in full:

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

Each of the three cheaper policies fails. Pin only the lowest, and a child forked higher up resolves to a version that was never current at its anchor. Pin only the highest, and the lower fork finds nothing at all. Range-pin everything below the highest, and one branch forked at head retains its parent's whole history for as long as it lives.

[[SVG:skv-anchor-kinds]]

Anchors do not only come from children. A live merge edge contributes two: its target-side head, which preserves durable edge history, and its source-side cursor, which preserves the actual three-way base. The merge section explains why the second is necessary. A stale edge pins nothing at all, because its source is gone and no future merge can measure from that base — holding history for a deleted branch is how a store that churns sandbox branches would never reclaim anything.

Honouring *n* anchors over *m* versions looks like *n × m* comparisons. It isn't, because both lists are sorted the same way:

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

One index that never rewinds, `O(versions + anchors)` for arbitrarily many branches. One version can serve several anchors at once, which is the case that makes many branches cheap.

[[SVG:skv-anchor-walker]]

The widget lets you place fork anchors between versions — the only case where the four policies disagree — and run each policy against the same chain.

[[WIDGET:skv-anchor-policy]]

Both the set and the range answer every anchor correctly. Only the retained count separates them, so the argument for the set is a counter rather than a correctness bug.

> Recap: anchors are a set because no single anchor serves several forks correctly. `AnchorWalker::serves` honours all of them in one pass over a key's versions.

## The pin is an additive override {#additive-pin}

The pin is a layer over compaction's existing rules, and it only ever adds retention:

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

With no children, output is byte-identical to a store that never had branching compiled in. Branching cannot regress the unbranched engine, by construction rather than by testing.

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

Two guards sit outside the pin. The first is `force_not_bottom`. A compaction may treat its highest level as the bottom of the read stack — where tombstones can be dropped entirely — only if nothing reads below it, and two unrelated conditions break that. A branch that is forked from has anchored readers resolving it below its tombstones. A branch that is itself a fork child has ancestor layers sitting under its own bottom level.

[[SVG:skv-two-bottoms]]

The second is the bottom-level hard-delete shortcut. If a key's newest version is a hard delete, the whole key can leave the database: output nothing and drop the tombstone too. The guard on it reads as a definition rather than a patch:

```rust
// src/iter.rs — hard_delete_may_drop_all
/// It is legal only when every reader that can still see an older version
/// also sees the tombstone that erases it. A reader boundary is a live
/// snapshot sequence or the inherited-view pin floor; a boundary landing in
/// `[oldest_seq, delete_seq)` reads data the tombstone does not cover for
/// it, so those versions — and the tombstone above them, which must keep
/// masking them for readers at or above `delete_seq` — have to survive.
```

A reader boundary is either a live snapshot sequence or a retention anchor, and both are checked by the same predicate. A fork anchor and a snapshot sequence are the same kind of object: one durable, one transient.

> Recap: the pin only adds retention, so a store with no children compacts as an unbranched one would. A non-versioned parent keeps one version per anchor, not the range.

## Racing a fork against a compaction {#pin-races}

Anchors are durable, but they appear concurrently. A compaction job that has been merging for a while may already have discarded a version that an anchor published thirty milliseconds ago now requires, and a discarded version cannot be un-discarded.

The protocol is to sample the anchor set when the job is created, re-check it under the publication lock, and refuse the output if anything appeared:

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

The asymmetry is deliberate. Appeared means refuse, with `Error::CompactionPinRaced { unsampled_anchor }`; the output is discarded and the inputs stay live for the next cycle. Vanished means publish anyway, since the job merely kept more than it needed. There is no case where the fork loses. A fork is a user-visible operation with a durable commit point; a compaction is background work that can be redone.

The same discipline applies on the merge side. `record_merge_edge` holds the level manifest read guard across its catalog publication, because the edge becomes a retention anchor the instant it lands. `fork_branch` holds the same read guard across its own publish so compaction cannot raise the retention floor underneath it. Whichever of the two publishes second sees the other and fails closed.

`compaction_pin_races` counts them. A few are normal; a lot means forking against heavy compaction, and the discarded work is real.

> Recap: a compaction samples anchors when it starts and re-checks under the publish lock. An anchor that appeared refuses the output; one that vanished is harmless.

## What a live branch costs {#cost-shapes}

Cost shapes rather than measurements, and the metric that shows each one.

Read amplification tracks fork depth. A chain *d* deep means *d* layers, each contributing its own capped iterators into one merge, so fan-in grows with depth and with each layer's live component count. `MAX_VIEW_DEPTH = 64` bounds it, and it is a budget rather than physics — a 64-layer merge is legal and slow.

Space tracks pinned versions, and this is the one that grows. For a non-versioned parent it is roughly one extra version per anchor per touched key.

Runtime state is lazy. There is one WAL, one commit pipeline, one clock, one table-id allocator and one write-buffer soft limit; there are *N* memtables and *N* level sets. Those are allocated on a branch's first write and never at the fork, so an idle branch costs no arena.

[[SVG:skv-branch-runtimes]]

[[SVG:skv-what-a-branch-costs]]

Two metric names changed meaning recently. `pin_retained_versions_total` is a cumulative counter of versions that completed compactions retained solely because an anchor needed them, since the process opened. It measures retention work, not how many extra versions are live on disk, so it tells you whether branches are costing you rather than how much space they hold. And the write buffer is a `write_buffer_soft_limit` rather than a budget: rotation does not release an immutable arena until its flush completes, and an oversized batch may need an arena larger than the configured number. A hard cap would need admission and back-pressure accounting across active, immutable and in-flight flush memory, which is a different allocator design rather than a rename.

The design target, restated: many short-lived branches. A permanent branch is meant to detach.

# Part V — Reading what changed

## Diff is a sequence filter {#diff}

A branch's own component set contains only rows it wrote, so scanning it is already proportional to the diff rather than to the data. No change journal is needed to make diff cheap.

One thing complicates it:

```rust
// src/diff.rs
//! What it is *not* is "everything the branch owns": detach
//! materializes inherited rows into the branch's own tables, so entries are
//! filtered by sequence against the fork anchor rather than assumed to be above
//! it. That filter is the difference between a diff and a lie.
```

So a diff reads through `Snapshot::own_only` — the branch's own memtables and level set, with no ancestor layers — and then still filters `seq > base`. Before a detach that filter looks redundant, because every owned row is above the anchor by construction. Detach is what makes it load-bearing.

[[SVG:skv-diff]]

The diff is tombstone-inclusive, because a delete is a change and it is the change a merge most needs to be told about. It emits one entry per key, with the branch's newest write winning.

## Three-way merge against a base that moves {#merge-base}

A three-way merge needs three things per key: the value at the base, the value on the source now, and the value on the target now. The base is the last state the two branches agreed on.

The obvious choice is the fork anchor. That is right for the first merge and wrong for every one after it, because after a merge the two branches have agreed on something newer. Without moving the base, a second merge re-offers everything the first applied and re-raises conflicts that were already settled.

So the base is three sequences rather than one:

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

The target head cannot be the base. Merging into a target never mutates the source, so values that existed only on the target at that edge were never part of source history. Read the target at that edge and call the result the common base, and a later source edit to one of those keys looks uncontested, so it gets applied and overwrites a target value the source never knew about. The base side is therefore the source snapshot at `source_through`, while `target_at` is retained as durable edge history and reported to callers but is not a base value. For the same reason a scan probe covers target writes from `fork_at` rather than from the last edge.

Absence is treated as an ordinary value throughout, which is what makes delete-versus-delete resolve and delete-versus-modify conflict without special cases:

[[SVG:skv-merge-verdicts]]

Two refusals are structural. A merge is accepted only into the branch the source was forked from; siblings get `BranchesUnrelated`, because no common base is recorded and inventing one would be a guess. And a stale-generation edge is discarded, because a source deleted and recreated under the same id shares nothing with its predecessor.

Validation checks two retention floors, the target's and the source's, with the second gated on `source_through > fork_at` — because a first merge's source-side base is the inherited fork view, whose parent-side anchor was already validated, and a source cannot own rows at or below its own birth.

The widget runs two successive merges with the promotion edge toggleable. Turn it off, merge, write on the target, and merge again.

[[WIDGET:skv-moving-base]]

> Recap: the base is the source snapshot at the consumed cursor. The previous target head is edge history, not a base value, because merging never mutates the source.

## Two probes, one commit path, and whether it was atomic {#merge-execution}

Three execution decisions.

The question "has the target moved since the base?" can be answered per key by point-reading the read stack, or once by walking the target's own changes. Which is cheaper depends entirely on how many keys the merge touches, so the choice is made at `SCAN_PROBE_THRESHOLD = 256`. Their verdict-equivalence is a test rather than an assumption, so a badly chosen threshold costs time and never correctness. Preflight counts the source diff sequentially and switches at the same threshold instead of point-probing every changed key. There is also a fast path: a target nobody has touched matches the base on sequence alone, so planning that merge reads no values at all.

Merges go through the ordinary commit path. They get conflict detection, the WAL and sequence allocation for free, and there is no privileged bulk-apply path to keep correct separately. `preview_merge_into` shares the classification code with the real thing, so a preview cannot drift from what it previews.

Writes are bounded at the memtable size, and `MergeOutcome::chunks` is the contract:

```rust
// src/merge.rs
/// How many transactions the merge took. One means it landed atomically;
/// more means each chunk is durable on its own and a failure part-way would
/// have left the earlier ones applied.
```

Zero means there was nothing to write, one means one transaction, and more than one means resumable rather than atomic. Nothing passed to the call decides which you get — the size of the data does — so if atomicity matters you read `chunks` rather than assume it. A single entry above the budget is refused up front with `MergeTooLarge`.

[[WIDGET:skv-merge-chunks]]

Finally, the ordering rule: data commits first, edge second.

```rust
// src/lsm.rs
// Data first, edge second. A crash in between re-offers what was already
// applied on the next merge, which converges or conflicts — never a silent
// overwrite. The opposite order would advance past changes that were never
// written and lose them.
```

[[SVG:skv-merge-commit-order]]

One order fails loudly and idempotently and the other fails silently, which is what makes it a correctness property rather than a preference. A scoped `merge_range` records no edge at all, deliberately: a partial apply has not earned the claim that the source is fully merged.

> Recap: the two probes give the same verdicts, so the threshold costs time and not correctness. `chunks` is reported because the size of the data decides atomicity.

## Detach and revert {#detach-revert}

The ceiling model has one structural weakness: a branch that outlives its usefulness keeps taxing its parent. Two operations exist for that.

Detach materialises the inherited view into a single SSTable placed below the branch's own levels, then clears the parent link. The parent's retention pin is released and it can compact freely again. It costs a copy of everything the branch was inheriting — the opposite trade from forking — and it is the right answer for a branch that turned out to be permanent.

[[SVG:skv-detach]]

As covered above, the copy runs before `catalog_publish` is taken and the owner is re-validated afterwards. There is also an idempotency escape: if the parent link is already gone, detach returns successfully rather than doing the work twice.

Revert is a compensating commit rather than a rewrite. It diffs the branch's own writes in range, reads the inherited value at the anchor, skips keys already equal, and writes the rest through an ordinary transaction. History stays append-only, so the restored values are new writes at new sequences and nothing that read the old values stops being able to.

One API note that will catch people: `create_branch` is not a fork. It creates an empty branch with no parent and no inherited view. `fork_branch` is the one that takes a `ForkPoint`.

# Part VI — The design in one place

## Refusal as a design stance {#refusal}

The error list is the most opinionated part of this design, and it reads better as a design document than as an appendix. Each entry names something the engine declined to guess.

[[SVG:skv-errors]]

The principle behind all of them is stated once in the docs: a fork that quietly lost rows would be worse than a refused one.

The same stance appears where there is no error at all. Timeline resolution is exact-or-abstain rather than nearest-match. `MergeOutcome::chunks` reports what happened instead of letting you assume atomicity. `view_is_complete_at` returns false for any cap below the floor that is not itself a pinned anchor, because such a cap reads whatever happened to survive.

One qualification on the taxonomy: three newer refusal paths — a fork sequence before its parent's creation, a detach whose owner was fenced mid-copy, and a checkpoint whose commit drain timed out — reuse existing variants rather than adding new ones. The list is the taxonomy of what gets refused, not an index of call sites.

## The designs that were rejected {#rejected}

The rejected designs carry as much information as the chosen ones.

**A branch id in every physical key.** Covered above; ownership went into component metadata instead.

**A bounded fork-delta table.** The idea was that a child would hold the parent's committed-but-unflushed rows so it could resolve without reaching into the parent. Inherited views are logical instead, resolved through the parent's live memtables, which makes every fork point exact without a copy — and flattening a view is a copy, which is the thing a fork exists to avoid. A related idea went with it: that a child should recover entirely from its own root without the parent. The parent is guaranteed resolvable, so independence bought nothing and cost a copy.

**A commit change journal for diff and merge.** Unnecessary once diff restricts itself to owned components.

**Coupling WAL rotation to branch memtable rotation.** Branch rotations are independent and the WAL rotates on its own size policy at append time. The coupled version would have multiplied WAL churn by branch count.

**A lock-free runtime registry.** It is an `RwLock<HashMap>`, and lock-freedom is recorded as an optimisation rather than a requirement. `levels_by_owner` later became a `HashMap` too, for the reason the registry's comment anticipated: lookup cost must not scale with branch count.

**Chunked arenas, and a hard write-buffer cap.** Arenas are right-sized lazily so an idle branch allocates nothing, and the cap became a soft limit because the arena design cannot honestly provide a bound.

**Per-branch snapshot trackers.** The global tracker is conservative — a snapshot on one branch pins visibility for every owner's compaction. Correct, not optimal, deferred.

**A durable merge intent.** It would close a narrow window between a merge's data commit and its edge record. It is declined rather than deferred, on the grounds that each thing it would buy is already true, already free, or actively worse. In that window the engine refuses rather than proceeds, which is the safe end of it.

Most of these were rejected because their cost scaled with branch count, and four of them were resolved by removing a mechanism rather than adding one.

## The decision log {#decision-log}

[[SVG:skv-decision-log]]

## Current state and limits {#limits}

Where this stands.

It is not merged. All of it lives on SurrealKV's `v2` branch; `main`'s latest release is 0.21.3 and its README has no branching content. The public API is snapshot-tested and the user-facing semantics are documented, but nothing here is released and names may still move.

There are no measured numbers — no benchmark for fork latency, for read amplification against depth, or for pinned space per live branch. `pin_retained_versions_total` exists; a study that uses it does not.

The fork fence is store-wide, so `ForkPoint::Head` stalls every writer in the store rather than only the parent's. One global clock is one global serialisation point.

`ForkFenceTimeout` is unreachable by construction. There is no suspension point between the commit pipeline's enqueue and publish, so the fence always finds a drained pipeline — measured at zero timeouts in 200 fork attempts against 217 concurrent commits with the timeout set to zero. The guard stays because the async port introduces the `await` that makes it reachable. Checkpoint now runs an identical spin-to-drained under the same timeout but reports a different error, and that path is not covered by the same analysis.

The snapshot tracker is global, so one long-lived snapshot on an audit branch conservatively pins visibility for every owner's compaction.

Catalog publication is `O(B)`: every branch mutation still clones and encodes all live branch records. Tombstone retirement removed the capacity failure but not this cost, and it is deliberately not patched, because the fix belongs to a persistent-subobject metadata format rather than to a local change inside the current numbered-manifest format.

Async and object-store IO are not implemented at all. The current engine is filesystem-oriented.

Deterministic simulation is blocked on two ambient sources of randomness that are still in place: the skiplist draws a tower height per insert, and minted identities fold in a process-wide counter and the pid. Both are recorded decisions with named triggers, and together they mean a branching bug cannot currently be replayed from a seed. For this class of system that is the capability I would want next.

The named limits are budgets rather than physics. `MAX_VIEW_DEPTH = 64` means a chain that deep puts 64 layers into one merge, and `MAX_CATALOG_ENTRIES = 4096` is a number somebody will hit — near which a create or fork blocks on a synchronous sweep.

TTL is swept rather than timed. An expired branch is tombstoned by the maintenance pass, so between its deadline and the sweep it is fenced rather than readable. That is the safe direction, and it is still not what "expires at" sounds like.

Explicit non-goals, so nobody waits for them: `rebase`, tags, notes, and criss-cross, schema-aware, JSON or graph merges.

---

Back to the question at the start. A fork writes one catalog record and no data, at the price of a brief store-wide fence. Throwing one away reclaims a component set and retires a tombstone, with no rows deleted, because the branch was never in the keys. Asking what changed reads the branch's own components filtered by sequence. Asking for an exact point in the past returns either that point or `TimestampBelowHorizon`.

## References {#references}

### The LSM tree this is built on

- [The Log-Structured Merge-Tree (LSM-Tree)](https://www.cs.umb.edu/~poneil/lsmtree.pdf) — O'Neil, Cheng, Gawlick, O'Neil (1996). The original, and where the read and write amplification trade-off is first argued.
- [The Design and Implementation of a Log-Structured File System](https://people.eecs.berkeley.edu/~brewer/cs262/LFS.pdf) — Rosenblum & Ousterhout (1992). The ancestor idea: never overwrite, and make cleaning somebody's explicit job. The collision in Part IV is that cleaner under a new name.
- [Bigtable: A Distributed Storage System for Structured Data](https://research.google/pubs/pub27898/) — Chang et al. (OSDI 2006). Where the memtable, SSTable and compaction vocabulary comes from.
- [LSM-based storage techniques: a survey](https://link.springer.com/article/10.1007/s00778-019-00555-y) — Luo & Carey (VLDB Journal 2020). The map of the design space, and a good place to check Part I against.
- [Monkey: Optimal Navigable Key-Value Store](https://stratos.seas.harvard.edu/files/stratos/files/monkeykeyvaluestore.pdf) — Dayan, Athanassoulis, Idreos (SIGMOD 2017). Reasoning about cost shapes analytically rather than by benchmark, which is what Part IV attempts.
- [WiscKey: Separating Keys from Values in SSD-conscious Storage](https://www.usenix.org/system/files/conference/fast16/fast16-papers-lu.pdf) — Lu et al. (FAST 2016). Key and value separation, which `v2` removed.

### Versions, snapshots and reclaiming history

- [A Critique of ANSI SQL Isolation Levels](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-95-51.pdf) — Berenson et al. (1995). Where snapshot isolation is defined.
- [Multiversion Concurrency Control — Theory and Algorithms](https://dl.acm.org/doi/10.1145/319996.319998) — Bernstein & Goodman (1983). Versions as first-class, and what it means for one to still be needed.
- [An Empirical Evaluation of In-Memory Multi-Version Concurrency Control](https://www.vldb.org/pvldb/vol10/p781-Wu.pdf) — Wu et al. (VLDB 2017). Version-chain garbage collection, which is the retention-anchor problem from the other side.

### Determinism

- [Learning DST for testing our distributed transactional KV store](dst.html) — my earlier post on building a deterministic simulation tester, for what the two remaining sources of ambient randomness actually block.

### The code

On SurrealKV's `v2` branch:

- `docs/BRANCHING.md` — the user-facing semantics, and the source of the single-clock framing.
- `src/branch.rs` — `ForkPoint`, `RetentionAnchors`, `AnchorWalker`, and the catalog.
- `src/snapshot.rs` — the layer stack, the cap narrowing, and `SeqCappedIterator`.
- `src/iter.rs` — compaction's retention decision, the additive pin, and the hard-delete guard.
- `src/compaction/compactor.rs` — `force_not_bottom`, and where pins may come from.
- `src/merge.rs` and `src/diff.rs` — `EffectiveBase`, the classification, the two probes, and the sequence filter.
- `src/authority/` — the three lineages and the hard-link publish primitive.
- `docs/KNOWN_GAPS.md` — worth stealing the format: what, why, what it would take, and what would raise its priority.
