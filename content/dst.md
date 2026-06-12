---
title: Learning DST for testing our distributed transactional KV store
dek: Building a deterministic simulation tester.
eyebrow: Deterministic Simulation Testing
slug: dst
date: 2026-06-09
byline: A build log on dst — a from-scratch DST runtime, standing on Tokio, Turmoil, madsim, and FoundationDB.
---

We've been building our distributed transactional key-value store over the past year at [SurrealDB](https://surrealdb.com/). Two aspects that have always intrigued me are correctness and reproducibility. Having read multiple Jepsen reports, I've seen how difficult it can be to reproduce novel bugs once they're discovered.

Deterministic Simulation Testing (DST) is an interesting approach to addressing the reproducibility problem. IMO, this is how I see it fit in

[[SVG:coverage]]

The rest of this blog documents my learning of how DST works in real systems. I've also been building a [DST](https://github.com/arriqaaq/dst) library from scratch to understand the underlying ideas from first principles.

Along the way, I've also used it to test parts of our distributed kv store. That said, if you're looking for a more mature and production-proven ecosystem, I highly recommend checking out turmoil and madsim. Much of my own work is heavily inspired by turmoil, and many of the ideas presented here build on its concepts.

## What deterministic simulation testing actually is {#what-is-dst}

The easiest thing to test is a pure function:

```rust
fn checkout_total(price: u64, qty: u64) -> u64 {
    price * qty
}
```

*Why* it's so easy? Because `checkout_total(300, 2)` is *always* `600`. The output depends on nothing but the two numbers passed to the function. If a test over it ever fails, it fails the same way every time, and the inputs that broke it sit right there in the assertion.

This property — *same input, same output* — is the foundation of DST. Everything else coming up is to model a system back into behaving like `checkout_total`.

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

The fix is simple: stop *reading* the hidden input and start *passing* it.

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

That is the entire trick. A single function has one hidden input; a distributed system has thousands: every `now()`, every thread, every packet that arrives just before or just after its neighbour, every `HashMap` which has a random ordering. We cannot add ten thousand parameters to a function signature by hand.

So DST runs the whole distributed system — the network, the clocks, the task scheduler, the random numbers — inside one controlled process, and replaces every source of nondeterminism with something you own and feed from a single place. That place is the *seed*.

> Same seed implies the same execution implies the same result. Always.

### What a seed actually is {#what-is-a-seed}

Computers are deterministic machines. Given the same inputs, they'll produce the same outputs every time. So when a program asks for a "random" number, it's usually getting one from a deterministic algorithm called a pseudo-random number generator (PRNG).

A PRNG keeps some internal state and uses it to generate the next number in a sequence. Start it with the same seed and you'll get the exact same sequence every time. The numbers may look random, but they're completely reproducible—which turns out to be exactly what DST wants.

A *seed*, then, is just the starting point for that sequence.

The important thing to understand is that the seed is only one piece of the puzzle. A DST engine is deterministic because it takes control of the things that are normally left up to the operating system: packet delivery order, timer execution, task scheduling, network faults, and so on. Once those decisions are made by the simulator instead of the outside world, the execution becomes reproducible.

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

Once those sources are identified, the simulator’s role is to pull them inside the process and make them explicitly driven by a seed. Most systems reduce execution to a single deterministic driver loop — a “heartbeat” that advances virtual time and resolves all state transitions:

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

Concurrency now is simulated ordering. And the entire system becomes a pure function of the seed again.

[[SVG:sim-first]]

[[WIDGET:sim-cluster]]

## Building upon Tokio: making async time controllable {#tokio-tick}

The previous sections reduced deterministic simulation to a heartbeat: deliver due messages, choose which work runs, advance virtual time, and record what happened. That loop is easy to describe if the system is written directly against the simulator. Real async Rust systems are not. They already use `tokio::time::sleep`, `timeout`, `interval`, heartbeat tasks, retry loops, and cancellation.

So this section focuses on one narrower question:

> Can ordinary Tokio code run against time that the simulator controls?

Tokio gives us the building block for that. Instead of replacing the async programming model, we create runtimes whose clocks are paused. Application code still awaits Tokio timers. The difference is that those timers no longer follow the host wall clock.

Madsim rebuilds more of the runtime from first principles. Turmoil takes the other path: keep the Tokio programming model, but run it under a driver that decides when time moves. The approach here is closer to the Turmoil side of that split.

### The runtime shape we need {#the-node-runtime}

