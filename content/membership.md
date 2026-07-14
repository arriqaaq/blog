---
title: Who else is here? Cluster membership from first principles
dek: Heartbeats, gossip, SWIM, Serf, Lifeguard, and Rapid — how a cluster learns who is in it.
eyebrow: Distributed Systems
slug: membership
date: 2026-07-14
ogImage: mem-timeline
byline: A walkthrough of cluster membership — the underlying theory and the protocols (SWIM, Serf, Lifeguard, Rapid), with each mechanism running live on the page.
---

Consider a cluster of three servers. One of them stops answering.

It may have crashed, it may be rebooting, or it may be healthy behind a slow or broken network link. A second question follows: *which node decides?* One node may consider the server dead while another can still reach it, and the two cannot both be right. Whatever the system does next — route around the node, promote a replacement, rebalance its data — depends on which answer it acts on.

Every distributed system — databases, message queues, orchestrators — needs a continuously updated answer to one question: **who else is here right now?** That answer is **cluster membership**, and this post describes how systems compute it.

The protocols here span four decades and very different designs. We walk through them to learn how membership is handled as a system scales — the trade-offs, the failure modes, and the techniques the field has settled on. We take them in the order of the three meanings this post is about — the soft liveness view, the agreed sequence, the voter set — and [close](#surrealdb) with SurrealDS, SurrealDB's distributed transactional store, as a case study in how one system uses all three.

Before a system can keep that answer current, it has to get past one stubborn difficulty.

## Telling slow from dead {#slow-or-dead}

The difficulty has a single root: **in a distributed system, a slow node and a dead node are indistinguishable from the outside.** A node sends a message and no reply arrives. The remote machine may have crashed, the request may be queued, or the reply may still be in transit. All three cases present identically: silence.

In the widget below, an adversary has decided in advance whether the silent node is slow or dead; the only available actions are to wait longer or to declare it dead:

[[WIDGET:mem-slow-or-dead]]

The trade-off is symmetric. Declaring a node dead early risks removing a healthy-but-slow node; waiting longer delays detection of genuine failures. Running the timeout automatically shows that **no timeout value avoids both errors** — it only sets which error is more likely, and how often it occurs.

A timeout only chooses which mistake to make; it can't avoid mistakes. Before we try to do better, we need to be precise about *what* we're maintaining — because the single word "membership" is doing the work of three different jobs.

[[SVG:mem-words]]

## What membership means {#what-is-membership}

"Membership" refers to three different concepts with different consistency needs.

The first is a **liveness view**: *a local estimate of which nodes seem to be up.* This is soft, fast-changing information — what the theory literature calls a [failure detector](https://dl.acm.org/doi/10.1145/226643.226647), the pings and timeouts that estimate which machines are reachable. No node's estimate is authoritative, and two can disagree without harm, provided it is only used for soft decisions such as which replica to route a read to, or which peer to gossip with next. (At scale a node may not even track the whole cluster — [peer-sampling services](https://people.maths.bris.ac.uk/~maajg/ieeetocs03-scamp.pdf) deliberately keep only a small random *partial* view.)

The second is an **agreed view sequence**: *a numbered history of member lists — v1, v2, v3 — that every correct node observes in the same order.* This is the [group-membership / virtual-synchrony](https://www.cs.cornell.edu/ken/History.pdf) notion, and it requires coordination between nodes. It matters because some actions — rebalancing data, electing a primary — are incorrect if two nodes act on different versions of the member list. (Only *correct* nodes get the guarantee; a partitioned minority may be frozen or stale — that consistent views can't be had for free is [a theorem](https://dl.acm.org/doi/10.1145/248052.248120).)

The third is a **quorum configuration**: *the exact set of replicas whose votes decide whether a write commits.* A write counts as safe once a *majority* of that set has accepted it — so every node has to agree on which replicas are in the set. If two nodes disagree, each can collect its own "majority" from a different group and accept a *conflicting* write, with no shared member to catch the clash. That is what makes this meaning safety-critical rather than merely inconvenient: a slip here can lose already-committed data. Underneath, it is the same agreed, ordered sequence as the second meaning — in Raft the configuration is literally [an entry in the replicated log](https://raft.github.io/raft.pdf) — and a [later section](#membership-vs-consensus) shows why those groups must overlap and how the set is changed without ever breaking that.

So the three are better read as **two consistency tiers** — a soft local estimate, and an agreed ordered sequence — with the third being that sequence with the correctness bar raised to quorum intersection. What makes them easy to confuse is vocabulary: the literature applies the same words — *view*, *epoch*, *configuration* — to all of them, and worse, "view" and "term" also denote *leader* changes in Viewstamped Replication and Raft, a different concern entirely. As a result, papers can appear to be in competition when they address different concepts: a paper about the first meaning and one about the third are not disagreeing, but describing different problems.

The widget below shows one cluster through all three lenses at once. Crashing a node propagates through each layer at a different rate — the soft view changes immediately (and the two observers briefly disagree), the agreed sequence advances once, and the replica configuration changes last:

[[WIDGET:mem-three-views]]

> Recap: "membership" can mean a soft liveness estimate, an agreed ordered history, or a safety-critical voter set; identifying which one a system means is the first step to reading it correctly.

Most of this post lives in that first meaning — the soft liveness view and the protocols that compute it. The other two we separate out because *conflating* them — acting on a soft, disagreeing view where an agreed one is required — is a well-documented class of bugs, one a later section walks through. And that softness isn't lazy engineering; it's forced. The next section is the theory of why.

## Why the ambiguity is fundamental {#fundamental}

The timeout dilemma from [Telling slow from dead](#slow-or-dead) isn't a gap we can engineer around — it's a wall. Three results from the theory of distributed systems say why, and they shape every protocol in the rest of this post.

### Safety and liveness {#safety-liveness}

Describing the timeout's two errors precisely requires two terms that underpin every correctness argument in distributed systems.

A **safety** property states that *nothing bad ever happens*. If it is violated, the violation occurs at a specific moment and cannot be undone by anything that follows. "There are never two leaders at once" is a safety property: once two leaders exist, the execution is permanently incorrect.

A **liveness** property states that *something good eventually happens*. The mirror image holds: no finite prefix of an execution can violate it, because the good thing may still occur later. "Every request eventually receives a reply" is a liveness property — a request that has waited ten minutes has not violated it, and cannot at any finite time.

The distinction is operational rather than philosophical:

[[WIDGET:mem-safety-liveness]]

[Alpern and Schneider](https://www.cs.cornell.edu/fbs/publications/DefLiveness.pdf) proved in 1985 that every property decomposes into a safety part and a liveness part. The two are complementary, and most protocols trade one against the other.

### FLP and the standard response {#flp}

In 1985, [Fischer, Lynch, and Paterson](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf) proved the result known as **FLP**: in a fully asynchronous system — no bound on message delays, the same conditions as the slow-or-dead case above — no deterministic protocol can guarantee agreement among processes if even one of them may crash. The proof relies on the same ambiguity: an adversarial scheduler can always leave one decision pending on a message that may be merely slow rather than lost.

The standard response, common to every protocol discussed below, is:

**Preserve safety unconditionally; give up liveness during unfavorable periods.**

A correct protocol never produces two conflicting decisions — not during partitions, packet loss, or asynchrony. What it gives up is the guarantee of progress while the network misbehaves. When conditions recover — formalized as **partial synchrony** — progress resumes. The resulting structure recurs throughout this space: a low-cost **fast path** for when nodes already agree, and a more expensive **fallback** for when they do not.

[[SVG:mem-flp]]

The widget below shows this structure. Identical proposals are decided in one round; introducing disagreement invokes a coordinator and a slower round with more messages — but the outcome is always a single decision:

[[WIDGET:mem-fast-fallback]]

### CAP: the same trade-off under partition {#cap}

The same trade-off appears in the **[CAP theorem](https://www.comp.nus.edu.sg/~gilbert/pubs/BrewersConjecture-SigAct.pdf)**: when the network partitions, a system can retain *either* consistency (a safety property) *or* availability (a liveness property). The partition is not a third property to trade away; it is the condition that forces the choice. A membership service faces the same fork — freeze the minority side and keep a single history, or allow both sides to continue serving and let the history diverge:

[[WIDGET:mem-cap]]

> Recap: slow and dead cannot be reliably distinguished (FLP), so systems preserve safety at all times and regain progress once the network recovers; a timeout only selects which error to favor.

## Membership vs consensus {#membership-vs-consensus}

A natural question, given Raft and Paxos: does **consensus** already solve this — is "who is in the cluster" simply another value to agree on? The two are closely related, and this is where the three meanings of membership are most easily confused.

**What consensus provides.** A consensus protocol makes a fixed set of processes agree on a value — the same value everywhere, with no reversal. Composing decisions into a sequence yields **state machine replication (SMR)**: one agreed log of commands that every replica applies in the same order, so a group of machines behaves as one fault-tolerant machine.

**How it tolerates crashes.** Not by waiting for all nodes, which stalls on the first crash, but by counting a decision as final once a **quorum** — usually a majority — accepts it. The underlying property is quorum intersection: any two majorities of the *same* set share at least one member, so a value accepted by one quorum is visible to every later quorum through that shared member. Repeated draws of two majorities always intersect:

[[WIDGET:mem-quorum-overlap]]

Switching the widget to two configurations shows the limit of this property. **Intersection holds only for majorities of one agreed set.** A majority of {A,B,C,D,E} and a majority of {D,E,F,G,H} need not share any member.

**What consensus does not provide.** Consensus *assumes* the member set — its specification is "make *these n processes* agree". Determining the n processes, detecting when one fails, and changing the set safely are separate problems. Consensus also does not detect failures on its own; without an external signal of which nodes are up, it remains safe but can stall indefinitely (again, FLP). Membership supplies that missing piece.

Membership and consensus therefore depend on each other, and the risk lies at the boundary between them. A failure detector's error — suspecting a live node — costs at most a spurious leader election, a performance cost. A quorum configuration's error has a different consequence:

[[WIDGET:mem-detector-cost]]

The full failure mode: two clients hold different beliefs about the member set and each assembles a valid majority of a *different* set. The two quorums share no voter, and two conflicting writes both commit. This is **split brain**. Real databases hit the same class of problem: Cassandra's [CASSANDRA-9667](https://issues.apache.org/jira/browse/CASSANDRA-9667) documents how gossip-propagated joins could pick overlapping token ranges, and proposes making membership and ownership strongly consistent to fix it:

[[WIDGET:mem-split-brain]]

The remedy is structural. Between the soft, changing detection signal and the safety-critical voter set there must be a step that produces *agreement* — a single ordered record of the member set. Systems place that step differently: an external store such as [ZooKeeper](https://zookeeper.apache.org/) or [etcd](https://etcd.io/); the consensus protocol's own reconfiguration machinery; or a membership layer that runs its own consensus, as Rapid does (covered later):

[[SVG:mem-stack]]

Removing that step allows the quorum configuration to diverge, at which point quorum intersection no longer holds:

[[WIDGET:mem-agreement-box]]

> Recap: consensus assumes a member set and membership supplies it. A detector may be wrong at low cost; a voter set must not be, so an agreement step has to sit between the two.

## A tour of the papers {#the-papers}

Each protocol below answers "who else is here?", but sits at a different point on the design space above, and each addresses a limitation of the work before it.

[[SVG:mem-timeline]]

**The baseline: all-to-all heartbeats.** The simplest design has every node ping every other node each second. It works at small scale, but the cost is n·(n−1) messages per round. The widget below grows the cluster to make the quadratic cost concrete, then switches to gossip, where the same information propagates at linear cost:

[[WIDGET:mem-heartbeat-storm]]

**[Epidemics](https://dl.acm.org/doi/10.1145/41840.41841) (Demers et al., 1987).** This paper models replicated-database synchronization on the mathematics of epidemics, casting each node as *susceptible*, *infective*, or *removed*. **Anti-entropy** — periodically select a random peer and reconcile full state — is slow but thorough; **rumor mongering** — push new information to random peers until it stops being novel — is fast but can occasionally miss a node. Each push round shrinks the still-uninformed fraction by roughly a factor of 1/e, so an update reaches all n nodes in about log(n) rounds at close to linear message cost — the analysis the diagram below sketches, and the basis for every gossip system since.

[[SVG:mem-gossip-fanout]]

**[Gossip-style failure detection](https://www.cs.cornell.edu/home/rvr/papers/GossipFD.pdf) (van Renesse et al., 1998).** Gossip used as the detector: each node keeps a heartbeat counter per member, increments its own, and gossips the table; a counter that stops advancing marks a suspect. It scales, but each node still gossips a full member table, and detection time is coupled to gossip time.

**[SWIM](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf) (Das, Gupta & Motivala, 2002).** Separates failure detection from membership dissemination. Detection is small and constant-cost — each period, probe one peer, with a few indirect probes as a second opinion — and dissemination piggybacks on those packets. Per-node load stays flat as the cluster grows. A later section covers it in detail.

**[φ-accrual](https://doi.org/10.1109/RELDIS.2004.1353004) (Hayashibara et al., 2004).** A refinement of the *verdict itself*. A conventional detector outputs a binary alive/dead; an **accrual** detector outputs a continuous *suspicion level* and leaves the alive-or-dead call to the application. The φ detector keeps a sliding window of recent heartbeat inter-arrivals, fits a normal distribution to them, and reports φ = −log₁₀(P_later), where P_later is the probability that the next heartbeat is merely late rather than lost. The scale is the useful part: suspecting at φ ≥ 1 risks a mistake about 10% of the time, φ ≥ 2 about 1%, φ ≥ 3 about 0.1% — so each consumer picks the threshold matching its own cost of a false positive. Used in [Cassandra](https://github.com/apache/cassandra/blob/trunk/src/java/org/apache/cassandra/gms/FailureDetector.java) and [Akka](https://doc.akka.io/libraries/akka-core/current/typed/failure-detector.html).

[[SVG:mem-phi-accrual]]

**[memberlist](https://github.com/hashicorp/memberlist) and [Serf](https://github.com/hashicorp/serf/blob/master/docs/internals/gossip.html.markdown) (2013).** An implementation of SWIM (from HashiCorp) that adds a dedicated gossip cadence, a TCP full-state sync, graceful leaves, and an event layer. Covered two sections on.

**[Lifeguard](https://arxiv.org/abs/1707.00788) (2017).** Extensions to SWIM based on the observation that many false accusations originate at the node doing the accusing. Three mechanisms follow, covered in their own section.

**[FireFlies](https://www.cs.cornell.edu/home/rvr/papers/Fireflies.pdf) (Johansen et al., 2006).** Membership tolerant of nodes that lie — a Byzantine-tolerant overlay in which a verdict requires agreement among enough independent monitors that a colluding minority cannot remove a healthy node.

**[Census](https://www.usenix.org/conference/usenix-09/census-location-aware-membership-management-large-scale-distributed-systems) (Cowling et al., 2009).** Consistent, location-aware membership at scale, organized into epochs — an early approach to giving every node the same member list.

**[Rapid](https://www.usenix.org/conference/atc18/presentation/suresh) (Suresh et al., 2018).** A strongly-consistent design: detect with many observers, batch the changes, and run a leaderless consensus so the whole cluster moves through one sequence of views. Covered in its own section near the end.

**[ZooKeeper](https://zookeeper.apache.org/) and [etcd](https://etcd.io/).** A different route to the second meaning: no gossip — the member list is held as data in a small, strongly-consistent external store that nodes watch.

**Raft conf-change and [Matchmaker Paxos](https://www.jsys.org/bibliography/2021-09-3-whittakerSolution.html) (2021).** The reconfiguration category: protocols for changing the third meaning — the voter set itself — without breaking quorum intersection during the change. (This is delicate: a simplified membership-change scheme proposed for Raft was [later found unsafe by other researchers and corrected by Raft's author](https://groups.google.com/g/raft-dev/c/t4xj6dJTP6E/m/d2D9LrWRza8J).) Raft's changes are the meaning-three deep-dive [below](#raft-reconfig); Matchmaker is further reading.

Laid out in time, the papers look like a relay — each fixing a limitation of the last. Laid out by *design*, they are points in a many-dimensional space, and two that appear to disagree often just sit on different axes: Raft and Matchmaker are near-twins, while Rapid and Matchmaker barely touch. Before asking which of two "membership papers" is better, it is worth checking which axes they even share. Pick any two:

[[WIDGET:mem-axes]]

> Recap: all-to-all heartbeats cost too much; gossip made dissemination cheap; SWIM made detection cheap; memberlist and Serf packaged it as a library and agent; Lifeguard added local health awareness; Rapid added strong consistency.

## Meaning 1 · The liveness view {#meaning-1}

The protocols in this part all compute the [first meaning](#what-is-membership): a *soft* estimate of who is up — local, fast-changing, and allowed both to be wrong and to disagree between nodes. It is what most production "membership" actually is, and the cheapest to be wrong about.

## How Serf works {#serf}

**[Serf](https://github.com/hashicorp/serf/blob/master/docs/internals/gossip.html.markdown)** is a cluster-membership agent from HashiCorp; [Consul](https://www.consul.io/) uses it to maintain the member list under its service catalog. Under Serf sits **[memberlist](https://github.com/hashicorp/memberlist)**, a Go library; under memberlist sits the [SWIM paper](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf). Each layer builds on the one below:

[[SVG:mem-serf-stack]]

### The probe {#swim-probe}

SWIM's failure detector is minimal. Each **protocol period** (memberlist default: one second), a node selects one peer and sends a **ping**. If an ack returns within the timeout (500 ms), the peer is considered alive, at a cost of two packets.

If no ack returns, the node does not immediately mark the peer failed. It selects **k** other members and sends each a **ping-req**, asking them to probe the target on its behalf. (The paper leaves k configurable — [SWIM §3.1](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf); memberlist sets it to 3.) If any of them reaches the target, the ack is relayed back and the target is alive; only one network path had failed. This is what prevents a single bad link from producing a verdict: the target must be unreachable from several vantage points, not one.

Target selection is not uniformly random, which would allow a node to go unprobed for an unbounded time. SWIM keeps members in a list, traverses it **round-robin**, and **re-shuffles the list at the end of each pass** (new joiners are inserted at random positions). This bounds the worst-case interval between two probes of the same node, which in turn bounds detection time ([SWIM §4.3](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf)). The strip in the corner of the widget shows the shuffled probe order:

[[WIDGET:mem-swim]]

The two member-list panels disagree briefly and continuously while the widget runs. Verdicts propagate by **piggybacking**: updates travel as extra bytes on the pings and acks already in flight, with no dedicated packets. This is the "weakly-consistent" and "infection-style" in SWIM's name — no node holds an authoritative list, and for a liveness view none needs to.

But a failed probe is not yet a verdict. Even when the target is unreachable from every vantage point, SWIM does not drop it from the list — it opens a **suspect → confirm** lifecycle, and only the *confirmed* verdict, gossiped cluster-wide where it overrides everything, moves a node out of every member list for good. That lifecycle, and how two nodes' lists come to agree a node has failed *definitely*, is the next section.

### Suspicion and incarnation numbers {#incarnation}

A node that is briefly slow — busy CPU, transient network delay — can fail a probe round without having failed. To avoid removing it, a failed probe marks the target **suspect** rather than dead: it remains in the list and is treated as alive for routing, but on a timer. The suspicion is gossiped; if the timer expires with no refutation, the node is confirmed dead.

[[SVG:mem-swim-lifecycle]]

Refutation raises an ordering problem. If n3 is suspected and another node then hears from it, how is the "n3 is alive" message known to be *newer* than the "n3 is suspect" message? Gossip has no global clock, and the two messages can arrive in different orders at different nodes.

SWIM's answer: every member carries an **incarnation number**, and only that member may increment its own. When n3 learns it is suspected, it increments its incarnation and gossips *Alive* at the new value. The override rules ([SWIM §4.2](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf)) resolve the rest: a higher incarnation always wins; at *equal* incarnation, Suspect overrides Alive (otherwise a stale "alive" message from before the suspicion would cancel it); and a Confirm overrides both at any incarnation. The widget below runs the sequence, including a refutation attempted at the wrong incarnation:

[[WIDGET:mem-incarnation]]

The terminal Confirm is significant: a node declared dead cannot re-enter under the same identity. It rejoins as a new member at incarnation zero, which prevents membership state from moving backwards.

### What memberlist adds {#memberlist}

The SWIM paper describes one loop; memberlist runs three.

First, dissemination has its own cadence. Piggybacking spreads updates only as fast as probes occur — one per second per node — so memberlist adds a dedicated **gossip loop**: every **200 ms**, queued membership updates are sent over UDP to **3** random peers, five times the probe rate.

Second, an anti-entropy layer. UDP can drop messages, and epidemic dissemination can leave some nodes un-updated, so memberlist adds **push/pull**: every **30 seconds** each node selects one random peer, opens a TCP connection, and exchanges complete membership state — the anti-entropy of Demers et al., reconciling anything gossip missed. A joining node uses the same mechanism: one push/pull with an existing member transfers the full list.

The suspicion timer scales with cluster size, since a refutation needs time to reach the suspected node and return. memberlist sets the *floor* to **SuspicionMult (4) × log₁₀(N) × probe interval** (base-10 log, floored at one — about 4 s in a small cluster). A lone suspicion does not start at that floor: it opens **SuspicionMaxTimeoutMult (6)× higher** and shrinks toward the floor only as *independent* nodes confirm the same suspicion. That adaptive collapse is from Lifeguard, covered in the [next section](#lifeguard). The widget below shows the timeout growing with cluster size, and the difference between a crash and a graceful leave:

[[WIDGET:mem-serf-machine]]

### What Serf adds {#serf-layer}

memberlist maintains the list; **Serf** provides an interface on top of it. It exposes state transitions as an event stream — events such as member-join, member-leave, and member-failed (plus member-update and member-reap). It distinguishes leaving from failing: a node shutting down cleanly broadcasts a **leave intent** first, so peers record it as "left" rather than running the suspect-timeout-dead sequence for a node that was intentionally removed. Because intents and user events propagate over gossip with no global clock, Serf stamps them with **Lamport clocks** — logical timestamps that preserve the order of events such as a leave followed by a rejoin.

> Recap: Serf combines SWIM's probe (with indirect probes) and suspicion-with-refutation, memberlist's three loops (probe 1 s, gossip 200 ms, push/pull 30 s), and an event layer with leave intents and Lamport-clocked ordering.

## Lifeguard: local health awareness {#lifeguard}

Even with suspicion and indirect probing, SWIM-style detectors still produce false positives — healthy nodes briefly declared failed — and each one triggers downstream work: view changes, failovers, rebalancing. The widget below shows the cost of flapping: the same fault pattern under two detectors, with a rebalancing counter on the right:

[[WIDGET:mem-flap]]

The [Lifeguard paper](https://arxiv.org/abs/1707.00788) (Dadgar, Phillips & Currey, 2017) identifies a major source of these false positives at **the node doing the detecting**. When a node's own resources degrade — a GC pause, CPU contention, network delay or loss — its probes are sent late, its timers fire early relative to its slowed processing, and its acks are read after the deadline. In the paper's terms, the *local failure detector module* itself may be at fault: a degraded node observes a healthy cluster as a set of failures. Lifeguard extends SWIM with **local health awareness** ([Lifeguard §IV](https://arxiv.org/abs/1707.00788)) — three mechanisms that make a node account for its own condition before judging others.

**One: the Local Health Multiplier, applied by *LHA-Probe*.** Each node keeps a self-health score, **LHM**, a saturating counter from 0 to 8. It is incremented on a failed probe (+1); on a probe with a missed **nack** — a ping-req helper that cannot reach the target sends an explicit negative acknowledgement (in the paper, at 80% of the timeout), so the absence of any nack points at the initiator's own path (+1); and on having to refute a suspicion about oneself, since a cluster-wide suspicion of a node usually reflects that node's own slowness (+1). A clean probe decrements it (−1). The paper's *LHA-Probe* mechanism then multiplies both probe interval and timeout by **(LHM+1)**, so at LHM 8 probes go out every 9 seconds with a 4.5-second timeout, giving a slow node more time to read acks before treating their senders as failed. (memberlist implements a lighter version: it caps the multiplier at ×8 — an 8-second maximum probe interval — scales only the interval, leaves the 500 ms timeout unchanged, and sends the nack at the full timeout rather than at 80%.)

[[SVG:mem-lhm]]

**Two: dynamic suspicion timeouts.** A single suspicion may come from a degraded detector, so it begins with a long timeout. As *independent* nodes confirm the same suspicion, the timeout decreases — from Max toward Min on a log curve, reaching Min after K=3 confirmations. An unconfirmed suspicion waits; a suspicion with independent agreement resolves quickly.

**Three: the buddy system.** In SWIM as described so far, a suspected node learns of its suspicion only if gossip happens to reach it, and may spend its refutation window unaware. Lifeguard changes the piggyback priority so that a node probing a member it suspects includes the suspicion in the ping. The suspected node is notified directly and can refute immediately.

The widget below runs all three: degrade the "me" node with Lifeguard off and count the false accusations, then reset and repeat with it on:

[[WIDGET:mem-lifeguard]]

The paper's evaluation reports false-positive reductions in the 10–100× range (over 50× on average), with median detection latency roughly unchanged and tail latencies a few percent higher, because the dynamic timeout collapses quickly when several members agree. The three mechanisms are part of memberlist.

> Recap: LHM slows a degraded detector's probing, dynamic suspicion timeouts shorten only under independent confirmation, and the buddy system notifies a suspected node directly so it can refute.

## Meaning 2 · The agreed view sequence {#meaning-2}

Here the requirement hardens into the [second meaning](#what-is-membership): not a local guess but one ordered history of member lists that every correct node observes identically — which, unlike a liveness view, cannot be had without coordination.

## Rapid: one consistent view {#rapid}

The protocols since SWIM produce the first meaning: a soft, eventually-convergent liveness view, which suits routing and health checks. But some consumers — anything that derives a voter set, a shard map, or a primary — require the second meaning: every node observing the **same sequence of membership views**. These consumers also need the view to be stable under adverse conditions, since each view change they emit triggers failovers and data movement.

[Rapid](https://www.usenix.org/conference/atc18/presentation/suresh) (Suresh, Malkhi, Gopalan, Porto Carreiro & Lokhandwala, 2018) is a membership service for that requirement: strongly consistent views, at thousands of nodes, designed to avoid flapping even under "grey" failures — one-way links, heavy packet loss — that cause single-observer detectors to oscillate. It has three stages.

**Multiple observers, arranged as an expander.** Every process is monitored by **K** observers — its predecessors on K pseudo-random rings overlaid on the membership (the [evaluation uses K=10](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf)). This makes the monitoring graph an expander: well-connected, with no verdict resting on a single observer.

**Cut detection with watermarks** (the paper's term is **multi-process cut detection**). Observer alerts about a node are tallied rather than acted on directly. At or above the high watermark **H** (9 of 10), the node is **stable** and included in the proposed change. Below the low watermark **L** (3), the alerts are treated as **noise**. Between L and H, the node is **unstable** — enough observers have alerted to be notable, but not enough to cross H, which is the signature of a flapping or one-way link — and Rapid delays the proposal until every such node resolves. It then announces all stable changes as **one batched cut**, so ten simultaneous crashes become one view change rather than ten.

[[SVG:mem-rapid-watermarks]]

**Leaderless agreement on the cut.** Because nodes tally roughly the same alerts, almost every node independently computes the same proposal — the paper's *almost-everywhere agreement*. Rapid uses a Fast-Paxos-style vote on this: if **[more than three-quarters of the membership](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf)** report an identical cut, it is decided in one round with no leader. (Strictly more than three-quarters, rather than a simple majority, is required to skip the leader: two such quorums always overlap in more than half the membership, so they cannot decide two different cuts concurrently — a bare majority can overlap in a single node, which is not enough.) When proposals diverge, it falls back to classical Paxos — the fast-path/fallback structure again.

[[SVG:mem-rapid-quorum]]

The widget below shows the stages: failing three nodes tallies alerts against the watermarks into a single batched cut; a grey one-way fault holds a node in the unstable band where a gossip detector would flap; single-observer mode produces extra view changes:

[[WIDGET:mem-rapid-rings]]

Joins use the same pipeline — a joiner obtains **K temporary observers** through a seed member and enters through the same cut-detection-and-consensus path as removals (the temporary assignment lasts until a configuration change reflects the join). From the paper's evaluation: Rapid bootstraps 2,000-node clusters [2–2.32× faster than memberlist and 3.23–5.8× faster than a ZooKeeper-based scheme](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf), and [removes ten simultaneous crashes in one single-step consensus decision](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf). In its asymmetric-partition scenario, memberlist oscillates without removing all the faulty processes and ZooKeeper does not react to them, while Rapid detects and removes them; a related scenario applies [80% packet loss to 1% of processes](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf).

> Recap: Rapid uses many observers per node, a high/low watermark tally that batches changes and defers decisions about unstable nodes, and a leaderless three-quarters vote that gives every node the same view history.

## Meaning 3 · The quorum configuration {#meaning-3}

The strictest tier is the [third meaning](#what-is-membership): the exact set of replicas a write's majority is counted from. A wrong guess here is not a performance cost but a correctness one — orphaned or conflicting commits — so the set can never be a soft view. It has to be an agreed configuration, and *changing* it is itself a consensus decision.

## Changing the voter set safely: Raft reconfiguration {#raft-reconfig}

Consensus assumes a fixed set of voters ([What consensus does not provide](#membership-vs-consensus)). Real clusters are not fixed — machines are added, replaced, and retired — so the voter set has to change while the system keeps committing. The danger is precisely the [split brain](#membership-vs-consensus) from before, now opened by the *change itself* rather than by a failure detector.

**Why a naive switch is unsafe.** Suppose the voters go straight from an old set *C_old* to a new set *C_new*. There is a window in which some nodes still act on *C_old* while others already act on *C_new*. If a majority of *C_old* and a majority of *C_new* happen to be **disjoint**, each can make a decision — elect a leader, commit a write — with no shared member to catch the clash. That is two independent majorities in one cluster: split brain, caused by the reconfiguration itself.

[[WIDGET:mem-raft-reconfig]]

[Raft](https://raft.github.io/raft.pdf) gives two ways to close that window, both resting on the same [quorum-intersection](#membership-vs-consensus) property.

**Joint consensus.** The cluster does not jump from *C_old* to *C_new*; it first commits a **joint** configuration *C_old,new* in which every decision requires a majority of the old set **and** a majority of the new set. While the joint configuration is in force, no decision can be reached by an old-only or a new-only majority, so the two worlds cannot diverge. Once *C_old,new* is committed, the cluster moves on to *C_new*. Two overlapping phases, safe for an arbitrary change.

[[SVG:mem-raft-joint]]

**Single-server changes.** Raft's simpler option: add or remove exactly **one** voter at a time. A one-member difference is enough on its own — any majority of *C_old* and any majority of *C_new* must share a member, because two sets differing by a single element cannot have disjoint majorities. No joint phase is needed; a larger change is just taken one step at a time. This is the rule the [next section](#surrealdb) shows SurrealDS using.

**Even the simple rule is subtle.** The single-server scheme as first published turned out to have a safety bug, [found in 2015 by researchers formally verifying Raft's reconfiguration](https://groups.google.com/g/raft-dev/c/t4xj6dJTP6E/m/d2D9LrWRza8J): a newly elected leader could append a *further* configuration change before it had committed anything in its current term, which can destroy the guarantee that a single voter sits in both the quorum that committed an entry and the quorum that elects the next leader — the guarantee the safety proof rests on. Raft's author confirmed it and added one constraint: *a leader may not append a new configuration entry until it has committed an entry from its current term.* Joint consensus was never affected. The lesson matches the rest of this post — reconfiguration is where the delicate correctness bugs live, even when the rule looks obviously safe.

> Recap: changing the voter set can itself cause split brain if an old and a new majority go disjoint; Raft closes the window either with joint consensus (a decision needs both majorities) or with one-at-a-time changes (consecutive majorities always overlap) — and even the one-at-a-time rule needed a correctness fix.

## Membership in SurrealDS {#surrealdb}

**SurrealDS** is SurrealDB's distributed transactional store. SurrealDB uses it as a storage backend: each node runs a transaction coordinator alongside a local replica, and an interactive SQL transaction is driven by the coordinator against a set of SurrealDS replicas. It makes a good closing case because it is not a single protocol but a **system** — and it uses all three meanings of membership, at two layers.

**The compute layer: membership as rows in the store (meaning one, made agreed by meaning two).** SurrealDB's compute nodes do not gossip. Each upserts a heartbeat row into the shared transactional store every few seconds; any node may run a sweep that archives rows gone stale and later deletes them. There is no quorum math up here — because every change is one store transaction, the store *serializes* them, so the store's own transactions are the agreement box. Liveness stays soft (a missed heartbeat), but the record of who is a member is as consistent as any other row.

[[WIDGET:mem-heartbeat]]

**The store layer: the replica voter set (meaning three).** The store itself is replicated, and its replicas form the quorum that makes a write durable. That set is the safety-critical configuration from the [section above](#raft-reconfig): a write is durable once a majority of an agreed set of replicas has accepted it, so the store cannot let two nodes hold different ideas of that set. The member set is a **versioned view**, changed one step at a time — Raft's single-server rule — so consecutive views' quorums always overlap. The decision of *what* the set should be comes from outside the data plane: an external operator (on Kubernetes) reconciles a desired node count, and the store's only job is to install each change safely.

[[SVG:mem-surrealds-parts]]

What follows is that store-layer flow — first the roles, then how the set grows and shrinks, and the overlap principle that keeps every change safe.

### Voters and learners {#surreal-config}

SurrealDS replicas hold two roles. A **voter** is part of the store's quorum — the majority (⌊n/2⌋+1 of the voters) a write requires; an even voter count is run as the next odd size, so the quorum stays a real majority. A **learner** receives data and is catching up but does not vote; it is the staging state a joining node passes through.

The membership is a numbered configuration all nodes agree on. A change is committed through the store's own view-change path — the same path it uses to install a new leader — so a reconfiguration is agreed by a quorum before it takes effect. Learner-to-voter promotion is automatic, performed by the leader as each learner catches up.

[[SVG:mem-membership-kinds]]

### Adding voters {#surreal-add}

Growth is the easy direction, because nobody is ever dropped — no committed write can lose its holders. The only care needed is that a new voter has actually caught up before it counts.

- A node **joins as a learner**. It receives data and catches up but does not vote, so the voting set — and every quorum size — is unchanged. The store keeps its fault tolerance the whole time, and adding a node can never reduce it.
- Once the leader confirms the learner is caught up, it **promotes it to voter — one promotion per view.** The set grows 3 → 4 → 5 one at a time, so each new quorum overlaps the last, exactly as [quorum intersection](#membership-vs-consensus) required earlier: a single-voter step is safe when **q_old + q_new > |V_new|**, which holds at every step.

[[WIDGET:mem-reconfig]]

### What makes a shrink safe {#surreal-overlap}

Adding never risks data, because nobody is dropped. Removal is the direction that needs a rule, and it rests on one fact — the same [quorum-intersection](#membership-vs-consensus) property from before, now turned toward reconfiguration: **any two majorities of the same set share at least one member.** A write is committed once a *majority* of the voters have durably stored it, so if the voters you keep after a change are themselves a majority of the old set, they must overlap the majority that holds any committed write — at least one kept replica still has it, and nothing committed can vanish.

[[SVG:mem-two-majorities]]

You never get to know *which* majority holds a given write, so the rule has to hold for the worst case: the replicas you drop might be exactly the ones that held it.

### Removing voters {#surreal-remove}

That worst case gives the whole rule for a shrink:

> A shrink is safe only when the retained voters are still a majority of the old set — **retained ≥ ⌊n_old/2⌋+1**.

Take a five-voter store. Removing two keeps three, and three is still a majority of five — so any committed write, which lives on some majority of the old five, must have a holder among the three that remain. Drop one more, down to two, and the retained set is no longer a majority: the three replicas you dropped could have been exactly the ones holding a committed write, orphaning it, so that cut is refused. It is the addition rule run in reverse. The widget places a committed write **W** on a worst-case majority and lets you try each cut:

[[WIDGET:mem-shrink]]

## Recap {#recap}

The main points, one per item:

- **"Membership" refers to three things** — a soft liveness view, an agreed ordered history, and a safety-critical voter set — with different consistency requirements.
- **Slow and dead are indistinguishable** from within the system; FLP states this formally, and a timeout only selects which error to favor.
- **Safety is violated at a specific moment and cannot be repaired; liveness cannot be violated by any finite prefix** — so protocols preserve safety unconditionally and regain progress later.
- **Quorum intersection** is the mechanism under consensus, and it holds only over one agreed member set — which is why routing a soft view directly into quorum decisions causes split brain.
- **All-to-all heartbeats cost n²; gossip disseminates the same information at 3n**, reaching all nodes in about log n rounds.
- **SWIM separates detection from dissemination**: probe one peer per period (round-robin over a reshuffled list), use k indirect probes, and piggyback verdicts on existing packets.
- **Suspicion and incarnation numbers** give a suspected node a chance to refute, and only a node may increment its own incarnation.
- **memberlist runs three loops** — probe 1 s, gossip 200 ms, push/pull 30 s over TCP — and Serf adds events, leave intents, and Lamport-clocked ordering.
- **Lifeguard adds local health awareness**: a self-health multiplier that lengthens a degraded node's own timeouts, suspicion timeouts that shorten under independent confirmation, and direct notification of a suspected node.
- **Rapid produces one consistent view**: K observers per node, watermark tallies that batch changes and defer unstable nodes, and a leaderless three-quarters vote.
- **Changing the voter set is itself a consensus decision**: a naive switch can open two disjoint majorities, so Raft uses either joint consensus (a decision needs a majority of *both* the old and the new set) or one-at-a-time changes (consecutive majorities always overlap) — and reconfiguration is where the subtle safety bugs live.
- **SurrealDS shows all three meanings in one system**: SurrealDB's compute nodes track their membership as rows in the store (whose transactions are the agreement box), while the store's own replica set is a safety-critical voter configuration — grown and shrunk by Raft's single-server overlap rule, and decided by an external operator.

Across all of these, the recurring structure is a step, between soft detection and acted-upon configuration, that turns individual observations into an agreed decision.

SurrealDS keeps a simple membership flow today; as we build out our distributed transactional store, the harder questions these papers raise — consistent views at scale, safe reconfiguration, recovery after failure — are the ones we're working through. We'll write up what we learn as it takes shape. More to come.

## References {#references}

### The protocols

- [SWIM: Scalable Weakly-consistent Infection-style Process Group Membership Protocol](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf) — Das, Gupta, Motivala. DSN 2002. The split of detection from dissemination; probe/ping-req; suspicion and incarnation numbers (§4.2 has the override rules).
- [Lifeguard: Local Health Awareness for More Accurate Failure Detection](https://arxiv.org/abs/1707.00788) — Dadgar, Phillips, Currey, 2017. LHM, dynamic suspicion timeouts, the buddy system. An accompanying [write-up](https://www.hashicorp.com/en/blog/making-gossip-more-robust-with-lifeguard) describes the mechanisms informally.
- [Stable and Consistent Membership at Scale with Rapid](https://www.usenix.org/conference/atc18/presentation/suresh) — Suresh, Malkhi, Gopalan, Porto Carreiro, Lokhandwala. USENIX ATC 2018. K-ring observers, watermark cut detection, leaderless ¾ fast path.
- [Epidemic Algorithms for Replicated Database Maintenance](https://dl.acm.org/doi/10.1145/41840.41841) — Demers et al. PODC 1987. Anti-entropy and rumor mongering; where gossip begins.
- [A Gossip-Style Failure Detection Service](https://www.cs.cornell.edu/home/rvr/papers/GossipFD.pdf) — van Renesse, Minsky, Hayden. 1998. Heartbeat counters over gossip.
- [The φ Accrual Failure Detector](https://doi.org/10.1109/RELDIS.2004.1353004) — Hayashibara, Défago, Yared, Katayama. SRDS 2004. Suspicion as a level, not a boolean.
- [Fireflies: Scalable Support for Intrusion-Tolerant Network Overlays](https://www.cs.cornell.edu/home/rvr/papers/Fireflies.pdf) — Johansen, Allavena, van Renesse. EuroSys 2006. Membership when members can lie.
- [Census: Location-Aware Membership Management for Large-Scale Distributed Systems](https://www.usenix.org/conference/usenix-09/census-location-aware-membership-management-large-scale-distributed-systems) — Cowling, Ports, Liskov, Popa, Gaikwad. USENIX ATC 2009. Consistent, epoch-based views at scale.
- [In Search of an Understandable Consensus Algorithm (Raft)](https://raft.github.io/raft.pdf) — Ongaro & Ousterhout. USENIX ATC 2014. §6 (and dissertation §4) cover cluster membership changes: joint consensus and single-server changes. The single-server scheme's [safety fix](https://groups.google.com/g/raft-dev/c/t4xj6dJTP6E/m/d2D9LrWRza8J) followed in 2015.
- [Matchmaker Paxos: A Reconfigurable Consensus Protocol](https://www.jsys.org/bibliography/2021-09-3-whittakerSolution.html) — Whittaker et al. JSys 2021. The reconfiguration corner of the map.

### The code

- [hashicorp/memberlist](https://github.com/hashicorp/memberlist) — the library; [config.go](https://github.com/hashicorp/memberlist/blob/master/config.go) holds every default quoted in this post (probe 1 s / 500 ms, gossip 200 ms × 3, push/pull 30 s, SuspicionMult 4).
- [Serf: gossip internals](https://github.com/hashicorp/serf/blob/master/docs/internals/gossip.html.markdown) — the agent layer: events, intents, Lamport clocks.
- [surrealdb/surrealdb](https://github.com/surrealdb/surrealdb) — the open-source SurrealDB database engine.

### The theory

- [Impossibility of Distributed Consensus with One Faulty Process](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf) — Fischer, Lynch, Paterson. JACM 1985. FLP: slow-or-dead, as a theorem.
- [Defining Liveness](https://www.cs.cornell.edu/fbs/publications/DefLiveness.pdf) — Alpern, Schneider. IPL 1985. Every property = safety ∩ liveness.
- [Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services](https://www.comp.nus.edu.sg/~gilbert/pubs/BrewersConjecture-SigAct.pdf) — Gilbert, Lynch. 2002. CAP, formalized.
- [Unreliable Failure Detectors for Reliable Distributed Systems](https://dl.acm.org/doi/10.1145/226643.226647) — Chandra, Toueg. JACM 1996. The theory of detectors that are allowed to be wrong.
- [On the Impossibility of Group Membership](https://dl.acm.org/doi/10.1145/248052.248120) — Chandra, Hadzilacos, Toueg, Charron-Bost. PODC 1996. Why consistent views can't be free.

### Approachable companions

- [brianstorti.com/swim](https://www.brianstorti.com/swim/) — a friendly prose walkthrough of SWIM.
- [CASSANDRA-9667](https://issues.apache.org/jira/browse/CASSANDRA-9667) — "strongly consistent membership and ownership": a proposal to make Cassandra's membership and ownership linearizable, motivated by uncoordinated gossip-based joins selecting overlapping token ranges.
- [baseds](https://medium.com/baseds) — Vaidehi Joshi's series on distributed systems basics, the pedagogical north star for this post.
