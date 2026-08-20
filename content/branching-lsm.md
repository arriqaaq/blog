---
title: Git-style branching on an LSM key-value store
dek: How a fork, a diff and a merge are built out of one sequence number.
eyebrow: Storage Engines
slug: branching-lsm
date: 2026-08-17
ogImage: skv-ceiling
byline: "A build log on a personal experiment: adding git-style branching to an LSM key-value store, with each mechanism running live on the page."
---

Agents need somewhere to work that they can break. Handing one a scratch copy of a repository is routine, and a container is easier still. The database is the part that's hard to hand over, because a copy of it costs a copy of the data.

I came at this sideways, from [building a filesystem on a database](https://arriqaaq.com/blog/posts/agent-filesystem.html) so that every byte could say which action wrote it and be rolled back on its own. That part worked. Giving each agent its own copy of the database underneath it — an embedded SurrealDB over SurrealKV — was where the idea got expensive.

So I spent a while trying to make that copy cheap. I did it on [my fork](https://github.com/arriqaaq/surrealkv) of [SurrealKV](https://github.com/surrealdb/surrealkv), an embedded key-value store: git-style branching, with a fork, a diff and a merge, built on top of an LSM tree instead of beside one. I wanted to know what it takes and where the bill ends up. It does end up somewhere, and finding out where was most of the work.

Three cases want a branch, and they want different things from it. An **agent sandbox** lives for seconds or minutes, gets thrown away, and has to be undoable. A **dev, test or preview environment** lives for hours or days, and you want tens of them at once without standing up tens of stores. **Time travel and audit** wants to read the past exactly, where "yesterday at about 09:14" is worse than an error — an error tells you it failed, and an approximation leaves you to guess how wrong it is.

[[SVG:skv-use-cases]]

What those three share is that branches are mostly numerous and mostly short-lived. I sized the design for that: tens at a time, plus a way out for the one that turns out to be permanent.

Two things up front. None of this is released and the names may still move, and nothing here is benchmarked — where I describe a cost below I mean its shape and the metric that would show it, never a number I measured. Every mechanism is named with its real type and the file it lives in, so you can check any of it against the fork.

## How an LSM tree works {#lsm-primer}

A key-value store has to put each write somewhere, and that choice decides everything else. A B-tree puts it in the page where the key belongs, which scatters small random writes all over the disk — the one access pattern storage hardware handles worst. A **log-structured merge tree** takes the opposite bet: never modify data where it sits, only ever append.

- A write is appended to a **write-ahead log** first, so it survives a crash.
- Then it goes into the **memtable**, an in-memory buffer that keeps keys sorted so reads can be served straight out of it.
- When the memtable fills, it is written to disk in one sequential pass as an **SSTable**, an immutable sorted file. Fresh tables land in level 0, where their key ranges are allowed to overlap.
- Reads therefore have to check the memtable and every table that might hold the key, so a background job called **compaction** merges overlapping tables into fewer, larger, non-overlapping ones further down — L1, L2 and so on, each level roughly ten times the size of the one above it. Every table carries a **bloom filter**, a small summary that lets a read skip a table that certainly doesn't hold the key.
- A **delete** is a write too: it appends a **tombstone**, a marker saying the key is gone, and the old value stays on disk until some compaction removes the pair together.

That lifecycle is worth operating by hand. Put a few keys and watch the memtable flush; put the same key twice and find both versions sitting on disk; then compact, and watch the older one leave.

[[WIDGET:skv-lsm-basics]]

SurrealKV implements all of that without surprises — a skiplist memtable, a segmented write-ahead log, leveled compaction, a block cache, bloom filters. If you have read one LSM engine you have read most of this one.

[[SVG:skv-lsm-anatomy]]

Appending has a side effect that everything later leans on. Nothing is overwritten in place, so when you write `user:7` a second time the first value is still sitting on disk, superseded and still perfectly readable, and it stays that way until some compaction decides nobody can reach it any more.

## What's hard about branching a store {#hard}

Say you have a 40 GB store in about 2,000 SSTables, and you want a copy of it you can write to. You could just copy it. At 40 GB you might even get away with that. Try it ten times on the same host and you won't.

The good news is that an LSM tree already contains two of the three things a cheap copy needs.

**Every write draws a sequence number** — one monotonically increasing integer per commit. In SurrealKV that number doesn't sit beside the key, it sits inside it. The internal key is the user's key followed by two big-endian `u64`s:

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

Fifty-six bits of sequence and eight of kind: `Set`, `Delete`, `SoftDelete`, `Merge`, `RangeDelete` and a handful more. The timestamp is a selector for time-travel queries and orders nothing at all.

Internal keys sort by user key ascending and then by sequence *descending*, which packs every version of one key together, newest first. A reader after the current `user:7` seeks to `user:7` and takes the first entry it lands on.

**Visibility is a filter on that number.** A read at sequence *s* ignores every version above *s*. Nothing about this is branch-flavoured; it's plain snapshot isolation, the reason a reader is handed a single sequence number when it starts and stops seeing anything committed afterwards, and the reason a scan that runs for a minute doesn't see the writes that land during that minute.

**Compaction is the one component that destroys anything.** Reads destroy nothing, and writes destroy nothing either, since a write adds a version and a delete adds a tombstone. Compaction is where a superseded version becomes unreachable, and it's the only place in the engine where that decision gets made.

[[SVG:skv-primitives]]

Put the first two together and reading the store as it stood at sequence *s* already works, for any *s* whose versions happen to still be on disk. That last clause is the third thing branching needs, and it's the one the engine doesn't offer: nothing anywhere has promised compaction will keep the versions *s* depends on.

A snapshot doesn't close that gap. It hands you a sequence number to read at, and compaction agrees to keep everything that number can see, but there's no way to write to a number, and the agreement lapses the moment your reader goes away. A snapshot is built to lapse — a reader somebody forgot about would otherwise pin history forever — and that same expiry is why a snapshot can't stand in for a branch.

SurrealKV already had the next thing along, in `src/checkpoint.rs`. A checkpoint flushes the mutable state, hard-links every SSTable the manifest references, and copies the level manifest and the metadata. Your 40 GB copy therefore links about 2,000 files, so the work scales with the file count instead of the byte count — a real improvement, and not enough, because from that moment on the two stores share nothing. Each side compacts on its own schedule, rewriting its own copy of tables that started out byte-identical, and your 40 GB drifts toward 80 GB.

A fork writes one catalog record and links nothing whatsoever. Read a key that neither side has touched and it still comes out of one shared table.

[[WIDGET:skv-checkpoint-vs-branch]]

Two more things a checkpoint costs you, both easy to miss until you want them. There's no diff and no merge back, because the two stores no longer share a sequence number to compare against. And it's whole-store, so you can't check out part of one.

[[SVG:skv-checkpoint-vs-fork]]

So a fork has to skip the copy and keep a read path into its parent instead, which means the parent can no longer forget anything that path is able to reach.
## Four ways to build a branch {#options}

Four designs turn up for this, and between them they cover most of what shipping systems actually do: tag every key with a branch id, copy the store, replace the LSM with a content-addressed tree, or cap the sequence counter. They differ in what each one does to a fork, a read, a branch deletion, and compaction.

### A branch id in every key

Prefix the branch id onto the key and a fork writes nothing at all. The appeal is genuine, and this is the design most people reach for first, partly because plenty of multi-tenant schemas already prefix a tenant id the same way, so it arrives feeling proven.

[[SVG:skv-design-prefix]]

The trouble starts one layer down. Prefixing mixes every branch's rows into a single keyspace, so a compaction job can no longer be scoped to one branch, because there is no physical boundary left between them to scope it to. Deleting a branch stops being a metadata edit and becomes a range delete over live data.

Worse, one key's versions are no longer contiguous on disk. `b1·user:7` and `b2·user:7` sort nowhere near each other, so the newest-first walk that made a point read cheap now has to run once per branch on the fork path, turning a read at fork depth *d* into *d* separate scans. And a table's bloom filter can't answer "do you hold `user:7`" any more; it can only answer "do you hold `b1·user:7`", which means asking it once per prefix. Contiguous versions and one bloom-filter probe per table are the two things an LSM read path is built out of, and putting the branch in the key gives up both.

### A copy per branch

The design a checkpoint already gives you, and the baseline the other three are measured against.

[[SVG:skv-design-copy]]

It is correct and completely isolated, and the fork copies every row, so the cost grows with the size of the store rather than the size of the change. Nobody picks this on purpose at 40 GB; plenty of people end up with it anyway.

### A content-addressed tree

Name every node by the hash of its contents, make a branch a root pointer, and let a write copy the path from leaf to root while sharing every subtree it didn't touch. Git does exactly this. So does Dolt, whose prolly trees are a content-addressed B-tree built for structural sharing between versions.

[[SVG:skv-design-cat]]

It works, and diff is close to free, because two equal subtrees have equal names and can be skipped wholesale. The catch is scope: it replaces an LSM tree instead of extending one. MVCC, compaction and crash recovery all have to be re-derived over a new address space, which is a rewrite of the engine wearing the disguise of a feature.

### A ceiling on one counter

A branch is a maximum sequence number it is allowed to read of anything it inherited. Neon does something structurally similar at the page level, where a branch is a point in the WAL and reads below that point are served out of the parent's history.

[[SVG:skv-design-ceiling]]

The fork writes one metadata record and moves no data. Reads walk the branch's own components first and then its parent's, capped at that number. Deleting a branch reclaims the components the branch itself wrote. The cost doesn't disappear — it moves into compaction, which now has to be told which superseded versions are still somebody's current value. This is the design I built, and almost everything awkward about it traces back to that last sentence.

Running the same four steps under each design is more useful than reading the comparison. Fork, let the child write a key, let it read a key it inherited, then delete it — the scoreboard keeps every design you've already run, so the bills stack up side by side.

[[WIDGET:skv-branch-options]]

## A ceiling on one counter {#design}

A branch here is a parent link and an integer. Six parts turn that into something you can fork, read, write and merge: a sequence counter, a fork anchor, a catalog, per-branch components, a layer stack and a retention pin.

[[SVG:skv-architecture-map]]

- The **sequence counter** issues a number to every commit in the store, on every branch. There is exactly one.
- A branch's **fork anchor** is one of those numbers, and it is the highest sequence that branch may read of anything it inherited.
- The **catalog** records which branches exist, who each one's parent is, and what its anchor is. It is the durable copy of all that, and a fork is a write to it.
- Every branch has its **own components** — its own memtable and level sets, holding only the rows that branch wrote itself.
- A read walks the **layer stack**: your branch's components first, then each ancestor's, capped at the lowest anchor on the path.
- Compaction consults a **retention pin** built from the catalog, listing the superseded versions it may not discard.

Stepping one operation at a time shows which of the six each one touches. A fork writes the catalog and moves no data; a write lands in your branch's own components and takes its sequence from the shared counter; a read walks the stack; a merge reads a diff, commits the data, then records an edge.

[[WIDGET:skv-architecture]]

### One clock for the whole store {#one-clock}

There is one global sequence counter, and every commit on every branch draws the next number from it. Branches have no clocks of their own, and there is no per-branch head:

```rust
// src/branch.rs
/// Newest sequence this branch wrote ITSELF — not a per-branch head, which
/// a single global commit clock does not have. `None` means the branch has
/// never written, so it reads purely through its inherited view.
pub last_write_seq: Option<u64>,
```

One counter makes any two branches' sequence numbers directly comparable. That is what buys the cheap fork and the cheap merge: with per-branch clocks, relating two branches needs a vector clock, a mapping table or a causality graph, and with one clock everything a branch may see of everything it inherits is a single integer.

[[SVG:skv-ceiling]]

A branch's view is a ceiling. Nothing is copied and there is no second history to filter, only one history and a cap on how much of it this branch can see. A snapshot's read version is the same idea without the durability, and the difference is the whole feature: a snapshot dies with its reader, while this ceiling survives the reader, survives restart, and has room to be written on top of.

Put commits from several branches on the shared axis and two things show up. No two dots anywhere share a horizontal position, because the store has a single ordering; and every branch's own commits sit to the right of its own anchor.

[[WIDGET:skv-one-clock]]

That second observation settles copy-on-write shadowing, which is usually the fiddly part. When a child writes to a key it inherited, two versions of that key exist in two different component sets, and every read on the child has to prefer the child's. Implementations often track that explicitly with a dirty set, a shadow table, a per-key override map, or a copied page. None of it is needed here. A child only writes after it forked, and every write draws from the one global counter, so a child's sequence numbers always exceed everything it inherited, including its own anchor — its write to an inherited key is simply the newest version of that key.

[[SVG:skv-shadow]]

Deletion works the same way. A tombstone in the child sits at a higher sequence than the parent's row, so it hides that row without the parent knowing anything about it, and a branch can delete a row it doesn't physically hold. One consequence of that shows up again in the diff: what a branch *owns* and what a branch *wrote* are different sets, because detach materialises inherited rows into the branch's own tables at their original sequences.

### Choosing the fork anchor {#fork-anchor}

When you fork you have to say where, and that number becomes the branch's anchor. It goes into the catalog, so it outlives every reader and every restart, and a number that survives a restart is a number you can write on top of.

There are three ways to name it — the parent's current head, a specific sequence, or a point in time:

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

All three land on an exact sequence or fail. `AtTimestamp` resolves to the sequence committed at or before the moment you named, or it returns `TimestampBelowHorizon` — this is the audit case from the intro, where a fork that silently lands near the right moment is worse than no fork at all.

`Head` is the one with a surprise in it. It includes rows the parent has committed but not yet flushed, because the child resolves the parent's live state, memtables and all, instead of a set of files on disk. Nothing has to be flushed for your fork to be correct, which I had assumed I would need to build and then didn't.

[[SVG:skv-fork-anchor]]

Fork a branch off a branch and the anchors stack, each link contributing its own cap, and your effective ceiling is the lowest one on the path. So a grandchild can never see more of its grandparent than its parent could. That falls out of taking a minimum, and no check enforces it.

Two selectors get refused. You can't fork below the parent's own `created_at_seq`, since a child predating its parent isn't a thing. And a retried `AtTimestamp` fork is resolved again from scratch, so if that timestamp now maps to a different sequence than the first attempt used, you get a refusal instead of the old receipt.

### Where the owner is named {#ownership}

Branch identity rides in component metadata and is never prefixed into a user key or an internal key, which is how the read optimisations that the first design broke stay intact:

```rust
// src/batch.rs
/// Physical owner of every row in a commit batch. Ownership stays in the
/// batch/component metadata and is not prefixed into user keys.
pub(crate) struct BatchOwner {
	pub(crate) branch: BranchId,
	pub(crate) generation: BranchGeneration,
}
```

A commit batch carries one owner. A memtable is branch-pure and rejects a batch belonging to anybody else. Every SSTable records its owner in its own metadata, and loading the manifest fails closed if a level set's owner disagrees with what the table itself claims. The level manifest is partitioned per owner, and a read picks one partition:

```rust
// src/levels/mod.rs
// Point reads address this by physical owner; branch count must not enter
// the lookup cost.
levels_by_owner: HashMap<BatchOwner, Levels>,
```

There is no owner-blind way to reach levels at all, so a read path can't accidentally mix owners even if somebody wants it to. Lookup is by hash, which keeps the total number of branches out of the cost of every point read and every layer of an inherited read.

[[SVG:skv-key-vs-metadata]]

Keeping the keys owner-free pays off three times. Compaction stays a single-owner operation because the components it reads have one owner between them, and not because some rule says it must. Deleting a branch reclaims a component set and deletes no rows. And the key comparator never learns what a branch is, so a key's versions stay contiguous and newest-first. The comparator, the bloom filters and every seek in the read path were all built around that layout.

### Forking, and what it fences {#fork-protocol}

Writing to a branch is dull. Your row goes into that branch's own memtable and takes its sequence from the shared counter, exactly as it would on main, and there is no branch-aware write path to get wrong.

Creating the branch is where the care went. The whole fork is one publication to the catalog and it copies no data:

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

The fence stops write admission across the store and then spins until the commit pipeline reports drained, so `visible_seq_num` is exactly the head. Skip the drain and `ForkPoint::Head` resolves to a number with in-flight commits on both sides of it, leaving the child's view at neither the head nor any other well-defined point. Missing the drain deadline gives `Error::ForkFenceTimeout`, which is retryable.

Publishing then checks the ancestor chain against the depth budget, `MAX_VIEW_DEPTH = 64`, and asks whether the parent can still answer at the resolved sequence:

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

That predicate is the reason a historical fork can be refused rather than approximated.

Now the wart, because it's a real one. The fence is store-wide, and it stops writers who have no connection whatsoever to the branch being forked or to its parent. One global clock buys comparable sequence numbers everywhere, and the price is one global serialisation point: `ForkPoint::Head` briefly stalls everything. `fork_drain_nanos` divided by `forks` is the average pause each writer took on somebody else's behalf, and if you fork at head in a loop against a busy store, that's the number that will explain your p99 before anything else does.

One more thing will bite you in bulk. The catalog caps at 4,096 records, and at the cap a fork stops to run a reclamation sweep before proceeding, so it blocks rather than failing. A script that creates a thousand sandboxes will meet that sweep, and it will look like a hang.

### The catalog {#catalog}

A fork's commit point is a single durable act, so it needs a primitive that either happens or doesn't. The usual answer in an LSM engine is a MANIFEST file: append to it, or rewrite it and rename the new one into place.

Rename is atomic in one sense, since no reader ever sees a half-written file. It is not a compare-and-swap, though. It will cheerfully clobber a version somebody else wrote, so it can't express "publish this only if the state I read is still current" — which is exactly the sentence a fork needs to say.

So there's no MANIFEST file here. There are three numbered, immutable metadata lineages, never rewritten in place:

```
<db>/catalog/<version>.catalog            magic SKBC   the branch catalog
<db>/branch/<branch-id>/<version>.state   magic SKBM   one branch's owned facts
<db>/root/<version>.root                  magic SKRT   global recovery facts
```

Each file is magic, version, body, CRC32, and four versions of each lineage are kept. The publish primitive is a conditional create via `fs::hard_link`: linking to a name that already exists fails with `AlreadyExists`, at which point the publisher byte-compares the two and reports `AlreadyExistsSame` if the content matches.

[[SVG:skv-lineages]]

That gives a genuine compare-and-swap on a plain filesystem, with no extra service to run. Two concurrent publishers can't silently overwrite each other, and whichever loses sees the other and fails closed. Retries are idempotent, because re-publishing identical bytes after an interrupted attempt is indistinguishable from having succeeded the first time. That property earns its keep the first time a fork gets interrupted halfway through its own commit point.

#### Names and generations

The catalog is the only authority for branch existence, generation, parentage, anchors and TTLs. Names get reused; incarnations never do. Every physical owner names a `(BranchId, BranchGeneration)` pair, generations are globally monotone, and a handle to a deleted branch whose name has since been reused gets `BranchFenced` instead of quietly rebinding to whichever branch owns the name now. A merge edge naming a stale generation isn't that branch's history either, so it gets discarded.

Deletion can't just drop a branch's catalog record. At that moment its runtimes may exist, its WAL segments may be pinned, and its level state, tables and authority lineage are all still on disk, so something durable has to say "this branch is going away" or a crash mid-teardown leaves orphans that nothing will ever come back for. Deletion therefore publishes a tombstone, and `BranchCatalog::retire_deleted()` clears it later in a fixed order.

[[SVG:skv-catalog-lifecycle]]

Reclaim runtimes, WAL dependencies, level state and tables; then remove the state lineage directory and sync the parent directory; only then retire the tombstone in a new catalog publication. A failure anywhere before that last step leaves the tombstone in place, so the maintenance pass can retry safely as many times as it needs to. And tombstones have to be retired eventually because of that 4,096-record cap — if they lived forever, the cap would count every branch ever created instead of the branches alive now, which for a store churning agent sandboxes is a difference of several orders of magnitude.

#### Four locks, one order

Branching added several operations that grab global state at once. A fork touches the catalog, the level manifest and the commit pipeline. A detach copies a dataset and publishes a catalog version. A checkpoint reads every table and needs metadata to hold still. Compaction runs under the level manifest and has to be able to consult the catalog. Any two of those taking the same pair of locks in opposite orders is a deadlock waiting for load.

[[SVG:skv-lock-order]]

The order is `branch_materialization`, then `catalog_publish`, then the commit pipeline write fence and the level manifest. `branch_materialization` is a plain `Mutex<()>` deliberately kept separate from `catalog_publish`, because detach copies everything a branch was inheriting, and holding the catalog serialiser across a bulk copy would block every unrelated branch operation in the store for the duration. Detach materialises first, takes `catalog_publish` only for the final parent-link publication, and re-validates the owner afterwards in case it got fenced while the copy was running.

The order is enforced by a test that reads the source text and asserts that `catalog_publish.lock()` appears before `level_manifest.read()`. Yes — a test that greps its own codebase. I wrote it, felt a bit silly, and kept it anyway, because lock ordering doesn't live in any single execution. It lives in the shape of the code, and running the code proves nothing at all about whether an inverted path exists down some branch you didn't take.
## The read path {#read-stack}

A branch owns only what it wrote. Everything else it can see belongs to an ancestor, and it may only see the part of that ancestor sitting below its anchor, so a read has to consult several component sets with a different visibility rule for each one.

A snapshot here is therefore a stack of layers walked nearest-first, each carrying its own cap:

```rust
// src/snapshot.rs — Snapshot::new_owned
let mut cap = seq_num;
for (branch, generation, fork_seq) in chain {
	cap = cap.min(fork_seq);
	layers.push(SnapshotLayer { owner: BatchOwner { branch, generation }, runtime: ..., cap });
}
```

Walk the parent chain nearest-first, narrowing the cap monotonically as you go, and a layer's cap comes out as `min(snapshot seq, every fork anchor on the path to that ancestor)`.

[[SVG:skv-read-stack-anatomy]]

Inside a layer the search order is the one the engine already had: active memtable, then immutable memtables newest-first, then L0 across all overlapping tables, then L1 and below by binary search. The single difference is that each layer seeks at its own cap instead of at the snapshot sequence. The first visible version wins and the walk stops there. A tombstone in a nearer layer hides every farther layer, so a delete answers "absent" and doesn't step aside to let an ancestor answer in its place.

Those per-layer caps can't be collapsed into one filter on the merged stream, and every one of a layer's iterators is wrapped before it reaches the merge:

```rust
// src/snapshot.rs
// Every iterator of this layer is wrapped in a SeqCappedIterator
// BEFORE the merge: per-layer fork caps cannot be expressed by
// the merged stream's global snapshot filter.
```

Within one key, versions arrive sequence-descending, and a capped iterator walks past a key's above-cap versions down to its first visible one. A filter placed after the merge is consulted too late: by the time it runs, a different layer's row has already won the key, and the row it lets through isn't merely a wrong row somewhere in a stream — it's the answer the reader receives.

[[SVG:skv-cap-before-merge]]

That is a claim worth watching instead of taking on trust. Run it both ways and look at the rows that leak through in the second configuration: they are correctly ordered, they sit below the snapshot's own sequence, and nothing about them looks wrong. The only defect they have is which layer they came from, and once the streams interleave, that information is gone.

[[WIDGET:skv-per-layer-caps]]

## What compaction must keep {#compaction}

A fork writes one record, so nearly all of the cost of branching turns up here instead. Compaction exists to discard superseded versions, and a live fork anchor is a statement that one particular superseded version is still somebody's current value. So compaction has to be told what it may not throw away, and told durably, so that a crash can't lose the instruction. It also has to be told in a way that costs nothing at all in a store nobody has forked.

[[SVG:skv-compaction-conflict]]

Two cases are worth watching a real job handle: a store with no branches in it, where the pin should be invisible, and an anchor that appears after the job has already started merging.

[[WIDGET:skv-compaction-pins]]

### The anchor set {#anchor-set}

The failure modes here pull in opposite directions. Drop the version a child's anchor needs and the child's next read returns a newer row, with no error and no way to tell — a value that was never true at its fork point. Drop the version a merge's base sits at and the next merge compares against the wrong base and overwrites. Keep everything, and one long-lived branch pins its parent's entire history for as long as it exists.

My first version kept one number per owner: the lowest sequence anybody still needed, with everything at or above it preserved. That's a retention floor, and it is honestly the thing to build first — one integer per branch, cheap to check inside a compaction loop, and it reuses the machinery the engine already has for pinning snapshots. It lasted until I forked two branches at different points, which took about an afternoon.

Concretely. The parent holds `user:7` at sequences 12, 24 and 31. One child forked at 20, another at 28. A floor at 20 preserves the newest version at or below 20, which is version 12, and happily lets compaction drop 24. Now the second child reads `user:7` at its cap of 28, and the newest surviving version at or below 28 is 12 — a value that had already been replaced eight sequences before that child existed. It gets a real answer, promptly, with no error anywhere, and the answer was never true at its fork point. Raise the floor to 28 and the first child breaks the same way in the other direction. Pin the whole range below 28 instead and you retain the parent's entire history for as long as anything stays forked near head — the exact cost the fork existed to avoid.

A floor is one number standing in for a set, and no single number answers for two anchors:

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

Anchors don't only come from children, either.

[[SVG:skv-anchor-kinds]]

A live merge edge contributes two more: its target-side head, which preserves durable edge history, and its source-side cursor, which preserves the actual three-way base. A stale edge pins nothing whatsoever — its source is gone, no future merge can measure from that base, and holding history on behalf of a deleted branch is how a store that churns sandbox branches would quietly stop reclaiming anything.

The set is kept sorted descending and deduplicated, and it is never truncated to save space, because dropping an anchor drops the promise the anchor represents.

Honouring *n* anchors over *m* versions looks like it should cost *n × m* comparisons. It doesn't, because both lists are sorted the same way:

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

One index that never rewinds, so the pass costs `O(versions + anchors)` for any number of branches, and one version can serve several anchors at once.

[[SVG:skv-anchor-walker]]

The four policies only disagree when an anchor falls between two versions, which is exactly the case that is fiddly to construct by hand and easy to construct by dragging. Place the anchors where you like and run each policy against the same version chain — both the set and the range answer every anchor correctly, and only the retained count separates them. The argument for the set is a counter, not a correctness bug, which is worth knowing before you go implementing it.

[[WIDGET:skv-anchor-policy]]

### Where the pins come from {#pin-source}

Compaction needs to know which sequences it must preserve, and the tempting source is the live snapshot tracker: it's in memory, it's already there, and it knows precisely who is reading right now.

It's the wrong source, for two separate reasons. Compaction's output would start depending on who happened to be reading when the job ran, so two runs over identical inputs could produce different files, which makes the component unreproducible and its bugs unrepeatable — and if you have ever chased a compaction bug you know how much that costs. Beyond that, a promise living in a reader's memory doesn't survive a crash, while a fork anchor is durable precisely so that a process which never saw the original reader can still honour it.

So retention pins come from the durable catalog, never from the snapshot tracker and never from child state manifests. Both pin shapes below are deterministic for the same reason: they depend on catalog anchors and never on which snapshots happen to be live. It is also why compaction has to be able to read the catalog while holding the level manifest, and that requirement is where the lock order came from.

### The pin only adds retention {#additive-pin}

Compaction already had rules for deciding whether to write a version out or discard it, and those rules know nothing about branches. The pin doesn't replace them; it's one extra condition OR'd onto the answer they give:

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

`output_ignoring_pin` is the pre-branching answer. Because the pin can only flip a false to a true, it turns a discard into a keep and never the reverse, so in a store with no branches `pinned_by_child_view` is always false and every byte compaction writes is what it would have written before branching existed. The `||` is doing that work, and no test has to stand behind it.

What the pin actually pins depends on whether the parent keeps history at all:

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

Tens of branches stay affordable because of the per-anchor shape; a versioned parent pays the range shape to keep its own history honest.

Two guards sit outside the pin entirely. The first is `force_not_bottom`. A compaction may treat its highest level as the bottom of the read stack, where tombstones can be dropped outright, only if nothing reads below it — and two unrelated conditions break that assumption. A branch that has been forked from has anchored readers resolving below its tombstones. A branch that is itself a fork child has ancestor layers sitting underneath its own bottom level.

[[SVG:skv-two-bottoms]]

Either way, the level that looks like the bottom isn't, and dropping tombstones there would resurrect rows for somebody.

The second guard covers the bottom-level hard-delete shortcut, where a key whose newest version is a hard delete can leave the database entirely, outputting nothing and dropping the tombstone with it. Its precondition:

```rust
// src/iter.rs — hard_delete_may_drop_all
/// It is legal only when every reader that can still see an older version
/// also sees the tombstone that erases it. A reader boundary is a live
/// snapshot sequence or the inherited-view pin floor; a boundary landing in
/// `[oldest_seq, delete_seq)` reads data the tombstone does not cover for
/// it, so those versions — and the tombstone above them, which must keep
/// masking them for readers at or above `delete_seq` — have to survive.
```

A reader boundary is either a live snapshot sequence or a retention anchor, and one predicate checks both, because a fork anchor and a snapshot sequence are the same kind of object with different lifetimes. One is durable and one is transient, and compaction has no reason to care which.

### Racing a fork against a compaction {#pin-races}

Anchors are durable, but they appear concurrently, and that combination is where I lost the most time. A compaction job that has been merging happily for a while may already have discarded a version that an anchor published thirty milliseconds ago now requires, and a discarded version cannot be un-discarded.

The protocol is to sample the anchor set when the job is created, re-check it under the publication lock, and refuse the output if anything appeared in between:

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

The asymmetry runs one way on purpose. An anchor that appeared means refuse, with `Error::CompactionPinRaced { unsampled_anchor }`; the output is discarded and the inputs stay live for the next cycle. An anchor that vanished means publish anyway, since the job simply kept more than it needed to. The fork always wins this race, because a fork is a user-visible operation with a durable commit point and a compaction is background work that can be run again in five minutes.

The same discipline applies on the merge side. `record_merge_edge` holds the level manifest read guard across its catalog publication, because the edge becomes a retention anchor the instant it lands, and `fork_branch` holds the same read guard across its own publish so compaction can't raise the retention floor underneath it. Whichever of the two publishes second sees the other and fails closed.

`compaction_pin_races` counts these refusals. A few are normal. A lot means you are forking against heavy compaction, and the discarded merge work is real work somebody's disk did for nothing.
## Diff and merge {#merge}

### Diff {#diff}

A branch's own component set holds only rows it wrote, so scanning that set costs what the diff costs instead of what the data costs, and no change journal is needed to make it cheap. That is the one place in this design where something came out cleaner than I expected.

Then detach spoils it:

```rust
// src/diff.rs
//! What it is *not* is "everything the branch owns": detach
//! materializes inherited rows into the branch's own tables, so entries are
//! filtered by sequence against the fork anchor rather than assumed to be above
//! it. That filter is the difference between a diff and a lie.
```

So a diff reads through `Snapshot::own_only` — the branch's own memtables and level set with no ancestor layers — and then still filters `seq > base`. Before any detach has happened that filter looks like dead weight, since every owned row is above the anchor by construction. Detach is the reason it's there: it copies inherited rows into the branch's own tables at their original, below-anchor sequences, and without the filter those inherited rows would show up as things the branch had changed.

[[SVG:skv-diff]]

The diff includes tombstones, because a delete is a change. It emits one entry per key, with the branch's newest write winning.

### A base that moves {#merge-base}

A three-way merge needs the value at the base, the value on the source now, and the value on the target now, where the base is the last state the two branches agreed on.

The obvious candidate for that base is the fork anchor, and it's right for the first merge and wrong for every one after it, because once you have merged, the two branches have agreed on something newer than where they diverged. Leave the base at the fork anchor and a second merge re-offers everything the first one already applied, re-raising conflicts that were settled a week ago.

So the base is three sequences:

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

Why can't the target's head at the last merge serve as the base? Because merging into a target never mutates the source, so values that existed only on the target at that edge were never part of source history at all. Treat the target-at-edge state as the common base and a later source edit to one of those keys looks uncontested, gets applied, and overwrites a target value the source never knew existed. The base side is therefore the source snapshot at `source_through`, and `target_at` is kept as durable edge history and reported to callers without ever being a base value. For the same reason a scan probe has to cover target writes from `fork_at` rather than from the last edge, or it misses target-only writes that predate it.

Absence is treated as a value all the way through the classification, so delete-versus-delete resolves and delete-versus-modify conflicts, with neither needing a special case.

[[SVG:skv-merge-verdicts]]

Some merges are refused outright. A merge is accepted only into the branch the source was forked from, and siblings get `BranchesUnrelated`, because no common base was ever recorded for them and inventing one would be a guess dressed up as a merge. A stale-generation edge is discarded too, since a source that was deleted and recreated under the same id shares nothing with its predecessor.

Validation checks two retention floors, the target's and the source's, with the second gated on `source_through > fork_at`. A first merge's source-side base is the inherited fork view, whose parent-side anchor was already validated at fork time, and a source can't own rows at or below its own birth.

Two successive merges with the promotion edge switched off is the fastest way to see why any of this is necessary. Turn it off, merge, write on the target, then merge again, and the second merge re-offers the first one's work.

[[WIDGET:skv-moving-base]]

### How a merge executes {#merge-execution}

The question "has the target moved since the base?" can be answered per key by point-reading the read stack, or once by walking the target's own changes, and which is cheaper depends entirely on how many keys the merge touches. So the choice is made at `SCAN_PROBE_THRESHOLD = 256`, and the two probes' verdict-equivalence is covered by a test, which means a badly chosen threshold costs you time and never correctness. Preflight counts the source diff sequentially and switches at the same threshold instead of point-probing every changed key, and there's a fast path underneath both: a target nobody has touched matches the base on sequence alone, so planning that merge reads no values at all.

Merges go through the ordinary commit path. Conflict detection, the WAL and sequence allocation are all handled there already, and there is no privileged bulk-apply path sitting alongside it to keep correct separately. `preview_merge_into` shares the classification code with the real thing, so a preview can't drift from what it previews.

Atomicity is the part people assume and shouldn't. Writes are bounded at the memtable size, and `MergeOutcome::chunks` is the contract:

```rust
// src/merge.rs
/// How many transactions the merge took. One means it landed atomically;
/// more means each chunk is durable on its own and a failure part-way would
/// have left the earlier ones applied.
```

Zero means there was nothing to write, one means one transaction, and more than one means the merge was resumable rather than atomic. Nothing you pass to the call decides which of those you get — the size of the data decides. So if atomicity matters to you, read `chunks` afterwards and don't infer it from the fact that the call returned successfully. A single entry above the budget is refused up front with `MergeTooLarge`.

[[WIDGET:skv-merge-chunks]]

One ordering rule governs the whole operation: data commits first, edge second.

```rust
// src/lsm.rs
// Data first, edge second. A crash in between re-offers what was already
// applied on the next merge, which converges or conflicts — never a silent
// overwrite. The opposite order would advance past changes that were never
// written and lose them.
```

[[SVG:skv-merge-commit-order]]

One order fails loudly and idempotently, the other loses writes quietly. That difference makes the ordering a correctness property. A scoped `merge_range` records no edge at all, on purpose, because a partial apply hasn't earned the claim that the source is fully merged.

## What a branch costs {#cost}

Three costs, and I can describe the shape of each and the metric that would show it, which is not the same as having measured any of them.

**Reads amplify with fork depth.** A chain *d* deep means *d* layers, each contributing its own capped iterators into one merge, so fan-in grows with depth and with each layer's live component count. `MAX_VIEW_DEPTH = 64` bounds it, and 64 is a budget somebody chose rather than a physical limit — a 64-layer merge is entirely legal, and slow, and I would rather find out how slow on a test host than in a store somebody depends on.

**Space grows with pinned versions.** This is the cost that accumulates while you aren't looking. For a non-versioned parent it comes to roughly one extra version per anchor per touched key. `pin_retained_versions_total` counts versions that completed compactions kept solely because an anchor needed them, so it measures retention work rather than live bytes on disk, and it's the number that tells you whether your branches are costing you anything.

**Runtime state is allocated lazily.** One WAL, one commit pipeline, one clock and one table-id allocator are shared by the whole store, while memtables and level sets are per branch. Those arrive on a branch's first write instead of at the fork, so an idle branch costs no arena at all.

[[SVG:skv-branch-runtimes]]

One caveat if you're sizing a host. The write buffer is a `write_buffer_soft_limit`, and the "soft" is load-bearing: rotation doesn't release an immutable arena until its flush completes, and an oversized batch may need an arena larger than the configured number. A hard cap would need admission and back-pressure accounting across active, immutable and in-flight flush memory, which is a different allocator design and not a renamed constant.

### Detach and revert {#detach-revert}

The ceiling model has one structural weakness: a branch that outlives its usefulness keeps taxing its parent through the retention pin, forever, for as long as it exists. Two operations exist to get out of that.

Detach materialises the inherited view into a single SSTable placed below the branch's own levels, then clears the parent link, which releases the parent's retention pin and lets it compact freely again. The price is a copy of everything the branch was inheriting, so detach is forking's trade run backwards, and it's the right answer for exactly one case: the branch that turned out to be permanent.

[[SVG:skv-detach]]

The copy runs before `catalog_publish` is taken, and the owner is re-validated afterwards in case it got fenced while the copy was running. Detach is idempotent as well, so if the parent link is already gone it returns successfully instead of doing all that work twice.

Revert writes compensating values forward instead of rewriting anything. It diffs the branch's own writes in range, reads the inherited value at the anchor, skips keys that are already equal, and writes the rest back through an ordinary transaction. History stays append-only throughout: the restored values are new writes at new sequences, and nothing that could read the old values loses that ability.

One API name is worth double-checking before you use it, because I have got this wrong in my own tests. `create_branch` is not a fork — it makes an empty branch with no parent and no inherited view. `fork_branch` is the one that takes a `ForkPoint`.

---

So: a fork writes one catalog record and no data, at the price of a brief store-wide fence. Throwing a branch away reclaims a component set and retires a tombstone, deleting no rows, because the branch was never in the keys to begin with. Asking what changed reads the branch's own components filtered by sequence. Asking for an exact point in the past gives you either that point or `TimestampBelowHorizon`.

The bill lands on compaction, which now has to be handed a durable set of sequences it may not forget. I knew roughly where it would land when I picked the design. What I didn't anticipate was how much of the work turned out to be about the *timing* of that instruction rather than its contents — sampling the anchor set before merging, re-checking it under the publication lock, deciding which side of a race is allowed to lose.

What I want next is numbers. `pin_retained_versions_total` against a realistic churn of sandbox branches would tell me whether the per-anchor pin holds its shape at tens of branches or quietly degrades into the range pin under load, and `fork_drain_nanos` under a write-heavy workload would tell me whether the store-wide fence is a footnote or a problem. Until then, the shape of the cost is understood and its size isn't.

## References {#references}

### LSM trees

- [The Log-Structured Merge-Tree (LSM-Tree)](https://www.cs.umb.edu/~poneil/lsmtree.pdf) — O'Neil, Cheng, Gawlick, O'Neil (1996). The original, and where the read and write amplification trade-off is first argued.
- [The Design and Implementation of a Log-Structured File System](https://people.eecs.berkeley.edu/~brewer/cs262/LFS.pdf) — Rosenblum & Ousterhout (1992). Never overwrite, and make cleaning somebody's explicit job. Compaction is that cleaner under a new name.
- [Bigtable: A Distributed Storage System for Structured Data](https://research.google/pubs/pub27898/) — Chang et al. (OSDI 2006). Where the memtable, SSTable and compaction vocabulary comes from.
- [LSM-based storage techniques: a survey](https://link.springer.com/article/10.1007/s00778-019-00555-y) — Luo & Carey (VLDB Journal 2020). The map of the design space, and the best single survey of LSM variants.
- [Monkey: Optimal Navigable Key-Value Store](https://stratos.seas.harvard.edu/files/stratos/files/monkeykeyvaluestore.pdf) — Dayan, Athanassoulis, Idreos (SIGMOD 2017). How to reason about LSM cost analytically rather than by benchmark.
- [WiscKey: Separating Keys from Values in SSD-conscious Storage](https://www.usenix.org/system/files/conference/fast16/fast16-papers-lu.pdf) — Lu et al. (FAST 2016). Key and value separation, and the write-amplification case for it.

### Versions, snapshots and reclaiming history

- [A Critique of ANSI SQL Isolation Levels](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/tr-95-51.pdf) — Berenson et al. (1995). Where snapshot isolation is defined.
- [Multiversion Concurrency Control — Theory and Algorithms](https://dl.acm.org/doi/10.1145/319996.319998) — Bernstein & Goodman (1983). Versions as first-class, and what it means for one to still be needed.
- [An Empirical Evaluation of In-Memory Multi-Version Concurrency Control](https://www.vldb.org/pvldb/vol10/p781-Wu.pdf) — Wu et al. (VLDB 2017). Version-chain garbage collection, which is the retention-anchor problem from the other side.

### Determinism

- [Learning DST for testing our distributed transactional KV store](dst.html) — my earlier post on building a deterministic simulation tester.

### The code

In [my fork](https://github.com/arriqaaq/surrealkv):

- `docs/BRANCHING.md` — the user-facing semantics.
- `src/branch.rs` — `ForkPoint`, `RetentionAnchors`, `AnchorWalker`, and the catalog.
- `src/snapshot.rs` — the layer stack, the cap narrowing, and `SeqCappedIterator`.
- `src/iter.rs` — compaction's retention decision, the additive pin, and the hard-delete guard.
- `src/compaction/compactor.rs` — `force_not_bottom`, and where pins may come from.
- `src/merge.rs` and `src/diff.rs` — `EffectiveBase`, the classification, the two probes, and the sequence filter.
- `src/authority/` — the three lineages and the hard-link publish primitive.
- `docs/KNOWN_GAPS.md` — every gap recorded as what, why, what it would take, and what would raise its priority.