Each simulated host or client eventually runs inside a Tokio runtime with three important properties: it is current-thread, time-enabled, and started with Tokio time paused.

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

This is also why long simulated waits are cheap. A task can `sleep(Duration::from_secs(3600)).await` without making the test wait an hour of wall-clock time. When the runtime has no runnable work except timers, paused Tokio time can move directly to the next timer deadline.

### What Tokio does while the fence is pending {#the-timer-wheel}

A Tokio sleep is not a busy loop. `tokio::time::sleep(duration)` computes a deadline from `Instant::now() + duration` and creates a timer entry. On first poll, that entry is registered with Tokio's time driver.

Tokio's traditional time driver is a hashed timing wheel: six levels, 64 slots per level, one-millisecond precision in the lowest level, and progressively coarser buckets for farther deadlines. The driver tracks the next expiration time. When the current-thread runtime has runnable work, it polls that work. When there is no runnable work left and the remaining work is timer-backed, the runtime parks.

On an unpaused runtime, parking means waiting on the OS until the next timer is due. On a paused runtime, the parking path checks whether the clock can auto-advance. If it can, Tokio performs a zero-duration park and, if nothing else woke the runtime, advances the paused clock by the time until the next timer. Then the time driver processes expired wheel entries and wakes their tasks.

So a node tick is this loop with a fence deadline: poll ready work, park, advance to the next timer, wake expired tasks, poll again, and repeat. When the next expired timer is the fence, `run_until` returns. The wall clock did not move the node forward; Tokio's saved clock moved because the runtime reached an idle timer boundary.

[[WIDGET:timer-wheel]]

### Tokio choices that still need to be pinned down {#tokio-internals}

Paused time removes host time from Tokio timers, but Tokio can still make choices. Deterministic replay needs those choices to be either removed by construction or pinned to the seed.

The first choice is worker scheduling. `new_current_thread` is a requirement, not a preference. A multi-threaded runtime has worker queues and work stealing; two ready tasks can be polled in different orders depending on which OS worker gets scheduled first. A current-thread runtime has one worker and one local scheduling context, so there is no worker race inside a node.

[[WIDGET:work-stealing]]

The second choice is `tokio::select!`. By default, `select!` does not always poll branches top-to-bottom. The macro generates a pseudo-random starting branch so a loop does not structurally favor the first branch forever. That is good production fairness and bad replay unless the randomness is controlled.

The runtime seed closes that gap. DST derives a node-specific seed from the simulation seed and passes it to Tokio's `Builder::rng_seed`, making Tokio-level pseudo-random choices replayable for a fixed seed.

[[WIDGET:select-seed]]

This gives us the Tokio half of the story: a node can run ordinary async Rust code, with timers controlled by a paused runtime and Tokio-level scheduling choices pinned down. The next section describes the simulator around those runtimes: the shared driver clock, packet heap, seeded faults, OS hooks, and replay hash.

## Anatomy of the framework: four layers over a seed {#dst-project}

The Tokio section explained how one node can run ordinary async Rust code on paused time. That is only one piece of deterministic simulation.

A distributed test also needs a shared world around those nodes: one clock for packet delivery, one place where faults are chosen, one network model, and one record of what happened. The framework puts four layers between the system under test and the host machine:

1. a **driver** that decides when the world moves forward,
2. **node runtimes** that make async code run on paused Tokio time,
3. a **deterministic network and PRNG** that turn packet timing, loss, delay, and node order into seeded choices,
4. **OS hooks** that catch clock and entropy reads that bypass Tokio.

One seed enters at the top. Every controlled choice flows from it. The result is a run that can be replayed by giving the simulator the same seed again.

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

The third layer is the **deterministic substrate**: the seeded PRNG plus the simulated network. This is where the seed becomes visible as behavior. Should a packet be delayed? How long should the delay be? Should this link drop traffic? If several packets become deliverable at the same virtual instant, which one arrives first? In a real deployment, the kernel and network decide those things. In the simulator, the seeded model decides them.

When application code sends a packet, it does not go to the operating system. The socket implementation looks at the active node context and hands the packet to the simulated network. A send is stamped with the current shared simulation time:

```rust
let now = ctx.elapsed;
let deliver_at = now + latency + extra_delay;
```

The packet is stored in a min-heap keyed by `(deliver_at, seq)`. The delivery time decides when the packet becomes visible. The sequence number breaks ties, so packets due at the same instant still have a deterministic order. At the start of each driver step, `deliver_due_packets(ctx.elapsed)` moves every due packet into the receiver's inbox.

