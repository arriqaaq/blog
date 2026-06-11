# Widget correctness & faithfulness audit

**Scope:** all 22 registered widgets in `build/widgets.json`.
**Method:** per widget, a *verify* agent (contract + `node --check` + per-claim faithfulness) then an
independent *adversarial audit* agent that re-opened the source to refute both the issues and the
passing verdicts. 44 agents total.
**Source of truth (code, not docs):** `projects/dst/src` · `tapir-rs/src` ·
`tokio-1.52.3/src` (dst resolves tokio 1.52.1 per `Cargo.lock`) · enterprise branch
`arriqaaq/dst-game-own-framework` (read via `git show`).

**Two caveats, stated up front:**
1. **Runtime rendering was NOT verified.** Agents ran `node --check` (syntax) and static analysis only;
   no headless browser was available. "Working" below means *the contract holds and it parses*, not
   *the animation was watched*.
2. **A concurrent session edited the repo mid-run** (02:10–02:15, files rebuilt via `npm run build`).
   That was the de-turmoil refactor, not this audit — my agents are read-only and never ran the build.
   Findings on `clock-recursion`, `transport-swap`, and the renamed `turmoil-step`→`step-loop` were
   re-verified against the *current* files.

---

## Verdict summary

Contract (working) — **all 22 pass.** `node --check` clean; every widget is a `"use strict"` IIFE that
guards `anime` (v4) + `window.DSTKit`, builds via `K.container`, re-themes on a `data-mode`
MutationObserver, and exposes `window.<Global>.init`. **No accidental determinism leaks**: the three
determinism flags are all intentional negative examples or self-corrected false positives (see below).

Faithfulness — graded against source:

| Widget | In post? | Faithfulness | Note |
|---|---|---|---|
| tick-loop | ✓ | **clean** | — |
| four-layers | ✓ | **clean** | — |
| host-client-lifetime | ✓ | **clean** | — |
| partition-hold | ✓ | **clean** | — |
| two-clocks | ✓ | clean* | illustrative tick/latency numbers only |
| pure-function | ✓ | minor | `%20` shown vs ~1-in-5 simulated |
| same-seed-replay | ✓ | minor | `.build()?`; folds send events into hash |
| tokio-runtime | ✓ | minor | "epoll_wait" on a time-only runtime |
| paused-clock | ✓ | minor | "clears unfrozen field" omits `base+=elapsed` |
| work-stealing | ✓ | clean* | multi-thread `Math.random` is the point |
| select-seed | ✓ | minor | full permutation vs tokio's start-index rotation |
| packet-heap | ✓ | minor | caption omits `+ extra_delay` |
| sim-cluster | ✓ | minor | "mulberry32" mislabel; RNG ≠ routing |
| rolling-clog | ✓ | minor | two streams vs one; clog order is deterministic |
| step-loop (was turmoil-step) | ✓ | clean | de-turmoiled by concurrent edit |
| **timer-wheel** | ✓ | **fix** | "spans ~12 days" is ~64× too small |
| **clock-handoff** | ✓ | **fix** | driver "leaps" sim-time; real driver steps fixed `sim_tick` |
| **packet-admission** | ✓ | **fix** | held traffic shown bypassing the loss gate |
| **transport-swap** | ✓ | **fix** | prod is QUIC (`quinn`), not raw `tokio::net::UdpSocket` |
| **tapir-commit** | ✓ | **fix** | drop≠abstain conflation; slow-path round-trip overstated |
| os-hooks | ✓ | minor→fix | getrandom not gated by `in_node_context`; not `dlsym` |
| **clock-recursion** | ✗ (registered only) | **wrong** | fabricated APIs; worst widget, but unused |

`*` = no factual error; numbers are deliberately illustrative.

---

## Findings that warrant a fix

### 1. clock-recursion — fabricated APIs (highest faithfulness defect; not embedded)
The widget is **not referenced in the post** (`widgets.json` only) — low blast radius — but if it is ever
embedded it is the most inaccurate. The concurrent edit only removed the `turmoil::` prefix; the rest stands:
- **The "one-line fix" `Handle::try_current().is_ok()` does not exist in the codebase.**
  `grep -rn try_current dst/src` → **zero hits**. The real gate is `TickContext::in_node_context()`
  (`dst/src/os_hooks/clock.rs:115`) = `NODE_CTX.is_set()` (`dst/src/sim/context.rs:31-32`), a
  `scoped_thread_local!` presence check.
