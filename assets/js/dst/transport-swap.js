/**
 * DST Transport Swap (re-skinned via dst-kit) — swap the seam, not the replica.
 *
 * The same TAPIR replica / ClusterBus code is generic over `impl Transport`. In prod the slot is
 * filled by tokio::net::UdpSocket over a chaotic wire (jittery, can reorder, can lose). In tests it
 * is filled by TurmoilTransport wrapping dst::UdpSocket on the driver-scheduled backplane
 * (ordered min-heap, partitionable). The replica is untouched; only the trait object behind the
 * seam changes. All randomness is seeded ⇒ same seed, same run. Partition (sim only) drops messages
 * between n0 and n2.
 *
 * Exposes window.DSTTransportSwap.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('transport-swap: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('transport-swap: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 320, NODES = 3;
  const REPLICA = { x: 250, y: 18, w: 280, h: 48 };
  const SLOT = { x: 300, y: 78, w: 180, h: 30 };
  const NODE = { y: 250, w: 150, h: 56, gap: 30, x0: 60 };
  const WIRE = { y: 168 };       // prod: chaotic horizontal wire
  const HEAP = { x: 596, y: 150, w: 168, rowH: 24, max: 5 };  // sim: ordered backplane heap
  const nx = (i) => NODE.x0 + i * (NODE.w + NODE.gap);
  const ncx = (i) => nx(i) + NODE.w / 2;

  const SNIPPET = `// the replica is generic over the seam — never edited
fn run_replica<T: Transport>(bus: ClusterBus<T>) { /* ... */ }

