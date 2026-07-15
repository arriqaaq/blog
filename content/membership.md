---
title: Who else is here? Cluster membership from first principles
dek: Heartbeats, gossip, SWIM, Serf, Lifeguard, and Rapid — how a cluster learns who is in it, and the separate problem of changing the voter set.
eyebrow: Distributed Systems
slug: membership
date: 2026-07-14
ogImage: mem-timeline
byline: A walkthrough of cluster membership — the underlying theory and the protocols (SWIM, Serf, Lifeguard, Rapid) — plus reconfiguration, the separate problem of changing the voter set — with each mechanism running live on the page.
---

Consider a cluster of three servers. One of them stops answering.

It may have crashed, it may be rebooting, or it may be healthy behind a slow or broken network link. A second question follows: *which node decides?* One node may consider the server dead while another can still reach it, and the two cannot both be right. Whatever the system does next — route around the node, promote a replacement, rebalance its data — depends on which answer it acts on.

Every distributed system — databases, message queues, orchestrators — needs a continuously updated answer to one question: **who else is here right now?** That answer is **cluster membership**.

The term covers several related problems. A system may keep a local estimate of which peers appear reachable. It may also maintain an ordered sequence of membership views that participating nodes install in the same order. Separately, a replicated protocol must define the exact set of voters used to form a quorum, and it must change that set through a reconfiguration procedure.

[[SVG:mem-timeline]]

This study forms part of our exploration of membership in SurrealDS. The protocols covered here help us evaluate how detection, dissemination, and coordinated membership views may evolve as the system grows.


## Telling slow from dead {#slow-or-dead}

The difficulty is that **in a distributed system, a slow node and a dead node are indistinguishable from the outside.** A node sends a message and no reply arrives. The remote machine may have crashed, the request may be queued, or the reply may still be in transit. All three cases present identically: silence.

In the widget below, an adversary has decided in advance whether the silent node is slow or dead; the only available actions are to wait longer or to declare it dead:

[[WIDGET:mem-slow-or-dead]]

The trade-off is symmetric. Declaring a node dead early risks removing a healthy-but-slow node; waiting longer delays detection of genuine failures. Running the timeout automatically shows that **no timeout value avoids both errors** — it only sets which error is more likely, and how often it occurs.

A timeout only chooses which mistake to make; no scheme avoids both mistakes. The next section covers the theory of why.

## Why no timeout can fix it {#fundamental}

The timeout dilemma cannot be engineered away. Three results from distributed-systems theory explain why, and they shape every protocol in the rest of this post.

### Safety and liveness {#safety-liveness}

Describing the timeout's two errors precisely requires two terms that underpin every correctness argument in distributed systems.

A **safety** property states that *nothing bad ever happens*. If it is violated, the violation occurs at a specific moment and cannot be undone by anything that follows. "There are never two leaders at once" is a safety property: once two leaders exist, the execution is permanently incorrect.

A **liveness** property states that *something good eventually happens*. The mirror image holds: no finite prefix of an execution can violate it, because the good thing may still occur later. "Every request eventually receives a reply" is a liveness property — a request that has waited ten minutes has not violated it, and cannot at any finite time.

The distinction is easiest to see on a timeline:

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

## What membership means {#what-is-membership}

So a system lives with two kinds of answer: soft ones it can afford to be wrong about, and agreed ones it pays coordination for. Those are the **two things "membership" actually means**, and they carry different consistency needs.

[[SVG:mem-words]]