[[WIDGET:packet-heap]]

The packet heap is the important visual here. Instead of sending bytes to a real socket, the simulator schedules packets for future virtual times. A packet sits in the heap until its delivery time arrives. When the driver reaches that time, the packet is moved into the receiver's inbox.

That one substitution changes the meaning of the network. Packet delivery is no longer “whatever the OS and NIC happened to do.” It is an ordered, replayable part of the test. Same seed, same delays, same delivery order.

[[WIDGET:packet-admission]]

Faults are layered on top of the same network model. The key distinction is between **dropping** and **holding** traffic.

[[WIDGET:partition-hold]]

A partition is a cut wire: traffic across that link is discarded. A hold is a clogged pipe: traffic stops moving, but the packets are kept and may be released later. Those two failures look similar from far away, but they test different protocol behavior. A system that survives dropped messages has not necessarily survived delayed messages arriving all at once after recovery.

That is why the framework exposes both. A partition asks, “Can the system tolerate loss?” A hold asks, “Can the system tolerate time, backlog, and reordering pressure?”

The same seeded PRNG drives these choices. Change the seed and the simulator explores a different execution. Keep the seed and it replays the same network behavior, node order, and fault sequence.

### Layer 4: OS interposition {#os-hooks-layer}

The fourth layer is **OS interposition**. Tokio's paused clock handles code that uses Tokio time: `tokio::time::sleep`, `timeout`, `interval`, and `tokio::time::Instant::now()`.

It does not automatically virtualize every clock or entropy read in the process. A dependency that calls `std::time::Instant::now()`, `SystemTime::now()`, raw `clock_gettime`, `getrandom`, or another platform entropy source can still reach the host.

[[WIDGET:os-hooks]]

The optional OS hooks close part of that gap. While execution is inside an active node context, clock reads can return simulation time instead of host time, and entropy reads can be served from a seeded generator instead of the operating system. For monotonic clocks, the hook returns the published `TickContext::elapsed`. For realtime clocks, it can return `wall_epoch + elapsed`. Outside node context, or without the hooks enabled, those calls fall back to host behavior.

This is not magic, and it is not a replacement for designing deterministic code, but it closes an important class of leaks from dependencies that were never written with simulation in mind.

### The receipt: history hash {#history-hash}

The final piece is not another layer; it is the receipt. Every meaningful event — packet delivered, packet dropped, node crashed, link repaired — is recorded into a history hash. The hash is not there to explain the bug by itself. It is there to prove that a replay really walked the same path.

> Same seed. Same schedule. Same faults. Same fingerprint.

That is the framework in one picture: the seed feeds the driver, the driver advances paused runtimes, the network turns messages into scheduled events, the hooks catch hidden host reads, and the history hash tells you whether the contract held.

## Using it to test our Distributed KV Store {#testing-ds}

A deterministic simulator is only useful if the system under test can be placed inside it without rewriting the system.

That starts with a design choice that is worth making even before DST exists: the core code should talk to the outside world through interfaces. Networking, storage, time, randomness, and background execution should sit behind seams that can be swapped. In production, those seams point at the real implementation. In tests, they can point at a controlled one.

That is what made the simulation practical. The replica code did not need a separate "simulation version". It already sent messages through a transport boundary, so the simulator only had to replace the transport underneath it.

### The seam: swap the world, not the protocol {#transport-seam}

The production system sends bytes through a real network transport. In the simulator, the same shape of interface is backed by the DST network instead:

```rust
#[async_trait::async_trait]
trait Transport {
    async fn send(&self, to: &SocketAddr, raw: &[u8], priority: i32) -> Result<()>;
    fn shutdown(&self);
}
```

The protocol still calls `send`. The replica still believes it is talking to another node. The difference is that delivery is no longer owned by the kernel. It is owned by the simulator.

That one substitution is the important trick. Latency, packet order, partitions, drops, crashes, and restarts now come from the seed instead of from the host machine.

[[WIDGET:transport-swap]]

This is the shape I would aim for in any system I wanted to test this way:

- the protocol owns its state machine,
- the harness owns the network,
- the simulator owns time and faults,
- the seed owns the choices.

Once those boundaries exist, the test cluster becomes a small in-process deployment. The harness starts a few replica hosts, starts one or more clients, and lets the simulator drive the world forward. A test can then read almost like an integration test: bring up nodes, issue a transaction, crash or partition something, and assert what must still be true.

