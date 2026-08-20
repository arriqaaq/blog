---
title: Building a filesystem on a database
dek: How syscalls, inodes, blocks, journals and FUSE work, and what each one becomes when the storage underneath is a database.
eyebrow: Filesystems
slug: agent-filesystem
date: 2026-08-10
ogImage: fs-anatomy
byline: A build log on rebuilding a filesystem piece by piece on a database, so that every byte it stores can say which action wrote it, with each mechanism running live on the page.
---

An agent worked a repository overnight. In the morning, one file is wrong.

I want to ask the filesystem four questions. Which action wrote this? What else did that same run touch? What did the file look like before? Can I undo that one change without undoing everything after it? The filesystem answers the first three with silence and the fourth with a shrug. What it does offer is a modification time — a single number saying *something* changed, at roughly this moment, by nobody in particular.

That is not a missing feature. It is the design. A filesystem forgets on purpose, and it took me an embarrassingly long time to be able to say why. I have used filesystems every day for fifteen years and I could not have told you what an inode holds, where a file's bytes are recorded, or what happens between `write()` returning and a platter changing. I knew the vocabulary. I did not know the machine.

So I built one. Every piece a real filesystem has, mine had to have something in its place, and the substrate underneath it is a database, because a database is good at exactly the four things I just asked for.

[[SVG:fs-stack]]

Five surfaces reach it: an embedded Rust SDK, an MCP server for tool calls, a CLI for inspecting and publishing, a `run` command for executing an unmodified program under a sandbox, and a POSIX mount over FUSE for the many tools that only speak `open`/`read`/`write`. All five translate into one semantic kernel that owns the rules, and one crate below that, `surrealfs-store`, is the only thing that talks to the database. The database is an embedded SurrealDB over its own LSM engine, SurrealKV.

