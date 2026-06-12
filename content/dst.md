---
title: Learning DST for testing our distributed transactional KV store
dek: Building a deterministic simulation tester.
eyebrow: Deterministic Simulation Testing
slug: dst
date: 2026-06-09
byline: A build log on dst — a from-scratch DST runtime, standing on Tokio, Turmoil, madsim, and FoundationDB.
---


Over the past year, we've been building our distributed transactional key-value store at [SurrealDB](https://surrealdb.com/), alongside our own embedded key-value engine, [SurrealKV](https://github.com/surrealdb/surrealkv). Working on both systems has reinforced just how important correctness and reproducibility are for these kinds of systems.

Having read a number of Jepsen reports over the years, I've understood how difficult it can be to reproduce bugs once they're discovered. Many of the most interesting failures only occur under very specific timing conditions, or after a thousand of complex runs, making them frustratingly hard to reproduce, debug and verify. And whilst searching for answers, DST always seemed to pop up. I'd heard about it for years, but never really took the time to understand or work on how to implement it for any system.

Deterministic Simulation Testing (DST) is an approach to address the reproducibility problem. IMO, this is how I see it fit in

[[SVG:coverage]]

The rest of this blog documents my learning of how DST works and how to model it for your system. I've also been building a [DST](https://github.com/arriqaaq/dst) library from scratch to understand the underlying ideas from first principles.

Along the way, I've also used it to test parts of our distributed kv store. That said, if you're looking for a more mature and production-proven ecosystem, I highly recommend checking out turmoil and madsim. Much of my own work is heavily inspired by turmoil, and many of the ideas presented here build on its concepts.

## What deterministic simulation testing actually is {#what-is-dst}

The easiest thing to test is a pure function:

```rust
fn checkout_total(price: u64, qty: u64) -> u64 {
    price * qty
}
```

It's easy because `checkout_total(300, 2)` is *always* `600`. The output depends on nothing but the two numbers passed to the function. If a test over it ever fails, it fails the same way every time, and the inputs that broke it sit right there in the assertion.

This property — *same input, same output* — is what DST is built on. Everything that follows is about making a whole system behave like `checkout_total` again.

Now here is almost the same function, with one additional line added:

```rust
use std::time::{SystemTime, UNIX_EPOCH};

fn checkout_total(price: u64, qty: u64) -> u64 {
    let subtotal = price * qty;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    if now % 20 == 0 {        // a "discount" that fires on 1 call in 20
        subtotal / 2
    } else {
        subtotal
    }
}
```

Now `checkout_total(300, 2)` returns `600` usually. About one call in twenty it returns `300`. The output no longer depends only on its arguments; it depends on a *hidden input*, the wall clock, that the caller never sees and can never reproduce. A test that catches the `300` case catches it once and never again, because the nanosecond that triggered it is already gone.

The fix is to pass the hidden input in instead of reading it.

```rust
fn checkout_total(price: u64, qty: u64, now_nanos: u128) -> u64 {
    let subtotal = price * qty;
    if now_nanos % 20 == 0 {
        subtotal / 2
    } else {
        subtotal
    }
}

#[test]
fn replays_forever() {
    // the exact clock value that broke in CI — pinned, reproducible, ours
    assert_eq!(checkout_total(300, 2, 1_700_000_000_000_000_000), 300);
}
```

The clock went from something the function *reaches for* to something the test *hands it*. The function is pure again, and the bug now has the exact inputs that led to it — the triple `(300, 2, 1_700…000)`.

[[WIDGET:pure-function]]

The same move scales, just not by hand. A single function has one hidden input; a distributed system has thousands: every `now()`, every thread, every packet that arrives just before or just after its neighbour, every `HashMap` with its random ordering. We cannot add ten thousand parameters to a function signature.

So DST runs the whole distributed system — the network, the clocks, the task scheduler, the random numbers — inside one controlled process, and replaces every source of nondeterminism with something you own and feed from a single place. That place is the *seed*.

> Same seed implies the same execution implies the same result. Always.

### What a seed actually is {#what-is-a-seed}

A program that asks for a "random" number usually gets one from a deterministic algorithm — a pseudo-random number generator (PRNG).

A PRNG keeps internal state and uses it to produce the next number in a sequence. The same seed produces the exact same sequence every time: the numbers look random but are completely reproducible, which is exactly what DST needs.

A *seed* is the starting point for that sequence.

The seed is only one piece of the puzzle. A DST engine is deterministic because it takes control of the things that are normally left up to the operating system: packet delivery order, timer execution, task scheduling, network faults, and so on. Once those decisions are made by the simulator instead of the outside world, the execution becomes reproducible.

```rust
DST_SEED=<n> cargo test <name>
```

