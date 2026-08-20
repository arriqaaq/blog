---
title: Git-style branching on an LSM key-value store
dek: How a fork, a diff and a merge are built out of one sequence number.
eyebrow: Storage Engines
slug: branching-lsm
date: 2026-08-17
ogImage: skv-ceiling
byline: "A build log on a personal experiment: adding git-style branching to an LSM key-value store, with each mechanism running live on the page."
made: assisted
---

Agents need somewhere to work that they can break. So I started with an experiment to [build a filesystem on a database ([SurrealDB](https://surrealdb.com/))](https://arriqaaq.com/blog/posts/agent-filesystem.html) so that every action could say who wrote it and be rolled back on its own. That worked, somewhat. But giving each agent its own copy of the database underneath got expensive.

So I spent a while making that copy cheap, on [my fork](https://github.com/arriqaaq/surrealkv) of [SurrealKV](https://github.com/surrealdb/surrealkv): git-style branching, with a fork, a diff and a merge, built into an LSM tree instead of beside one.

Three cases want a branch, and they want different things from it. An *agent sandbox* lives for seconds or minutes, gets thrown away, and has to be undoable. A *dev, test or preview environment* lives for hours or days, and you want tens at once without standing up tens of stores. *Time travel and audit* wants to read the past exactly. "Yesterday at about 09:14" is worse than an error: an error tells you it failed, an approximation leaves you guessing how wrong it is.

[[SVG:skv-use-cases]]

Branches here are numerous and short-lived, and that's what I sized the design for: tens at a time, plus a way out for the one that turns out to be permanent.

None of this is released and the names may still move. Nothing here is benchmarked, so every cost below is a shape and the metric that would show it, never a number I measured. Every mechanism is named with its real type and the file it lives in, so you can check it against the fork.

## How an LSM tree works {#lsm-primer}

Every key-value store has to answer one question: where does a write go? A B-tree puts it in the page where the key belongs, so writes land in small chunks scattered across the disk, the access pattern storage hardware handles worst. A log-structured merge tree (LSM tree, from here on) takes the opposite bet: never modify data where it sits, only ever append.

A write goes to a write-ahead log first (a WAL, an append-only file that exists so a crash can't lose an acknowledged write). Then into the memtable, an in-memory buffer that keeps keys sorted so reads can be served straight out of it. When the memtable fills, it is written to disk in one sequential pass as an SSTable, an immutable sorted file. Fresh tables land in level 0, where key ranges may overlap, so a read checks the memtable and then every table that might hold the key.

Reads get slower as tables pile up. A background job called compaction merges overlapping tables into fewer, larger, non-overlapping ones further down: L1, L2, and so on, each level about ten times the size of the one above. Every table carries a bloom filter, a small summary that lets a read skip a table which certainly doesn't hold the key. And a delete is a write: it appends a tombstone, a marker saying the key is gone, and the old value sits on disk until some compaction removes the pair.

Those seven parts are the machine, and the lifecycle repays operating by hand. Put a few keys and watch the memtable flush. Put the same key twice and find both versions on disk. Then compact, and watch the older one leave.

[[WIDGET:skv-lsm-basics]]

SurrealKV implements all of it without surprises: a skiplist memtable, a WAL split into fixed-size segments so old ones can be deleted whole, leveled compaction, bloom filters, and a block cache holding recently-read chunks of SSTable in memory. If you've read one LSM engine you've read most of this one.

[[SVG:skv-lsm-anatomy]]

Appending has a side effect. Nothing is overwritten in place, so write `user:7` a second time and the first value is still on disk, superseded and perfectly readable, until some compaction decides no reader can reach it.

## What's hard about branching a store {#hard}

Say you've got a 40 GB store in about 2,000 SSTables, and you want a copy of it you can write to. You could just copy it. At 40 GB you might get away with that once. Try it ten times on one host and you won't.

But an LSM tree already contains two of the three things a cheap copy needs.

The first is a sequence number on every write, one increasing integer per commit. In SurrealKV it doesn't sit beside the key, it sits inside it. The internal key is the user's key followed by two big-endian `u64`s:

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

That's 56 bits of sequence and 8 of kind (`Set`, `Delete`, `SoftDelete`, `Merge`, `RangeDelete`, and a handful more). The timestamp is a selector for time-travel queries and orders nothing. Internal keys sort by user key ascending, then by sequence descending, so every version of one key sits together, newest first. A reader after the current `user:7` seeks to `user:7` and takes the first entry it lands on.

The second is that visibility is a filter on that number. Ask for `user:7` at sequence 40 and the engine walks past every version stamped 41 or higher. Nothing about that is branch-flavoured. It's plain snapshot isolation: a reader handed one sequence number at the start stops seeing anything committed after it, and a scan that runs for a minute misses the writes landing during that minute.

The third thing is missing. Compaction is the only component that destroys anything. Reads destroy nothing, and writes destroy nothing either, since a write adds a version and a delete adds a tombstone. Compaction is where a superseded version becomes unreachable.

[[SVG:skv-primitives]]

Put the first two together and reading the store as it stood at sequence *s* works, for any *s* whose versions happen to still be on disk. Nothing has promised compaction will keep the versions *s* depends on.

A snapshot doesn't fix it. It hands you a sequence number to read at, and compaction agrees to keep everything that number can see. But you can't write to a number, and the deal lapses the moment your reader goes away. Snapshots are built to lapse, or a reader somebody forgot would pin history forever.

SurrealKV already had the next thing along, in `src/checkpoint.rs`. A checkpoint flushes the mutable state, hard-links every SSTable the manifest references, then copies the level manifest and the metadata. Your 40 GB copy links about 2,000 files, so the work scales with the file count instead of the byte count. That's a real improvement. But from then on the two stores share nothing. Each side compacts on its own schedule, rewriting its own copy of tables that started out byte-identical, and your 40 GB drifts toward 80 GB. A fork writes one catalog record and links nothing. Read a key neither side has touched and it comes out of one shared table: the same block, the same file, the same cache.

[[WIDGET:skv-checkpoint-vs-branch]]

A checkpoint costs you two more things. There's no diff and no merge back, because the two stores no longer share a sequence number to compare against. And it's whole-store, so you can't check out part of one.

[[SVG:skv-checkpoint-vs-fork]]

So a fork skips the copy and keeps a read path into its parent. The parent can no longer forget anything that path can reach.

## Four ways to build a branch {#options}

Four designs turn up for this, and between them they cover most of what shipping systems do: tag every key with a branch id, copy the store, replace the LSM with a content-addressed tree, or cap the sequence counter. They differ in what each does to a fork, a read, a branch deletion, and compaction.

### A branch id in every key

Prefix the branch id onto the key and a fork writes nothing. This is the design most people reach for first, partly because plenty of multi-tenant schemas prefix a tenant id the same way, so it arrives feeling proven.

[[SVG:skv-design-prefix]]

But it doesn't work. Prefixing mixes every branch's rows into one keyspace, so a compaction job can no longer be scoped to a single branch: there's no physical boundary left to scope it to. Deleting a branch stops being a metadata edit and becomes a range delete over live data.

Worse, one key's versions are no longer contiguous on disk. `b1·user:7` and `b2·user:7` sort nowhere near each other. The newest-first walk that made a point read cheap has to run once per branch on the fork path, so a read at fork depth *d* becomes *d* separate scans. And a table's bloom filter can't answer "do you hold `user:7`" any more, only "do you hold `b1·user:7`", so it has to be asked once per prefix. Contiguous versions and one bloom probe per table are what an LSM read path is built out of, and this gives up both.

### A copy per branch

This is what a checkpoint gives you, and the baseline the other three get measured against. It's correct and fully isolated. The fork copies every row, so cost grows with the size of the store instead of the size of the change. It's hard to pick on purpose at 40 GB, and easy to end up with anyway.

### A content-addressed tree

Name every node by the hash of its contents, make a branch a root pointer, and let a write copy the path from leaf to root while sharing every subtree it didn't touch. Git does this. So does Dolt, whose prolly trees are a content-addressed B-tree built for structural sharing between versions.

[[SVG:skv-design-cat]]

It works, and diff is cheap: two equal subtrees have equal names and can be skipped wholesale. The catch is scope. It replaces an LSM tree instead of extending one, so everything that engine already solved has to be solved again over a new address space: keeping several versions of a row readable at once, reclaiming the ones nobody needs, and coming back up correctly after a crash. That's a rewrite of the engine wearing the disguise of a feature.

### A ceiling on one counter

A branch is a maximum sequence number it may read of anything it inherited. Neon does something similar at the page level: a branch is a point in the WAL, and reads below that point are served out of the parent's history.

[[SVG:skv-design-ceiling]]

The fork writes one metadata record and moves no data. Reads walk the branch's own components first, then its parent's, capped at that number. Deleting a branch reclaims the components the branch wrote. The cost doesn't disappear, it moves: compaction now has to be told which superseded versions are still somebody's current value.

Run the same four steps under each design. Fork, let the child write a key, let it read a key it inherited, then delete it. The scoreboard keeps every design you've run, so the bills stack up side by side.

[[WIDGET:skv-branch-options]]

## The design {#design}

I picked the ceiling. Behind it is a single global sequence counter: every commit on every branch draws the next number from it, and a branch is one of those numbers plus a parent link. Branches have no clocks of their own:

```rust
// src/branch.rs
/// Newest sequence this branch wrote ITSELF — not a per-branch head, which
/// a single global commit clock does not have. `None` means the branch has
/// never written, so it reads purely through its inherited view.
pub last_write_seq: Option<u64>,
```

One counter makes any two branches' sequence numbers directly comparable. With per-branch clocks, relating two branches needs a vector clock, a mapping table or a causality graph. With one clock, everything a branch may see of everything it inherits is a single integer.

[[SVG:skv-ceiling]]

So a branch's view is a ceiling: one history, and a cap on how much of it this branch can see. Unlike a snapshot's read version, that cap survives its reader, survives restart, and has room to be written on top of.

Put commits from several branches on the shared axis and two things show up. No two dots share a horizontal position, because the store has a single ordering. And every branch's commits sit to the right of the point it was forked at, its anchor from here on.

[[WIDGET:skv-one-clock]]

Around that counter sit six parts:

- the **sequence counter**, issuing a number to every commit in the store, on every branch
- a **fork anchor** per branch, the highest sequence it may read of anything it inherited
- the **catalog**, recording which branches exist, and each one's parent and anchor
- each branch's **own components**: its memtable, plus the levels of SSTables that memtable flushes into (a *level set*), holding only the rows that branch wrote
- the **layer stack** a read walks: your own components first, then each ancestor's, capped at the lowest anchor on the path
- the **retention pin** compaction consults, listing the superseded versions it may not discard

A fork writes the catalog and moves no data. A write lands in your branch's own components and takes its sequence from the shared counter. A read walks the stack. A merge reads a diff, commits the data, then records an *edge*: a durable note in the catalog saying these two branches agreed, as of these sequence numbers. Edges and anchors are both promises compaction has to keep.

[[WIDGET:skv-architecture]]

If a fork copies nothing, what does the child hold, and how does it read tables that main wrote before the fork existed? And if main keeps writing afterwards, why don't those newer rows show up in the child?

[[SVG:skv-map]]

The child holds a parent pointer and a number. It gets its own memtable and levels the first time it writes, and reads everything else through main, live, at every read. Main's later writes sit right there in the memtable the child reads through. They don't show up because they carry sequences above the child's ceiling, and the walk seeks under it. Nothing is captured at fork time, so nothing can go stale.

[[WIDGET:skv-fork-lifecycle]]

Each of those parts is a piece of the LSM engine that had to change. They come in the order a write meets them: the log, the memtable, the tables it flushes into, the manifest indexing them, the compaction rewriting them, and the read that walks the lot.

## The write-ahead log {#wal}

One log serves the whole store, and every branch's commits land in it. A branch gets no log of its own and needs none: the sequence number on a record says where it sits relative to every other record, whoever wrote it.

What each record gains is an owner. A commit batch belongs to one branch, and the record carries that owner, so replay after a crash routes each row back to the memtable that owns it.

[[SVG:skv-wal-owners]]

The cost shows up in disk usage. A stretch of log can only be discarded once everything written into it has reached disk, and that now spans several branches. One branch that takes a single write and goes idle keeps its stretch alive, and nothing older can be cleaned up behind it. The engine reports how much log is held this way (`wal_pinned_segments`); if it climbs while your data volume doesn't, an idle branch is the reason.

The single log also fixes what a timestamp means. Every commit draws from the same counter, so a moment in time maps onto one sequence: the last committed at or before it. That works only while the versions from back then survive, and compaction eventually removes them. Below that point the store cannot reconstruct the moment, so it tracks how far back it can still answer (`timeline_horizon`) and refuses anything older (`TimestampBelowHorizon`) instead of returning the nearest version left. A fork that lands near the right moment is worse than no fork, because nothing tells you how near.

## The memtable {#memtable}

Every branch gets its own memtable, and a memtable accepts batches from one owner. Hand it a batch belonging to anybody else and it refuses.

```rust
// src/batch.rs
/// Physical owner of every row in a commit batch. Ownership stays in the
/// batch/component metadata and is not prefixed into user keys.
pub(crate) struct BatchOwner {
	pub(crate) branch: BranchId,
	pub(crate) generation: BranchGeneration,
}
```

[[SVG:skv-memtable-purity]]

That keeps the write path dull. Your row goes into your branch's memtable and takes its sequence from the shared counter, just as it would on main. There is no branch-aware write path to get wrong.

A memtable arrives on a branch's first write, never at the fork, so an idle branch costs no memory. A thousand branches nobody has written to cost a thousand catalog records and nothing else. The memory they draw from is one shared pool with a store-wide budget (`write_buffer_soft_limit`), and the "soft" is load-bearing. A memtable's memory is not released when the branch rotates to a fresh one, only when the old one finishes flushing, and a single oversized batch gets more than the budget allows. A hard cap would mean refusing writes while accounting for memory in use, memory waiting to flush and memory mid-flush at once. That is a different allocator design, not a renamed constant.

The memtable is also where copy-on-write shadowing resolves, and this is the part I expected to be hard. When a child writes to a key it inherited, two versions of that key sit in two component sets, and every read on the child has to prefer the child's. Implementations usually track that with a dirty set, a shadow table, a per-key override map, or a copied page. None of it is needed here. A child only writes after it forked, and every write draws from the one global counter, so a child's sequences always exceed everything it inherited, including its own anchor. Its write to an inherited key is the newest version of that key, and the newest-first walk finds it first.

[[SVG:skv-shadow]]

Deletion works the same way. A tombstone in the child sits above the parent's row, so it hides that row without the parent knowing, and a branch can delete a row it does not physically hold. What a branch *owns* and what a branch *wrote* are therefore different sets, and the diff has to deal with that.

## SSTables and levels {#sstables}

A memtable flush produces an SSTable, and the table records its owner in its own metadata. Loading the manifest fails closed if a level set's owner disagrees with what the table claims, so a mismatch fails at startup instead of answering wrongly later.

The level manifest is partitioned per owner, and a read picks one partition:

```rust
// src/levels/mod.rs
// Point reads address this by physical owner; branch count must not enter
// the lookup cost.
levels_by_owner: HashMap<BatchOwner, Levels>,
```

[[SVG:skv-levels-by-owner]]

There's no owner-blind way to reach a level set, so a read path can't mix owners even if somebody wants it to. Lookup is by hash, which keeps the total number of branches out of the cost of every point read and every layer of an inherited read.

The branch id never enters a user key or an internal key, anywhere.

[[SVG:skv-key-vs-metadata]]

That one decision pays three times. Compaction stays a single-owner operation because the components it reads have one owner between them, and not because some rule says it must. Deleting a branch reclaims a component set and deletes no rows. And the key comparator never learns what a branch is, so a key's versions stay contiguous and newest-first, and a bloom filter still answers "do you hold `user:7`" in one probe.

Two components come out untouched. Bloom filters are keyed on the user key and behave as they always did, and the block cache never learns about branches. Inheriting a parent layer means one more set of filters to probe, so that cost tracks fork depth, but nothing inside either component had to change.

## The manifest {#manifest}

The manifest is how an LSM tree knows which tables sit in which level. Branching needs one thing from it the usual design can't give: a fork's commit point has to be a single durable act that either happens or doesn't.

The usual answer is a MANIFEST file. Append to it, or rewrite it and rename the new one into place. Rename is atomic in one sense, since no reader ever sees a half-written file, but it isn't a compare-and-swap. It will clobber a version somebody else wrote, so it can't say "publish this only if the state I read is still current".

So there's no MANIFEST file here. There are three numbered, immutable metadata lineages, never rewritten in place:

```
<db>/catalog/<version>.catalog            magic SKBC   the branch catalog
<db>/branch/<branch-id>/<version>.state   magic SKBM   one branch's owned facts
<db>/root/<version>.root                  magic SKRT   global recovery facts
```

Each file is magic, version, body, CRC32, and four versions of each lineage are kept. Publishing creates the next numbered name as a hard link, and linking to a name that already exists fails instead of overwriting. The publisher either wins the name or finds somebody else took it, and then compares the two byte for byte and treats an identical file as its own success.

[[SVG:skv-lineages]]

That gives a compare-and-swap on a plain filesystem with no extra service to run. Two publishers cannot silently overwrite each other; whichever loses sees the other and refuses. And when a fork is interrupted halfway through its commit point, re-publishing the same bytes is indistinguishable from having succeeded the first time.

The level manifest stays, still recording which tables are in which level, now partitioned per owner. The catalog sits above it and holds everything about branches themselves.

[[SVG:skv-manifest-split]]

Compaction needs the catalog while holding the level manifest. Hence the lock order.

#### Names and generations

The catalog is the only authority on which branches exist, who their parents are, where their anchors sit and when they expire. Delete a branch called `staging` and create another with the same name, and those are two unrelated branches sharing a label. So every branch carries a counter alongside its name, bumped on reuse and never reused itself, and ownership is that pair. A handle from the first `staging` fails with `BranchFenced` instead of rebinding to the new one, and a merge edge pointing at the old one is discarded.

Deleting a branch cannot just drop its catalog record. The branch may still hold live memory, a stretch of WAL, its tables and its own metadata files. Something durable has to say the branch is going away, or a crash halfway through teardown orphans all of it with nothing left to say it should be reclaimed. So deletion publishes a marker first, and a maintenance pass clears up afterwards in a fixed order. (This marker is also called a tombstone, confusingly: it is a catalog record about a branch, not the per-key marker from the primer.)

[[SVG:skv-catalog-lifecycle]]

Release the memory, then the WAL, then the level metadata and the tables. Delete the branch's metadata directory and make sure that deletion reaches disk. Only then remove the marker, in a fresh catalog publication. A failure before that last step leaves the marker in place, so the pass can run again.

The markers have to be cleared because the catalog caps at 4,096 records. If they lived forever the cap would count every branch ever created instead of the branches alive now, and for a store churning sandboxes those numbers diverge fast. At 4,096 a fork stops to run a clean-up sweep before proceeding, so it blocks rather than fails. A script creating a thousand sandboxes in a loop will meet that sweep, and it will look like a hang.

#### Four locks, one order

Branching added several operations that grab global state at once. A fork touches the catalog, the level manifest and the commit queue. A detach copies everything a branch was inheriting, then publishes a catalog version. A checkpoint reads every table and needs the metadata to hold still. Compaction holds the level manifest and consults the catalog. Any two of those taking the same pair of locks in opposite orders is a deadlock waiting for load.

[[SVG:skv-lock-order]]

The order is the copy lock, then the catalog lock, then the fence that stops new writes entering the queue, then the level manifest. The first two are separate on purpose. A detach can copy a great deal of data, and holding the catalog lock that long would block every unrelated branch operation in the store. So a detach copies first, takes the catalog lock only for the small publication at the end, and re-checks its branch afterwards in case it was deleted mid-copy.

The order is enforced by a test that reads the source text and asserts `catalog_publish.lock()` appears before `level_manifest.read()`. A test that greps its own codebase. I wrote it, felt silly, and kept it, because lock ordering does not live in any single execution. It lives in the shape of the code, and running the code proves nothing about a path you didn't take.

## Compaction {#compaction}

Compaction exists to discard superseded versions. A live fork anchor says one superseded version is still somebody's current value. Resolving that conflict is where nearly all the cost of branching ended up.

[[SVG:skv-compaction-conflict]]

So compaction has to be told what it may not throw away: durably, so a crash cannot lose the instruction, and cheaply enough to cost nothing in a store that has never been forked.

[[WIDGET:skv-compaction-pins]]

The failure modes pull in opposite directions. Drop the version a child's anchor needs and its next read returns a newer row, with no error and no way to tell it is wrong. Drop the version a merge measures from, the state the two branches last agreed on, and the next merge compares against the wrong base and overwrites. Keep everything, and one long-lived branch pins its parent's history for as long as it lives.

My first version kept one number per owner: the lowest sequence anybody still needed, with everything at or above it preserved. That is a retention floor, and it is the thing to build first. One integer per branch, cheap to check in a compaction loop, reusing the machinery the engine has for pinning snapshots. It lasted until I forked two branches at different points, about an afternoon.

Here is the case that killed it. The parent holds `user:7` at sequences 12, 24 and 31. One child forked at 20, another at 28. A floor at 20 keeps version 12 and lets compaction drop 24. The second child then reads `user:7` at its cap of 28, and the newest version left below 28 is 12, replaced eight sequences before that child existed. No error, just a row that was never current at its fork point. Raise the floor to 28 and the first child breaks the same way. Pin the whole range below 28 and the parent keeps its history for as long as anything stays forked near head, the cost the fork existed to avoid.

A floor is one number standing in for a set, and one number cannot answer for two anchors:

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

Anchors do not only come from children.

[[SVG:skv-anchor-kinds]]

A live merge edge contributes two more, its target-side head and its source-side cursor. A stale edge pins nothing: its source is gone, and no future merge can measure from that base. Holding history for a deleted branch is how a store churning sandboxes stops reclaiming anything. The set is sorted descending, deduplicated, and never truncated, because dropping an anchor drops the promise it represents.

Honouring *n* anchors over *m* versions looks like it should cost *n × m* comparisons. It does not, because both lists are sorted the same way:

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

The four policies only disagree when an anchor falls between two versions. Both the set and the range answer every anchor correctly, and only the retained count separates them.

[[WIDGET:skv-anchor-policy]]

Where the pins come from matters as much as what is in them. The tempting source is the live snapshot tracker: in memory, already there, and it knows who is reading right now. It is wrong twice over. Compaction's output would depend on who happened to be reading when the job ran, so two runs over identical inputs could produce different files, and an unreproducible compaction has unrepeatable bugs. And a promise in a reader's memory does not survive a crash, while a fork anchor is durable enough for a process that never saw the reader to honour it. So pins come from the catalog and nothing else.

One thing does get shared, and it surprised me. There is a single snapshot tracker for the store, so one branch's live snapshot pins visibility for every owner's compaction. A long-running read on a throwaway sandbox holds versions on main.

The pin itself is weak by design. Compaction already had rules for writing a version out or discarding it, and those rules know nothing about branches. The pin does not replace them. It is one extra condition OR'd onto the answer they give:

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

The first condition is the answer compaction would have given before branching existed. The second asks whether some branch still needs this version. An or can only turn a discard into a keep, never the reverse, so that byte-identical behaviour is a property of the operator and not something a test has to keep honest.

What the pin covers depends on the parent. A store can keep old versions of a key and let you read them back, or keep only the current value and treat everything older as garbage the moment it is superseded. A child of the first inherits a readable history, so a view capped anywhere inside it might ask for any version under the cap. A child of the second sees one value per key, whatever was current at its anchor:

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

A versioned parent pays the whole range, the price of having promised its readers a history.

Two guards sit outside the pin, and the first is the bottom level. A compaction on the deepest level it has normally knows nothing reads below it, so tombstones can be dropped there instead of written out again. Branching breaks that twice. A branch that has been forked from has readers resolving below its tombstones. A branch that is itself a fork child has its parent's layers under its own deepest level.

[[SVG:skv-two-bottoms]]

Either way the level that looks like the bottom is not, and dropping tombstones there would resurrect rows for somebody. `force_not_bottom` is the flag that stops it.

The second guard covers hard deletes. A soft delete hides a key but leaves its history reachable; a hard delete removes the key and everything behind it. When a hard delete is the newest thing on a key, compaction at the bottom level can drop the whole key and write nothing out. That is legal under one condition:

```rust
// src/iter.rs — hard_delete_may_drop_all
/// It is legal only when every reader that can still see an older version
/// also sees the tombstone that erases it. A reader boundary is a live
/// snapshot sequence or the inherited-view pin floor; a boundary landing in
/// `[oldest_seq, delete_seq)` reads data the tombstone does not cover for
/// it, so those versions — and the tombstone above them, which must keep
/// masking them for readers at or above `delete_seq` — have to survive.
```

One predicate checks both boundaries, because a fork anchor and a snapshot sequence are the same kind of object with different lifetimes. One is durable, one is transient, and compaction has no reason to care which.

That leaves the race, where I lost the most time. Anchors are durable but they appear concurrently, and a job that has been merging for a while may already have discarded a version that an anchor published thirty milliseconds ago now needs. A discarded version cannot be un-discarded. So the job samples the anchor set when it starts, re-checks it under the publication lock, and refuses its output if anything appeared in between:

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

When the job refuses, the output is thrown away, the inputs stay live for the next cycle, and `CompactionPinRaced` names the anchor the job never sampled. The fork always wins this race, because a fork is a user-visible operation with a durable commit point and a compaction is background work that can run again in five minutes.

Recording a merge edge takes the same precaution from the other side. It holds a read lock on the level manifest across its catalog write, because the moment that edge lands it becomes another sequence compaction must preserve. Forking holds the same lock across its own write. Whichever publishes second sees the other and refuses.

The engine counts these refusals (`compaction_pin_races`). A few are normal. A lot means you are creating branches against heavy compaction, and each refusal is merge work your disk did and threw away.

## The read path {#read-path}

A branch owns only what it wrote. Everything else it can see belongs to an ancestor, and it may only see the part of that ancestor sitting below its anchor. So a read consults several component sets, with a different visibility rule for each.

A snapshot here is therefore a stack of layers walked nearest-first, each carrying its own cap:

```rust
// src/snapshot.rs — Snapshot::new_owned
let mut cap = seq_num;
for (branch, generation, fork_seq) in chain {
	cap = cap.min(fork_seq);
	layers.push(SnapshotLayer { owner: BatchOwner { branch, generation }, runtime: ..., cap });
}
```

Walk the parent chain nearest-first, narrowing the cap as you go, and a layer's cap comes out as `min(snapshot seq, every fork anchor on the path to that ancestor)`. It narrows and never widens.

That stack gets used in two shapes. A point read takes one layer at a time and finishes it before touching the next: active memtable, then immutable memtables newest-first, then L0 across every overlapping table, then L1 and below by binary search. Each layer seeks at its own cap instead of the snapshot sequence, and the first visible version ends the read.

[[SVG:skv-read-walk]]

A tombstone ends it just as firmly. A delete in a nearer layer answers "absent" instead of stepping aside to let an ancestor answer, so a branch can delete a row it never physically held.

The cap reaches the two kinds of component by two routes. In a memtable it is a comparison: the walk lands on a key's newest version and steps down through the older ones until it reaches one at or below the cap. In an SSTable there is no comparison, because the cap is built into the seek key, and internal keys sort by user key ascending and sequence descending. A version above the cap sorts ahead of the seek target, so it is never read.

[[SVG:skv-cap-seek]]

A range scan can't work that way, because it yields one ordered stream instead of one answer. Every layer's iterator is capped on its own and only then merged:

```rust
// src/snapshot.rs
// Every iterator of this layer is wrapped in a SeqCappedIterator
// BEFORE the merge: per-layer fork caps cannot be expressed by
// the merged stream's global snapshot filter.
```

Why can't the filter go after the merge? Within one key, versions arrive sequence-descending, and a capped iterator walks past a key's above-cap versions down to its first visible one. A filter placed after the merge is consulted too late. By then a different layer's row has already won the key, and the row that leaks through is the answer the reader receives.

[[SVG:skv-cap-before-merge]]

Run it both ways and look at the rows that leak through in the second configuration. They're correctly ordered, they sit below the snapshot's own sequence, and nothing about them looks wrong. Their one defect is which layer they came from, and once the streams interleave, that information is gone.

[[WIDGET:skv-per-layer-caps]]

## Fork, diff and merge {#operations}

### Forking a branch {#fork}

When you fork you have to say where, and that number becomes the branch's anchor. It goes into the catalog, so it outlives every reader and every restart. There are three ways to name it:

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

All three land on an exact sequence or they fail. Forking at head includes rows the parent has committed but not yet flushed, because the child resolves the parent's live state, memtables and all, instead of a set of files on disk. So nothing has to be flushed for a fork to be correct. I had assumed I would need to build that.

[[SVG:skv-fork-anchor]]

Fork a branch off a branch and the anchors stack, each link contributing its own cap, so your effective ceiling is the lowest on the path. A grandchild can never see more of its grandparent than its parent could. That falls out of taking a minimum, and no check enforces it.

The fork itself is one publication to the catalog, and it copies no data:

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

Fencing refuses new writes into the queue; draining waits for the writes already inside it to land. Without the drain, forking at head picks a number with unfinished commits on both sides of it, and the child's view sits at neither the head nor any point you could name. The wait has a deadline, and missing it gives a retryable `ForkFenceTimeout`.

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

So a historical fork gets refused instead of approximated. Ask for a point older than anything the parent still holds and you get `BelowRetentionFloor`, carrying what you asked for and how far back the parent can go. Ask for a chain deeper than 64 and you get `ViewDepthExceeded`; detaching a branch along the chain shortens it. Two more refusals have nothing to do with retention. You cannot fork a parent at a point before the parent existed. And a retried timestamp fork is resolved from scratch, so if that timestamp now maps to a different sequence, you get a refusal instead of a stale receipt.

The fence is store-wide. It stops writers with no connection to the branch being forked or to its parent, because one global clock means one global point everything queues through. The engine tracks total drain time and the number of forks, and the ratio is the average pause each writer absorbed on somebody else's behalf (`fork_drain_nanos` over `forks`). Create branches in a loop against a busy store and that ratio will explain your p99.

### Diffing a branch {#diff}

A branch's own component set holds only rows it wrote, so scanning that set costs what the diff costs instead of what the data costs. No change journal is needed.

Detach spoils it:

```rust
// src/diff.rs
//! What it is *not* is "everything the branch owns": detach
//! materializes inherited rows into the branch's own tables, so entries are
//! filtered by sequence against the fork anchor rather than assumed to be above
//! it. That filter is the difference between a diff and a lie.
```

So a diff reads through `Snapshot::own_only`, the branch's own memtables and level set with no ancestor layers, and then still filters `seq > base`. Before any detach that filter looks like dead weight, since every owned row is above the anchor by construction. Detach is why it's there. It copies inherited rows into the branch's own tables at their original, below-anchor sequences, and without the filter those rows would show up as changes the branch had made.

[[SVG:skv-diff]]

The diff includes tombstones, because a delete is a change. It emits one entry per key, with the branch's newest write winning.

### Merging a branch {#merge}

A three-way merge needs the value at the base, the value on the source now, and the value on the target now, where the base is the last state the two branches agreed on.

The obvious candidate is the fork anchor. It is right for the first merge and wrong for every one after it, because once you have merged, the two branches have agreed on something newer than where they diverged. Leave the base at the fork anchor and a second merge re-offers everything the first one applied. So the base is three sequences:

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

Why can't the target's head at the last merge serve as the base? Merging into a target never mutates the source, so values that existed only on the target at that edge were never part of source history. Treat the target-at-edge state as the common base and a later source edit to one of those keys looks uncontested, gets applied, and overwrites a target value the source never knew existed.

Stop recording the edge and merge twice to see it. Merge, write on the target, merge again, and the second merge re-offers the first one's work and re-raises a conflict that was already settled.

[[WIDGET:skv-moving-base]]

Absence is treated as a value all the way through the classification, so delete-versus-delete resolves and delete-versus-modify conflicts, with neither needing a special case.

[[SVG:skv-merge-verdicts]]

When both sides changed the same key to different things, the merge stops and reports how many keys are in that state (`MergeConflicts`). Pick a blanket strategy, supply a function that decides per key, or go and look at them.

Some merges are refused earlier. A merge is only accepted into the branch the source was forked from, so two siblings get `BranchesUnrelated`: no base was ever recorded between them, and inventing one would be a guess dressed up as a merge. An edge pointing at a branch deleted and recreated under the same name is discarded on the same grounds. And a merge checks that both sides can still be read back as far as the base needs, which for a first merge the fork already passed.

"Has the target changed since the base?" can be answered one key at a time, or in a single pass over everything the target has written. Which is cheaper depends on how many keys the merge touches. So the engine counts the source's changes and switches between the two at `SCAN_PROBE_THRESHOLD = 256` keys. A test asserts both approaches reach the same verdict on the same input, so a badly chosen threshold costs time and never correctness.

There is a fast path under both. If no write has landed on the target since the last merge, its sequence number alone proves nothing changed, and planning reads no values.

Merges go through the same commit path as any other write, where conflict detection, the WAL and sequence allocation already live. Previewing a merge runs the same classification code as performing one, and if the target moves in between, the apply refuses.

A merge cannot write more in one transaction than fits in a memtable, so a big enough merge is split into several:

```rust
// src/merge.rs
/// How many transactions the merge took. One means it landed atomically;
/// more means each chunk is durable on its own and a failure part-way would
/// have left the earlier ones applied.
```

Nothing you pass to the call decides which you get; the size of the data decides. So read the count afterwards if atomicity matters. And if a single key's value is too big for one transaction, splitting cannot help, so the merge is refused up front with `MergeTooLarge`.

[[WIDGET:skv-merge-chunks]]

One ordering rule governs the operation: data commits first, edge second.

```rust
// src/lsm.rs
// Data first, edge second. A crash in between re-offers what was already
// applied on the next merge, which converges or conflicts — never a silent
// overwrite. The opposite order would advance past changes that were never
// written and lose them.
```

[[SVG:skv-merge-commit-order]]

A merge restricted to a range of keys (`merge_range`) records no edge: having applied part of a branch does not entitle anything to claim the two branches now agree.

### Detach and revert {#detach-revert}

The ceiling model has one structural weakness. A branch that outlives its usefulness keeps taxing its parent through the retention pin, for as long as it exists.

Detach copies the inherited view into a single SSTable placed below the branch's own levels, then clears the parent link, which releases the parent's pin and lets it compact freely again. The price is a copy of everything the branch was inheriting, so detach is forking's trade run backwards, and it is the right answer for the branch that turned out to be permanent.

[[SVG:skv-detach]]

The copy happens before the catalog lock is taken, and the branch is re-checked afterwards in case it was deleted mid-copy. Detach is idempotent: if the parent link is already gone it returns successfully instead of doing the work twice.

Revert writes compensating values forward instead of rewriting anything. It diffs the branch's own writes in range, reads the inherited value at the anchor, skips keys already equal, and writes the rest through a transaction. History stays append-only: the restored values are new writes at new sequences, and nothing that could read the old values loses that ability.

`create_branch` does not fork anything. It makes an empty branch with no parent and nothing inherited, and `fork_branch` is the one that takes a `ForkPoint`. I have got that wrong in my own tests.

## What a branch costs {#cost}

Three costs. I can describe the shape of each and the metric that would show it, which is not the same as having measured any of them.

Reads amplify with fork depth. A chain three deep means every read consults all three branches, so the work grows with the depth of the chain and with how many memtables and tables each branch on it has live. It does not grow with the number of branches: a thousand branches forked straight off main cost one extra layer each, a chain of ten costs ten. `MAX_VIEW_DEPTH = 64` caps the chain, and somebody picked 64; it is not a physical limit. Past it a fork is refused. Just short of it, reads walk 64 layers, legal and slow.

Space grows with pinned versions. For the common case it comes to roughly one extra version per branch, per key the parent has overwritten since the fork. The engine keeps a running count of versions its compactions held onto solely because some branch needed them (`pin_retained_versions_total`). It only ever goes up, counting from process start, so the signal is how fast it climbs.

Runtime state is allocated lazily. One WAL, one commit queue, one counter, one snapshot tracker and one table-id allocator are shared by the store however many branches exist. A memtable and a level set are per branch, and both arrive on the branch's first write, so an idle branch costs a catalog record and nothing else.

[[SVG:skv-branch-runtimes]]

A thousand idle branches cost a thousand records, those same shared runtimes, and whatever their anchors pin in the parent.

---

So: a fork writes one catalog record and no data, at the price of a brief store-wide fence. Throwing a branch away reclaims a component set and clears a marker, deleting no rows, because the branch was never in the keys. Asking what changed reads the branch's own components filtered by sequence. Asking for an exact point in the past gives you that point or a refusal naming how far back the store can go.

The bill lands on compaction, which now has to be handed a durable set of sequences it may not forget. I knew roughly where it would land when I picked the design. What I did not anticipate was how much of the work was about the *timing* of that instruction rather than its contents: sampling the anchor set before merging, re-checking it under the publication lock, deciding which side of a race is allowed to lose.

What I want next is numbers. A realistic churn of sandbox branches would show whether one version per anchor holds up at tens of branches or turns into the whole range under load. Timing the fence against a write-heavy workload would show whether that store-wide pause is a footnote or a problem. Both counters exist. I have not pointed them at anything real.

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