let bus = if cfg!(sim) {
    ClusterBus::new(TurmoilTransport::new())  // dst::UdpSocket
} else {
    ClusterBus::new(tokio::net::UdpSocket::bind(addr)?)
};`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const mk = () => ({ seed: 7, rng: K.rng(7), mode: 'sim', seq: 0, sent: 0, delivered: 0,
      dropped: 0, heap: [], partitioned: false, playing: false, busy: false, speed: 1 });
    const st = mk();
    const inbox = [0, 0, 0];
    let svg, content, anim, logBody, c;
    const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);
    const dur = (ms) => ms / st.speed;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));
    const slotY = (i) => HEAP.y + 10 + i * HEAP.rowH;
    const isCut = (a, b) => st.partitioned && ((a === 0 && b === 2) || (a === 2 && b === 0));
    // text helper: T(parent, x, y, fill, size, weight, anchor) -> sets .textContent on result
    const T = (p, x, y, fill, size, weight, anchor) => K.el('text', anchor
      ? { x, y, fill, 'font-size': size, 'font-weight': weight || 400, 'text-anchor': anchor }
      : { x, y, fill, 'font-size': size, 'font-weight': weight || 400 }, p);

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--green t-send">✉ Send</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">transport</span>
          <button class="dstk-btn dstk-btn--blue t-prod">prod: UdpSocket</button>
          <button class="dstk-btn dstk-btn--purple t-sim">sim: Turmoil</button></div>
        <span class="dstk-tdiv"></span>
        <button class="dstk-btn dstk-btn--red t-part">✂ Partition n0⇿n2</button>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span><input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Swapping the transport', sub: 'prod UDP vs simulated UdpSocket — same replica code',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'sent', label: 'sent' }, { id: 'deliv', label: 'delivered' }, { id: 'drop', label: 'dropped' }],
        cap: K.highlightRust(SNIPPET),
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 same replica, two transports — swap the trait object at the seam', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      const sim = st.mode === 'sim', tColor = sim ? c.purple : c.blue;

      // Replica / ClusterBus box (production code — never changes)
      K.el('rect', { x: REPLICA.x, y: REPLICA.y, width: REPLICA.w, height: REPLICA.h, rx: 9, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      T(content, REPLICA.x + REPLICA.w / 2, REPLICA.y + 20, c.text, 13, 700, 'middle').textContent = 'Replica / ClusterBus<T>';
      T(content, REPLICA.x + REPLICA.w / 2, REPLICA.y + 37, c.muted, 10, 400, 'middle').textContent = 'production code — untouched';

      // wire from box down into the seam slot
      K.el('line', { x1: REPLICA.x + REPLICA.w / 2, y1: REPLICA.y + REPLICA.h, x2: SLOT.x + SLOT.w / 2, y2: SLOT.y, stroke: c.separator, 'stroke-width': 1.4 }, content);

      // the seam: a bound slot "impl Transport" — only this changes between prod and sim
      K.el('rect', { x: SLOT.x, y: SLOT.y, width: SLOT.w, height: SLOT.h, rx: 7, fill: K.grad(uid, sim ? 'purple' : 'blue'), stroke: tColor, 'stroke-width': 1.8, 'stroke-dasharray': '5,3' }, content);
      T(content, SLOT.x + SLOT.w / 2, SLOT.y + 19, tColor, 11.5, 700, 'middle').textContent = sim ? 'impl Transport = Turmoil' : 'impl Transport = UdpSocket';
      T(content, W / 2, SLOT.y + SLOT.h + 22, c.muted, 10.5, 400, 'middle').textContent = sim
        ? 'TurmoilTransport → dst::UdpSocket · driver-scheduled · ordered · partitionable'
        : 'tokio::net::UdpSocket → real wire · jittery · can reorder · can lose';

      // backplane visual: prod = chaotic wire; sim = ordered heap
      if (sim) {
        T(content, HEAP.x, HEAP.y - 6, c.purple, 10.5, 700).textContent = 'backplane heap';
        T(content, HEAP.x, HEAP.y + 4, c.muted, 8.5).textContent = 'min by (deliver_at, seq)';
      } else {
        K.el('line', { x1: NODE.x0, y1: WIRE.y, x2: nx(NODES - 1) + NODE.w, y2: WIRE.y, stroke: c.blue, 'stroke-width': 2, 'stroke-dasharray': '2,5', opacity: 0.7 }, content);
        T(content, W / 2, WIRE.y - 8, c.blue, 10.5, 700, 'middle').textContent = 'chaotic wire — no ordering guarantees';
      }

      // nodes — the same replicas regardless of transport
      for (let i = 0; i < NODES; i++) {
        const x = nx(i);
        K.el('rect', { id: id('box', i), x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 9, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: NODE.y + 18, r: 4.5, fill: c.green }, content);
        T(content, x + 28, NODE.y + 22, c.text, 13, 700).textContent = 'n' + i;
        T(content, x + NODE.w - 12, NODE.y + 22, c.muted, 9, 400, 'end').textContent = i === 0 ? 'client' : 'replica';
        const inb = T(content, x + 14, NODE.y + 44, c.muted, 10);
        inb.setAttribute('id', id('inb', i)); inb.textContent = 'inbox ' + inbox[i];
      }
    }

    function render() {
      stat('sent', st.sent); stat('deliv', st.delivered); stat('drop', st.dropped);
      // partition marker between n0 and n2 (sim only)
      let cut = svg.querySelector('#' + CSS.escape(uid + '-cut')); if (cut) cut.remove();
      if (st.partitioned && st.mode === 'sim') {
        cut = K.el('g', { id: uid + '-cut' }, content);
        const mx = (ncx(0) + ncx(2)) / 2;
        K.el('line', { x1: mx, y1: NODE.y - 14, x2: mx, y2: NODE.y + NODE.h + 6, stroke: c.red, 'stroke-width': 2.4, 'stroke-dasharray': '4,4' }, cut);
        T(cut, mx, NODE.y - 18, c.red, 9.5, 700, 'middle').textContent = '✂ n0⇿n2 cut';
      }
      // heap rows (sim only)
      let g = svg.querySelector('#' + CSS.escape(uid + '-heap')); if (g) g.remove();
      if (st.mode === 'sim') {
        g = K.el('g', { id: uid + '-heap' }, content);
        const sorted = st.heap.slice().sort(cmp);
        if (!sorted.length) K.el('text', { x: HEAP.x + 4, y: slotY(0) + 13, fill: c.muted, 'font-size': 9.5, 'font-style': 'italic' }, g).textContent = '(empty)';
        sorted.slice(0, HEAP.max).forEach((p, idx) => {
          const y = slotY(idx), top = idx === 0;
          K.el('rect', { x: HEAP.x, y, width: HEAP.w, height: HEAP.rowH - 5, rx: 5, fill: K.grad(uid, 'blue'), stroke: top ? c.amber : c.blue, 'stroke-width': top ? 2 : 1 }, g);
          K.el('text', { x: HEAP.x + 7, y: y + 13, fill: c.text, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, g).textContent = `s${p.seq} @${p.deliverAt} n${p.from}→n${p.to}`;
        });
        if (sorted.length > HEAP.max) T(g, HEAP.x, slotY(HEAP.max) + 11, c.muted, 9).textContent = `+${sorted.length - HEAP.max} more`;
      }
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function pickRoute() {
      const from = Math.floor(st.rng() * NODES);
      let to = Math.floor(st.rng() * (NODES - 1)); if (to >= from) to++;
      return { from, to };
    }

    // PROD: each Send fires messages straight across the chaotic wire — jittery arrival, can reorder,
    // can be lost. Pure visual chaos seeded by rng; nothing is queued in an ordered structure.
    async function sendProd() {
      const burst = 2 + Math.floor(st.rng() * 2);
      const flights = [];
      for (let k = 0; k < burst; k++) {
        const { from, to } = pickRoute();
        st.seq++; st.sent++; const seq = st.seq;
        const lost = st.rng() < 0.22;            // the wire can drop
        const jitter = dur(360 + st.rng() * 520); // reorder via variable latency
        K.addLog(logBody, `udp send seq=${seq} n${from}→n${to}`, 'hl');
        flights.push(flyWire(from, to, seq, lost, jitter));
      }
      render();
      await Promise.all(flights);
    }
    async function flyWire(from, to, seq, lost, d) {
      const sx = ncx(from), tx = ncx(to);
      const dot = K.el('circle', { cx: sx, cy: NODE.y, r: 6, fill: lost ? c.red : c.blue,
        filter: K.glow(uid) }, anim);
      // arc up to the chaotic wire, drift, then down to target (or vanish mid-wire if lost)
      const midX = lost ? (sx + tx) / 2 : tx;
      await animate(dot, { cx: [sx, (sx + tx) / 2, midX], cy: [NODE.y, WIRE.y, lost ? WIRE.y : NODE.y],
        duration: d, ease: 'inOut(2)' });
      if (lost) {
        await animate(dot, { r: [6, 11], opacity: [1, 0], duration: dur(180), ease: 'out(2)' });
        st.dropped++; K.addLog(logBody, `LOST on wire: seq=${seq} (udp gives no guarantee)`, 'err');
      } else {
        st.delivered++; bumpInbox(to);
        flash(E('box', to)); K.addLog(logBody, `arrived: seq=${seq} → n${to}`, 'ok');
      }
      render(); dot.remove();
    }

    // SIM: Send enqueues into the ordered backplane heap, then the driver drains it deterministically
    // (min by deliver_at, seq). Partitioned links are dropped at enqueue time.
    async function sendSim() {
      const burst = 2 + Math.floor(st.rng() * 2);
      for (let k = 0; k < burst; k++) {
        const { from, to } = pickRoute();
        st.seq++; st.sent++; const seq = st.seq;
        if (isCut(from, to)) {
          st.dropped++;
          K.addLog(logBody, `partition drops seq=${seq} (n${from}⇿n${to} cut)`, 'err');
          await flyToHeap(from, true);
          continue;
        }
        const deliverAt = 10 + Math.floor(st.rng() * 90);
        st.heap.push({ seq, from, to, deliverAt });
        K.addLog(logBody, `enqueue seq=${seq} n${from}→n${to} @${deliverAt}`, 'hl'); render();
        await flyToHeap(from, false);
      }
      await drain();
    }
    async function flyToHeap(from, dropped) {
      const dot = K.el('circle', { cx: ncx(from), cy: NODE.y, r: 6, fill: dropped ? c.red : c.purple,
        filter: K.glow(uid) }, anim);
      await animate(dot, { cx: HEAP.x + 12, cy: slotY(0) + 8, duration: dur(300), ease: 'inOutQuad' });
      if (dropped) await animate(dot, { r: [6, 11], opacity: [1, 0], duration: dur(160), ease: 'out(2)' });
      dot.remove();
    }
    async function drain() {
      // driver pops the heap in deterministic order
      while (st.heap.length) {
        st.heap.sort(cmp);
        const p = st.heap.shift(); render();
        const dot = K.el('circle', { cx: HEAP.x + 12, cy: slotY(0) + 8, r: 6, fill: c.green,
          filter: K.glow(uid) }, anim);
        await animate(dot, { cx: ncx(p.to), cy: NODE.y, duration: dur(320), ease: 'inOutQuad' });
        await animate(dot, { r: [6, 11], opacity: [1, 0], duration: dur(140), ease: 'out(2)' });
        dot.remove();
        st.delivered++; bumpInbox(p.to); flash(E('box', p.to));
        K.addLog(logBody, `driver delivers seq=${p.seq} → n${p.to} (ordered)`, 'ok'); render();
      }
    }

    function bumpInbox(i) { inbox[i]++; const e = E('inb', i); if (e) e.textContent = 'inbox ' + inbox[i]; }
    function flash(b) { if (b) animate(b, { opacity: [1, 0.45, 1], duration: dur(260), ease: 'inOut(2)' }); }

    async function send() {
      if (st.busy) return; st.busy = true; setLock(true);
      if (st.mode === 'sim') await sendSim(); else await sendProd();
      st.busy = false; setLock(false);
    }

    function setMode(mode) {
      if (st.busy || st.mode === mode) return;
      st.mode = mode; st.heap = [];
      if (mode === 'prod') st.partitioned = false; // a real wire can't be cleanly partitioned by the driver
      K.addLog(logBody, mode === 'sim'
        ? 'swap seam → TurmoilTransport (driver-scheduled, ordered, partitionable)'
        : 'swap seam → tokio::net::UdpSocket (real wire — replica code unchanged)', 'hl');
      drawScene(); render(); refreshButtons();
    }

    function bind() {
      root.querySelector('.t-send').onclick = () => { if (!st.busy) send(); };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-prod').onclick = () => setMode('prod');
      root.querySelector('.t-sim').onclick = () => setMode('sim');
      root.querySelector('.t-part').onclick = () => {
        if (st.busy || st.mode !== 'sim') return;
        st.partitioned = !st.partitioned;
        K.addLog(logBody, st.partitioned ? 'inject partition: n0⇿n2 link cut' : 'heal partition: n0⇿n2 reconnected',
          st.partitioned ? 'err' : 'ok');
        render(); refreshButtons();
      };
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 7; reset(); };
      refreshButtons();
    }
    function refreshButtons() {
      const prodB = root.querySelector('.t-prod'), simB = root.querySelector('.t-sim'),
        partB = root.querySelector('.t-part');
      if (prodB) prodB.className = 'dstk-btn t-prod ' + (st.mode === 'prod' ? 'dstk-btn--blue' : 'dstk-btn--ghost');
      if (simB) simB.className = 'dstk-btn t-sim ' + (st.mode === 'sim' ? 'dstk-btn--purple' : 'dstk-btn--ghost');
      if (partB) { partB.disabled = st.mode !== 'sim';
        partB.className = 'dstk-btn t-part ' + (st.partitioned ? 'dstk-btn--amber' : 'dstk-btn--red'); }
    }

    function reset() {
      const mode = st.mode, speed = st.speed;
      st.rng = K.rng(st.seed >>> 0); st.seq = 0; st.sent = 0; st.delivered = 0; st.dropped = 0;
      st.heap = []; st.partitioned = false; st.busy = false; st.mode = mode; st.speed = speed;
      inbox[0] = inbox[1] = inbox[2] = 0;
      setLock(false); drawScene(); render(); refreshButtons();
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · same seed ⇒ same run', 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-send', '.t-reset', '.t-prod', '.t-sim', '.t-part', '.t-seed'], b);
      if (!b) refreshButtons(); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTransportSwap = { init };
})();