- **The recursion CYCLE is invented.** The widget draws `sim_elapsed() → World::try_current_host() →
  host.timer.sim_elapsed() → tokio → std → clock_gettime`. In source, `sim_elapsed()`
  (`dst/src/os_hooks/mod.rs:17`) just does an atomic load — it **reads no clock**, so it cannot cause the
  depicted recursion; `World::try_current_host` and `host.timer` appear nowhere.
- The high-level *moral* — "gate on a TLS flag, not on a clock read" — is correct; every concrete
  identifier is not. **Recommend:** rewrite against the real `in_node_context()`/`NODE_CTX` gate, or drop it.

### 2. transport-swap — prod transport type is wrong
Widget shows prod as `tokio::net::UdpSocket` ("real wire · jittery · can reorder · can lose"; snippet
`ClusterBus::new(tokio::net::UdpSocket::bind(addr)?)`). The real production `impl Transport` is
**`QuicTransport`** backed by `quinn` (`crates/enterprise/src/ntw/quic.rs:458,482`; constructed in prod via
`QuicTransport::bind` at `dbs/mod.rs:494`). The de-turmoil edit fixed the *sim* label (now "SimTransport")
but left the *prod* side as raw UDP.
- Nuance (audit): behaviorally QUIC is one-uni-stream-per-message, fire-and-forget, drop-on-cache-miss
  with TAPIR retry (`quic.rs:21,750,784`), so "can lose / can reorder" *across messages* is directionally
  true. Only the **type label** is wrong. **Recommend:** label prod `QuicTransport`/QUIC.

### 3. tapir-commit — two protocol mismatches (embedded)
- **Drop ≠ Abstain.** Controls/logs say "drop k replies" (`tapir-commit.js:53,81,207,260`) but the SVG
  renders them as red **"abstain"** (`:189`), then re-sends and those same replicas all reply **Ok**
  (`:227-228`). In TAPIR, `Abstain` is a *definitive disagreeing reply that arrived*
  (`tapir-rs/src/protocol.rs:407`); it counts **against** the Ok quorum and `abstain ≥ quorum` returns
  `Abstain` which loops/sleeps and never commits (`transaction.rs:739-743`). An abstainer does not flip to
  Ok on a plain re-send. The widget conflates "dropped/non-responding" with "abstained" and is internally
  inconsistent.
- **Slow path overstates the round count.** Widget always animates a 2nd round trip and sets round-trips=2
  (`:171,228,232`). But `propose_slow_path` first re-checks the *already-collected* fast-path replies for
  `slow_quorum` (`client.rs:282-283,943-954`); for the depicted case (3 Ok = slow_quorum) the real protocol
  decides from round-1 replies with **no second physical round trip**.

### 4. timer-wheel — "spans ~12 days" is ~64× too small (embedded, user-visible)
Snippet (`:40`) and footnote (`:107`) say "6 levels × 64 slots → spans ~12 days." Tokio's 6-level wheel
spans `(1<<36)-1` ms ≈ **795 days (~2.18 yr)** (`tokio .../runtime/time/wheel/mod.rs:48`, doc:42-44).
~12 days is the *level-5 slot size* / the span of the first 5 levels — not what 6 levels span. (Other
mechanics — linear buckets, cursor-wrap cascade — are honest pedagogical re-skins, fine.)

### 5. clock-handoff — driver does not "leap" sim-time (embedded)
On `node.sleep(1s)` the widget leaps the sim canonical "now" by 1000 ms in one Step (`:144-151,167`) and
logs "idle gap of 1000 ms skipped in 0 real time." The real driver advances the shared coordinate by a
**fixed `sim_tick`** every step (`tick.rs:69 ctx.elapsed += sim_tick`; default 1 ms, `builder.rs:39`;
`core.rs:115-119,163-168` loops a fixed tick). The auto-advance leap is a property of **Tokio's paused
clock within one `rt.tick(dt)`** (driven by the fence deadline), not the driver resizing its tick. "Idle
gap skipped in 0 real time" is true for **wall-clock** only; rendering the sim-time coordinate jumping
1000 ms conflates wall-clock cost with the per-step sim-time increment.

### 6. packet-admission — held traffic shown bypassing the loss gate (embedded)
`decide()` short-circuits to `'held'` (`:210`) and stacks "link held?" *above* "seeded loss coin-flip?",
implying held packets never hit loss. In source a held link only skips the **partition** drop
(`backplane.rs:148-149`); execution still runs the seeded loss roll (`:159`) and computes a fresh
`deliver_at` (`:191-200`) before `enqueue_held` (`:209`). So loss **applies to held packets too**; the
widget inverts that ordering. (Also omits `max_inflight` overflow drop `:223-227` and the FilterChain
Drop/Delay path — both no-ops by default, fine to omit.)