You cannot replace a mechanism you cannot describe, so the filesystem comes first. The code is at [github.com/surrealdb-dev/surrealfs](https://github.com/surrealdb-dev/surrealfs); nothing here is released, and names may still move.

## How a filesystem works

A filesystem turns a linear array of numbered blocks into named files. Everything it does is one of two jobs — deciding which blocks hold which bytes, and surviving a crash in the middle of changing that — and the four objects it keeps on disk exist to serve them.

### What `write()` does {#what-write-does}

Start with the smallest possible thing: a program opens a file and writes five bytes.

```c
int fd = open("/home/me/notes.txt", O_WRONLY | O_CREAT, 0644);
write(fd, "hello", 5);
close(fd);
```

`write()` does not put bytes on a disk. It copies them into memory the kernel controls, marks that memory as needing attention later, and returns. On a buffered write that is the whole transaction. The disk is not involved, and it may not be involved for another thirty seconds.

The `write(2)` man page says so without hedging: **"A successful return from write() does not make any guarantee that data has been committed to disk."** The only way to be sure is `fsync()`.

Between your byte and the platter sit eight layers, and each one is a place the byte can stop:

1. **The C library.** `write()` itself is a thin syscall wrapper that does no buffering. This surprised me, because I had conflated it with `fwrite()` and `printf()`, which *do* buffer inside a `FILE*` — and that is a second, separate copy in userspace before the kernel has seen anything at all.
2. **The syscall boundary.** The library puts the syscall number in a register and executes `SYSCALL`, and the CPU switches into kernel mode. (One detail worth knowing if you read older material: dispatch used to go through a `sys_call_table[]` array of function pointers. Current kernels dispatch through a `switch` statement instead, as a Spectre mitigation — the source still carries a comment saying the table "is no longer used for system calls.")
3. **The VFS.** The kernel's Virtual File System layer is a *dispatch* layer, not an implementation. It resolves the file descriptor to an in-kernel object, checks permissions and bounds, and then calls a function pointer that the actual filesystem installed. This indirection is why one `write()` works identically on ext4, XFS, btrfs, a USB stick, or a filesystem you wrote yourself in userspace, which is what FUSE makes possible.
4. **The filesystem driver.** For a buffered write, ext4 and friends land in the kernel's generic write path, which does a three-step dance per chunk of the write: ask the filesystem to prepare a page, **copy the user's bytes into it**, then tell the filesystem the copy is done. That middle step is the one and only CPU copy of your data in a buffered write.
5. **The page cache.** The page just written is now *dirty*: its contents differ from what is on disk. That is the state the data is left in when `write()` returns.
6. **Writeback.** Later — on an age threshold, or under memory pressure, or because you asked — kernel flusher threads walk the dirty pages and hand them to the block layer.
7. **The block layer.** Requests get merged, sorted by an I/O scheduler, and dispatched to the driver.
8. **The device's own cache.** This is the layer I had never thought about. Drives with a volatile write-back cache signal completion *before* the data is on non-volatile media. The kernel has explicit flags to force the issue — a pre-flush of the device cache, and a "don't acknowledge until this is truly durable" flag. Without those, an acknowledged write can still evaporate on power loss.

The widget below walks a byte down that stack. Watch where the token stops on an ordinary `write()`, then hit crash and see what disappears:

[[WIDGET:fs-syscall-path]]

Writeback buys throughput. Batching lets the kernel merge adjacent writes, sort them into an order the device likes, skip writing pages that got overwritten again a millisecond later, and avoid blocking your program on hardware that is a hundred thousand times slower than RAM. The cost is a window in which your data exists only in volatile memory.

`fsync(fd)` closes that window. It flushes the file's data *and* its metadata and does not return until the storage says it is durable. `fdatasync(fd)` is the cheaper cousin: it skips metadata that is not needed to read the data back, so a changed timestamp does not force the flush but a changed file size does.

One more caveat, and it is the best illustration of how names and files are separated. From `fsync(2)`, verbatim:

> Calling fsync() does not necessarily ensure that the entry in the directory containing the file has also reached disk. For that an explicit fsync() on a file descriptor for the directory is also needed.

Making a *file* durable does not make its *name* durable. You can `fsync` a newly created file, lose power, and boot into a filesystem where the bytes are safely on disk and nothing points to them. That is not an oversight. A file and its name are two different objects living in two different places.

This is hard rather than merely subtle. In 2018 PostgreSQL discovered that on Linux, when buffered writeback failed, the kernel could discard the dirty pages and mark them clean, so a *later* `fsync()` would cheerfully report success for data that never reached disk. Worse, on some kernel versions the error was only reported to file descriptors opened before the failure — and PostgreSQL's checkpointer opened its descriptors after. PostgreSQL now treats an `fsync()` failure as unrecoverable and panics. A production database had assumed `fsync` meant what it obviously means.

### Inodes and directory entries {#four-structures}

Every Unix-shaped filesystem is built from four objects: a *superblock*, an *inode*, a *directory entry*, and an *open file description*. What each one leaves out matters more than what it holds.

The superblock describes the filesystem itself. How big it is, how big its blocks are, where its tables begin, what features it has. There is one per mounted filesystem, and losing it means losing the map, so filesystems keep backup copies.

The inode is the file. It holds the mode bits, the owner, the size, the timestamps, the link count, and the information needed to find the file's data. It is identified by a number, and that number is the file's real identity as far as the filesystem is concerned. "Inode" is short for *index node*, because the number indexes into an on-disk array.

A directory entry maps a name to an inode number. That is its whole job. An open file description is what `open()` creates: a cursor holding the current offset and the status flags.

[[SVG:fs-anatomy]]

Here is the part that reorganised how I think about files. An inode does not contain the file's name. Not as a convenience field, not as a back-reference. The name is not there at all, because names live only in directory entries.

I checked that four ways before I believed it. The kernel's `struct inode` has no name field. `struct dentry` has both a name and a pointer to the inode it names, with a comment reading *"Where the name belongs to"*. The VFS documentation says plainly that *"A single inode can be pointed to by multiple dentries (hard links, for example, do this)"*. And the textbook framing is that creating a file does two separate things: allocate a structure to track the file, then link a human-readable name to it.

Once you see that split, a family of Unix behaviours stops being trivia and becomes arithmetic.

A hard link is not a special feature. It is a second directory entry containing the same inode number. Nothing is copied, there is no "original" and no "link", and the system cannot tell you which name came first because that was never recorded. The link count is the inode field counting how many names point at it: `link()` increments it, `unlink()` decrements it, and the data is released when it reaches zero *and* no process still has the file open.

That is why the syscall is `unlink` and not `delete`. It removes a name, and deletion is a consequence that may or may not follow. It also explains the trick every Unix programmer eventually learns: open a file, unlink it immediately, and you hold a private scratch file with no name, which the kernel destroys when your process exits. The link count hit zero, but the open file description kept it alive.

The widget below is that arithmetic. Add a second name and the count goes to two. Delete one name and the file survives. Delete the last one and the blocks finally free:

[[WIDGET:fs-inode-anatomy]]

One precision point, because the shared name causes endless confusion and I had the two concepts merged for years. Linux's `struct dentry` and an on-disk directory entry are different things. The kernel's dentry is cache only, and the VFS documentation is blunt about it: *"Dentries live in RAM and are never saved to disc: they exist only for performance."* The dcache can be dropped under memory pressure and rebuilt by reading from disk. It can even hold *negative* entries, caching the fact that a name does not exist, which is why repeatedly stat-ing a missing file is cheap. The on-disk entry is ground truth; the dentry is the memoised result of having looked it up.

The offset lives somewhere specific too. A file descriptor is a small integer indexing a per-process table. That table points at an open file description, which is system-wide and holds the offset and the status flags, and that points at the inode. Three levels, with the offset in the middle one. That is why `dup()` and `fork()` produce descriptors that *share* a cursor, since they share the description, while opening the same file twice gives you two independent cursors over one inode. POSIX calls it an "open file description"; in kernel parlance the object is a `struct file`.

### Blocks and extents {#blocks-and-extents}

The inode has to record *where* the data is. There are two generations of answer, and the difference between them is a good lesson in how a data structure ages.

Storage is handed out in fixed-size *blocks*. In ext4 that is anywhere from 1 KiB to 64 KiB, with 4 KiB being typical. A block is the smallest unit that can be allocated, which means a one-byte file still consumes a whole block. That waste is internal fragmentation, and it is not a rounding error. The original FFS paper measured real user data and found that moving to 4096-byte blocks wasted **45.6%** of the disk, which is why they invented sub-block fragments. That number is from 1984 and files have grown enormously since, so it is not a modern measurement. The mechanism is unchanged though, and most files are still small. (Modern ext4 does not pack file tails together; its small-file trick is to store the contents *inside* the inode when they fit in about sixty bytes.)

There have been two generations of answer to "where are the bytes", and the difference between them is a good lesson in how a data structure ages. The ext2-style inode has a 60-byte area holding fifteen block pointers. Twelve are *direct* — they name data blocks. The thirteenth points at a block that is itself full of pointers (single indirect). The fourteenth points at a block of blocks of pointers (double indirect). The fifteenth adds one more level.

That gives a lopsided tree on purpose. Twelve direct pointers at 4 KiB each cover the first 48 KB of a file with no indirection at all, and most files are small enough never to leave that fast path. As a file grows the levels kick in: at 4 KiB blocks, single indirect carries you to about 4 MB, double indirect past 4 GB, triple indirect to roughly 4 TB. The costs are real. Each indirect block consumes a block of storage, so metadata grows with the file, and reading near the end of a large file means reading up to three metadata blocks first just to learn where it is.

An *extent* is the second answer: a starting block and a run length. One record describes a contiguous run instead of one pointer per block. ext4's extent structures are twelve bytes each, and exactly four of them fit in the inode before it has to spill out into an external tree, which can go a few levels deep. A single extent tops out at 32,768 blocks, or 128 MiB at 4 KiB blocks.

That last number kills a tempting simplification. A perfectly contiguous 1 GiB file is *not* one extent. It is at least eight. But eight twelve-byte records is still about a hundred bytes to describe a gigabyte, against roughly a megabyte of indirect blocks for the same file under the old scheme.

The widget below shows one file both ways. Grow it past twelve blocks and indirection appears. Switch to extents and the same file collapses into a handful of records. Fragment the free space and the extent count climbs back up:

[[WIDGET:fs-blocks-extents]]

Which blocks are free is tracked in a bitmap, one bit per block, and that single fact determines a surprising amount of the on-disk geometry. One 4 KiB bitmap block covers 4096 × 8 = 32,768 blocks, which at 4 KiB each is 128 MiB. That is why ext4 block groups are 128 MiB. The number is not a tuning choice. It falls out of the arithmetic.

Allocation then tries very hard to keep related things close: a file's data near its inode, a directory's inodes together, new top-level directories spread into emptier groups. ext4 goes further and *delays* the decision. It does not choose physical blocks when you call `write()`; it waits until writeback, when it knows how much you actually wrote and can place it all at once.

Fragmentation is what happens when this fails. Free space gets carved into non-contiguous holes by deletion, and eventually a new file has to be scattered across them. Extents degrade gracefully, since a fragmented file is just more extents, but they do degrade. That is why ext4 ships an online defragmenter.

Directories are files too. A directory's data blocks contain its entries: for each one, an inode number, a record length, a name length, and the name. The record length is what makes deletion cheap: the entry is skipped over and its space folded into a neighbour, ready to be reused. ext4 adds a hashed index for large directories, cunningly hidden inside the directory file disguised as empty blocks so that an older, index-unaware reader still sees a valid linear directory.

One caveat. "A directory is a file" describes the on-disk structure, not the interface. `read()` on a directory returns `EISDIR`; you have to use the dedicated directory-reading calls.

### Path resolution {#path-resolution}

Given `/home/me/src/main.rs`, the kernel has to find an inode. There is no index from full paths to inodes — no such table exists. The path is resolved one component at a time, and each step is the same small operation repeated.

Start at the root directory's inode. Read its data blocks. Scan the entries for `home` and get an inode number. Load that inode. Read *its* data blocks. Scan for `me`. Load that inode. And so on, once per slash.

Done literally, a five-component path on a cold cache means five directory reads plus five inode reads before you have touched the file. That is the reason the dentry cache exists: it memoises the (parent directory, name) → inode step so the second traversal of a hot path touches no disk at all. It caches misses as well as hits, and its entries survive renames, because the association between a name and the file it names is stable even when the name moves.

The widget below resolves a path with the cache cold and then warm. The number to watch is disk reads:

[[WIDGET:fs-path-walk]]

This walk is also the reason deep directory hierarchies have a real, if usually small, cost, and, as the FUSE round trip makes painfully concrete, it is the single biggest performance consideration when the filesystem answering each of those steps is not the kernel but a process on the other side of a pipe.

### Journals {#journaling}

Here is the problem that turns a filesystem from a data structure into a systems problem.

Appending one block to a file is one operation to you and three independent writes to the disk: mark the block used in the free-space bitmap, update the inode to record the new size and point at the block, and write the block's contents. The disk commits one write at a time and a crash can land between any two of them.

[[SVG:fs-journal]]

Enumerate what a crash can leave behind and every case is bad in a different way. Only the data block landed: the write is simply lost, which is disappointing but *consistent*. Only the inode landed: it now points at a block the bitmap says is free, so the file reads garbage and the same block may be handed to someone else. Only the bitmap landed: a block is marked used that nothing references — a permanent leak. Inode and bitmap but not data: the metadata is perfectly consistent and the file contains whatever was on that disk region previously, which is the worst outcome of the set because nothing is detectably wrong.

One rule organises all of it, in the textbook's phrasing: *write the pointed-to object before the object that points to it*. A pointer to garbage is far more dangerous than a leaked block.

*Journaling* is write-ahead logging applied to a filesystem. Before touching the real locations, write a description of the intended update into a dedicated log, then write a commit record. Only then apply the changes to their real homes. On mount after a crash, replay the log: transactions with a valid commit record get re-applied, transactions without one are discarded. The commit record is the atomicity boundary — a multi-block update becomes all-or-nothing because a single block's presence decides it.

ext4 offers three modes, and the differences matter more than the names suggest:

- `data=journal`. File data goes through the journal too. Everything is protected, and every byte of data is written twice.
- `data=ordered`, the default. Only metadata is journalled. File data is forced out to its final location *before* the metadata commit that references it. This upholds the pointer rule without doubling the writes.
- `data=writeback`. Metadata is journalled and data ordering is not preserved. Fast, and after a crash a file can have entirely consistent metadata pointing at stale contents.

The mode names mislead people, so it is worth being exact: **`data=ordered` does not journal your data.** It orders it. All three modes guarantee *metadata* consistency; they differ only in what they promise about your bytes. A journal keeps the filesystem structurally sound. It does not promise that the thing you wrote is there.

`fsck` still exists because a journal only protects what passes through it. It cannot help with a corrupt superblock, bit rot, a hardware fault or a kernel bug, and it cannot detect the "consistent metadata, garbage contents" case at all. What the journal did do is demote `fsck` from routine to exceptional: replaying a log is proportional to recent activity, while a full check is proportional to the size of the disk, which on a large volume is the difference between seconds and hours.

### What is not recorded {#forgetting}

Everything above is a machine for maintaining *one current state* with maximum efficiency and adequate crash safety. Nowhere in it is there a place to record a previous state, and nowhere is there a place to record who caused a change.

A write overwrites the block in place. The old bytes are gone the instant the new ones land — not archived, not marked superseded, just gone. The inode's timestamps get updated, so afterwards the filesystem knows that something changed and approximately when. It does not know what changed, what it was before, which process did it, or why.

[[SVG:fs-forgets]]

That is not a deficiency. Overwriting in place is why a filesystem can run at the speed of the device, and the metadata it keeps is exactly the metadata `stat()` requires and no more. For decades the missing context was supplied by a human who remembered what they did, and by version control for the files where history was worth paying for.

An agent is not that human. It performs hundreds of writes per session through tools that call other tools, it cannot reliably report what it did, and by the time anyone looks, the evidence has been overwritten by design. The four questions I opened with are unanswerable not because filesystems are badly built but because nothing in the design was ever asked to answer them.

Which brings me to the actual experiment: what happens if you keep every mechanism above but change what a write is *allowed to destroy*?

## FUSE {#what-fuse-is}

Every mechanism above lives in the kernel, so replacing any of it means either writing a kernel module or finding the seam where the kernel is willing to ask someone else. FUSE is that seam, and it is three pieces, which the kernel documentation names exactly: *"a kernel module (fuse.ko), a userspace library (libfuse.*) and a mount utility (fusermount)."* The module registers itself as a filesystem type like any other, so the VFS dispatches to it as it would to ext4. Then, instead of reading blocks, it packages the request as a message and hands it to a userspace process.

### The round trip

That handoff happens through `/dev/fuse`, a character device. A mount is bound to an *already-open* file descriptor on that device. `fusermount` opens it, passes the descriptor as a mount option, then hands the descriptor back to your process over a Unix socket. The kernel checks it is genuinely a FUSE device before accepting.

Here is one `read()` all the way out and back:

1. The application calls `read()`. The VFS dispatches to fuse.
2. fuse builds a request: a fixed 40-byte header carrying an opcode (`FUSE_READ`) and a unique id, followed by the operation's arguments. It queues the request and puts the calling process to sleep.
3. Your daemon is blocked in `read()` on `/dev/fuse`. It wakes up, the kernel **copies** the request into its buffer, and the read returns.
4. Your daemon does its work, which in my case is querying a database, then `write()`s back a 16-byte reply header echoing that same unique id, followed by the data.
5. The kernel matches the reply to the request **by unique id**, copies the payload in, and wakes the sleeping process, which returns from `read()`.

[[WIDGET:fs-fuse-loop]]

The boundary crossings are what this costs. An in-kernel filesystem answers a `read()` with two mode transitions, in and out. FUSE needs four: the application's syscall, your daemon returning from its read, your daemon's write, and the application finally returning. Add process context switches to get from the application to your daemon and back. Add the copies: the FAST paper measuring FUSE is blunt that *"Every such call requires a memory copy between the kernel and user space,"* with a splice path that only helps above a page or two.

How much this costs in practice is workload-dependent to an almost comical degree. The same paper found FUSE's overhead ranged from *"completely imperceptible"* to a **83%** degradation, and that relative CPU utilisation could rise by 31%. Their worst cases were metadata-heavy: creating one file went through five serial operations, and a single-threaded daemon serialises thirty-two concurrent readers. (That measurement is from 2015-era kernels; ongoing work has moved the numbers a lot for streaming I/O since.)

Replies need not come back in order. Each syscall blocks, but many can be in flight at once and the daemon may answer them in any order, which is why replies are matched by unique id and not by position. The kernel maintains several queues for this, including a priority one for interrupts.

The session loop underneath all of this is small. Stripped down:

```
loop {
    let request = read(/dev/fuse)?;   // blocks until the kernel has work
    let reply = dispatch(request);    // FUSE_LOOKUP, FUSE_READ, FUSE_WRITE, ...
    write(/dev/fuse, reply)?;         // matched back by request.unique
}
```

A filesystem, from the kernel's point of view, is a process that answers questions in a loop.

Mounting does not need root. `mount(2)` is privileged, so FUSE ships a setuid-root helper that performs the mount on your behalf after checking you have write access to the mountpoint. Unprivileged mounts are forced `nosuid,nodev` so you cannot use one to smuggle in a setuid binary. By default only the user who mounted it can see the filesystem *at all* — even root — and lifting that requires an explicit option that is itself restricted unless the system administrator has enabled it.

`FUSE_INIT` is the request that matters most here. Before anything else, the kernel sends a `FUSE_INIT` request advertising a bitmask of every protocol feature it supports. Your daemon replies with the subset it wants. The kernel then enables exactly what came back.

These flags are obligations. Accepting one changes what the kernel will and will not send you. libfuse's own source has a comment to this effect, that once composed, the negotiated set *"is the negotiation result, not a wish list."* The Rust library I used is blunter still, noting that because the negotiated set is only echoed back, *"an unimplemented capability fails silently rather than loudly."*

Nothing errors. The semantics quietly become wrong instead, and this is where it cost me a data-loss bug worth walking through, because the mechanism is general.

Without the atomic `O_TRUNC` capability, the kernel strips `O_TRUNC` out of the open and follows up with a separate size-zeroing `setattr`. My adapter serviced that second message by manufacturing a second handle on a path it already had open, and closing that second handle tripped a staleness check, which discarded the caller's write and reported success. Files read back empty after being overwritten.

Requesting the capability fixes that half. The kernel's side of the bargain is explicit in its source: with the flag set it skips the follow-up `setattr`, and the comment says why — *"No need to send request to userspace, since actual truncation has already been done by OPEN."*

Except it had not been done by open, because I had not written that part yet. The flag was computed correctly, passed into a parameter named `create`, and used to select an option set whose `truncate` field was `false`. It arrived one function call from its destination and was dropped. I had taken a job over from the kernel and then not done it.

So the file kept its old tail. Overwriting `"the original, rather long, content"` with `"short"` left `"shortiginal, rather long, content"` on disk. Every test I had overwrote with *longer* content, where the new bytes cover the old ones completely and a missing truncate is invisible. One wrote `"first"` then `"second body"`. Another wrote `fn main() {}` then `fn main() { }`. Both passed, and both would have passed with the bug.

The lesson generalises past parameter names: when you negotiate a capability, you take on the work the other side stops doing, and the tests least likely to catch the gap are the ones you already wrote, because you wrote them under the old contract.

### The callbacks {#fuse-callbacks}

The Rust library I built on is a reimplementation of the protocol rather than a binding, and it exposes the *low-level* interface: callbacks are addressed by inode number, not by path, and every reply is sent explicitly. There is no path-based convenience layer, so the inode↔path bookkeeping that libfuse's high-level API does for you is yours to build. What I built instead is a lazily-populated map in both directions, described under *Inode numbers*.

Here is the surface. Nineteen callbacks are implemented; the interesting column is the third.

[[SVG:fs-fuse-ops]]

Unimplemented callbacks do not fail loudly. They take the library's default, and those defaults have consequences:

- `statfs` defaults to a reply of all zeros, so `df` reports a filesystem of size zero, zero used, zero free.
- `forget` defaults to doing nothing, which means nothing ever tells my inode table it can drop an entry.
- Extended attributes, POSIX locking, `fallocate`, hole-seeking and device nodes all report "not implemented", which is why some tools behave oddly against this mount.
- `readdir` offsets are positional indices into a freshly-listed directory, so a concurrent mutation between two `readdir` calls can skip or duplicate an entry.

`flush` and `fsync` are one line each: reply OK. Durability here is a property of publishing. Staged bytes wait in the daemon until something publishes them, so an `fsync` that returned success would be describing a guarantee this design makes somewhere else.

One flag is requested in `init`: atomic `O_TRUNC`. If the kernel refuses it, the mount fails instead of starting up in a degraded state:

```rust
fn init(&mut self, _req: &Request, config: &mut fuser::KernelConfig)
    -> std::io::Result<()>
{
    config
        .add_capabilities(fuser::InitFlags::FUSE_ATOMIC_O_TRUNC)
        .map_err(|missing| {
            std::io::Error::other(format!(
                "this kernel does not support {missing:?}; without atomic O_TRUNC an \
                 overwrite would be silently discarded"
            ))
        })
}
```

That error message is there because of the data loss described earlier: without the capability, the kernel splits the truncate off into a `setattr` my adapter mishandled.

## The rebuild {#the-swap}

Each of those mechanisms needed something in its place. Ten of them collapse into four, and three have no replacement at all.

[[SVG:fs-component-swap]]

The neon row is the one I did not anticipate. The block allocator disappears entirely. In a real filesystem, deciding *where* bytes go is a whole subsystem: bitmaps, block groups, locality heuristics, delayed allocation, an online defragmenter. Here nothing chooses a location, because a piece of data's name comes from its contents and its placement is the storage engine's problem. That is a category of code, and a category of bug, deleted instead of reimplemented.

The inode has no equivalent either. I expected to build a table of inodes and never needed one, because identity moved from an allocated number to the path itself.

### Chunks {#where-bytes-live}

Every byte of every file is stored in a column of a row in a database table. There is no blob store, no object storage, no sidecar file, no directory of loose content files anywhere in the design. A file's contents are split into pieces, each piece becomes one row, and the bytes sit in that row's `inline_bytes` column.

[[SVG:fs-storage-layers]]

Here is the path from your buffer to durable storage.

A write is cut into fixed 256 KiB chunks. Fixed-size chunking is the simple choice: inserting a byte at the front of a file re-chunks everything after it, which content-defined chunking would avoid. The size sits behind a constant so it can be changed later, and I have not benchmarked it.

Each chunk is hashed with BLAKE3, and that hash is its name.

Chunks then accumulate in a plain in-process map until something decides to publish. Nothing has reached the database yet, so a write that is never published costs one hash and some memory and leaves no trace.

At publication time each chunk becomes a row keyed by its own digest:

```sql
UPSERT chunk:⟨repository⟩/⟨blake3⟩ CONTENT {
    repository:   $repo,
    digest:       $digest,
    length:       $len,
    storage_kind: "INLINE",
    inline_bytes: $bytes,
    created_at:   time::now()
}
```

`UPSERT` and not `CREATE`, and that single choice *is* the deduplication mechanism. There is no reference count, no existence check, no dedup index. Writing bytes that already exist means upserting a row that already exists, which is a no-op that costs one statement. Rewriting the same file a hundred times stores one copy.

The table is schemaful, and the fields are constrained: `storage_kind` is one of a fixed set, `length` has to be a number, `digest` has to be there. A malformed chunk row is refused by the database at the point of writing, instead of by a validator three layers up that someone has to remember to call.

The storage engine then takes over. The rows live in one embedded database that persists through an LSM-tree engine, and that engine keeps a separate value log for large values, meaning anything over 4 KiB by default. So a 256 KiB chunk payload lands in the value log instead of being carried through the tree's compactions. That is an accident of the chunk size, not something I tuned.

Reading reverses all of it. A file's entry lists its extents in order; each extent names a chunk; each chunk is one row fetched by primary key, verified against its digest, and concatenated.

Three properties of the read path follow from this shape:

- **There is no ranged read.** Opening a file materialises all of it in memory, and reading a range slices that buffer. Reading one byte from the middle of a 100 MB file fetches all four hundred chunk rows. The chunking makes ranged reads possible, since the extents are right there, and I have not implemented them.
- **There is no cache for file contents.** There is a cache for directory nodes, but chunk payloads are fetched from the engine every time.
- **Chunk fetches are not batched.** Directory nodes are fetched in one query for many nodes; chunks are fetched one query per chunk, in a loop.

All three are consequences of treating a chunk as the unit of transfer, and all three are fixable inside that choice: a ranged read needs a chunk index, a cache needs an eviction policy, and batching needs the fetch loop to become one query. The 256 KiB chunk size itself is a guess I have not gone back and measured.

### Content addressing {#content-addressing}

Content addressing makes three separate problems disappear at once.

Equality gets cheap. Two chunks with the same name hold the same bytes, so comparing them costs a string comparison instead of a read. Everything later that needs to know "did this change?" gets to ask by name.

Immutability becomes structural. You cannot modify a chunk in place, because modified bytes hash differently and are therefore a *different* chunk. There is no rule against overwriting; overwriting is simply not an operation that can be expressed. The destructive POSIX write loses its ability to destroy, without anyone policing it.

And deduplication is a side effect of the primary key, as the `UPSERT` above showed. Record ids here are deterministic: `chunk:⟨repository⟩/⟨blake3⟩` is derived from the content rather than allocated by the database, so every digest-named thing in the design arrives with a primary key it computed for itself. Writing state is an upsert, and re-writing a node that already exists costs one statement and changes nothing.

One detail I got wrong on the first attempt and had to go back and fix: structural hashes need domain separation. Every digest that names a directory node, a key-value map, a state root, or a commit is computed over a prefix identifying what *kind* of thing is being hashed, so that a value of one kind can never collide with a value of another:

```rust
/// Domain-separated digest: BLAKE3 over `surrealfs:v1:<kind>\n<payload>`.
pub fn digest(kind: &str, payload: &[u8]) -> Digest {
    let mut hasher = blake3::Hasher::new();
    hasher.update(DOMAIN_PREFIX.as_bytes());
    hasher.update(kind.as_bytes());
    hasher.update(b"\n");
    hasher.update(payload);
    Digest::from_bytes(*hasher.finalize().as_bytes())
}

/// Content chunks are addressed by the plain BLAKE3 of their raw bytes
/// (no domain prefix), which keeps deduplication independent of any
/// SurrealFS versioning.
pub fn chunk_digest(bytes: &[u8]) -> Digest {
    Digest::from_bytes(*blake3::hash(bytes).as_bytes())
}
```

Chunks are the deliberate exception, and the comment says why: a chunk's name depends on nothing but its bytes, so deduplication keeps working across any future change to my own formats.

The widget below is the mechanism. Edit one byte and watch a new chunk appear while the old one stays; duplicate a whole file and watch the store not grow at all:

[[WIDGET:fs-chunks]]

### Directories {#the-tree}

Chunks name file contents. The namespace, meaning the tree of directories, is named the same way, and this is where the design departs most sharply from a real filesystem.

A directory becomes an immutable node: a sorted list of entries, each mapping a name to what it points at. The node is encoded canonically and hashed, and that hash is the directory's name. Because a node's digest covers its children's digests, the root's digest transitively covers the entire namespace: every directory, every file name, every mode bit, every symlink target, and by way of the extents, every byte of every file.

Here is the entry type, and the thing to look for is what identifies a file:

```rust
/// One entry in a directory node.
pub enum Entry {
    /// A subdirectory, referenced by the digest of its own node.
    Dir { meta: Meta, node: StateNodeId },
    /// A regular file. Extents are ordered and cover `[0, size)` with no gaps.
    File {
        meta: Meta,
        size: u64,
        extents: Vec<Extent>,
        /// Every path in this file's hard-link group, sorted, including
        /// its own — empty for the ordinary single-link case.
        links: Vec<RepoPath>,
    },
    Symlink { meta: Meta, target: String },
}
```

There is no inode number in it. Identity is the path. The module comment explains the reasoning better than I can paraphrase it: *an allocated identity would make the root depend on the history that produced it rather than on the content it holds.* If a file created on Tuesday got inode 481 and an identical file created on Wednesday got 482, two logically identical filesystems would hash differently, and equal state would stop producing an equal name.

This has a cost, and it lands on hard links. Hard links work because the name and the file are separate objects. Removing inode numbers removes that separation, so link groups have to be stored *as content* — each member of the group carries the sorted list of all the group's paths. A group of N paths costs O(N²) bytes. Real link groups have two or three members, and paying a little there avoided introducing a second addressing scheme alongside the first. It is the clearest case I hit of a POSIX mechanism that could not be dropped, only relocated.

Path copying is what keeps immutability affordable. Writing `/src/main.rs` creates a new node for `src` and a new root node, and nothing else. Every sibling subtree keeps its digest and is shared by name between the old tree and the new one. A write persists O(depth) new nodes, not O(tree) — a test caps it at three new nodes for a single write into a thousand-file tree.

[[WIDGET:fs-path-copy]]

The same sharing runs in reverse for reads: diffing two trees can skip any subtree whose digests match on both sides without reading it, so a diff costs the size of the change rather than the size of the repository.

And the database side of this is a single table:

```sql
DEFINE TABLE state_node TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD kind   ON TABLE state_node TYPE string ASSERT $value IN ["DIR", "KV"];
DEFINE FIELD digest ON TABLE state_node TYPE string;
DEFINE FIELD body   ON TABLE state_node TYPE object FLEXIBLE;
…
```

One row per immutable node, addressed by digest. Writing a new version of the namespace upserts the handful of nodes that changed. There is no inode table and no directory-entry table. The applied migration says so in a comment, calling row-level projections "a later, measured migration."

### The state root {#state-root}

An agent's working state is more than files. It also keeps key-value state: preferences, intermediate results, cursors. Restoring the files while forgetting that is restoring half a brain.

So the unit of state is a **state root**: the namespace tree's root node and a key-value node, hashed together into one digest.

[[SVG:fs-root-anatomy]]

```rust
/// A state root: the namespace tree root plus the KV node.
///
/// Both halves are content-addressed, so equal logical state yields an
/// equal root regardless of the history that produced it. That is what
/// makes root verification a proof of byte-for-byte restoration rather
/// than a claim about provenance.
pub fn root_digest(namespace_tree: &StateNodeId, kv: &StateNodeId) -> StateRootId {
    let mut e = Enc::new();
    e.digest(&namespace_tree.0).digest(&kv.0);
    StateRootId(digest("state-root", &e.finish()))
}
```

*Regardless of the history that produced it* is the phrase that matters. Two sessions that arrive at the same bytes by different routes, in different orders and through different intermediate states, one of them via a mistake and a correction — end at the same root digest.

[[WIDGET:fs-equal-roots]]

That is what verification rests on, and it replaces `fsck`. "Did the restore work?" is not a log line saying the restore ran; it is recomputing one digest from the restored content and comparing two strings. Where `fsck` scans a whole volume looking for internal contradictions, this either re-derives or it does not. The archive import does exactly that — every root re-derived rather than trusted, and a corrupted archive refused.

Two properties of that half are worth stating. the key-value half is not a tree. It is a single whole-map node, so any key change rewrites the whole node. Agent key-value sets are hundreds of entries where file trees reach tens of thousands, so the structural sharing has not paid for itself there yet. And **key-value values are chunks but are never chunked** — a value becomes exactly one chunk however large it is, with no size ceiling on that path, which is a sharp edge I know about and have not filed down.

No clock appears anywhere in a state root. An entry's metadata is mode, owner and group, and nothing else. Timestamps would make identical content hash differently, so they are excluded from state entirely. Where mtime comes from instead is the commit that last wrote the path.

### Commits {#history}

So far there is state, precisely named, and no history. The step that adds it is small: write the name down.

A **commit** records a state root, its parent commit, and who made it. A **branch** is a mutable name bound to a commit. A **snapshot** is the same binding made immutable. That is the history model.

The storage engine underneath can keep versions of its own, and it was tempting to let *history* mean the engine's history. Application history and storage history have different lifetimes, though. Immutable commits over content-addressed roots are what make a fork one row and verification one hash, and branches built on engine versions would have been only as durable as a compaction policy.

The consequences are outsized because everything beneath a root is immutable and shared by digest. The migration comment puts it well:

```sql
-- A snapshot is a name bound to a commit. It costs one row regardless of
-- repository size, because the commit already references an immutable state
-- root and every node beneath it is shared. "Take a snapshot" is therefore
-- a constant-time operation rather than a copy.
```

The same arithmetic covers the rest. **Forking** binds a new name to the commit you are on — one row. **Reverting** publishes a new commit whose state root *is* an older root; because that root and every node beneath it already exist, the revert writes commit metadata and moves no content, whatever the repository's size. The harmful commits stay in history with a compensating commit after them. History is preserved, never rewritten.

[[WIDGET:fs-commit-graph]]

For an agent runtime this is the recovery loop made cheap enough to use without thinking: savepoint before a risky tool call, fork to let a sub-agent explore without touching the main line, revert when the morning-after file turns out wrong.

### Publishing {#publication}

This replaces the journal, and it solves the same problem: one logical change is several physical writes, and something must make them atomic.

The first decision is *when* a transition may happen at all. A commit never happens by accident. `close()` does not commit. `fsync()` does not commit. A mount accumulating an agent's writes does not commit. Work stages into a workspace and becomes history only when something explicitly publishes it. If every `close()` minted a commit, a session that saves a file sixty times would produce sixty commits with no intent attached to any of them — history that is technically complete and practically useless.

The second decision is what a publication *is*: one database transaction that either fully happens or fully does not.

[[SVG:fs-publish-steps]]

The steps run in a fixed order inside that transaction: re-check the idempotency receipt, compare-and-swap the branch head, verify the staged content exists, write the new nodes and the commit and its provenance edges, advance the branch, store the receipt. Three of those carry the weight — the compare-and-swap, the receipt, and where the bulk bytes go.

Every publication names the commit it believes is the branch head. That field is not optional, and no code path can omit it. If the branch has moved, the publication fails inside the transaction, before anything is written, with a typed error that tells the caller exactly what to rebase onto:

```rust
if actual_head != plan.expected_head {
    return Err(SfsError::HeadConflict {
        branch: plan.branch.to_string(),
        expected: plan.expected_head.to_string(),
        actual: actual_head.to_string(),
    });
}
```

There is no last-write-wins anywhere. A conflict is an ordinary outcome the caller handles by re-reading, rebasing and retrying. A test drives four writers through a hundred rounds of this and asserts that each round produces one winner and three typed conflicts.

Two choices sit underneath that. A store is single-writer: an OS file lock makes it exclusive to one process, publications serialise behind an in-process lock, and the compare-and-swap is the second line of defence rather than the first. Concurrent writers on separate branches is a position the design can support and does not yet. And garbage collection is manual. It walks every state root, collects what they reach and deletes the rest after a grace period, but nothing schedules it for you.

[[WIDGET:fs-head-race]]

"Did it commit?" is a real question, so publications leave receipts. A process can crash after the transaction commits and before the caller hears about it. Retrying blindly would double-publish; giving up would lose work. So each publication carries a request id and writes a receipt in the same transaction, and ambiguity is a typed error whose documentation is an instruction:

```rust
/// Ambiguous outcome: the transaction may or may not have committed.
/// Resolve by receipt lookup, never by blind retry.
#[error("ambiguous transaction outcome for request {request_id}: {detail}")]
Ambiguous { request_id: String, detail: String },
```

After a crash you look up the receipt: present means it happened, absent means it did not. A harness pins this by having a child process publish and then abort itself at two chosen points — right after acknowledging, and in the staged-but-uncommitted window — and asserting that after reopening, every acknowledged commit is complete, verifiable, and free of gaps in the sequence.

Bulk bytes stay outside the transaction. Chunk payloads are written before it opens, so a large write never rides inside the transaction that moves a branch head; the transaction only verifies that the chunks its mutations name are present. The cost is a window in which staged-but-unreferenced chunks exist, which a reachability sweep reclaims — walking every state root, collecting what they reach, and deleting the rest after a grace period. That sweep has no scheduler: it runs when something calls it, which today means a test or the command line.

### The walk {#path-resolution-rebuilt}

A POSIX path walk reads a directory, finds a name, loads an inode, and repeats. This design's walk is the same shape with different nouns — read a node, find a name, load the child node, repeat — and comparing them is the clearest way to see what changed.

The tree code is synchronous and the database is asynchronous, so resolution happens in two phases: fetch the nodes along the route into a small in-memory cache, then run the pure tree logic against it. The module comment states the goal directly: *"Resolving a path costs one round trip per component rather than a load of the whole namespace, which is the point of the tree."*

The arithmetic is slightly better than one round trip per component. Resolving `/a/b/c.txt` loads the root, then `a`, then `b` — three loads, not four, because the leaf entry is read out of `b`'s already-loaded node. Listing a directory costs one extra load past the route.

Two cache tiers sit on that walk, and they map onto the dentry cache in an interesting way. A mount holds one long-lived workspace whose node cache warms up and stays warm for the life of the mount. Beneath that sits a shared cache of directory nodes, bounded at a few thousand entries.

That second cache has a property the dentry cache cannot have, and it is my favourite consequence of content addressing in the design:

> The cache key *is* the content hash, so a cached node can never be stale and the cache needs no invalidation logic at all.

A dentry cache has to be invalidated, because the thing it caches can change underneath it. Here, a node's identity *is* its content, so a cached entry cannot become wrong — only unreferenced. Insertion happens only after the node has been decoded and re-hashed, so a corrupt row cannot enter the cache. Eviction can therefore be dumb: any node can be re-fetched, so the policy only has to be cheap.

### Inode numbers {#inode-numbers}

Having no inodes leaves one problem: the kernel insists on them. Every FUSE reply carries an inode number and clients rely on them being stable, since a program that stats a file twice and sees two different numbers concludes it is looking at two different files.

So inode numbers exist, and they are allocated by the mount layer rather than stored: two hash maps and a counter, mapping paths to numbers and back, with the root pinned at 1. They are handed out on first sight and never appear in a commit, a state root, or any hash.

Rename therefore moves a whole subtree. Renaming `/old` to `/new` has to re-key not just that entry but every path beneath it, or every open handle under that directory breaks. The prefix match is component-aware rather than string-based, so renaming `/old` does not accidentally capture `/olderfile.txt`. Four tests pin this, one of them through a real kernel mount.

Numbers are never recycled either. When a path is forgotten its number is retired instead of returning to a pool, and a recreated path gets a fresh, higher number. Reuse is how a stale client handle silently starts referring to a different file: giving out a number that used to mean something else converts a stale-handle error into silent corruption.

The cost: because the FUSE `forget` callback is not implemented, nothing ever shrinks that map. A mount that stats a million paths holds a million entries until it is unmounted.

## Who wrote this byte {#provenance}

Now the machinery pays for itself. The morning-after questions were: which action wrote this, and what else did that run touch?

Everything an agent does enters through a recorded structure. A run contains spans, one per tool call, each recording a name, a status and timing. That much is ordinary tracing, and on its own it would be a log sitting next to the filesystem with no way to join the two. The difference is where the trace attaches: **a publication carries the span that authored it**, written into the commit and as a graph edge — span *caused* commit, an actual row you can traverse in either direction — in the same transaction that moves the branch head. Attribution is a field of the write.

> A change cannot reach the store without carrying the span that made it.

One more decision completes the chain. Each commit records its mutations, and each mutation row carries **the path it touched as an indexed column** rather than buried in a JSON body. The migration comment says what the index buys:

```sql
-- The path this mutation touched, as a queryable column rather than a value
-- buried in the JSON body. This is what turns "which tool call last wrote
-- this file" into a graph traversal instead of a scan-and-parse over every
-- mutation ever recorded.
DEFINE FIELD path  ON TABLE commit_mutation TYPE string;
DEFINE INDEX mutation_repo_path ON TABLE commit_mutation FIELDS repository, path;
```

Line the pieces up: the mutation carries the path, the mutation names its commit, the commit names its authoring span, the span names the tool call. So "which tool call last wrote this file" is one indexed lookup followed by two record-link hops — a single statement:

```sql
SELECT commit, kind,
       type::string(commit.committed_at) AS committed_at,
       commit.message            AS message,
       commit.author_span.name   AS tool_name,
       commit.author_span.status AS tool_status
FROM commit_mutation
WHERE repository = $repo AND path = $path
ORDER BY domain_sequence DESC LIMIT $limit
```

`commit.author_span.name` is the whole chain in one expression: mutation → commit → span, three tables crossed by record links, no joins written out, while the `WHERE` clause lands on a composite index over `(repository, path)`. Newest-first over a path's history, attributed, in one round trip.

[[WIDGET:fs-provenance]]

This is also where mtime comes back. Keeping clocks out of the state root left `stat()` with nothing to report. The answer is that the commit which last touched a path has a timestamp, and the same indexed query finds it — so an mtime here is not "roughly when the kernel flushed something" but "the recorded time of the publication that made this byte."

Three carve-outs narrow that: a path still staged in a workspace carries wall-clock time until publication gives it a commit time; the root directory always reports the mount time; and if provenance is missing or unparseable it falls back to the mount time, on the grounds that a slightly wrong timestamp is a far smaller failure than a failed `stat`.

The query orders by a sequence number denormalised onto each mutation row, and a migration comment records why: ordering by a field reached *through* a record link does not sort reliably. I found that the way you usually find it, by getting a wrong order back from a query that looked right. The fix is to copy the sort key onto the row and index it.

## The surfaces {#three-doors}

Agents do not arrive through one interface. They arrive through an embedded SDK, through tool calls, and through a POSIX mount for the many tools that only speak `open`/`read`/`write` — compilers, shells, anything spawned as a subprocess. The CLI makes a fourth, though it is there for a person inspecting and publishing rather than for an agent.

The rule is that these are *translations*, never separate *implementations*. Each surface translates its protocol into calls on one semantic kernel that owns every rule described above. A semantics bug fixed in the kernel is fixed behind every door, because there is nowhere else for the rule to live.

The surfaces disagree on purpose. The same work produces different commit *counts* through different doors: the SDK publishes per call, tool calls publish per tool call, and a mount stages an entire session and publishes nothing until told to. One conformance test drives an identical workload through all three and asserts the final state roots are identical. A second test asserts the other half of the contract — that the SDK and the mount reach that same state by *different* numbers of commits:

```rust
assert!(
    mount_commits < sdk_commits,
    "a mount stages a session into one commit ({mount_commits}) where the \
     SDK publishes per call ({sdk_commits}); converging would mean the \
     mount started committing on its own"
);
```

If that inequality ever fails, the mount has started inventing commits.

[[WIDGET:fs-three-doors]]

A companion test makes sure that comparison can fail. It takes the "identical" workloads and perturbs a single field — one mode bit, one symlink target, one leftover file — and asserts the roots *diverge*. A conformance test that cannot fail proves nothing.

Confinement is the last piece. All of the above assumes an agent's writes go through a door. An agent that can write outside the mount has escaped the provenance graph, not merely the filesystem. There is a `run` command that executes an unmodified program against real files under a sandbox — Seatbelt on macOS, Landlock on Linux, both chosen because they work without privilege, since a sandbox that requires privilege to enter is one that gets skipped exactly where it matters most. On Linux the policy is applied between `fork` and `exec`, with a check that refuses to exec at all if the ruleset enforced nothing.

That confinement is wired to the `run` path, not to the mount. Running a mounted session under the same sandbox is not done.

Only the FUSE translation needs Linux. The mount semantics live in a protocol-agnostic layer whose tests run anywhere, so the surface that has to be portable is the one that is.

---

The four questions I opened with are answerable now, and the machinery that answers them is less exotic than I expected: content addressing, one immutable tree, a transaction, and a foreign key put where it belongs.

> The files stay ordinary. The history around them becomes queryable.

## References {#references}

### How filesystems work

- [Operating Systems: Three Easy Pieces — the file systems chapters](https://pages.cs.wisc.edu/~remzi/OSTEP/) — free, and the clearest explanation of inodes, directories, crash consistency, and journaling I found. Chapters 39–42 are the relevant ones.
- [The Linux VFS documentation](https://www.kernel.org/doc/html/latest/filesystems/vfs.html) — the authority for what a superblock, inode, dentry, and file each are, including the line that dentries live in RAM and are never saved to disc.
- [Pathname lookup](https://www.kernel.org/doc/html/latest/filesystems/path-lookup.html) — how the dentry cache actually works, negative entries included; more subtle than it looks.
- [The ext4 data structures documentation](https://www.kernel.org/doc/html/latest/filesystems/ext4/) — block groups, the `i_block` pointer array, extent trees, and directory entry layouts, with exact field sizes.
- [A Fast File System for UNIX (McKusick et al., 1984)](https://dsf.berkeley.edu/cs262/FFS.pdf) — where the block/fragment trade-off and the 45.6% waste measurement come from; still worth reading whole.
- [`write(2)`](https://man7.org/linux/man-pages/man2/write.2.html) and [`fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html) — the durability contract in the words that actually define it, including the directory-fsync caveat.
- [`open(2)`](https://man7.org/linux/man-pages/man2/open.2.html) — the NOTES section is where "open file description" is defined and mapped onto the kernel's `struct file`.
- [Ensuring data reaches disk](https://lwn.net/Articles/457667/) — the five buffering layers between a variable and the platter.
- [PostgreSQL's fsync() surprise](https://lwn.net/Articles/752063/) — what happens when a serious database and a serious kernel disagree about what a successful `fsync` means.
- [ext4 and data loss](https://lwn.net/Articles/322823/) — the delayed-allocation flap, and a good case study in applications depending on behaviour nobody promised.

### FUSE

- [The libfuse project](https://github.com/libfuse/libfuse) — the reference implementation, and the source of truth for what each capability flag obliges you to do.
- [The kernel's FUSE documentation](https://docs.kernel.org/filesystems/fuse/fuse.html) — the protocol from the other side, including a step-by-step walkthrough of one request's journey and the reasoning behind the unprivileged-mount restrictions.
- [To FUSE or Not to FUSE: Performance of User-Space File Systems](https://www.usenix.org/conference/fast17/technical-sessions/presentation/vangoor) — the careful measurement of what the round trip actually costs, rather than the folklore.

### The ideas the rebuild rests on

- [surrealfs](https://github.com/surrealdb-dev/surrealfs) — the code: the semantic kernel, the store crate, the FUSE adapter, and the schema migrations quoted throughout.
- [BLAKE3](https://github.com/BLAKE3-team/BLAKE3) — the hash under every name in the rebuild.
- [Making Data Structures Persistent (Driscoll, Sarnak, Sleator, Tarjan)](https://www.cs.cmu.edu/~sleator/papers/making-data-structures-persistent.pdf) — path copying, which is what makes an immutable directory tree affordable rather than absurd.
- [Purely Functional Data Structures (Okasaki)](https://www.cs.cmu.edu/~rwh/students/okasaki.pdf) — structural sharing as a design tool.
- [Pro Git — Git Internals](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain) — the closest widely-known relative of this data model, and a useful place to notice where this design differs.