The seed simply gives the simulator a way to explore different executions while keeping each one replayable. Change the seed and you may get a different schedule, different faults, or a different delivery order. Keep the seed the same and the simulator can reconstruct the same execution again.

[[WIDGET:same-seed-replay]]


### Where nondeterminism enters the system {#sources}

Nondeterminism is anything the program reads that is not part of those inputs — values supplied by the environment rather than the seed. It can show up in:

1. **Concurrency**. Which task runs next is chosen by the OS scheduler, and on multicore systems execution is interleaved in different ways each run.

2. **Time**. Calls to the system clock (now, Instant, clock_gettime) return values that change across runs, affecting timeouts, retries, leases, and scheduling logic.

3. **Randomness**. Explicit RNG usage and hidden entropy from OS sources (getrandom, hardware RNGs, TLS internals) also introduces variation.

4. **I/O ordering**. Network and disk systems decide arrival order, write visibility, and buffering effects outside the program’s control.

5. **Iteration order**. Data structures like hash maps and hash sets may randomize iteration order using OS entropy.

The randomness and uncontrollable aspects is what makes reproducibility fail.

### The simulator {#the-heartbeat}

Given many sources of nondeterminism, the simulator’s role is to pull them inside the process and make them explicitly driven by a seed. Most systems reduce execution to a single deterministic driver loop — a “heartbeat” that advances virtual time and resolves all state transitions:

[[WIDGET:tick-loop]]

At each tick, the loop:

- delivers messages scheduled for the current virtual time
- decides which tasks run next
- advances virtual time explicitly
- steps all active nodes
- records an execution log or hash

Nothing happens outside this loop:

- time does not advance unless the loop advances it
- there is no background execution
- all scheduling decisions are made explicitly per tick

In many implementations, this loop runs on a single thread because it makes it easier to enforce a strict and reproducible ordering of events. Some systems also use runtimes like WASM to isolate user code and further reduce accidental sources of nondeterminism from the host environment.

### Why run the system in one process {#one-process}

The nondeterministic channels become controllable only if they live inside the same process as the seed. This makes it easy to simulate the distributed system as a single process that owns time, scheduling, randomness, and I/O.

Each external source becomes an internal component:

- scheduler → deterministic run queue
- time → mutable virtual clock
- randomness → seeded generator only
- network → in-process message system
- data structure order → explicitly ordered maps

Concurrency becomes simulated ordering, and the system is once again a function of its seed.

[[SVG:sim-first]]

[[WIDGET:sim-cluster]]

## Building upon Tokio: making async time controllable {#tokio-tick}

So far we have reduced deterministic simulation to a step-loop: deliver due messages, choose which work runs, advance virtual time, and record what happened. This loop is easy to describe if the system is written directly against the simulator. Real async Rust systems are not. They already use `tokio::time::sleep`, `timeout`, `interval`, heartbeat tasks, retry loops, and cancellation.

Interestingly, Tokio has building block for simulation controls. Instead of replacing the async runtime, we create runtimes whose clocks are paused. Application code still awaits Tokio timers. The difference is that those timers no longer follow the host wall clock.

Madsim rebuilds more of the runtime from first principles. Turmoil takes the other path: keep the Tokio programming model, but run it under a driver that decides when time moves. My approach for the dst library is closer to the Turmoil side of that split.

### The runtime shape we need {#the-node-runtime}

Each simulated host or client eventually runs inside a Tokio runtime with three important properties: it is **current-thread**, **time-enabled**, and **started with Tokio time paused**.

```rust
fn build_runtime(sim_seed: u64, node_name: &str) -> Result<Runtime, Error> {
    let mut builder = tokio::runtime::Builder::new_current_thread();
    builder.enable_time().start_paused(true);

    #[cfg(all(feature = "tokio-rng-seed", tokio_unstable))]
    {
        use rand::RngCore;

        let node_seed =
            crate::prng::Prng::derive_stream(sim_seed, node_name.as_bytes()).next_u64();

        builder.rng_seed(tokio::runtime::RngSeed::from_bytes(
            &node_seed.to_le_bytes(),
        ));
    }

    let _ = (sim_seed, node_name);

    builder
        .build()
        .map_err(|e: std::io::Error| Error::Io(e.to_string()))
}
```

- `new_current_thread` gives the runtime one executor thread. That matters because a multi-threaded runtime reintroduces OS worker scheduling: two ready tasks may run in different orders depending on which worker wakes first.
- `enable_time` installs Tokio's timer driver.
- `start_paused(true)` freezes Tokio's own clock. Calls to `tokio::time::Instant::now()` and timers such as `sleep`, `timeout`, and `interval` now depend on Tokio's paused clock rather than elapsed wall-clock time.
- `rng_seed` derives a node-specific seed from the simulation seed and the node name, then passes it into Tokio so runtime-internal randomness can be replayed.

