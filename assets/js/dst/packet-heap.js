/**
 * DST In-Flight Packet Heap (re-skinned via dst-kit) — earliest-deadline-first delivery.
 *
 * The network backplane is a BinaryHeap<Reverse<ScheduledPacket>> ordered by (deliver_at, seq):
 * the earliest deadline is always delivered first, and a monotonically increasing seq breaks ties
 * so equal-deadline packets keep deterministic FIFO order. Send injects a packet with a seeded
 * latency; "Send 2 @ same tick" shows the seq tie-break; Step advances now and pops everything
 * due via a scan-bar animation then flies a particle to the target node.
 *
 * Exposes window.DSTPacketHeap.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('packet-heap: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('packet-heap: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 320, TICK = 10, NODES = 3;
  // Node dots across top
  const NODE = { y: 44, r: 16, xs: [110, 310, 510] };
  // Heap column on the right
  const HEAP = { x: 470, y: 90, w: 268, rowH: 30, max: 7 };
  // 'now' readout position (left side)
  const NOW = { x: 190, y: 140 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      seed: 42, rng: K.rng(42), now: 0, seq: 0,
      heap: [], busy: false, playing: false, speed: 1,
    };
    let svg, content, anim, logBody, c;
    const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);
    const dur = (ms) => ms / st.speed;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <span class="dstk-tlabel">packet</span>
        <button class="dstk-btn dstk-btn--blue t-send">&#43; Send</button>
        <button class="dstk-btn dstk-btn--blue t-tie">Send 2 @ same tick</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">&#9197; Step +${TICK}ms</button>
        <button class="dstk-btn dstk-btn--green t-play">&#9654; Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>&#9208;</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">&#8634;</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5&#215;</option><option value="1" selected>1&#215;</option><option value="2">2&#215;</option></select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'In-flight packet heap', sub: 'earliest-deadline-first',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [
          { id: 'now', label: 'now (ms)' },
          { id: 'inflight', label: 'in-flight' },
          { id: 'seq', label: 'seq' },
        ],
        cap: K.highlightRust(
          '// BinaryHeap<Reverse<ScheduledPacket>> ordered by (deliver_at, seq)\n' +
          '// deliver_due_packets(now): pop while heap.peek().deliver_at <= now\n' +
          'let pkt = ScheduledPacket { seq, from, to, deliver_at: now + latency };\n' +
          'heap.push(Reverse(pkt)); // seeded latency ⇒ deterministic order'
        ),
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
    }

    function drawScene() {
      content.innerHTML = '';

      // --- node dots (purple) across the top ---
      for (let i = 0; i < NODES; i++) {
        const cx = NODE.xs[i];
        // glow ring behind node
        K.el('circle', { cx, cy: NODE.y, r: NODE.r + 4, fill: K.grad(uid, 'purple'), opacity: 0.5 }, content);
        K.el('circle', { id: nid(i), cx, cy: NODE.y, r: NODE.r, fill: K.grad(uid, 'purple'),
          stroke: c.purple, 'stroke-width': 2 }, content);
        K.el('text', { x: cx, y: NODE.y + 4, 'text-anchor': 'middle', fill: c.text,
          'font-size': 11, 'font-weight': 700 }, content).textContent = 'n' + i;
        // connector line stub pointing down toward heap area
        K.el('line', { x1: cx, y1: NODE.y + NODE.r + 2, x2: cx, y2: NODE.y + NODE.r + 18,
          stroke: c.purple, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.4 }, content);
      }

      // --- arrow from heap top down to node area (delivery direction indicator) ---
      // horizontal guide line from now-clock area to heap
      K.el('line', { x1: NOW.x + 60, y1: NOW.y - 8, x2: HEAP.x - 8, y2: NOW.y - 8,
        stroke: c.separator, 'stroke-width': 1, 'stroke-dasharray': '4 4' }, content);

      // --- 'now' readout box (amber) ---
      K.el('rect', { x: NOW.x - 58, y: NOW.y - 34, width: 116, height: 56, rx: 8,
        fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.5 }, content);
      K.el('text', { x: NOW.x, y: NOW.y - 18, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 9, 'font-weight': 600, 'letter-spacing': '0.05em' }, content).textContent = 'DRIVER CLOCK';
      K.el('text', { id: uid + '-now-lbl', x: NOW.x, y: NOW.y + 8, 'text-anchor': 'middle',
        fill: c.amber, 'font-size': 20, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums',
        filter: K.glow(uid) }, content).textContent = 'now = 0 ms';

      // condition label below clock
      K.el('text', { x: NOW.x, y: NOW.y + 38, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 9 }, content).textContent = 'deliver when now ≥ deliver_at';

      // --- heap column header ---
      K.el('text', { x: HEAP.x, y: HEAP.y - 20, fill: c.blue,
        'font-size': 12, 'font-weight': 700 }, content).textContent = 'BinaryHeap<Reverse<ScheduledPacket>>';
      K.el('text', { x: HEAP.x, y: HEAP.y - 6, fill: c.muted, 'font-size': 9 }, content)
        .textContent = 'ordered by (deliver_at, seq)  —  top = earliest';

      // arrow marker from heap top toward node area (right-to-left delivery)
      K.el('line', { x1: HEAP.x - 8, y1: slotY(0) + 12, x2: NODE.xs[2] + NODE.r + 2, y2: slotY(0) + 12,
        stroke: c.blue, 'stroke-width': 1.2, opacity: 0.25,
        'marker-end': K.arrow(uid, 'blue') }, content);
    }

    function nid(i) { return `${uid}-node-${i}`; }
    function slotY(i) { return HEAP.y + 14 + i * HEAP.rowH; }

    function render() {
      // stat cards
      stat('now', st.now + ' ms');
      stat('inflight', st.heap.length);
      stat('seq', st.seq);

      // now label in SVG
      const nowLbl = svg.querySelector('#' + CSS.escape(uid + '-now-lbl'));
      if (nowLbl) nowLbl.textContent = 'now = ' + st.now + ' ms';

      // heap rows — rebuild sub-group each frame
      let hg = svg.querySelector('#' + CSS.escape(uid + '-heap'));
      if (hg) hg.remove();
      hg = K.el('g', { id: uid + '-heap' }, content);

      const sorted = [...st.heap].sort(cmp);
      if (!sorted.length) {
        K.el('text', { x: HEAP.x + 8, y: slotY(0) + 14, fill: c.muted,
          'font-size': 10, 'font-style': 'italic' }, hg).textContent = '(empty — no packets in flight)';
        return;
      }
      sorted.slice(0, HEAP.max).forEach((p, idx) => {
        const y = slotY(idx), top = idx === 0, due = p.deliverAt <= st.now;
        K.el('rect', { x: HEAP.x, y, width: HEAP.w, height: HEAP.rowH - 5, rx: 6,
          fill: K.grad(uid, 'blue'),
          stroke: top ? c.amber : c.blue,
          'stroke-width': top ? 2.2 : 1 }, hg);
        K.el('text', { x: HEAP.x + 9, y: y + 16, fill: due ? c.green : c.text,
          'font-size': 11, 'font-variant-numeric': 'tabular-nums' }, hg)
          .textContent = `s${p.seq}  deliver_at=${p.deliverAt}ms  n${p.from}→n${p.to}` + (due ? '  ✓ due' : '');
      });
      if (sorted.length > HEAP.max) {
        K.el('text', { x: HEAP.x, y: slotY(HEAP.max) + 12, fill: c.muted, 'font-size': 9 }, hg)
          .textContent = `+${sorted.length - HEAP.max} more…`;
      }
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // --- packet insertion with fly animation ---
    function pushPacket(from, to, lat) {
      const pkt = { seq: ++st.seq, from, to, deliverAt: st.now + lat };
      st.heap.push(pkt);
      K.addLog(logBody, `push seq=${pkt.seq} n${from}→n${to} deliver_at=${pkt.deliverAt}ms`, 'hl');
      render();
      // fly from source node down to heap top slot
      const dot = K.el('circle', { cx: NODE.xs[from], cy: NODE.y + NODE.r, r: 6,
        fill: c.blue, filter: K.glow(uid) }, anim);
      animate(dot, { cx: HEAP.x + 12, cy: slotY(0) + 12, duration: dur(340), ease: 'inOutQuad',
        onComplete: () => dot.remove() });
      return pkt;
    }

    async function send() {
      if (st.busy) return; st.busy = true; setLock(true);
      const from = Math.floor(st.rng() * NODES);
      let to = Math.floor(st.rng() * (NODES - 1)); if (to >= from) to++;
      pushPacket(from, to, 20 + Math.floor(st.rng() * 90));
      await K.delay(dur(240)); st.busy = false; setLock(false);
    }

    async function sendTie() {
      if (st.busy) return; st.busy = true; setLock(true);
      const lat = 30 + Math.floor(st.rng() * 60);
      const a = pushPacket(0, 1, lat);
      const b = pushPacket(0, 2, lat);
      K.addLog(logBody,
        `same deliver_at=${a.deliverAt}ms — seq breaks tie: s${a.seq} before s${b.seq}`, 'warn');
      await K.delay(dur(300)); st.busy = false; setLock(false);
    }

    async function stepOnce() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.now += TICK; render();
      K.addLog(logBody, `tick → now = ${st.now}ms`, '');

      const due = [...st.heap].filter((p) => p.deliverAt <= st.now).sort(cmp);
      for (const p of due) {
        // scan-bar pulses over the top slot
        const bar = K.el('rect', { x: HEAP.x - 4, y: slotY(0) - 2, width: HEAP.w + 8,
          height: HEAP.rowH - 1, rx: 7, fill: 'none',
          stroke: c.amber, 'stroke-width': 2.5, opacity: 0 }, anim);
        await animate(bar, { opacity: [0, 1, 0], duration: dur(280), ease: 'inOut(2)' });
        bar.remove();

        // particle flies from heap top to target node
        const dot = K.el('circle', { cx: HEAP.x + 12, cy: slotY(0) + 12, r: 7,
          fill: c.green, filter: K.glow(uid) }, anim);
        st.heap = st.heap.filter((q) => q.seq !== p.seq);
        // flash destination node
        const nodeEl = svg.querySelector('#' + CSS.escape(nid(p.to)));
        if (nodeEl) flash(nodeEl);
        await animate(dot, { cx: NODE.xs[p.to], cy: NODE.y, duration: dur(420), ease: 'inOutQuad' });
        await animate(dot, { r: [7, 14], opacity: [1, 0], duration: dur(150), ease: 'out(2)',
          onComplete: () => dot.remove() });
        K.addLog(logBody, `pop seq=${p.seq} → delivered n${p.from}→n${p.to}`, 'ok');
        render();
      }
      if (!due.length) K.addLog(logBody, 'no packets due yet', '');
      await K.delay(dur(100)); st.busy = false; setLock(false);
    }

    function flash(nodeEl) {
      animate(nodeEl, { opacity: [1, 0.3, 1], duration: dur(300), ease: 'inOut(2)' });
    }

    function bind() {
      root.querySelector('.t-send').onclick = send;
      root.querySelector('.t-tie').onclick = sendTie;
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 42; reset(); };
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        if (st.heap.length < 3 && st.rng() < 0.8) await send();
        await stepOnce();
        if (!st.playing) break;
        await K.delay(dur(280));
      }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      st.now = 0; st.seq = 0; st.heap = []; st.rng = K.rng(st.seed >>> 0); st.busy = false;
      setLock(false); drawScene(); render();
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · same seed ⇒ same run', 'hl');
    }
    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-send', '.t-tie', '.t-step', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    K.addLog(logBody, '🌱 heap empty — Send a packet to begin', 'hl');

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTPacketHeap = { init };
})();
