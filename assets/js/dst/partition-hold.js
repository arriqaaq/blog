/**
 * DST Partition vs Hold — the most-misunderstood distinction, made kinetic.
 *
 * Grounded in src/topology/link.rs: LinkState { Healthy, Hold { pending: VecDeque<HeldPacket> }, Partitioned }.
 *   • PARTITIONED — a packet crossing the link is DROPPED: gone forever.
 *   • HOLD        — a packet is BUFFERED in a per-link queue (VecDeque<HeldPacket>): alive but parked.
 *     On release() the whole pending queue is returned in FIFO order; each HeldPacket keeps its
 *     ORIGINAL deliver_at (seq + payload identity intact), so the parked packets burst back into
 *     delivery all at once.
 *   • HEALTHY     — packets cross and are delivered.
 *
 * Presentation reworked for clarity: two lanes shown side-by-side so the contrast is loud —
 * a CUT WIRE (drop) above a CLOGGED PIPE (buffer-then-burst). Re-skinned via dst-kit.
 * Exposes window.DSTPartitionHold.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('partition-hold: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('partition-hold: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 300;
  const N_MSGS = 3;                       // few, followable packets

  // Phase strip
  const PILL = { y: 14, h: 26, w: 232, gap: 14, x0: 18 };
  const PHASES = [
    { t: '① send 3 messages', zone: 'blue' },
    { t: '② fault hits the link', zone: 'red' },
    { t: '③ release the clog', zone: 'green' },
  ];
  const pillX = (i) => PILL.x0 + i * (PILL.w + PILL.gap);

  // Two lanes. Each: sender box (left) → fault marker (mid) → receiver box (right).
  const LANE = { x0: 18, w: W - 36, h: 96, gap: 16, y0: 56 };
  const laneY = (i) => LANE.y0 + i * (LANE.h + LANE.gap);
  const BOX = { w: 92, h: 46 };
  const SX = LANE.x0 + 206;               // sender box x (indented past the left label column)
  const RX = LANE.x0 + LANE.w - 14 - BOX.w; // receiver box x
  const wireL = SX + BOX.w, wireR = RX;    // wire endpoints
  const FAULT_X = (wireL + wireR) / 2 + 36; // where drop/clog happens
  const STAGE_X = wireL + 26;              // where messages line up before the fault

  // amber=hold, red=partition (kit palette zones)
  const LANES = [
    { plain: 'CUT WIRE', sub: 'partition — packet is DROPPED', tag: 'Partitioned', zone: 'red',   kind: 'drop' },
    { plain: 'CLOGGED PIPE', sub: 'hold — packet is BUFFERED', tag: 'Hold { VecDeque }', zone: 'amber', kind: 'hold' },
  ];

  function init(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const uid = containerId;

    const st = {
      phase: -1,
      held: [],          // [{ seq }] parked in the clogged pipe
      dropped: 0,        // packets lost on the cut wire
      delivered: 0,      // packets that reached the receiver (burst)
      seq: 0,
      busy: false,
      verdict: ['', ''], // per-lane outcome text once a run completes
    };

    let svg, content, anim, logBody, c;

    build();

    function controls() {
      return `
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--blue t-send">▶ Send 3 messages</button>
          <button class="dstk-btn dstk-btn--green t-release">⤓ Release the clog</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>
        </div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">the question</span>
          <span class="dstk-sub" style="max-width:240px">does it vanish, or pile up?</span>
        </div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Drop vs hold: does the message vanish, or pile up and arrive all at once?',
        sub: 'two broken links, side by side',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'dropped',   label: 'dropped (cut)'  },
          { id: 'held',      label: 'parked (clog)'  },
          { id: 'delivered', label: 'delivered'      },
        ],
        cap: 'Both links break the moment you send. A <b>cut wire</b> (partition) drops packets — gone '
           + 'forever. A <b>clogged pipe</b> (hold) buffers them in a queue; on release they burst out '
           + 'all at once, still in their original order.',
      });
      c = K.palette();
      svg     = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim    = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene();
      bind();
      setPhase(-1);
      render();
      K.addLog(logBody, '🌱 ready — press Send and watch the two faults differ', 'hl');
    }

    // ---- scene ---------------------------------------------------------------

    function drawScene() {
      content.innerHTML = '';
      anim.innerHTML = '';

      // phase strip
      PHASES.forEach((p, i) => {
        K.el('rect', { id: nid('pill', i), x: pillX(i), y: PILL.y, width: PILL.w, height: PILL.h, rx: 7,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: nid('pilltext', i), x: pillX(i) + PILL.w / 2, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = p.t;
        if (i < PHASES.length - 1)
          K.el('text', { x: pillX(i) + PILL.w + PILL.gap / 2, y: PILL.y + PILL.h / 2 + 4,
            'text-anchor': 'middle', fill: c.muted, 'font-size': 12 }, content).textContent = '→';
      });

      LANES.forEach((L, i) => drawLane(i, L));
    }

    function drawLane(i, L) {
      const y = laneY(i), accent = c[L.zone];
      const midY = y + LANE.h / 2;

      // lane frame
      K.el('rect', { x: LANE.x0, y, width: LANE.w, height: LANE.h, rx: 10,
        fill: K.grad(uid, L.zone), stroke: accent, 'stroke-width': 1.3 }, content);

      // lane label — plain word loud, jargon as a small tag
      K.el('text', { x: LANE.x0 + 14, y: y + 22, fill: accent, 'font-size': 14, 'font-weight': 800,
        'letter-spacing': '.03em' }, content).textContent = L.plain;
      K.el('text', { x: LANE.x0 + 14, y: y + 38, fill: c.muted, 'font-size': 9.5 }, content).textContent = L.sub;
      const tagW = 18 + L.tag.length * 5.6;
      K.el('rect', { x: LANE.x0 + 14, y: y + 46, width: tagW, height: 15, rx: 7.5,
        fill: accent, 'fill-opacity': 0.16, stroke: accent, 'stroke-opacity': 0.5 }, content);
      K.el('text', { x: LANE.x0 + 14 + tagW / 2, y: y + 57, 'text-anchor': 'middle',
        fill: accent, 'font-size': 8.5, 'font-weight': 700,
        'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = L.tag;

      // wire (the link). For the cut wire we draw a visible gap+spark at the fault.
      K.el('line', { id: nid('wire', i), x1: wireL, y1: midY, x2: wireR, y2: midY,
        stroke: c.separator, 'stroke-width': 3 }, content);

      // sender + receiver boxes
      K.el('rect', { id: nid('snd', i), x: SX, y: midY - BOX.h / 2, width: BOX.w, height: BOX.h, rx: 8,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.5 }, content);
      K.el('text', { x: SX + BOX.w / 2, y: midY - 4, 'text-anchor': 'middle', fill: c.text,
        'font-size': 11, 'font-weight': 700 }, content).textContent = 'n0';
      K.el('text', { x: SX + BOX.w / 2, y: midY + 10, 'text-anchor': 'middle', fill: c.muted,
        'font-size': 8.5 }, content).textContent = 'sender';

      K.el('rect', { id: nid('rcv', i), x: RX, y: midY - BOX.h / 2, width: BOX.w, height: BOX.h, rx: 8,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.5 }, content);
      K.el('text', { x: RX + BOX.w / 2, y: midY - 4, 'text-anchor': 'middle', fill: c.text,
        'font-size': 11, 'font-weight': 700 }, content).textContent = 'n1';
      K.el('text', { id: nid('rcvcnt', i), x: RX + BOX.w / 2, y: midY + 10, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 8.5 }, content).textContent = 'got 0';

      // fault marker at FAULT_X (hidden until the fault lands)
      const fg = K.el('g', { id: nid('fault', i), opacity: 0 }, content);
      if (L.kind === 'drop') {
        // a jagged break in the wire
        K.el('path', { d: `M${FAULT_X - 10},${midY - 11} L${FAULT_X - 1},${midY - 2} L${FAULT_X - 9},${midY + 3} L${FAULT_X + 1},${midY + 12}`,
          stroke: c.red, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, fg);
        K.el('path', { d: `M${FAULT_X + 10},${midY - 11} L${FAULT_X + 1},${midY - 2} L${FAULT_X + 9},${midY + 3} L${FAULT_X - 1},${midY + 12}`,
          stroke: c.red, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, fg);
      } else {
        // a clog: dashed amber plug + a parked-queue tray below the wire
        K.el('rect', { x: FAULT_X - 9, y: midY - 16, width: 18, height: 32, rx: 4,
          fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6, 'stroke-dasharray': '4,3' }, fg);
        K.el('text', { id: nid('queuelbl', i), x: FAULT_X + 18, y: midY - 16, fill: c.amber,
          'font-size': 9, 'font-weight': 700 }, content).textContent = '';
      }

      // big per-lane verdict (right of receiver)
      K.el('text', { id: nid('verdict', i), x: LANE.x0 + LANE.w - 14, y: y + 22, 'text-anchor': 'end',
        fill: c.muted, 'font-size': 13, 'font-weight': 800 }, content).textContent = '';
    }

    function nid(k, i) { return `${uid}-${k}-${i}`; }
    function E(k, i) { return svg.querySelector('#' + CSS.escape(nid(k, i))); }

    // ---- phase strip ---------------------------------------------------------

    function setPhase(k) {
      st.phase = k;
      PHASES.forEach((p, i) => {
        const r = E('pill', i), t = E('pilltext', i); if (!r) return;
        const on = i === k;
        r.setAttribute('fill', on ? K.grad(uid, p.zone) : 'none');
        r.setAttribute('stroke', on ? c[p.zone] : c.separator);
        r.setAttribute('stroke-width', on ? 2.2 : 1.4);
        if (on) r.setAttribute('filter', K.glow(uid)); else r.removeAttribute('filter');
        t.setAttribute('fill', on ? c[p.zone] : c.muted);
      });
    }

    // ---- render --------------------------------------------------------------

    function render() {
      stat('dropped',   st.dropped);
      stat('held',      st.held.length);
      stat('delivered', st.delivered);

      // clogged-pipe queue label
      const ql = E('queuelbl', 1);
      if (ql) ql.textContent = st.held.length ? `${st.held.length} parked →` : '';

      // parked chips piled at the clog (lane 1)
      [...anim.querySelectorAll('.ph-chip')].forEach((x) => x.remove());
      const midY = laneY(1) + LANE.h / 2;
      st.held.forEach((p, idx) => {
        const cx = FAULT_X + 22 + idx * 26, cy = midY;
        const g = K.el('g', { class: 'ph-chip' }, anim);
        K.el('circle', { cx, cy, r: 11, fill: K.grad(uid, 'amber'), stroke: c.amber,
          'stroke-width': 1.5, filter: K.glow(uid) }, g);
        K.el('text', { x: cx, y: cy + 3.5, 'text-anchor': 'middle', fill: c.amber,
          'font-size': 9, 'font-weight': 700 }, g).textContent = 's' + p.seq;
      });

      // receiver "got N" — distinct per lane (cut wire never receives; clog receives on release)
      const cut = E('rcvcnt', 0), clog = E('rcvcnt', 1);
      if (cut)  cut.textContent  = 'got 0';
      if (clog) clog.textContent = 'got ' + st.delivered;

      // verdicts
      [0, 1].forEach((i) => {
        const v = E('verdict', i); if (!v) return;
        v.textContent = st.verdict[i] || '';
        v.setAttribute('fill', i === 0 ? c.red : (st.held.length ? c.amber : c.green));
      });
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // ---- actions -------------------------------------------------------------

    // Send N messages down BOTH lanes at once. Each message starts identical; the fault decides its fate.
    async function sendBatch() {
      if (st.busy) return;
      setLock(true);
      // fresh run
      st.dropped = 0; st.delivered = 0; st.held = []; st.verdict = ['', '']; st.seq = 0;
      [...anim.querySelectorAll('.ph-chip,.ph-msg')].forEach((x) => x.remove());
      E('fault', 0).setAttribute('opacity', 0);
      E('fault', 1).setAttribute('opacity', 0);
      render();

      // ① send
      setPhase(0);
      K.addLog(logBody, '── ① sending ' + N_MSGS + ' messages down each link ──', 'hl');

      // messages leave the senders and queue up just before each fault point
      for (let m = 0; m < N_MSGS; m++) {
        const seq = ++st.seq;
        await Promise.all([
          flyTo(0, STAGE_X + m * 22, c.blue, 'in flight'),
          flyTo(1, STAGE_X + m * 22, c.blue, 'in flight'),
        ]);
        // tag the in-flight dots so we can resolve them at the fault
        markStaged(0, seq, STAGE_X + m * 22);
        markStaged(1, seq, STAGE_X + m * 22);
        K.addLog(logBody, `sent: seq=${seq} n0→n1 (both links)`, null);
      }

      // ② fault hits — both links break at once
      setPhase(1);
      E('fault', 0).setAttribute('opacity', 1);
      E('fault', 1).setAttribute('opacity', 1);
      animate(E('wire', 0), { opacity: [1, 0.3], duration: 220 });
      await K.delay(180);
      K.addLog(logBody, '── ② both links break: cut wire vs clogged pipe ──', 'warn');

      // resolve each lane's staged messages
      const staged = [...anim.querySelectorAll('.ph-msg')];

      // CUT WIRE (lane 0): every message reaches the break and vanishes.
      const cutMsgs = staged.filter((g) => g.dataset.lane === '0');
      for (const g of cutMsgs) {
        const dot = g.firstChild;
        await animate(dot, { cx: FAULT_X, duration: 200, ease: 'out(2)' });
        dot.setAttribute('fill', c.red);
        await animate(dot, { r: [7, 15], opacity: [1, 0], duration: 240, ease: 'out(2)' });
        g.remove();
        st.dropped++;
        flashFault(0);
        K.addLog(logBody, `dropped: seq=${g.dataset.seq} — cut wire, gone forever`, 'err');
        render();
      }
      st.verdict[0] = '✗ VANISHED';

      // CLOGGED PIPE (lane 1): messages pile up parked in the buffer (VecDeque), nothing delivered yet.
      const clogMsgs = staged.filter((g) => g.dataset.lane === '1');
      for (const g of clogMsgs) {
        const dot = g.firstChild;
        const idx = st.held.length;
        await animate(dot, { cx: FAULT_X + 22 + idx * 26, duration: 220, ease: 'inOutQuad' });
        await animate(dot, { opacity: [1, 0], duration: 90 });
        g.remove();
        st.held.push({ seq: parseInt(g.dataset.seq, 10) });
        K.addLog(logBody, `parked: seq=${g.dataset.seq} — buffered, deliver_at preserved`, 'warn');
        render();
      }
      st.verdict[1] = st.held.length ? '⏸ PILING UP' : '';
      render();
      K.addLog(logBody, `cut wire: ${st.dropped} dropped · clogged pipe: ${st.held.length} parked — press Release`, 'hl');

      setPhase(-1);
      setLock(false);
    }

    // ③ Release the clogged pipe: the whole VecDeque bursts out in FIFO order, all at once.
    async function release() {
      if (st.busy || !st.held.length) return;
      setLock(true);
      setPhase(2);
      E('fault', 1).setAttribute('opacity', 0);
      const queue = st.held.slice();
      st.held = [];
      st.verdict[1] = '';
      render();
      K.addLog(logBody, `── ③ release: ${queue.length} parked packets burst out (FIFO order) ──`, 'hl');

      const midY = laneY(1) + LANE.h / 2;
      // launch them together so it reads as a BURST, not a trickle
      await Promise.all(queue.map((p, idx) => burstOne(p, idx, midY)));
      st.verdict[1] = '✓ BURST through';
      render();
      K.addLog(logBody, `delivered ${queue.length} at once — order ${queue.map((p) => 's' + p.seq).join(' ')} preserved`, 'ok');

      setPhase(-1);
      setLock(false);
    }

    function burstOne(p, idx, midY) {
      const startX = FAULT_X + 22 + idx * 26;
      const dot = K.el('circle', { cx: startX, cy: midY, r: 9, fill: c.amber, filter: K.glow(uid) }, anim);
      return animate(dot, { cx: RX, duration: 360, ease: 'out(2)' }).then(() => {
        dot.setAttribute('fill', c.green);
        flash(E('rcv', 1));
        st.delivered++;
        render();
        return animate(dot, { r: [9, 15], opacity: [1, 0], duration: 150, ease: 'out(2)' });
      }).then(() => dot.remove());
    }

    // a single message flying from a lane's sender to an x-position on the wire
    function flyTo(lane, tx, color, _label) {
      const midY = laneY(lane) + LANE.h / 2;
      const dot = K.el('circle', { cx: wireL, cy: midY, r: 7, fill: color, filter: K.glow(uid),
        class: 'ph-fly' }, anim);
      return animate(dot, { cx: tx, duration: 300, ease: 'inOutQuad' }).then(() => dot.remove());
    }

    // place a persistent staged message dot at (tx, lane midline), tagged for later resolution
    function markStaged(lane, seq, tx) {
      const midY = laneY(lane) + LANE.h / 2;
      const g = K.el('g', { class: 'ph-msg' }, anim);
      g.dataset.lane = String(lane);
      g.dataset.seq = String(seq);
      K.el('circle', { cx: tx, cy: midY, r: 7, fill: c.blue, filter: K.glow(uid) }, g);
    }

    function flash(box) {
      if (box) animate(box, { opacity: [1, 0.4, 1], duration: 280, ease: 'inOut(2)' });
    }
    function flashFault(i) {
      const f = E('fault', i);
      if (f) animate(f, { opacity: [1, 0.45, 1], duration: 220, ease: 'inOut(2)' });
    }

    // ---- bind ----------------------------------------------------------------

    function bind() {
      root.querySelector('.t-send').onclick    = () => sendBatch();
      root.querySelector('.t-release').onclick = () => release();
      root.querySelector('.t-reset').onclick   = () => {
        if (st.busy) return;
        st.phase = -1; st.held = []; st.dropped = 0; st.delivered = 0; st.seq = 0; st.verdict = ['', ''];
        [...anim.querySelectorAll('.ph-chip,.ph-msg,.ph-fly')].forEach((x) => x.remove());
        anim.innerHTML = '';
        E('fault', 0).setAttribute('opacity', 0);
        E('fault', 1).setAttribute('opacity', 0);
        E('wire', 0).setAttribute('opacity', 1);
        setPhase(-1);
        render();
        K.addLog(logBody, '↺ reset — both links healthy again', 'hl');
      };
    }

    function setLock(b) {
      st.busy = b;
      K.lock(root, ['.t-send', '.t-release', '.t-reset'], b);
      // release only makes sense once packets are parked
      const rel = root.querySelector('.t-release');
      if (rel && !b) rel.disabled = st.held.length === 0;
    }

    // theme observer
    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTPartitionHold = { init };
})();