[[WIDGET:tokio-runtime]]

### Where Tokio `now()` comes from {#where-now-comes-from}

On an ordinary runtime, `tokio::time::Instant::now()` eventually follows the host's monotonic clock. On a paused Tokio runtime, it reads a value stored inside Tokio's clock state.

In Tokio's `test-util` build, the clock stores a base `std::time::Instant`. When the clock is paused, Tokio clears the `unfrozen` field. After that, `tokio::time::Instant::now()` returns the stored base instant instead of adding host elapsed time. The base instant changes only when Tokio advances it, either through an explicit advance or through Tokio's paused-time auto-advance path.

So a node calling `tokio::time::Instant::now()` is not reading the machine's live clock. It is reading a value owned by that node's Tokio runtime.

[[WIDGET:paused-clock]]

### Advancing time with a sleep fence {#how-a-node-tick-advances-time}

Once Tokio time is paused, the simulator can move a runtime forward by awaiting a timer inside that runtime:

```rust
local
    .run_until(async {
        tokio::time::sleep(tick).await;
    })
    .await;
```

The `sleep(tick)` is a fence. `LocalSet::run_until` keeps polling the node's local tasks until that fence future completes. Application timers inside the node and the fence timer all register deadlines in the same Tokio time driver.

This is why the simulator uses a sleep fence rather than simply jumping the clock forward. If an application heartbeat is due at `+400ms` and the fence is due at `+1s`, Tokio wakes the heartbeat before the fence resolves. A direct clock jump can skip over that shape of execution unless the caller separately drives every intermediate timer.

### What Tokio does while the fence is pending {#the-timer-wheel}

A Tokio sleep is not a busy loop. When a task awaits `tokio::time::sleep(duration)`, Tokio creates a timer-backed future. The first step is turning the relative duration into an absolute deadline:

```rust
pub fn sleep(duration: Duration) -> Sleep {
    let location = trace::caller_location();

    match Instant::now().checked_add(duration) {
        Some(deadline) => Sleep::new_timeout(deadline, location),
        None => Sleep::new_timeout(Instant::far_future(), location),
    }
}
```

Here `sleep` turns **"sleep for this long"** into **"wake at this `Instant`"**: in Tokio's source, it computes the deadline before constructing the `Sleep` future. See [`tokio/src/time/sleep.rs`](https://github.com/tokio-rs/tokio/blob/tokio-1.52.1/tokio/src/time/sleep.rs#L123-L130).

`Sleep::new_timeout` then creates the timer entry:

```rust
let entry = Timer::new(handle, deadline);
```

That line matters because the `Sleep` future now owns a runtime timer entry. But the entry is not yet registered with the timer wheel. Registration happens when the future is first polled.

Inside `poll_elapsed`, Tokio checks whether the entry has already been registered. If not, it resets the entry with the current deadline and registers it with the time driver:

```rust
if !self.registered {
    let deadline = self.deadline;
    self.as_mut().reset(deadline, true);
}

let inner = self
    .inner()
    .expect("inner should already be initialized by `self.reset()`");

inner.state.poll(cx.waker())
```

So **a Tokio timer becomes part of the runtime's timer machinery when the future is polled, not merely when the `Sleep` value is created**. The source for this path is in [`tokio/src/runtime/time/entry.rs`](https://github.com/tokio-rs/tokio/blob/tokio-1.52.1/tokio/src/runtime/time/entry.rs#L598-L617).

Once registered, the timer lives in Tokio's traditional time driver: a hashed timing wheel. The wheel is a bucketed structure. Near deadlines go into fine-grained buckets, while farther deadlines go into progressively coarser buckets.

Tokio's source describes the shape of the wheel like this:

```rust
/// Timer wheel.
///
/// Levels:
///
/// * 1 ms slots / 64 ms range
/// * 64 ms slots / ~ 4 sec range
/// * ~ 4 sec slots / ~ 4 min range
/// * ~ 4 min slots / ~ 4 hr range
/// * ~ 4 hr slots / ~ 12 day range
/// * ~ 12 day slots / ~ 2 yr range
levels: Box<[Level; NUM_LEVELS]>,
```

And the number of levels is fixed at six:

```rust
/// Number of levels. Each level has 64 slots. By using 6 levels with 64 slots
/// each, the timer is able to track time up to 2 years into the future with a
/// precision of 1 millisecond.
const NUM_LEVELS: usize = 6;
```

