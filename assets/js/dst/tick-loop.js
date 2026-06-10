/**
 * DST Tick-Loop (re-skinned via dst-kit) — one discrete heartbeat of the simulation.
 * deliver_due_packets(now) drains the (deliver_at, seq) min-heap into node inboxes → tick each
 * node's paused clock by one tick_duration → advance global elapsed. Seeded ⇒ same seed, same run.
 * Exposes window.DSTTickLoop.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('tick-loop: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('tick-loop: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 230, NODES = 3, TICK = 10;
  const NODE = { y: 26, w: 168, h: 118, gap: 24, x0: 18 };
  const HEAP = { x: 590, y: 30, w: 176, rowH: 26, max: 6 };
  const nx = (i) => NODE.x0 + i * (NODE.w + NODE.gap);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      seed: 42, rng: K.rng(42), now: 0, step: 0, seq: 0,
      nodes: Array.from({ length: NODES }, () => ({ clock: 0, inbox: 0 })),
      heap: [], playing: false, busy: false, speed: 1,
    };
    let svg, content, anim, logBody, c;
    const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);
    const dur = (ms) => ms / st.speed;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));
    const slotY = (i) => HEAP.y + 8 + i * HEAP.rowH;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span><input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'The tick loop', sub: 'one discrete heartbeat',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'now', label: 'sim time' }, { id: 'step', label: 'step' }, { id: 'inflight', label: 'in-flight' }],
        cap: 'One driver, one thread: deliver due packets → tick each paused node → advance time.',
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
      // heap frame label + delivery arrow hint
      K.el('text', { x: HEAP.x, y: HEAP.y - 12, fill: c.blue, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'in-flight heap';
      K.el('text', { x: HEAP.x, y: HEAP.y - 1, fill: c.muted, 'font-size': 9 }, content).textContent = 'min by (deliver_at, seq)';
      // nodes
      for (let i = 0; i < NODES; i++) {
        const x = nx(i);
        K.el('rect', { id: id('box', i), x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 10,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: NODE.y + 18, r: 4.5, fill: c.purple }, content);
        K.el('text', { x: x + 28, y: NODE.y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'n' + i;
        K.el('text', { x: x + NODE.w - 12, y: NODE.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content).textContent = i === 0 ? 'client' : 'host';
        K.el('text', { x: x + 14, y: NODE.y + 52, fill: c.muted, 'font-size': 10 }, content).textContent = 'paused clock';
        K.el('text', { id: id('clk', i), x: x + 14, y: NODE.y + 80, fill: c.purple, 'font-size': 22,
          'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
        K.el('text', { id: id('inb', i), x: x + 14, y: NODE.y + 103, fill: c.muted, 'font-size': 10 }, content).textContent = 'inbox 0';
      }
    }

    function render() {
      stat('now', st.now + ' ms'); stat('step', st.step); stat('inflight', st.heap.length);
      for (let i = 0; i < NODES; i++) { E('clk', i).textContent = st.nodes[i].clock + ' ms'; E('inb', i).textContent = 'inbox ' + st.nodes[i].inbox; }
      // heap rows live in content under a known group: rebuild a sub-group
      let g = svg.querySelector('#' + CSS.escape(uid + '-heap')); if (g) g.remove();
      g = K.el('g', { id: uid + '-heap' }, content);
      const sorted = [...st.heap].sort(cmp);
      if (!sorted.length) K.el('text', { x: HEAP.x + 4, y: slotY(0) + 14, fill: c.muted, 'font-size': 10, 'font-style': 'italic' }, g).textContent = '(empty)';
      sorted.slice(0, HEAP.max).forEach((p, idx) => {
        const y = slotY(idx), top = idx === 0;
        K.el('rect', { x: HEAP.x, y, width: HEAP.w, height: HEAP.rowH - 5, rx: 5, fill: K.grad(uid, 'blue'),
          stroke: top ? c.amber : c.blue, 'stroke-width': top ? 2 : 1 }, g);
        K.el('text', { x: HEAP.x + 8, y: y + 14, fill: c.text, 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums' }, g)
          .textContent = `s${p.seq} @${p.deliverAt} n${p.from}→n${p.to}`;
      });
      if (sorted.length > HEAP.max) K.el('text', { x: HEAP.x, y: slotY(HEAP.max) + 12, fill: c.muted, 'font-size': 9 }, g).textContent = `+${sorted.length - HEAP.max} more`;
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    async function stepOnce() {
      if (st.busy) return; st.busy = true; setLock(true);
      const now = st.now;
      for (const p of [...st.heap].filter((q) => q.deliverAt <= now).sort(cmp)) {
        await fly(HEAP.x + 10, slotY(0) + 9, nx(p.to) + NODE.w / 2, NODE.y, c.green);
        st.heap = st.heap.filter((q) => q.seq !== p.seq); st.nodes[p.to].inbox++;
        flash(E('box', p.to)); K.addLog(logBody, `delivered: seq=${p.seq} (n${p.from}→n${p.to})`, 'ok'); render();
      }
      for (let i = 0; i < NODES; i++) {
        await sweep(i);
        const from = st.nodes[i].clock; st.nodes[i].clock = from + TICK;
        await countUp(E('clk', i), from, st.nodes[i].clock);
        if (st.rng() < 0.45) {
          let to = Math.floor(st.rng() * (NODES - 1)); if (to >= i) to++;
          const pkt = { seq: ++st.seq, from: i, to, deliverAt: now + TICK + 20 + Math.floor(st.rng() * 90) };
          st.heap.push(pkt); K.addLog(logBody, `push seq=${pkt.seq} n${i}→n${to} @${pkt.deliverAt}`, 'hl'); render();
          await fly(nx(i) + NODE.w / 2, NODE.y + NODE.h, HEAP.x + 10, slotY(0) + 9, c.green, 260);
        }
      }
      st.now = now + TICK; st.step++; render();
      st.busy = false; setLock(false);
    }
    async function fly(sx, sy, tx, ty, color, d) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: dur(d || 360), ease: 'inOutQuad' });
      await animate(dot, { r: [6, 12], opacity: [1, 0], duration: dur(150), ease: 'out(2)' });
      dot.remove();
    }
    async function sweep(i) { const b = E('box', i); b.setAttribute('stroke', c.amber); await animate(b, { opacity: [1, 0.6, 1], duration: dur(150), ease: 'inOut(2)' }); b.setAttribute('stroke', c.purple); }
    function flash(b) { animate(b, { opacity: [1, 0.45, 1], duration: dur(260), ease: 'inOut(2)' }); }
    function countUp(t, a, b) { const p = { v: a }; return animate(p, { v: b, duration: dur(220), ease: 'out(2)', onUpdate: () => t.textContent = Math.round(p.v) + ' ms', onComplete: () => t.textContent = b + ' ms' }); }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 42; reset(); };
    }
    async function play() { if (st.playing) return; st.playing = true; pp(); while (st.playing) { await stepOnce(); if (!st.playing) break; await K.delay(dur(340)); } }
    function pause() { st.playing = false; pp(); }
    function reset() { st.playing = false; pp(); st.now = 0; st.step = 0; st.seq = 0; st.heap = []; st.rng = K.rng(st.seed >>> 0); st.nodes = Array.from({ length: NODES }, () => ({ clock: 0, inbox: 0 })); st.busy = false; setLock(false); drawScene(); render(); K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · same seed ⇒ same run', 'hl'); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    K.addLog(logBody, '🌱 ready — seed ' + st.seed + ' · same seed ⇒ same run', 'hl');
    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTickLoop = { init };
})();
