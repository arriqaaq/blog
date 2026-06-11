/**
 * DST Transport Swap (re-skinned via dst-kit) — "swap the wire, not the replica."
 *
 * The same TAPIR replica / ClusterBus code talks to the wire through one seam: `dyn Transport`
 * (the trait is at tapir-rs src/transport.rs:24; ClusterBus stores it as `Arc<dyn Transport>`,
 * src/transport.rs:385). In prod the seam is filled by the real-UDP UdpTransport (tapir-rs
 * src/udp.rs — fragments/reassembles datagrams, impls Transport at src/udp.rs:424) on a real wire:
 * jittery, can reorder, can lose, and none of it is owned by the seed — so a Send burst lands
 * differently every run. In tests the seam is filled by a sim transport over dst::UdpSocket
 * (dst src/net/udp.rs:18) on the driver-scheduled backplane — a min-heap keyed by (deliver_at, seq)
 * (dst src/sim/backplane.rs:54 + the Ord at :28-34: ordered, deterministic). The replica is
 * UNTOUCHED; only the `dyn Transport` behind the seam changes.
 * (The sim-transport glue lives on an unchecked-out branch, so its exact type name isn't pinned here.)
 *
 * The widget makes that contrast the whole point: it sends the SAME burst TWICE (run A, run B) down
 * each wire and asks whether run B matched run A.
 *   • prod wire → modelled with the non-seeded JS Math.random() *on purpose*, because a real wire's
 *     timing/loss come from the host machine, not the seed — so A ≠ B (the bug can't be replayed).
 *   • sim wire → two FRESH K.rng(seed) streams draw the identical sequence, so A = B (same seed,
 *     same run — replayable). Latency, order, and drops come from the seed instead of the host.
 *
 * Loud per-lane verdict carries the lesson. Exposes window.DSTTransportSwap.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('transport-swap: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('transport-swap: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 318, MSGS = 5;          // same small burst, sent twice per wire

  // top: the replica + the seam slot (production code — never changes)
  const REPLICA = { x: 250, y: 14, w: 280, h: 44 };
  const SLOT = { x: 300, y: 66, w: 180, h: 28 };

  // two wire lanes, each with two run-rows (A, B) of message cells
  const LANE = { x0: 20, y0: 122, h: 80, gap: 12, w: W - 40 };
  const laneY = (i) => LANE.y0 + i * (LANE.h + LANE.gap);
  const CX0 = 250, CX1 = 588, PITCH = (CX1 - CX0) / MSGS, CW = PITCH - 8, CH = 24;
  const rowY = (i, ab) => laneY(i) + 22 + ab * 30;   // ab: 0 = run A, 1 = run B
  const cellX = (col) => CX0 + col * PITCH;

  // Plain-English label first; the textbook term is a small tag.
  const LANES = [
    { plain: 'real wire (production)', sub: 'UdpTransport · real UDP datagrams over the host network',
      tag: 'dyn Transport = UdpTransport', zone: 'blue',  mode: 'prod' },
    { plain: 'simulated wire (tests)', sub: 'sim transport · dst::UdpSocket on the backplane heap',
      tag: 'dyn Transport = sim transport', zone: 'purple', mode: 'sim' },
  ];

  const SNIPPET = `// the seam: one trait, stored behind the replica as a trait object — never edited
pub trait Transport: Send + Sync + 'static { /* send, shutdown */ }