The first is a **liveness view**: *a local estimate of which nodes seem to be up.* This is soft, fast-changing information — what the theory literature calls a [failure detector](https://dl.acm.org/doi/10.1145/226643.226647), the pings and timeouts that estimate which machines are reachable. No node's estimate is authoritative, and two can disagree without harm, provided it is only used for soft decisions such as which replica to route a read to, or which peer to gossip with next. (At scale a node may not even track the whole cluster — [peer-sampling services](https://people.maths.bris.ac.uk/~maajg/ieeetocs03-scamp.pdf) deliberately keep only a small random *partial* view.)

The second is an **agreed view sequence**: an ordered sequence of member lists such as v1, v2, and v3. Correct participants install these views in the same order according to the membership protocol's guarantees. This is the group-membership or [virtual-synchrony](https://www.cs.cornell.edu/ken/History.pdf) use of the term. Producing that sequence requires coordination because a view may drive actions such as assigning shards, selecting a primary, or starting recovery.

The [group-communication literature](https://dl.acm.org/doi/10.1145/503112.503113) defines several forms of membership service and view semantics. The exact guarantees vary by protocol. A partitioned or excluded process may hold an older view, while the participating processes continue with a later one. The [group-membership impossibility result](https://dl.acm.org/doi/10.1145/248052.248120) explains why a service cannot provide every desirable accuracy and consistency property in an asynchronous environment without additional assumptions.

A third, closely related object is the **voter configuration**: the replicas whose votes count toward a quorum in a consensus or replication protocol. This article calls it a configuration to distinguish it from a failure detector's liveness view.

The configuration cannot be derived independently at each node from recent timeout observations. If nodes use different voter sets, they may each form a quorum under their own configuration. Those quorums are not guaranteed to intersect. A protocol therefore records configuration changes through an agreed mechanism.

Terminology is not uniform. Papers and implementations use words such as *membership*, *view*, *epoch*, and *configuration* in overlapping ways. In this article:

- **liveness view** means a local, revisable reachability estimate;
- **agreed view** means an ordered membership record installed through coordination;
- **configuration** means the voter set used for quorum decisions;
- **reconfiguration** means the procedure that changes that voter set.


The widget below shows a local liveness view and an agreed view sequence for the same cluster. The local estimates can change at different times. The agreed sequence advances only through its coordination step:

[[WIDGET:mem-two-views]]

> Recap: a liveness view is local and revisable. An agreed membership view is ordered through a protocol. A voter configuration defines quorum participants and changes through reconfiguration. Similar names do not make these objects interchangeable.

## Membership vs consensus {#membership-vs-consensus}

A natural question, given Raft and Paxos: does **consensus** already solve this — is "who is in the cluster" simply another value to agree on? The two are closely related, and this is where membership and the voter set are most easily confused.

**What consensus provides.** A consensus protocol makes a fixed set of processes agree on a value — the same value everywhere, with no reversal. Composing decisions into a sequence yields **state machine replication (SMR)**: one agreed log of commands that every replica applies in the same order, so a group of machines behaves as one fault-tolerant machine.

**How it tolerates crashes.** Not by waiting for all nodes, which stalls on the first crash, but by counting a decision as final once a **quorum** — usually a majority — accepts it. The underlying property is quorum intersection: any two majorities of the *same* set share at least one member, so a value accepted by one quorum is visible to every later quorum through that shared member. Repeated draws of two majorities always intersect:

[[WIDGET:mem-quorum-overlap]]

Switching the widget to two configurations shows the limit of this property. **Intersection holds only for majorities of one agreed set.** A majority of {A,B,C,D,E} and a majority of {D,E,F,G,H} need not share any member.

**What consensus does not provide.** Consensus *assumes* the member set — its specification is "make *these n processes* agree". Determining the n processes, detecting when one fails, and changing the set safely are separate problems. Consensus also does not detect failures on its own; without an external signal of which nodes are up, it remains safe but can stall indefinitely (again, FLP). Membership supplies that missing piece.

Membership and consensus therefore depend on each other, and the risk lies at the boundary between them. A failure detector's error — suspecting a live node — costs at most a spurious leader election, a performance cost. A voter-set error has a different consequence:

[[WIDGET:mem-detector-cost]]

The full failure mode: two clients hold different beliefs about the member set and each assembles a valid majority of a *different* set. The two quorums share no voter, and two conflicting writes both commit. This is **split brain**. Real databases hit the same class of problem: Cassandra's [CASSANDRA-9667](https://issues.apache.org/jira/browse/CASSANDRA-9667) documents how gossip-propagated joins could pick overlapping token ranges, and proposes making membership and ownership strongly consistent to fix it:

[[WIDGET:mem-split-brain]]

The remedy: between the soft, changing detection signal and the safety-critical voter set, add a step that produces *agreement* — a single ordered record of the member set. Systems place that step differently: an external store such as [ZooKeeper](https://zookeeper.apache.org/) or [etcd](https://etcd.io/); the consensus protocol's own reconfiguration machinery; or a membership layer that runs its own consensus, as Rapid does (covered later):

[[SVG:mem-stack]]

Removing that step allows the voter set to diverge, at which point quorum intersection no longer holds:

[[WIDGET:mem-agreement-box]]

> Recap: consensus assumes a member set and membership supplies it. A detector may be wrong at low cost; a voter set must not be, so an agreement step has to sit between the two.

## Meaning 1 · The liveness view {#meaning-1}

The protocols in this part produce local estimates of which nodes appear reachable. Their outputs may differ temporarily across nodes, and later observations may revise an earlier suspicion.

**The baseline: all-to-all heartbeats.** In a direct heartbeat design, every node sends a probe to every other node during each round. With *n* nodes, that produces *n(n−1)* directed probes per round, before counting acknowledgements or retries. The design is simple, but the number of pairwise exchanges grows quadratically.

The widget below compares this pattern with fixed-fanout gossip:

[[WIDGET:mem-heartbeat-storm]]

**Gossip: dissemination at linear cost.** [Epidemics](https://dl.acm.org/doi/10.1145/41840.41841) (Demers et al., 1987) models replicated-database synchronization on the mathematics of epidemics, casting each node as *susceptible*, *infective*, or *removed*. **Anti-entropy** — periodically select a random peer and reconcile full state — is slow but thorough; **rumor mongering** — push new information to random peers until it stops being novel — is fast but can occasionally miss a node. Each push round shrinks the still-uninformed fraction by roughly a factor of 1/e, so an update reaches all n nodes in about log(n) rounds at close to linear message cost — the analysis the diagram below sketches, and the basis for every gossip system since.

[[SVG:mem-gossip-fanout]]

**Gossip as the detector.** [Gossip-style failure detection](https://www.cs.cornell.edu/home/rvr/papers/GossipFD.pdf) (van Renesse et al., 1998) turns the same mechanism on liveness itself: each node keeps a heartbeat counter per member, increments its own, and gossips the table; a counter that stops advancing marks a suspect. It scales, but each node still gossips a full member table, and detection time is coupled to gossip time. The next protocol decouples them.


## SWIM, memberlist, and Serf {#serf}

[Serf](https://github.com/hashicorp/serf/blob/master/docs/internals/gossip.html.markdown) is a cluster membership agent built by HashiCorp, used by [Consul](https://www.consul.io/) to maintain its member list. It builds on [memberlist](https://github.com/hashicorp/memberlist), a Go library whose membership mechanisms are based in part on the [SWIM paper](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf). The layers can be read from the protocol upward:

[[SVG:mem-serf-stack]]

[SWIM](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf) separates two activities:

- **failure detection**, which actively probes selected peers;
- **membership dissemination**, which carries recent updates between nodes.

Each node initiates a constant number of direct and indirect probes in a protocol period, independent of the cluster size. Dissemination can piggyback on those messages. The size of the membership state and the amount of update traffic can still grow with the cluster, so the constant bound applies to the active probe pattern rather than to every byte processed by a node.

### The probe {#swim-probe}

During each **protocol period**, a SWIM node selects a target and sends a **ping**. If an acknowledgement arrives before the probe timeout, that probe completes successfully.

The default memberlist configuration referenced by this article uses a one-second probe interval and a 500-millisecond probe timeout. These are configurable implementation values, not fixed requirements of the SWIM protocol.

If the direct probe times out, the initiator asks **k** other members to probe the same target by sending **ping-req** messages. The SWIM paper leaves *k* configurable ([SWIM §3.1](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf)); the referenced memberlist default sets the indirect-check count to 3.

An acknowledgement returned through any helper shows that at least one alternate path can reach the target. This reduces the influence of a failed or delayed path between the original initiator and target. It does not establish that the target is reachable from every member.

SWIM schedules probes by traversing a shuffled member list rather than repeatedly sampling targets with replacement. After a pass, it reshuffles the list. This keeps the number of protocol periods between probes of a member bounded by the size of the list ([SWIM §4.3](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf)), subject to membership changes and scheduling delays.

[[WIDGET:mem-swim]]

Membership updates travel with protocol traffic through **piggybacking**. Nodes can therefore hold different local lists while updates are still being disseminated. The lists are weakly consistent: there is no single read of the liveness view that is simultaneously authoritative for every node.

A failed probe starts a suspicion process. It does not immediately produce a final failure update.

### Suspicion and incarnation numbers {#incarnation}

A delayed process can miss one or more probe deadlines without having stopped. SWIM therefore marks the target **suspect** and starts a timer. The suspicion is disseminated to other members. If the target refutes the suspicion before the timer expires, nodes can return it to the alive state. If the timer expires without a valid refutation, the protocol emits a confirmed-failure update.

[[SVG:mem-swim-lifecycle]]

The updates need an ordering rule. A node may receive an Alive update and a Suspect update for the same member in either order, and message arrival time does not identify which state is newer.

SWIM associates each member with an **incarnation number**. A member can increase its own incarnation number when it learns that an earlier incarnation has been suspected. It then disseminates an Alive update carrying the higher number.

The SWIM ordering rules ([SWIM §4.2](https://www.cs.cornell.edu/projects/Quicksilver/public_pdfs/SWIM.pdf)) are:

- a higher incarnation number supersedes a lower one;
- for the same incarnation, Suspect supersedes Alive;
- a confirmed-failure update is terminal for that membership instance.

The equal-incarnation rule prevents an old Alive message from canceling a later suspicion. A process that returns after its membership instance has been confirmed failed must be represented in a way that distinguishes the new instance from the confirmed one.

[[WIDGET:mem-incarnation]]

### What memberlist adds {#memberlist}

memberlist combines several periodic activities around the SWIM probe mechanism. The values below are the configurable defaults in the linked implementation at the version used for this article.

**Probe loop.** A node probes one selected member at each probe interval. Direct and indirect checks produce Alive, Suspect, and failure updates.

**Gossip loop.** At the default 200-millisecond interval, a node sends queued updates over UDP to a configurable number of random peers; the referenced default fanout is 3. This loop allows updates to travel more frequently than the one-second probe interval.

**Push/pull loop.** At the default 30-second interval, a node opens a TCP connection to a selected peer and exchanges a broader membership snapshot. This acts as an anti-entropy mechanism for updates that did not reach a node through UDP gossip. Joining nodes also use push/pull exchanges to obtain membership state.

The suspicion timeout depends on the cluster size and configuration values. With the referenced defaults, memberlist sets the floor to `SuspicionMult (4) × log₁₀(N) × probe interval` — a base-10 logarithm floored at one, about 4 seconds in a small cluster. A first suspicion does not start at that floor: it opens `SuspicionMaxTimeoutMult (6)×` higher and collapses toward the floor as independent confirmations arrive, through the Lifeguard-derived mechanism described next.

[[WIDGET:mem-serf-machine]]

The exact intervals and multipliers are operational settings. Changing them alters detection latency, network traffic, and tolerance for delayed processing.

### What Serf adds {#serf-layer}

memberlist maintains membership state. **Serf** exposes changes in that state through an event interface.

Its member events include joins, leaves, failures, updates, and eventual reaping of old records. A process that shuts down normally can broadcast a leave intent, allowing peers to distinguish that event from a timeout-based failure indication.

Serf also attaches Lamport timestamps to intents and user events. These logical timestamps provide an ordering relation for events that may arrive through gossip in different network orders. They do not provide a physical clock or make every membership observation simultaneous.

> Recap: SWIM initiates direct and indirect probes and disseminates ordered membership updates. memberlist adds configurable gossip and push/pull loops around that mechanism. Serf exposes the resulting state changes as events and represents graceful leave separately from timeout-based failure.

## Lifeguard: local health awareness {#lifeguard}

A SWIM observer can produce false suspicions when the observer itself is delayed. A process under CPU pressure, a runtime pause, or network loss may send probes late, process acknowledgements after its local deadline, or fail to service indirect-probe traffic promptly.

The widget below compares repeated state changes under two detector configurations:

[[WIDGET:mem-flap]]

The [Lifeguard paper](https://arxiv.org/abs/1707.00788) describes three extensions that make a SWIM-style detector account for local health.

**1. Local Health Multiplier.** The paper defines a bounded local-health score, LHM, a saturating counter from 0 to 8. Three events increase it by one: a failed probe; a probe with a missing negative acknowledgement (a ping-req helper that cannot reach the target sends an explicit nack, so the absence of any nack points at the initiator's own path); and having to refute a suspicion about oneself. A successful probe decreases it by one. In the paper's LHA-Probe mechanism, the score multiplies both the probe interval and the timeout by (LHM + 1), so a locally delayed observer waits longer before classifying another member as unresponsive — at LHM 8, probes go out every 9 seconds with a 4.5-second timeout.

The memberlist implementation uses the same idea with implementation-specific details. It caps the multiplier at ×8 (an 8-second maximum probe interval), scales only the interval and leaves the 500-millisecond timeout unchanged, and sends the nack at the full timeout rather than at 80% of it. The timeout and negative-acknowledgement timing should be read from the linked version rather than inferred from the paper's pseudocode, because they are not identical.

[[SVG:mem-lhm]]

**2. Dynamic suspicion timeouts.** A suspicion begins with a longer deadline. Confirmations from distinct observers reduce that deadline toward a configured minimum on a log curve, reaching the minimum after three independent confirmations. One observer therefore waits longer before producing a confirmed-failure update, while several observers reporting the same condition can complete the suspicion sooner.

**3. Buddy notification.** When a node probes a member that it currently suspects, it gives the suspicion update high piggyback priority. The target can then learn about the suspicion directly and issue a refutation without waiting for an unrelated gossip exchange.

[[WIDGET:mem-lifeguard]]

In the paper's evaluated workloads, these mechanisms reduced false positives by roughly 10–100× (over 50× on average) relative to the evaluated SWIM baseline, with median detection latency roughly unchanged and tail latencies a few percent higher. Those measurements apply to the paper's configurations and fault models; they are not a general bound for every deployment.

memberlist implements variants of the local-awareness, dynamic-suspicion, and buddy-notification ideas. Its exact behavior is determined by the implementation version and configuration values.

> Recap: Lifeguard adds information about the observer's own condition, shortens suspicion deadlines when independent reports accumulate, and gives suspected nodes a more direct opportunity to refute the suspicion.

## φ-accrual: suspicion as a level {#phi-accrual}

The detectors described so far eventually map observations to states such as Alive, Suspect, and Failed. An **accrual failure detector** instead reports a level of suspicion and leaves the final threshold to the consumer.

The [φ-accrual detector](https://doi.org/10.1109/RELDIS.2004.1353004) keeps a sliding window of recent heartbeat inter-arrival times and fits a normal distribution to that history. It reports:

**φ = −log₁₀(P_later)**

Here, `P_later` is the model's estimated probability of observing an inter-arrival time at least as large as the current delay. Under that fitted model, φ = 1 corresponds to a tail probability of 0.1, φ = 2 to 0.01, and φ = 3 to 0.001.

These values are model outputs, not guaranteed real-world false-positive rates. Their calibration depends on the arrival-time distribution, the sample window, and how well current network and process behavior resembles the recorded history.

A consumer chooses a threshold according to how it uses the result. A routing layer may tolerate a lower threshold than a component that triggers an expensive failover. [Cassandra](https://github.com/apache/cassandra/blob/trunk/src/java/org/apache/cassandra/gms/FailureDetector.java) and [Akka](https://doc.akka.io/libraries/akka-core/current/typed/failure-detector.html) include φ-accrual-style failure detectors in their implementations.

[[SVG:mem-phi-accrual]]

The output remains a local estimate. Different observers can report different φ values for the same process.

## Meaning 2 · The agreed view sequence {#meaning-2}

Some operations require more than local reachability estimates. A shard assignment, primary selection, or recovery plan may need an ordered membership record so that participating nodes do not act on unrelated versions of the member list.

An **agreed view sequence** provides that record. The protocol defines which nodes participate, how a view is proposed, when it is installed, and what an excluded or partitioned node may observe.

There are several architectural placements for this coordination. An application can store membership records in a strongly consistent service such as [ZooKeeper](https://zookeeper.apache.org/) or [etcd](https://etcd.io/) and watch for changes. A membership protocol can organize changes into epochs, as [Census](https://www.usenix.org/conference/usenix-09/census-location-aware-membership-management-large-scale-distributed-systems) does. Another approach is to combine failure reports with an agreement protocol, as Rapid does.

## Rapid: one consistent view {#rapid}

[Rapid](https://www.usenix.org/conference/atc18/presentation/suresh) is a membership protocol designed to produce a consistent sequence of views at large cluster sizes. Its design combines multiple observers, cut detection, and agreement on a proposed membership change.

**Multiple observers.** Rapid overlays several pseudo-random rings on the current membership. A process is monitored by its predecessors on those rings. The [paper's evaluation](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf) commonly uses **K = 10**, so each process has ten observers in that configuration.

The purpose is to avoid making a membership proposal from one observer's report alone. The ring construction distributes observer relationships across the membership.

**Cut detection with watermarks.** Observers send alerts about processes they cannot reach. Rapid counts those alerts and places each process relative to a low and high watermark.

In the example parameters used by the paper:

- fewer than **L = 3** alerts are below the low watermark;
- **H = 9** or more alerts reach the high watermark;
- counts between L and H are in an unstable region.

A process at or above the high watermark can be included in a proposed cut. A process in the unstable region delays proposal formation until its alert count moves out of that region. The protocol can include several stable joins or removals in one proposed cut.

[[SVG:mem-rapid-watermarks]]

**Agreement on the cut.** Nodes receive overlapping sets of alerts and often compute the same proposed cut. Rapid uses a Fast-Paxos-style path when [more than three-quarters of the membership](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf) report the same proposal. The quorum size and voting rules are part of Rapid's safety argument for that path.

When proposals do not receive the required fast-path support, the protocol uses its fallback agreement path rather than installing competing cuts independently.

[[SVG:mem-rapid-quorum]]

The widget below shows the three stages: observers report changes, watermark logic forms a cut, and the agreement step installs a new view. It also shows how a process can remain in the unstable band while reports disagree:

[[WIDGET:mem-rapid-rings]]

Joins use the same broad pipeline. A joining process first obtains temporary observers through an existing member, then enters a later view through cut detection and agreement.

The Rapid paper reports several measurements for its test configurations. In its 2,000-node bootstrap experiment, Rapid completed bootstrap [2–2.32× faster than the memberlist-based scheme and 3.23–5.8× faster than a ZooKeeper-based scheme](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf), and [removes ten simultaneous crashes in a single-step consensus decision](https://www.usenix.org/system/files/conference/atc18/atc18-suresh.pdf). Other experiments apply asymmetric communication and packet loss — one scenario applies 80% packet loss to 1% of processes; in the asymmetric-partition case, memberlist oscillates without removing all faulty processes and ZooKeeper does not react, while Rapid detects and removes them. These are results from the paper's implementation, cluster setup, and workloads rather than general performance guarantees.

> Recap: Rapid collects reports from several observers, waits for alert counts to leave the unstable region, groups stable changes into a cut, and installs that cut through an agreement protocol.

## The voter set: a separate problem — reconfiguration {#voter-set}

The **voter configuration** is the set of replicas whose responses count toward quorum decisions. Consensus and replication papers use several names for this object, including membership, configuration, acceptor set, and replica set. This article uses **configuration** because the object is different from a local failure-detector view.

A process does not stop being a voter merely because another process has timed out while contacting it. Removing or adding a voter changes the quorums that can decide future values. The protocol therefore has to order that change relative to earlier and later decisions.

The procedure that changes the voter set is **reconfiguration**. Its design must specify:

- how the old configuration authorizes a transition;
- when the new configuration begins to govern decisions;
- how state is transferred to new replicas;
- which quorums must be contacted during the transition;
- how concurrent leaders or delayed messages are handled.

## Changing the voter set: reconfiguration {#raft-reconfig}

Suppose a system changes from an old configuration *C_old* to a new configuration *C_new*. A direct local switch is not enough. Some processes may receive the change earlier than others, and delayed operations may still be using the old configuration.

If an old-config quorum and a new-config quorum can be disjoint, each quorum can contain no process that observed the other's decision. A reconfiguration protocol prevents the two configurations from acting as unrelated consensus groups during the transition.

[[WIDGET:mem-raft-reconfig]]

[Raft](https://raft.github.io/raft.pdf) describes two approaches.

**Joint consensus.** The protocol first enters a joint configuration, commonly written *C_old,new*. During that phase, an operation must satisfy the quorum requirements of both the old and new configurations. After the joint configuration is committed, the protocol can commit the new-only configuration.

The joint phase orders the transition through the replicated log and prevents an old-only quorum or a new-only quorum from completing the transition by itself.

[[SVG:mem-raft-joint]]

**Single-server changes.** Raft also describes changing one voter at a time. Consecutive configurations that differ by one member have intersecting majorities. A larger requested change is represented as a sequence of one-member transitions.

This rule is only one part of the protocol. Leader election, log commitment, configuration-entry ordering, and restrictions on proposing another change still matter. A [correction discussed on the Raft development list](https://groups.google.com/g/raft-dev/c/t4xj6dJTP6E/m/d2D9LrWRza8J) added a condition that a newly elected leader must commit an entry from its current term before appending a further configuration change. Joint consensus uses a different transition rule and was not changed by that correction.

**Where configuration history is stored.** Raft places configuration entries in the replicated log. Viewstamped Replication also orders reconfiguration through replicated protocol state, using its view and epoch machinery.

Other protocols move configuration authority elsewhere. [Matchmaker Paxos](https://mwhittaker.github.io/publications/matchmaker_paxos.pdf), building on [Vertical Paxos](https://lamport.azurewebsites.net/pubs/vertical-paxos.pdf), uses a set of matchmakers that records which acceptor configuration belongs to each round.

For a new round, a proposer registers the new configuration with a matchmaker quorum and learns the prior configurations that may contain a chosen value. It then performs the recovery work required by those configurations before using the new one. This removes configuration processing from the normal acceptor path, while adding work when a new configuration is introduced.

[[SVG:mem-matchmaker]]

Raft and Matchmaker Paxos therefore place configuration history in different components. Both protocols define how a proposer learns which earlier quorums may contain decisions and how the next configuration is authorized.

> Recap: reconfiguration is an ordered protocol transition, not a timeout response. Joint consensus requires old and new quorums during an intermediate phase. One-at-a-time changes use overlap between consecutive configurations together with the rest of the consensus protocol. Matchmaker Paxos records configuration history in a separate matchmaker service.

## How membership works in SurrealDS {#surrealdb}

**SurrealDS** is SurrealDB's distributed transactional store. Each SurrealDB node runs a transaction coordinator and a local SurrealDS replica. A coordinator executes a transaction against replicas named by the current store configuration.

> Note: The earlier protocols describe different points in the membership design space. We are studying these approaches as part of the continued development of SurrealDS, particularly how their ideas apply as clusters grow and encounter a broader range of network and failure conditions.

The design described here separates three concerns:

- signals that indicate a process or connection is not making progress;
- a numbered view that records replica roles;
- a configuration change that adds or removes voters.

A failure signal can start recovery work. It does not, by itself, rewrite the voter configuration.

### Failure detection

SurrealDS uses several signals when a node, coordinator, or connection stops making progress.

A progress timer can initiate leadership transfer when the current leader is not advancing. If the coordinator handling a transaction becomes unavailable, the transaction protocol can use a backup-coordinator path when the replicated transaction state permits continuation. Network keep-alives identify connections that have stopped responding.

These mechanisms answer different operational questions. A leadership timer concerns the current leader. Coordinator recovery concerns ownership of an in-progress transaction. A keep-alive concerns one network connection.

None of these observations directly removes a replica from the configuration. A replica remains assigned its current role until the view-change path installs another configuration.

A failure signal can still affect when a proposed transition is attempted or completed. For example, the system may wait for a retained replica or learner to reach the state required by the transition.

### Voters and learners {#surreal-config}

A SurrealDS configuration assigns each replica one of two roles.

A **voter** participates in quorum decisions. For a configuration with *n* voters, a majority contains `floor(n/2) + 1` voters.

A **learner** receives replicated state but is not counted in the voting quorum. The learner role provides a staging period for a joining replica before it participates in decisions.

Configurations belong to numbered views. A role change becomes active when the corresponding view is installed through the view-change path.

On Kubernetes, an external operator reconciles the requested node count. It can introduce a node as a learner or request removal of existing voters. Learner promotion is handled after the learner has reached the required replicated state.

[[SVG:mem-membership-kinds]]

### Adding voters {#surreal-add}

SurrealDS adds a new replica in two stages.

1. **Join as a learner.** The replica is added without a vote and starts receiving state.
2. **Promote through a later view.** After the leader determines that the learner meets the catch-up requirement, it proposes a view in which that learner is a voter.

The design promotes one learner in each view change. A sequence such as three voters to five voters is represented as `3 → 4 → 5`, not as one direct promotion of two learners.

For one added voter, the old configuration is a subset of the new configuration. A majority of the old set and a majority of the new set intersect. This is the relevant set-overlap property for that step. The implementation still applies its catch-up, proposal, view-installation, and consensus checks before the new role takes effect.

[[WIDGET:mem-reconfig]]

### The retained-set check {#surreal-overlap}

Removing voters requires the transition to account for values that may have been stored by an old-config quorum.

SurrealDS applies a retained-set condition. For an old configuration with `n_old` voters, the retained set must contain at least:

`floor(n_old / 2) + 1`

voters.

This condition means that the retained set is itself a majority of the old configuration. Any majority of one configuration intersects every other majority of that same configuration. The retained set therefore has at least one member in common with any old majority.

[[SVG:mem-two-majorities]]

This establishes a quorum-overlap property for the old and retained sets. It is one condition used by the transition; the complete behavior also depends on the view-change and replication protocol that installs the new configuration.

### Removing voters {#surreal-remove}

A proposed shrink passes the retained-set check only when:

> **retained voters ≥ floor(n_old / 2) + 1**

For an old configuration of five voters, retaining three meets the condition because three is a majority of five. Retaining two does not meet it.

The check is based on the old configuration, not only on the quorum size of the proposed new configuration. The replicas being removed could include members of an old quorum that stored a previous value. Requiring the retained set to be an old-config majority provides the intersection described above.

The widget places a value on one possible old majority and shows which proposed retained sets meet the condition:

[[WIDGET:mem-shrink]]

The additions and removals are deliberately asymmetric in this design. Learners are promoted one at a time after catch-up. A removal request may name several voters, but the resulting retained set must pass the old-configuration majority check before the new view is installed.

We will share more details as we scale SurrealDS on how these algorithms perform. Thank you for the read.

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
- [In Search of an Understandable Consensus Algorithm (Raft)](https://raft.github.io/raft.pdf) — Ongaro & Ousterhout. USENIX ATC 2014. §6 — titled "Cluster membership changes," though its body names the object a *configuration* — covers joint consensus and single-server changes; [the dissertation's](https://web.stanford.edu/~ouster/cgi-bin/papers/OngaroPhD.pdf) ch. 4 repeats the split ("Arbitrary configuration changes using joint consensus"). The single-server scheme's [safety fix](https://groups.google.com/g/raft-dev/c/t4xj6dJTP6E/m/d2D9LrWRza8J) followed in 2015.
- [Matchmaker Paxos: A Reconfigurable Consensus Protocol](https://www.jsys.org/bibliography/2021-09-3-whittakerSolution.html) — Whittaker et al. JSys 2021 ([PDF](https://mwhittaker.github.io/publications/matchmaker_paxos.pdf)). Config authority in a set of matchmakers, off the steady-state path; a reconfiguration in one round trip.
- [Reconfiguring a State Machine](https://lamport.azurewebsites.net/pubs/reconfiguration-tutorial.pdf) — Lamport, Malkhi, Zhou. SIGACT News 2010. The taxonomy of the reconfiguration design space (in the log vs stop-and-restart vs external master), and where group-communication view change fits.
- [Vertical Paxos and Primary-Backup Replication](https://lamport.azurewebsites.net/pubs/vertical-paxos.pdf) — Lamport, Malkhi, Zhou. PODC 2009. Reconfiguration via an "auxiliary configuration master" — the origin of the externalized-registry idea Matchmaker builds on.
- [Implementing Fault-Tolerant Services Using the State Machine Approach](https://www.cs.cornell.edu/fbs/publications/smsurvey.pdf) — Schneider. ACM Computing Surveys 1990. The SMR tutorial; its §7 already names replica addition and removal "Reconfiguration," two decades before Raft.
- [Paxos Made Simple](https://lamport.azurewebsites.net/pubs/paxos-simple.pdf) — Lamport. 2001. The set of servers as part of the state, changed by ordinary commands — "an arbitrarily sophisticated reconfiguration algorithm."
- [Viewstamped Replication Revisited](http://pmg.csail.mit.edu/papers/vr-revisited.pdf) — Liskov, Cowling. MIT-CSAIL-TR 2012. The view/epoch-change machinery that leader-based reconfiguration descends from.

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
- [Group Communication Specifications: A Comprehensive Study](https://dl.acm.org/doi/10.1145/503112.503113) — Chockler, Keidar, Vitenberg. ACM Computing Surveys 2001. The canonical specification of a membership service — "a listing of the currently active and connected processes," delivered as views — including the proof that *precise* membership is as strong as an eventually perfect failure detector (◇P), and the concession that an adversarial network can force any membership service into "inconsistent decisions that do not correctly reflect the network situation."
- [A History of the Virtual Synchrony Replication Model](https://www.cs.cornell.edu/ken/History.pdf) — Birman. 2010. Membership views in virtual synchrony, joins and suspected-crash removals — and the observation that modern Paxos's voter set is "a dynamically tracked notion of membership (also called a view)," the correspondence that lets one word straddle both problems.

### Good reads

- [brianstorti.com/swim](https://www.brianstorti.com/swim/) — a friendly prose walkthrough of SWIM.
- [CASSANDRA-9667](https://issues.apache.org/jira/browse/CASSANDRA-9667) — "strongly consistent membership and ownership": a proposal to make Cassandra's membership and ownership linearizable, motivated by uncoordinated gossip-based joins selecting overlapping token ranges.
- [baseds](https://medium.com/baseds) — Vaidehi Joshi's series on distributed systems basics, the pedagogical north star for this post.
