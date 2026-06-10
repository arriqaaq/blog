/**
 * DST Sim-Cluster (re-skinned via dst-kit) — whole system, one process.
 *
 * The entire distributed system lives inside ONE OS process: three nodes, a network
 * backplane, a single driver/clock, and a seed→RNG, all enclosed in one rounded process
 * boundary. In Real mode each packet arrives at a jittery wall-clock time, the delivery
 * order shuffles every run, and two runs diverge to different fingerprints. In Simulated
 * mode the single driver steps everything from the sim clock and seeded RNG, so two runs
 * with the same seed replay the identical event order and the same fingerprint.
 *
 * Exposes window.DSTSimCluster.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('sim-cluster: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('sim-cluster: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 300, NODES = 3, TICK = 10, MAXSTEP = 6;
  const PROC = { x: 16, y: 18, w: W - 32, h: Hh - 36, rx: 16 };
  const NODE = { y: 64, w: 150, h: 78, gap: 22, x0: 40 };
  const nx = (i) => NODE.x0 + i * (NODE.w + NODE.gap);
  const NET = { x: 40, y: 168, w: 3 * NODE.w + 2 * NODE.gap, h: 36 };
  const DRV = { x: 40, y: 222, w: 320, h: 50 };
  const RNGB = { x: 380, y: 222, w: 360, h: 50 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { sim: true, seed: 1337, step: 0, elapsed: 0, fp: '', nodes: [0, 0, 0], playing: false, busy: false };
    let svg, content, anim, logBody, c;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">mode</span>
          <button class="dstk-btn dstk-btn--amber t-mode"></button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span><input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Whole system, one process', sub: 'nodes, network, clock, RNG — all under one driver',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'step', label: 'step' }, { id: 'elapsed', label: 'sim elapsed' }, { id: 'fp', label: 'fingerprint' }],
        cap: 'One process owns time and randomness. Same seed ⇒ identical universe; real mode diverges.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); reseed(); render();
      K.addLog(logBody, '🌱 ready — one process, one driver · ' + (st.sim ? 'deterministic' : 'wall-clock chaos'), 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // the single OS process boundary enclosing everything
      K.el('rect', { id: id('proc', 0), x: PROC.x, y: PROC.y, width: PROC.w, height: PROC.h, rx: PROC.rx,
        fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 2, 'stroke-dasharray': '7,5' }, content);
      K.el('text', { x: PROC.x + 14, y: PROC.y + 18, fill: c.muted, 'font-size': 11, 'font-weight': 700 }, content)
        .textContent = 'one OS process — { sim }';

      // three node boxes
      for (let i = 0; i < NODES; i++) {
        const x = nx(i);
        K.el('rect', { id: id('box', i), x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 9,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: NODE.y + 18, r: 4.5, fill: c.purple }, content);
        K.el('text', { x: x + 28, y: NODE.y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'n' + i;
        K.el('text', { x: x + NODE.w - 12, y: NODE.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
          .textContent = i === 0 ? 'client' : 'host';
        K.el('text', { x: x + 14, y: NODE.y + 44, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'inbox';
        K.el('text', { id: id('inb', i), x: x + 14, y: NODE.y + 66, fill: c.purple, 'font-size': 20, 'font-weight': 700,
          'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0';
      }

      // network backplane
      K.el('rect', { x: NET.x, y: NET.y, width: NET.w, height: NET.h, rx: 8,
        fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
      K.el('text', { x: NET.x + 12, y: NET.y + 23, fill: c.blue, 'font-size': 11.5, 'font-weight': 700 }, content)
        .textContent = 'network backplane';
      K.el('text', { id: id('nethint', 0), x: NET.x + NET.w - 12, y: NET.y + 23, 'text-anchor': 'end', fill: c.muted, 'font-size': 10 }, content)
        .textContent = '';

      // single driver / clock box
      K.el('rect', { id: id('drv', 0), x: DRV.x, y: DRV.y, width: DRV.w, height: DRV.h, rx: 8,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      K.el('text', { x: DRV.x + 14, y: DRV.y + 20, fill: c.green, 'font-size': 11.5, 'font-weight': 700 }, content)
        .textContent = 'single driver · clock';
      K.el('text', { id: id('clk', 0), x: DRV.x + 14, y: DRV.y + 40, fill: c.text, 'font-size': 13, 'font-weight': 600,
        'font-variant-numeric': 'tabular-nums' }, content).textContent = 't = 0 ms';

      // seed → RNG box
      K.el('rect', { x: RNGB.x, y: RNGB.y, width: RNGB.w, height: RNGB.h, rx: 8,
        fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.8 }, content);
      K.el('text', { x: RNGB.x + 14, y: RNGB.y + 20, fill: c.amber, 'font-size': 11.5, 'font-weight': 700 }, content)
        .textContent = 'seed → RNG (mulberry32)';
      K.el('text', { id: id('rng', 0), x: RNGB.x + 14, y: RNGB.y + 40, fill: c.text, 'font-size': 13, 'font-weight': 600,
        'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
    }

    // Derive a stable 8-hex fingerprint purely from the seed via K.rng — sim mode shows this.
    function seedFingerprint(seed) {
      const r = K.rng(seed >>> 0);
      let h = '';
      for (let i = 0; i < 8; i++) h += Math.floor(r() * 16).toString(16);
      return h;
    }
    function reseed() {
      st.rng = K.rng(st.seed >>> 0);
      st.fp = st.sim ? seedFingerprint(st.seed) : '????????';
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function render() {
      stat('step', st.step);
      stat('elapsed', st.sim ? st.elapsed + ' ms' : '~' + st.elapsed + ' ms');
      stat('fp', st.fp || '········');
      E('clk', 0).textContent = st.sim ? 't = ' + st.elapsed + ' ms (sim)' : '≈ ' + st.elapsed + ' ms (wall)';
      E('rng', 0).textContent = st.sim ? 'seed=' + st.seed + ' → ' + st.fp : 'os entropy → nondeterministic';
      const drv = E('drv', 0), drvCol = st.sim ? 'green' : 'red';
      drv.setAttribute('fill', K.grad(uid, drvCol)); drv.setAttribute('stroke', c[drvCol]);
      E('nethint', 0).textContent = st.sim ? 'driver-ordered' : 'jittery arrival';
      E('nethint', 0).setAttribute('fill', st.sim ? c.green : c.red);
      const mb = root.querySelector('.t-mode');
      mb.textContent = st.sim ? '◉ Simulated' : '◯ Real';
      mb.className = 'dstk-btn t-mode ' + (st.sim ? 'dstk-btn--green' : 'dstk-btn--red');
    }

    // One step: the driver delivers packets across the network into node inboxes. In sim mode
    // the order is fixed by the seeded RNG; in real mode it is shuffled by wall-clock jitter.
    async function stepOnce() {
      if (st.busy || st.step >= MAXSTEP) return;
      st.busy = true; setLock(true);

      // who-talks-to-whom order: seeded RNG in sim, fresh entropy in real
      const pick = st.sim ? st.rng : Math.random;
      const order = [0, 1, 2];
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(pick() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      const to = order[0], from = (to + 1) % NODES;

      // network flash + packet flight from sender, over backplane, into receiver inbox
      const netY = NET.y + NET.h / 2;
      await fly(nx(from) + NODE.w / 2, NODE.y + NODE.h, nx(from) + NODE.w / 2, netY, st.sim ? c.green : c.red, 200);
      await fly(nx(from) + NODE.w / 2, netY, nx(to) + NODE.w / 2, netY, st.sim ? c.green : c.red, 320);
      await fly(nx(to) + NODE.w / 2, netY, nx(to) + NODE.w / 2, NODE.y + NODE.h, st.sim ? c.green : c.red, 200);
      st.nodes[to]++; flash(E('box', to)); E('inb', to).textContent = st.nodes[to];

      // advance time: exact tick in sim, jittery in real
      if (st.sim) { st.elapsed += TICK; }
      else { st.elapsed += TICK + Math.floor(Math.random() * 40 - 12); }
      st.step++;

      // fold this event into the fingerprint only in real mode (sim keeps the pure seed digest)
      if (!st.sim) st.fp = scramble(st.fp, from, to, st.elapsed);

      K.addLog(logBody, `step ${st.step}: n${from}→n${to} @${st.elapsed}ms` + (st.sim ? '' : ' (jitter)'), st.sim ? 'ok' : 'warn');
      render();
      st.busy = false; setLock(false);
    }

    // Real-mode fingerprint mutates from nondeterministic event data so two runs diverge.
    function scramble(prev, from, to, t) {
      let h = (parseInt(prev.replace(/[^0-9a-f]/gi, '0') || '0', 16) >>> 0);
      h = (Math.imul(h ^ from, 0x9e3779b1) ^ Math.imul(to + 1, 0x85ebca77) ^ Math.imul(t | 1, 0xc2b2ae35)) >>> 0;
      h = (h ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
      return ('00000000' + h.toString(16)).slice(-8);
    }

    async function fly(sx, sy, tx, ty, color, d) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: d || 320, ease: 'inOutQuad' });
      dot.remove();
    }
    function flash(b) { const old = b.getAttribute('stroke'); b.setAttribute('stroke', c.amber); animate(b, { opacity: [1, 0.45, 1], duration: 260, ease: 'inOut(2)', onComplete: () => b.setAttribute('stroke', old) }); }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-mode').onclick = () => { if (st.busy) return; st.sim = !st.sim; reset(); };
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 0; reset(); };
    }

    async function play() { if (st.playing || st.step >= MAXSTEP) return; st.playing = true; pp(); while (st.playing && st.step < MAXSTEP) { await stepOnce(); if (!st.playing) break; await K.delay(380); } st.playing = false; pp(); }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      st.step = 0; st.elapsed = 0; st.busy = false;
      st.nodes = [0, 0, 0]; reseed(); setLock(false);
      drawScene(); render();
      K.addLog(logBody, st.sim ? '↺ reset — seed ' + st.seed + ' · same seed ⇒ same fingerprint ' + st.fp : '↺ reset — real mode · each run diverges', st.sim ? 'hl' : 'warn');
    }
    function pp() { const p = root.querySelector('.t-play'), q = root.querySelector('.t-pause'); if (p) p.disabled = st.playing; if (q) q.disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-mode', '.t-seed'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTSimCluster = { init };
})();