### Start with concrete tests {#ds-concrete-tests}

The first useful tests do not need to explain the whole protocol. They should ask small, concrete questions:

- can a transaction commit when all replicas are up?
- does a restarted node rejoin with the state it needs?
- does a commit fail when quorum is unreachable?

Those are good DST tests because each one has a seed. If the unlucky timing exposes a bug, that timing is no longer lost. The seed is the address of the run.

[[WIDGET:ds-commit]]

The tests can stay readable because the complicated part is outside the test body. The harness owns cluster construction, node startup, simulated transport, and clock setup. The test owns only the scenario it wants to exercise.

```rust
run_dst(seed, |sim| {
    let cluster = build_test_cluster(3);

    sim.client("node-0", async move {
        let tx = cluster.begin().await?;
        tx.set("hello", 42).await?;
        tx.commit().await?;
        Ok(())
    });

    cluster.register_replica_hosts(sim);
});
```

The exact helper names are not the point. The point is the shape: production code runs inside a deterministic world, and the test describes only the behavior it cares about.

[[WIDGET:host-client-lifetime]]

### Then let the seed choose the details {#ds-scenarios}

Hand-written scripts are good regressions. They are not enough for exploration. Once the basic seams work, the next step is to describe a kind of world rather than a fixed timestamp-by-timestamp script.

A small scenario struct is enough:

```rust
struct Scenario {
    profile: FaultProfile,
    budget: Duration,
    invariants: Vec<Invariant>,
}

struct FaultProfile {
    crash_per_tick: f64,
    bounce_per_tick: f64,
    partition_toggle_per_tick: f64,
    tx_per_tick: f64,
    key_space: u32,
    client_crash_per_tick: f64,
}
```

The profile says what kind of pressure to apply: crashes, restarts, partitions, transaction load, contention, or client failures. The seed decides the exact nodes, links, transactions, and ticks.

That keeps the blog-level story simple:

> same seed + same scenario = same fault sequence.

[[WIDGET:rolling-clog]]

The scenario does not have to reveal the internals of the protocol. It only needs to tell the reader what kind of pressure is being applied. For example:

- crash and restart nodes, then check that the cluster heals,
- toggle partitions, then check that connected replicas agree,
- run many transactions over a tiny key space, then check that conflicts are resolved safely,
- kill a client mid-transaction, then check that the system can still settle.

The simulator is the adversary. The seed is how we replay the adversary.

### What to assert: safety first, liveness with a budget {#ds-invariants}

Faults only create pressure. Invariants decide whether the system survived it.

The clean split is safety versus liveness.

[[SVG:safety-liveness]]

**Safety** should be checked continuously. If a value has been committed, the system must not later behave as if it was never committed. If a node reports progress, that progress should not go backwards. Safety failures should stop the run immediately, because they mean the system entered a state that should be impossible.

**Liveness** should be checked at the end of a bounded scenario. A system under constant faults may be unable to make progress, and that is not automatically a bug. Progress assertions only make sense when the scenario leaves enough of the cluster connected for long enough.

That is why liveness needs a budget: give the system simulated time to recover, then ask whether it did.

[[SVG:quorum]]

At the blog level, the assertions can stay plain:

```rust
enum Invariant {
    CommittedNeverRegresses,
    AllLiveNodesRecover,
    ConnectedNodesAgree,
    AtLeastNCommits { min: u32 },
}
```

This is enough detail for the reader. We do not need to walk through every internal message or recovery path. The important idea is that DST separates the pressure from the judgment: the fault profile creates possible executions, and the invariants define what must hold across all of them.

### Replay is the payoff {#ds-replay}

When a run fails, the debugging loop should be boring:

```bash
DST_SEED=<failing-seed> cargo test <test-name>
```

The same seed reconstructs the same world: the same packet delays, the same node crashes, the same timer deadlines, the same partitions, and the same assertion failure.

[[WIDGET:same-seed-replay]]

That is the point of using DST here. The simulator is not a separate model of the algorithm. It is the same core code placed behind replaceable interfaces, driven by virtual time, a simulated network, seeded faults, and replayable invariants.

> The protocol stays the protocol. The world around it becomes deterministic.

## References {#references}

Primary sources behind the ideas in this post, grouped by topic. Where possible these link to the original talks, papers, and project documentation rather than secondary write-ups.

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