// ClusterBus::start takes any impl Transport, then erases it to Arc<dyn Transport>
let transport = if cfg!(sim) {
    sim_transport(addr).await?          // over dst::UdpSocket (sim backplane)
} else {
    UdpTransport::bind(addr).await?     // real UDP datagrams
};
let bus = ClusterBus::start((transport, rx), cfg, cluster, replica);`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { seed: 7, running: false, speed: 1, mismatch: [0, 0] };
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const rid = (lane, ab, col) => `${uid}-r-${lane}-${ab}-${col}`;
    const tid = (lane, ab, col) => `${uid}-t-${lane}-${ab}-${col}`;
    const Rect = (l, a, col) => svg.querySelector('#' + CSS.escape(rid(l, a, col)));
    const Txt = (l, a, col) => svg.querySelector('#' + CSS.escape(tid(l, a, col)));
    const Eid = (k, i) => svg.querySelector('#' + CSS.escape(`${uid}-${k}-${i}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--green t-run">▶ Send the same burst twice</button>
        <button class="dstk-btn dstk-btn--ghost t-replay">↺ Try again</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed (sim)</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Same replica code — swap only the wire underneath it',
        sub: 'send the same burst twice: the real wire diverges, the simulated wire repeats',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [
          { id: 'msgs', label: 'msgs / run' },
          { id: 'prod', label: 'real: A vs B' },
          { id: 'sim', label: 'sim: A vs B' },
        ],
        cap: K.highlightRust(SNIPPET),
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      stat('msgs', MSGS);
      K.addLog(logBody, '🌱 ready — the replica is untouched; only the trait object behind the seam swaps', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';

      // Replica / ClusterBus box (production code — never changes), with the seam slot below it.
      K.el('rect', { x: REPLICA.x, y: REPLICA.y, width: REPLICA.w, height: REPLICA.h, rx: 9,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      txt(REPLICA.x + REPLICA.w / 2, REPLICA.y + 19, c.text, 13, 700, 'middle').textContent = 'Replica / ClusterBus';
      txt(REPLICA.x + REPLICA.w / 2, REPLICA.y + 35, c.muted, 9.5, 400, 'middle').textContent = 'production code — never edited';

      // connector into the seam slot
      K.el('line', { x1: REPLICA.x + REPLICA.w / 2, y1: REPLICA.y + REPLICA.h, x2: SLOT.x + SLOT.w / 2,
        y2: SLOT.y, stroke: c.separator, 'stroke-width': 1.4 }, content);

      // the seam: a dashed slot "dyn Transport" — only what fills this changes between prod and sim
      K.el('rect', { x: SLOT.x, y: SLOT.y, width: SLOT.w, height: SLOT.h, rx: 7, fill: 'none',
        stroke: c.muted, 'stroke-width': 1.6, 'stroke-dasharray': '5,3' }, content);
      txt(SLOT.x + SLOT.w / 2, SLOT.y + 18, c.muted, 11, 700, 'middle').textContent = 'the seam: dyn Transport';
      txt(W / 2, SLOT.y + SLOT.h + 17, c.muted, 9.5, 400, 'middle').textContent =
        'swap only this — the two wires below fill the same slot';

      // legend for the cell colours
      legendSwatch(CX0, laneY(0) - 12, c.green, 'arrived');
      legendSwatch(CX0 + 92, laneY(0) - 12, c.red, 'lost');

      // two wire lanes
      LANES.forEach((L, i) => {
        const y = laneY(i), accent = c[L.zone];
        K.el('rect', { x: LANE.x0, y, width: LANE.w, height: LANE.h, rx: 9,
          fill: K.grad(uid, L.zone), stroke: accent, 'stroke-width': 1.3 }, content);

        // left: plain words first, then the detail, then the impl tag
        txt(LANE.x0 + 14, y + 22, c.text, 12.5, 700).textContent = L.plain;
        txt(LANE.x0 + 14, y + 39, c.muted, 9, 400).textContent = L.sub;
        const tw = 14 + L.tag.length * 5.4;
        K.el('rect', { x: LANE.x0 + 14, y: y + 49, width: tw, height: 16, rx: 8,
          fill: accent, 'fill-opacity': 0.16, stroke: accent, 'stroke-opacity': 0.5 }, content);
        txt(LANE.x0 + 21, y + 60.5, accent, 8.5, 700).textContent = L.tag;

        // two run-rows of empty message cells (A on top, B below)
        [0, 1].forEach((ab) => {
          txt(CX0 - 10, rowY(i, ab) + CH / 2 + 4, c.muted, 9.5, 700, 'end').textContent = ab === 0 ? 'A' : 'B';
          for (let col = 0; col < MSGS; col++) {
            K.el('rect', { id: rid(i, ab, col), x: cellX(col), y: rowY(i, ab), width: CW, height: CH, rx: 4,
              fill: c.separator, 'fill-opacity': 0.4 }, content);
            txt(cellX(col) + CW / 2, rowY(i, ab) + CH / 2 + 4, c.muted, 10, 700, 'middle',
              tid(i, ab, col)).textContent = '';
          }
        });

        // mismatch markers + the loud verdict (right edge)
        K.el('g', { id: `${uid}-ticks-${i}` }, content);
        txt(CX1 + 16, y + 30, c.muted, 13, 700, 'start', `${uid}-v1-${i}`).textContent = '—';
        txt(CX1 + 16, y + 48, c.muted, 8.5, 400, 'start', `${uid}-v2-${i}`).textContent = 'press Send';
      });
    }

    // text helper; optional id sets the element id, optional anchor sets text-anchor
    function txt(x, y, fill, size, weight, anchor, id) {
      const a = { x, y, fill, 'font-size': size, 'font-weight': weight || 400 };
      if (anchor) a['text-anchor'] = anchor;
      if (id) a.id = id;
      return K.el('text', a, content);
    }
    function legendSwatch(x, y, color, label) {
      K.el('rect', { x, y: y - 9, width: 11, height: 11, rx: 2.5, fill: color, 'fill-opacity': 0.7, stroke: color }, content);
      txt(x + 15, y, c.muted, 9).textContent = label;
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      const fmt = (d) => d === 0 ? 'match' : d + ' off';
      stat('prod', fmt(st.mismatch[0])); stat('sim', fmt(st.mismatch[1]));
    }

    // Each run is the SAME burst of MSGS messages. A cell records what the wire did to that message:
    //   { lost: bool, order: 0..MSGS-1 } — the position the message ended up arriving in.
    // prod wire → Math.random() (non-seeded ON PURPOSE: a real wire's timing/loss come from the host,
    //             not the seed) so run A and run B diverge.
    // sim wire  → two FRESH K.rng(seed) streams, so run A and run B draw the identical sequence.
    function oneRun(gen) {
      const cells = [];
      const arrived = [];
      for (let col = 0; col < MSGS; col++) {
        const lost = gen() < 0.18;                         // the wire can drop
        const latency = gen();                             // jitter → arrival order
        cells.push({ lost, latency });
        if (!lost) arrived.push({ col, latency });
      }
      // arrival order = sorted by latency; reorder is what makes order differ run-to-run
      arrived.sort((a, b) => a.latency - b.latency);
      arrived.forEach((m, pos) => { cells[m.col].order = pos + 1; });
      return cells;
    }

    function plan() {
      // sim: two fresh seeded streams → identical draws → A === B
      const s1 = K.rng(st.seed >>> 0), s2 = K.rng(st.seed >>> 0);
      return [
        [oneRun(Math.random), oneRun(Math.random)],   // prod: host-driven, diverges
        [oneRun(s1),          oneRun(s2)],            // sim: seed-driven, repeats
      ];
    }

    function paint(lane, ab, col, cell) {
      const color = cell.lost ? c.red : c.green;
      const r = Rect(lane, ab, col), t = Txt(lane, ab, col);
      r.setAttribute('fill', color); r.setAttribute('fill-opacity', 0.18);
      r.setAttribute('stroke', color); r.setAttribute('stroke-opacity', 0.9);
      t.setAttribute('fill', color);
      // show the arrival ORDER (#1..#n) so reorder is visible; ✗ for a dropped message
      t.textContent = cell.lost ? '✗' : '#' + cell.order;
      animate(r, { opacity: [0.2, 1], duration: dur(150), ease: 'out(2)' });
    }

    // two runs disagree on a message if its lost-ness OR its arrival order differs
    function differs(a, b) { return a.lost !== b.lost || a.order !== b.order; }

    async function runAll(replay) {
      if (st.running) return;
      st.running = true; setLock(true);

      // clear cells + verdicts
      LANES.forEach((L, i) => {
        svg.querySelector('#' + CSS.escape(`${uid}-ticks-${i}`)).innerHTML = '';
        [0, 1].forEach((ab) => { for (let col = 0; col < MSGS; col++) {
          const r = Rect(i, ab, col); r.setAttribute('fill', c.separator); r.setAttribute('fill-opacity', 0.4);
          r.removeAttribute('stroke'); Txt(i, ab, col).textContent = '';
        } });
        Eid('v1', i).textContent = '…'; Eid('v1', i).setAttribute('fill', c.muted);
        Eid('v2', i).textContent = ''; Eid('v2', i).setAttribute('fill', c.muted);
      });

      const data = plan();
      // sweep message-by-message across both runs and both wires so the fill-in is followable
      for (let col = 0; col < MSGS; col++) {
        LANES.forEach((L, i) => [0, 1].forEach((ab) => paint(i, ab, col, data[i][ab][col])));
        await K.delay(dur(150));
      }

      // verdicts
      LANES.forEach((L, i) => {
        const A = data[i][0], B = data[i][1];
        let diff = 0;
        for (let col = 0; col < MSGS; col++) if (differs(A[col], B[col])) { diff++; markMismatch(i, col); }
        st.mismatch[i] = diff;
        const same = diff === 0;
        const v1 = Eid('v1', i), v2 = Eid('v2', i);
        v1.textContent = same ? '✓ A = B' : '✗ A ≠ B';
        v1.setAttribute('fill', same ? c.green : c.red);
        v2.setAttribute('fill', same ? c.green : c.red);
        v2.textContent = same ? 'same seed, same run' : 'different every run';
      });
      render();

      K.addLog(logBody, (replay ? '↺ tried again' : '▶ sent') + ' — same burst, twice, down each wire', 'hl');
      K.addLog(logBody, 'real wire: ' + (st.mismatch[0]
        ? st.mismatch[0] + ' msgs differ — order/loss came from the host, can never replay'
        : 'matched by luck this time (host timing is not pinned)'),
        st.mismatch[0] ? 'err' : 'warn');
      K.addLog(logBody, 'sim wire: ' + (st.mismatch[1]
        ? st.mismatch[1] + ' msgs differ?! (unexpected)'
        : 'A = B @ seed=' + st.seed + ' — order/loss came from the seed, replayable'),
        st.mismatch[1] ? 'err' : 'ok');

      st.running = false; setLock(false);
    }

    // red box around a message column where run A and run B disagree — "this run can't be replayed"
    function markMismatch(lane, col) {
      const g = svg.querySelector('#' + CSS.escape(`${uid}-ticks-${lane}`));
      const yTop = rowY(lane, 0) - 3, yBot = rowY(lane, 1) + CH + 3;
      const box = K.el('rect', { x: cellX(col) - 2, y: yTop, width: CW + 4, height: yBot - yTop, rx: 4,
        fill: 'none', stroke: c.red, 'stroke-width': 2, opacity: 0 }, g);
      animate(box, { opacity: [0, 1], duration: dur(280), ease: 'out(2)' });
    }

    function bind() {
      root.querySelector('.t-run').onclick = () => runAll(false);
      root.querySelector('.t-replay').onclick = () => runAll(true);
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
      root.querySelector('.t-seed').onchange = (e) => {
        st.seed = parseInt(e.target.value, 10) || 0;
        K.addLog(logBody, '🌱 seed → ' + st.seed + ' · the simulated wire reproduces this exactly', 'hl');
        if (!st.running) runAll(true);
      };
    }

    function setLock(b) { K.lock(root, ['.t-run', '.t-replay', '.t-seed'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTransportSwap = { init };
})();