### 7. os-hooks — entropy path mis-gated (embedded)
The central diamond and the header comment (`:5-7`) route **both** `clock_gettime` and `getrandom` through
`USE_SIM_CLOCKS>0 && in_node_context()`, "otherwise dlsym(RTLD_NEXT)." In source only the **clock** is
gated that way (`clock.rs:115,139`). `getrandom` (`rand.rs:34-46`) never reads `in_node_context`/
`USE_SIM_CLOCKS` — it serves seeded bytes whenever `RNG_CELL` is set, else reads **`/dev/urandom`** (not
`dlsym`). Defensible only because `ClockGuard::install` flips both together; per-call it's inaccurate.
(Determinism "violation" here = the gate-OFF branch deliberately uses the host clock to depict
nondeterminism — intentional, not a leak.)

---

## Minor / acceptable simplifications (optional polish)

- **sim-cluster** — RNG box labeled **"mulberry32"**; the framework's `Prng` is ChaCha8 + SHA-256
  (`dst/src/prng.rs:6,9-15`). mulberry32 is only the *widget kit's* own RNG (`dst-kit.js:54`). A
  one-word mislabel that misattributes the kit's algorithm to the framework. Also: in SIM mode the
  widget uses the seeded RNG to choose **routing**; source uses it for latency jitter + optional node
  order, not routing (`tick.rs:47-48`, `backplane.rs:196`, `random_node_order` defaults false).
- **pure-function** — on-screen code shows `% 20` (matches prose) but the demo fires ~1-in-5 (`ODDS=5`,
  `:23,126-127`); the impure lane's "diverged" status is hard-coded (`:160,165`), not measured like the
  seeded lane (`:155-156`). `Math.random` at `:126` is the *intended* nondeterministic lane — not a leak.
- **select-seed** — renders a full Fisher-Yates permutation as the poll order, but tokio randomizes only a
  **start index** then polls a contiguous rotation `(start+i)%N` (`select.rs:675-680`); ~49% of seeds show
  an order tokio can't produce. The **winner** is correct. Snippet `.rng_seed(seed)` omits the real
  `RngSeed` type + `tokio_unstable`/feature gating.
- **rolling-clog** — shows two seeded streams (`r1`, `r2=K.rng(seed^…)`); source uses **one** `Prng`
  shuffled twice (`swizzle_clog.rs:46,84-85`), and **clog order is deterministic** — only the *unclog*
  order is shuffled. `net.set(LinkState::Hold)` is an invented API (real: `sim.hold`/`sim.release`).
- **same-seed-replay** — caption `.build()?` (Builder::build returns `Sim`, no `Result`); folds send/"push"
  events into the fingerprint, but the real `history_hash` has no send variant (`history.rs:44-50`, only
  fault/delivered/dropped); caption config ≠ the named test it's cited beside.
- **packet-heap** — caption `deliver_at = now + latency` omits `+ extra_delay` (`backplane.rs:200`, prose
  has it); `seq` starts at 1 vs source 0. Cosmetic.
- **paused-clock** — prose "clears the unfrozen field" omits the prior `base += elapsed` (`clock.rs:337`);
  "resets to 0" on crash is presentation (real: fresh `Instant::now` base); lockstep advance is the sim
  coordinator's clock, not per-node Tokio behavior.
- **tokio-runtime** — park subtitle "epoll_wait(timeout=0)"; the time-only runtime (`enable_time`, no
  `enable_io`, `runtime.rs:41`) installs no I/O driver and never calls epoll. Caption text is accurate.
- **two-clocks** — `sim_tick=10ms` illustrative (default 1ms); latency band illustrative. No error.
- **work-stealing** — multi-thread side uses `Math.random` (`:165,170,176`) **by design** (the
  irreproducible negative example); the advocated current-thread side is fully deterministic. Correct.

## Already fixed by the concurrent refactor
- **turmoil-step → step-loop** — renamed, `window.DSTStepLoop`, no "turmoil" in the file; registry +
  post token + generated HTML all updated. Stage-1's "stale turmoil branding" no longer applies.
- **transport-swap UI** — "Turmoil"/"sim: Turmoil" labels → "SimTransport"/"sim: dst". (The *prod*-type
  issue in finding #2 is separate and still open.)

## Process notes (not blog defects)
- Several agents cited a stale path `content/dst.md`; the real file is `content/the-seed-contract.md`. The
  audit caught it — substance was checked against the correct lines, so conclusions hold; only some
  citations name a nonexistent file.
- The `tokio-runtime` verify agent mislabeled its `library` field as `tapir-rs`; it audited the correct
  files.
