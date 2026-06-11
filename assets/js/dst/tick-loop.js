/**
 * DST Tick-Loop (re-skinned via dst-kit) — one discrete heartbeat of the simulation.
 *
 * The whole simulator is ONE driver on ONE thread doing the same three things, in order, every tick
 * — and nothing happens in between. A Step walks the three phases out loud:
 *   ① deliver due — every in-flight packet whose deliver_at ≤ now flies from the heap into its inbox;
 *   ② run nodes   — each node gets one turn; a node may send, which pushes a future packet to the heap;
 *   ③ advance     — the single sim clock moves forward by one tick_duration.
 * Packets live in a min-heap ordered by (deliver_at, seq); a packet already due (≤ now) is badged so
 * it's clearly "waiting for the next tick's ① deliver", not stuck. Seeded ⇒ same seed, same run.
 * Exposes window.DSTTickLoop.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('tick-loop: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('tick-loop: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 198, NODES = 3, TICK = 10;
  const PHASES = [
    { t: '① deliver due', zone: 'green' },
    { t: '② run nodes', zone: 'purple' },
    { t: '③ advance clock', zone: 'amber' },
  ];
  const PILL = { y: 16, h: 28, w: 170, gap: 12, x0: 18 };
  const pillX = (i) => PILL.x0 + i * (PILL.w + PILL.gap);
  const NODE = { y: 64, w: 168, h: 104, gap: 22, x0: 18 };
  const nx = (i) => NODE.x0 + i * (NODE.w + NODE.gap);
  const HEAP = { x: 586, y: 46, w: 178, rowH: 23, max: 6 };
  const slotY = (i) => HEAP.y + i * HEAP.rowH;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const mk = () => Array.from({ length: NODES }, () => ({ inbox: 0 }));
    const st = { seed: 42, rng: K.rng(42), now: 0, step: 0, seq: 0, nodes: mk(), heap: [], playing: false, busy: false, speed: 1 };
    let svg, content, anim, logBody, c;
    const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);
    const dur = (ms) => ms / st.speed;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));

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
        title: 'The tick loop — one Step does three things, then stops', sub: 'deliver due · run nodes · advance the clock',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'now', label: 'sim time' }, { id: 'step', label: 'step' }, { id: 'inflight', label: 'in-flight' }],
        cap: 'One driver, one thread. Every tick: ① deliver due packets → ② give each node a turn → '
           + '③ advance the clock. Nothing runs in between — press Step and watch.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render(); setPhase(-1);
      K.addLog(logBody, '🌱 paused — nothing runs until you Step (seed ' + st.seed + ')', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // phase pills
      PHASES.forEach((p, i) => {
        K.el('rect', { id: id('pill', i), x: pillX(i), y: PILL.y, width: PILL.w, height: PILL.h, rx: 8,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: id('pilltext', i), x: pillX(i) + PILL.w / 2, y: PILL.y + PILL.h / 2 + 4, 'text-anchor': 'middle',
          fill: c.muted, 'font-size': 12, 'font-weight': 700 }, content).textContent = p.t;
        if (i < PHASES.length - 1) K.el('text', { x: pillX(i) + PILL.w + PILL.gap / 2, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 12 }, content).textContent = '→';
      });

      // node cards — show the INBOX (the number that actually varies), not a redundant clock
      for (let i = 0; i < NODES; i++) {
        const x = nx(i);
        K.el('rect', { id: id('box', i), x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 10,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: NODE.y + 20, r: 4.5, fill: c.purple }, content);
        K.el('text', { x: x + 28, y: NODE.y + 24, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'n' + i;
        K.el('text', { x: x + NODE.w - 12, y: NODE.y + 24, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content).textContent = i === 0 ? 'client' : 'host';
        K.el('text', { x: x + 14, y: NODE.y + 48, fill: c.muted, 'font-size': 10 }, content).textContent = 'inbox · messages in';
        K.el('text', { id: id('inb', i), x: x + 14, y: NODE.y + 82, fill: c.purple, 'font-size': 30,
          'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0';
        K.el('text', { id: id('ran', i), x: x + NODE.w - 12, y: NODE.y + 82, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5 }, content).textContent = 'idle';
      }

      // in-flight heap (right column)
      K.el('text', { x: HEAP.x, y: PILL.y + 10, fill: c.blue, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'in-flight heap';
      K.el('text', { x: HEAP.x, y: PILL.y + 22, fill: c.muted, 'font-size': 9 }, content).textContent = 'min by (deliver_at, seq)';
      K.el('g', { id: uid + '-heap' }, content);
    }

    function setPhase(k) {
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

    function render() {
      stat('now', st.now + ' ms'); stat('step', st.step); stat('inflight', st.heap.length);
      for (let i = 0; i < NODES; i++) E('inb', i).textContent = st.nodes[i].inbox;
      let g = svg.querySelector('#' + CSS.escape(uid + '-heap')); if (g) g.remove();
      g = K.el('g', { id: uid + '-heap' }, content);
      const sorted = [...st.heap].sort(cmp);
      if (!sorted.length) { K.el('text', { x: HEAP.x + 4, y: slotY(0) + 14, fill: c.muted, 'font-size': 10, 'font-style': 'italic' }, g).textContent = '(empty — no packets in flight)'; return; }
      sorted.slice(0, HEAP.max).forEach((p, idx) => {
        const y = slotY(idx), due = p.deliverAt <= st.now;
        K.el('rect', { x: HEAP.x, y, width: HEAP.w, height: HEAP.rowH - 5, rx: 5, fill: K.grad(uid, due ? 'amber' : 'blue'),
          stroke: due ? c.amber : c.blue, 'stroke-width': due ? 2 : 1 }, g);
        K.el('text', { x: HEAP.x + 8, y: y + 13, fill: c.text, 'font-size': 10, 'font-variant-numeric': 'tabular-nums' }, g)
          .textContent = `s${p.seq} @${p.deliverAt} n${p.from}→n${p.to}`;
        K.el('text', { x: HEAP.x + HEAP.w - 8, y: y + 13, 'text-anchor': 'end', fill: due ? c.amber : c.muted, 'font-size': 8.5, 'font-weight': due ? 700 : 400 }, g)
          .textContent = due ? 'due ▸' : '+' + (p.deliverAt - st.now) + 'ms';
      });
      if (sorted.length > HEAP.max) K.el('text', { x: HEAP.x, y: slotY(HEAP.max) + 12, fill: c.muted, 'font-size': 9 }, g).textContent = `+${sorted.length - HEAP.max} more`;
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    async function stepOnce() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.step++;
      K.addLog(logBody, `── tick ${st.step} · now ${st.now} ms ──`, 'hl');

      // ① DELIVER DUE — every packet with deliver_at ≤ now flies into its inbox and leaves the heap.
      setPhase(0);
      const due = [...st.heap].filter((q) => q.deliverAt <= st.now).sort(cmp);
      if (!due.length) K.addLog(logBody, '① deliver due — nothing due yet', null);
      for (const p of due) {
        await fly(HEAP.x + 12, slotY(0) + 9, nx(p.to) + NODE.w / 2, NODE.y + NODE.h / 2, c.green);
        st.heap = st.heap.filter((q) => q.seq !== p.seq); st.nodes[p.to].inbox++;
        flash(E('box', p.to), c.green); E('inb', p.to).textContent = st.nodes[p.to].inbox;
        K.addLog(logBody, `① deliver s${p.seq} → n${p.to} (was due @${p.deliverAt})`, 'ok'); render();
      }

      // ② RUN NODES — each node gets one turn; a node may send, pushing a FUTURE packet to the heap.
      setPhase(1);
      for (let i = 0; i < NODES; i++) {
        await runNode(i);
        if (st.rng() < 0.32) {
          let to = Math.floor(st.rng() * (NODES - 1)); if (to >= i) to++;
          const pkt = { seq: ++st.seq, from: i, to, deliverAt: st.now + TICK * (2 + Math.floor(st.rng() * 4)) }; // 2–5 ticks out
          st.heap.push(pkt); render();
          K.addLog(logBody, `② n${i} sends → s${pkt.seq} n${i}→n${to}, deliver_at ${pkt.deliverAt}`, 'hl');
          await fly(nx(i) + NODE.w / 2, NODE.y + NODE.h / 2, HEAP.x + 12, slotY(0) + 9, c.blue, 280);
        }
      }

      // ③ ADVANCE — the single sim clock moves forward by one tick.
      setPhase(2);
      const from = st.now; st.now += TICK;
      await countUpStat('now', from, st.now);
      K.addLog(logBody, `③ advance clock → now ${st.now} ms`, 'warn');
      render();
      for (let i = 0; i < NODES; i++) E('ran', i).textContent = 'idle';
      setPhase(-1);
      st.busy = false; setLock(false);
    }

    async function fly(sx, sy, tx, ty, color, d) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: dur(d || 360), ease: 'inOutQuad' });
      await animate(dot, { r: [6, 12], opacity: [1, 0], duration: dur(150), ease: 'out(2)' });
      dot.remove();
    }
    async function runNode(i) {
      const b = E('box', i), ran = E('ran', i);
      ran.textContent = 'running…'; ran.setAttribute('fill', c.amber);
      b.setAttribute('stroke', c.amber);
      await animate(b, { opacity: [1, 0.6, 1], duration: dur(150), ease: 'inOut(2)' });
      b.setAttribute('stroke', c.purple);
      ran.textContent = '✓ ran'; ran.setAttribute('fill', c.green);
    }
    function flash(b, col) { if (!b) return; animate(b, { opacity: [1, 0.45, 1], duration: dur(260), ease: 'inOut(2)' }); }
    function countUpStat(k, a, b) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (!e) return Promise.resolve();
      const p = { v: a };
      return animate(p, { v: b, duration: dur(220), ease: 'out(2)', onUpdate: () => e.textContent = Math.round(p.v) + ' ms', onComplete: () => e.textContent = b + ' ms' });
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 42; reset(); };
    }
    async function play() { if (st.playing) return; st.playing = true; pp(); while (st.playing) { await stepOnce(); if (!st.playing) break; await K.delay(dur(420)); } }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp(); st.now = 0; st.step = 0; st.seq = 0; st.heap = []; st.rng = K.rng(st.seed >>> 0);
      st.nodes = mk(); st.busy = false; setLock(false); drawScene(); render(); setPhase(-1);
      // a couple of packets already in flight so the first ① has something to deliver soon
      for (let k = 0; k < 2; k++) { const f = Math.floor(st.rng() * NODES); let t = Math.floor(st.rng() * (NODES - 1)); if (t >= f) t++; st.heap.push({ seq: ++st.seq, from: f, to: t, deliverAt: k === 0 ? 0 : TICK * (1 + Math.floor(st.rng() * 3)) }); }
      render();
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · same seed ⇒ same run', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    // seed a little initial traffic so step 1 isn't empty
    for (let k = 0; k < 2; k++) { const f = Math.floor(st.rng() * NODES); let t = Math.floor(st.rng() * (NODES - 1)); if (t >= f) t++; st.heap.push({ seq: ++st.seq, from: f, to: t, deliverAt: k === 0 ? 0 : TICK * (1 + Math.floor(st.rng() * 3)) }); }
    render();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTickLoop = { init };
})();