So **Tokio does not need to check every sleeping task on every tick**: it can place timers into wheel buckets and ask the wheel for the next interesting expiration. The wheel layout is documented in [`tokio/src/runtime/time/wheel/mod.rs`](https://github.com/tokio-rs/tokio/blob/tokio-1.52.1/tokio/src/runtime/time/wheel/mod.rs#L26-L45).

[[WIDGET:timer-wheel]]

The wheel works in millisecond ticks. Tokio's time source converts a tick count back into a duration with `Duration::from_millis`:

```rust
pub(crate) fn tick_to_duration(&self, t: u64) -> Duration {
    Duration::from_millis(t)
}
```

See [`tokio/src/runtime/time/source.rs`](https://github.com/tokio-rs/tokio/blob/tokio-1.52.1/tokio/src/runtime/time/source.rs#L32-L34).

When the runtime has runnable work, it keeps polling that work. But when there is no runnable task left, and the remaining work is timer-backed, the runtime asks the time driver for the next timer expiration and parks until then.

The time driver computes the wait duration from the next wheel deadline:

```rust
let next_wake = lock.wheel.next_expiration_time();

// ...

let duration = handle
    .time_source
    .tick_to_duration(when.saturating_sub(now));
```

Then the runtime parks for that duration:

```rust
self.park_thread_timeout(rt_handle, duration);
```

So **idle time is not wasted CPU time**: if the only remaining work is waiting on timers, Tokio parks the thread until the next timer should fire. The relevant driver path is in [`tokio/src/runtime/time/mod.rs`](https://github.com/tokio-rs/tokio/blob/tokio-1.52.1/tokio/src/runtime/time/mod.rs#L219-L233).

There is one important special case: paused time. When Tokio time is paused and auto-advance is allowed, the runtime does not need to wait for real wall-clock time. Instead, it performs a zero-duration park first. If nothing else wakes the runtime, Tokio advances its paused clock by the amount of time needed to reach the next timer:

```rust
if clock.can_auto_advance() {
    self.park.park_timeout(rt_handle, Duration::from_secs(0));

    // If the time driver was woken, then the park completed
    // before the "duration" elapsed. In this case, we don't
    // advance the clock.
    if !handle.did_wake() {
        if let Err(msg) = clock.advance(duration) {
            panic!("{}", msg);
        }
    }
} else {
    self.park.park_timeout(rt_handle, duration);
}
```

So on an ordinary unpaused runtime, Tokio waits for real time. On a paused Tokio runtime, Tokio can jump its own clock forward when the runtime is otherwise idle. The fork is in [`tokio/src/runtime/time/mod.rs`](https://github.com/tokio-rs/tokio/blob/tokio-1.52.1/tokio/src/runtime/time/mod.rs#L258-L280).

The condition for auto-advance is also explicit in the clock implementation:

```rust
inner.unfrozen.is_none() && inner.auto_advance_inhibit_count == 0
```

In other words, auto-advance is allowed only when the clock is frozen and nothing is temporarily inhibiting auto-advance. See [`tokio/src/time/clock.rs`](https://github.com/tokio-rs/tokio/blob/tokio-1.52.1/tokio/src/time/clock.rs#L354-L357).

After the park returns, Tokio processes expired timer entries from the wheel:

```rust
while let Some(entry) = lock.wheel.poll(now) {
    if let Some(waker) = unsafe { entry.fire(Ok(())) } {
        waker_list.push(waker);
    }
}

waker_list.wake_all();
```

Finally, **expired timers become task wakeups**: the driver polls the wheel for entries whose deadlines have passed, fires each timer, collects the associated wakers, and wakes the tasks. This happens in [`tokio/src/runtime/time/mod.rs`](https://github.com/tokio-rs/tokio/blob/tokio-1.52.1/tokio/src/runtime/time/mod.rs#L296-L336).

So a fence wait is not "sleeping" in the blocking-thread sense, and it is not "looping" in the busy-wait sense. It is this runtime loop:

```text
poll ready tasks
-> no runnable work remains
-> ask the timer wheel for the next deadline
-> park until that deadline
-> process expired timers
-> wake their tasks
-> poll again
```

When the next expired timer is the fence deadline, the task waiting on the fence becomes runnable again and `run_until` can return.

On an ordinary runtime, real time moved forward. On a paused Tokio runtime, Tokio's saved clock moved forward because the runtime reached an idle timer boundary.

### Tokio choices that still need to be pinned down {#tokio-internals}

Paused time removes host time from Tokio timers, but Tokio can still make choices. Deterministic replay needs those choices to be either removed by construction or pinned to the seed.

The first choice is worker scheduling. `new_current_thread` is a requirement, not a preference. A multi-threaded runtime has worker queues and work stealing; two ready tasks can be polled in different orders depending on which OS worker gets scheduled first. A current-thread runtime has one worker and one local scheduling context, so there is no worker race inside a node.

[[WIDGET:work-stealing]]

The second choice is `tokio::select!`. By default, `select!` does not always poll branches top-to-bottom. The macro generates a pseudo-random starting branch so a loop does not structurally favor the first branch forever. That is good production fairness and bad replay unless the randomness is controlled.

The runtime seed closes that gap. DST derives a node-specific seed from the simulation seed and passes it to Tokio's `Builder::rng_seed`, making Tokio-level pseudo-random choices replayable for a fixed seed.

[[WIDGET:select-seed]]

That covers the Tokio side: a node can run ordinary async Rust code, with timers controlled by a paused runtime and Tokio-level scheduling choices pinned down. The next section covers the simulator around those runtimes: the shared driver clock, packet heap, seeded faults, OS hooks, and replay hash.

## DST library architecture {#dst-project}

The Tokio section explained how one node can run ordinary async Rust code on paused time. That is only one piece of deterministic simulation.

A distributed test also needs a shared world around those nodes: one clock for packet delivery, one place where faults are chosen, one network model, and one record of what happened. The framework puts four layers between the system under test and the host machine:

1. a **driver** that decides when the world moves forward,
2. **node runtimes** that make async code run on paused Tokio time,
3. a **deterministic network and PRNG** that turn packet timing, loss, delay, and node order into seeded choices,
4. **OS hooks** that catch clock and entropy reads that bypass Tokio.

A single seed enters at the top, and every controlled choice flows from it, so the run can be replayed by giving the simulator the same seed again.

[[WIDGET:four-layers]]

### Layer 1: the driver {#driver-layer}

The first layer is the **driver**. It is the heartbeat from earlier in the post: deliver what is due, run the nodes, advance virtual time, and record what happened. Nothing moves in the background. A node does not make progress because an OS thread happened to wake up; it makes progress because the driver gave it a tick.

The driver owns the shared simulation time, `TickContext::elapsed`. This is the clock used for cross-node effects: packet delivery, link faults, observers, run duration, and history recording.

A step has a fixed shape:

```rust
pub(crate) fn tick_step(input: TickInput<'_>) -> Result<TickOutput, Error> {
    let now = ctx.borrow().elapsed;

    ctx.borrow_mut().network.deliver_due_packets(now);

    let mut running = Vec::new();
    for (&addr, rt) in runtimes.iter() {
        if !rt.is_crashed() {
            running.push(addr);
        }
    }

    if ctx.borrow().network.config.random_node_order {
        running.shuffle(ctx.borrow_mut().network.rng.inner_mut());
    }

    for &addr in &running {
        ctx.borrow_mut().active_node = Some(addr);
        let finished = TickContext::activate(ctx, || rt.tick(sim_tick))?;
        ctx.borrow_mut().active_node = None;

        // ... track whether clients have finished
    }

    ctx.borrow_mut().elapsed += sim_tick;
    *steps += 1;

    #[cfg(all(feature = "os-clock-hooks", unix))]
    crate::os_hooks::publish_sim_elapsed(ctx.borrow().elapsed);

    // ... return events and completion state
}
```

The order is part of the model. At the beginning of a step, DST delivers every packet whose scheduled delivery time is `<= ctx.elapsed`. It then chooses the non-crashed nodes to run. By default, that order is `IndexMap` insertion order. If `random_node_order` is enabled, the node list is shuffled with the simulation PRNG, so the schedule changes across seeds but replays for a fixed seed.

[[WIDGET:step-loop]]

Only after every live node has been stepped does the harness advance `ctx.elapsed += sim_tick`. That keeps cross-node effects step-granular and replayable: packets, faults, observers, and history recording all share the same simulation coordinate system.

### Layer 2: node runtimes {#node-runtime-layer}

The second layer is the **node runtime**. Each simulated host or client runs inside its own current-thread Tokio runtime with time paused. That lets ordinary async code keep using `tokio::time::sleep`, `timeout`, `interval`, and heartbeat loops, while the simulator decides when those timers fire.

The driver advances a node by activating it and calling `NodeRuntime::tick`:

```rust
pub fn tick(&mut self, duration: Duration) -> Result<bool, Error> {
    if self.crashed || self.finished {
        return Ok(self.finished);
    }

    self.tokio.block_on(async {
        self.local
            .run_until(async {
                tokio::time::sleep(duration).await;
            })
            .await;
    });

    // ... then check whether the node task has finished
}
```

Each node is activated through `TickContext::activate`, which installs the simulation context in scoped thread-local storage. That is how APIs such as `UdpSocket::bind`, `UdpSocket::send_to`, and the optional clock hooks can tell which node is currently executing.

[[WIDGET:clock-handoff]]

This is where it is useful to name the split between the two clocks.

Tokio time is private to each node runtime. It drives that node's sleeps, intervals, timeouts, and heartbeat tasks.

Simulation time is shared by the harness. It drives packet delivery, fault timing, observers, OS-clock hooks, and the global run budget.

During ordinary ticks, the driver advances them together: each node is allowed to make `sim_tick` worth of Tokio-time progress, and then the shared `TickContext::elapsed` advances by the same amount. They move together by construction, but they serve different purposes.

[[WIDGET:two-clocks]]

### Layer 3: deterministic network and PRNG {#network-layer}

The third layer is the **deterministic substrate**: the seeded PRNG plus the simulated network. This is where the seed becomes visible as behavior: whether a packet is delayed, how long the delay is, whether a link drops traffic, and — when several packets become deliverable at the same virtual instant — which one arrives first. In a real deployment, the kernel and network decide those things. In the simulator, the seeded model decides them.

When application code sends a packet, it does not go to the operating system. The socket implementation looks at the active node context and hands the packet to the simulated network. A send is stamped with the current shared simulation time:

```rust
let now = ctx.elapsed;
let deliver_at = now + latency + extra_delay;
```

The packet is stored in a min-heap keyed by `(deliver_at, seq)`. The delivery time decides when the packet becomes visible. The sequence number breaks ties, so packets due at the same instant still have a deterministic order. At the start of each driver step, `deliver_due_packets(ctx.elapsed)` moves every due packet into the receiver's inbox.

[[WIDGET:packet-heap]]

Instead of sending bytes to a real socket, the simulator schedules packets for future virtual times. A packet sits in the heap until its delivery time arrives. When the driver reaches that time, the packet is moved into the receiver's inbox.

That one substitution changes the meaning of the network: packet delivery is no longer “whatever the OS and NIC happened to do,” but an ordered, replayable part of the test, where the same seed produces the same delays and the same delivery order.

[[WIDGET:packet-admission]]

Faults are layered on top of the same network model. The key distinction is between **dropping** and **holding** traffic.

[[WIDGET:partition-hold]]

A partition is a cut wire: traffic across that link is discarded. A hold is a clogged pipe: traffic stops moving, but the packets are kept and may be released later. Those two failures look similar from far away, but they test different protocol behavior. A system that survives dropped messages has not necessarily survived delayed messages arriving all at once after recovery.

That is why the framework exposes both: a partition tests whether the system tolerates loss, and a hold tests whether it tolerates time, backlog, and reordering pressure.

The same seeded PRNG drives these choices. Change the seed and the simulator explores a different execution. Keep the seed and it replays the same network behavior, node order, and fault sequence.

### Layer 4: OS interposition {#os-hooks-layer}

The fourth layer is **OS interposition**. Tokio's paused clock handles code that uses Tokio time: `tokio::time::sleep`, `timeout`, `interval`, and `tokio::time::Instant::now()`.

It does not automatically virtualize every clock or entropy read in the process. A dependency that calls `std::time::Instant::now()`, `SystemTime::now()`, raw `clock_gettime`, `getrandom`, or another platform entropy source can still reach the host.

[[WIDGET:os-hooks]]

The optional OS hooks close part of that gap. While execution is inside an active node context, clock reads can return simulation time instead of host time, and entropy reads can be served from a seeded generator instead of the operating system. For monotonic clocks, the hook returns the published `TickContext::elapsed`. For realtime clocks, it can return `wall_epoch + elapsed`. Outside node context, or without the hooks enabled, those calls fall back to host behavior.

The hooks are not a replacement for designing deterministic code, but they close an important class of leaks from dependencies that were never written with simulation in mind.

## Using it to test our Distributed KV Store {#testing-ds}

For our distributed KV store, I wanted the simulator to run the same core code that runs outside the simulator. Otherwise, it is easy to end up testing a simplified model while the real implementation keeps its own edge cases.

The integration works because the code already has boundaries around the things that come from the environment: network I/O, storage, timers, randomness, and background work. In production, those boundaries use the normal implementations. In DST tests, the harness can swap in simulator-controlled versions.

The networking side is a good example. In production, the transport sends bytes over the real network. In the simulator, the same kind of interface can enqueue messages into the DST network instead. A simplified version looks like this:

```rust
#[async_trait::async_trait]
trait Transport {
    async fn send(&self, to: &Address, bytes: &[u8]) -> Result<()>;
    fn shutdown(&self);
}
```

The protocol still calls `send`. What changes is who controls delivery. In production, delivery depends on the operating system and the network. In the simulator, delivery becomes a scheduled event. Packet delay, ordering, drops, partitions, crashes, and restarts can all come from the seed rather than from the host machine.

[[WIDGET:transport-swap]]

This split gives us a useful way to structure the tests:

- the protocol owns its state machine,
- the harness owns the cluster setup and transport adapter,
- the simulator owns virtual time and injected faults,
- the seed records the choices that need to be replayed.

With those boundaries in place, the test then looks like a small deployment. `run_dst` seeds the simulator, hands it to the test body, and runs it to completion; the body wires up the cluster — replica hosts plus a coordinator client — and lets the simulator advance virtual time. The seed comes from `DST_SEED` when set, so a failing run can be replayed verbatim. The test code stays focused on the deployment rather than on the mechanics of clocks, networking, or host lifetimes.

```rust
run_dst(seed, |sim| {
    let cluster = build_cluster_config(3);

    // node-0 is the coordinator (a client); the rest are replica hosts.
    sim.client("node-0", async move {
        let (_replica, _bus, factory) =
            start_replica_node(NodeId(0), cluster.clone(), timeout).await?;
        wait_for_cluster_stable(timeout).await;
        // drive transactions through `factory`, then assert
        Ok(())
    });
    register_replica_hosts(sim, 3, &cluster, NodeId(0));
});
```

[[WIDGET:host-client-lifetime]]


### How to model a test {#ds-concrete-tests}

It is easy to start with small, concrete tests before adding randomized scenarios. The first tests can ask basic questions like:

- can a transaction commit when all replicas are up?
- does a restarted node rejoin with the state it needs?
- does a commit fail when quorum is unreachable?

And then, a simple DST test can be put together by:

- defining a scenario,
- attaching a fault profile,
- running it with a seed,
- checking invariants,
- replaying the seed when something fails.

#### Creating a scenario {#ds-concrete-tests}

A scenario pairs a fault profile with a simulated-time budget and a set of invariants. It does not pin the seed or the node count — those come from the run, so the same seed replays it.

```rust
struct Scenario {
    name: String,
    profile: FaultProfile,
    budget_sim_ms: u64,
    invariants: Vec<Invariant>,
}
```

For example, a crash-recovery scenario can be described without exposing the internal protocol:

```rust
let scenario = Scenario {
    name: "crash_recovery".into(),
    profile: FaultProfile { /* per-tick crash / bounce / partition rates */ },
    budget_sim_ms: 30_000,
    invariants: vec![
        Invariant::CommittedNeverRegresses,
        Invariant::AllUpNodesNormalAtEnd,
        Invariant::ConnectedNodesAgreeOnViewAtEnd,
    ],
};
```

[[WIDGET:ds-commit]]

This shape keeps the scenario written in terms of observable behavior: what kind of pressure the cluster runs under, for how long, and what must remain true. The protocol internals stay behind the boundary of the system under test.

#### Creating a fault profile {#ds-scenarios}

A fault profile is the pressure applied to a scenario. It stays at the same level as the test — crashes, restarts, partitions, transaction load, contention, and client failures — not internal messages or recovery steps.

```rust
struct FaultProfile {
    crash_per_tick: f64,
    bounce_per_tick: f64,
    partition_toggle_per_tick: f64,
    tx_per_tick: f64,
    key_space: u32,
    client_crash_per_tick: f64,
}
```

[[WIDGET:rolling-clog]]

This makes it possible to build up coverage gradually. A fault profile can start with no faults, then add one kind of pressure at a time:
- crash and restart nodes, then check that the cluster can heal,
- toggle partitions, then check that connected replicas agree,
- run many transactions over a small key space, then check that conflicts are handled safely,
- stop a client mid-transaction, then check that the system can settle.

### What to assert: safety first, liveness with a budget {#ds-invariants}

Faults only create executions; invariants decide whether an execution is acceptable. Safety and liveness fail in different ways, so the checker treats them differently.

[[SVG:safety-liveness]]

**Safety** is checked continuously. A committed value must never look uncommitted later — concretely, a node's highest committed timestamp must never go backwards. The moment it does, the run stops, because the system has reached a state the test considers invalid.

**Liveness** is judged once, at the end of the budget. Under constant faults a system may be unable to make progress, and that is not automatically a bug; progress is only required once the scenario has left enough of the cluster connected for long enough. The budget gives it that simulated time, and the check then asks whether it recovered.

[[SVG:quorum]]

So the invariants stay a small, flat list, and the checker decides when each one is evaluated:

```rust
enum Invariant {
    // Safety: checked continuously — a regression ends the run at once.
    CommittedNeverRegresses,
    // Liveness: evaluated once, when the time budget expires.
    AllUpNodesNormalAtEnd,
    ConnectedNodesAgreeOnViewAtEnd,
    AtLeastNCommits { min_commits: u32 },
}
```

The fault profile creates possible executions; the invariants define the properties that must hold across them — enough to explain the testing approach without exposing the protocol internals.


### Replay is the useful part {#ds-replay}

When a run fails, the most useful output is the seed and the scenario name:

```bash
DST_SEED=<failing-seed> cargo test <test-name>
```

[[WIDGET:same-seed-replay]]

That is what makes DST practical for this test suite. The same core code runs behind replaceable environment boundaries, while virtual time, the simulated network, seeded faults, and invariants make the run reproducible.

> The code under test stays the same. The world around it becomes replayable.

## References {#references}

Primary sources behind the ideas in this post, grouped by topic.

**FoundationDB**

- [Will Wilson, "Testing Distributed Systems w/ Deterministic Simulation" (Strange Loop 2014)](https://www.youtube.com/watch?v=4fFDFbi3toc) — the talk that popularized deterministic simulation testing; explains how FoundationDB ran an entire cluster in a single deterministic thread.
- [FoundationDB documentation: Simulation and Testing](https://apple.github.io/foundationdb/testing.html) — the official description of FoundationDB's simulation framework, including Flow and the Buggify fault-injection mechanism.
- [The FoundationDB Book: "A Culture of Correctness"](https://pierrez.github.io/fdb-book/meet_fdb/correctness.html) — community write-up of how generative testing, chaos agents, and deterministic replay underpin FoundationDB's correctness story.
- [SE Radio 685: Will Wilson on Deterministic Simulation Testing](https://se-radio.net/2025/09/se-radio-685-will-wilson-on-deterministic-simulation-testing/) — a 2025 interview tracing DST from FoundationDB to Antithesis, including the "Determinator" hypervisor.

**TigerBeetle VOPR**

- [TigerBeetle: The VOPR (Viewstamped Operation Replicator)](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/vopr.md) — docs for TigerBeetle's deterministic simulator that fuzzes consensus, storage, and fault handling under controlled seeds.
- [TigerBeetle ARCHITECTURE.md](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/internals/ARCHITECTURE.md) — design overview that situates the VOPR and deterministic-by-construction design within the broader system.
- [Jepsen analysis of TigerBeetle 0.16.11](https://jepsen.io/analyses/tigerbeetle-0.16.11) — Kyle Kingsbury's independent evaluation (versions 0.16.11–0.16.30); a useful external check on a DST-heavy codebase.

**Antithesis**

- [Antithesis: How Antithesis Works](https://antithesis.com/product/how_antithesis_works/) — vendor explanation of running whole systems inside a deterministic hypervisor and searching the state space for bugs.
- [Antithesis docs: Deterministic Simulation Testing](https://antithesis.com/docs/resources/deterministic_simulation_testing/) — a concise definition of DST and the properties (determinism, reproducibility, search) it requires.
- [Antithesis: The Deterministic Hypervisor](https://antithesis.com/blog/deterministic_hypervisor/) — how Antithesis achieves whole-system determinism below the application, rather than inside it.
- [Aadhav Vignesh, "Building an open-source version of Antithesis, Part 1"](https://www.databases.systems/posts/open-source-antithesis-p1) — surveys the DST ecosystem (FoundationDB, TigerBeetle, Turmoil, Coyote, madsim) while sketching an open-source design.

**Tokio & Turmoil**

- [Announcing Turmoil](https://tokio.rs/blog/2023-01-03-announcing-turmoil) — the Tokio team's introduction to a deterministic simulation harness for distributed Rust systems.
- [tokio-rs/turmoil (source)](https://github.com/tokio-rs/turmoil) — the Turmoil repository: simulated network, time, and randomness for testing async Rust.
- [Turmoil API documentation (docs.rs)](https://docs.rs/turmoil) — reference for Turmoil's simulation API.
- [S2: "Deterministic simulation testing for async Rust"](https://s2.dev/blog/dst) — how S2 combines Turmoil with madsim-style syscall overrides to control time, entropy, and I/O; the "mad-turmoil" pairing this post refers to.
- [Pierre Zemb, "Unlocking Tokio's Hidden Gems: Determinism, Paused Time, and Local Execution"](https://pierrezemb.fr/posts/tokio-hidden-gems/) — practical guide to seeded runtimes, current-thread execution, and Tokio's paused clock.
- [Tokio docs: tokio::time::pause](https://docs.rs/tokio/latest/tokio/time/fn.pause.html) — API reference for pausing and auto-advancing virtual time, the building block for fast, deterministic time-based tests.
- [Tokio: Testing](https://tokio.rs/tokio/topics/testing) — official guidance on testing async code, including time control with the paused clock.
- [madsim-rs/madsim](https://github.com/madsim-rs/madsim) — a deterministic async runtime that intercepts time, randomness, and networking to make Tokio-based systems fully reproducible.
