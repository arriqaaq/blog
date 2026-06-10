/**
 * DST Paused Per-Node Clock (re-skinned via dst-kit) — time jumps, it doesn't flow.
 *
 * Each node is its own Tokio current-thread runtime built start_paused(true): tokio::time::Instant
 * is frozen and only advances when the driver ticks. A continuous gray "wall clock" face sweeps
 * above for contrast; the node clocks sit still, then JUMP by exactly one tick when stepped.
 * n0.sleep(1s) schedules a far-future wake so the next Step auto-advances/leaps straight to it
 * (idle gaps skipped). crash(n2) rebuilds the runtime, resetting that node's paused Instant to 0
 * while sim-global elapsed marches on — the documented, physically-unfixable discontinuity.
 *
 * Exposes window.DSTPausedClock.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('paused-clock: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('paused-clock: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 300, NODES = 3, TICK = 10;
  const WALL = { cx: 64, cy: 60, r: 32 };
  const CARD = { y: 124, h: 150, w: 226, gap: 20, x0: 28 };
  const cardX = (i) => CARD.x0 + i * (CARD.w + CARD.gap);

  const SNIPPET = `let rt = Builder::new_current_thread()
    .enable_time()
    .start_paused(true)   // tokio::time::Instant frozen
    .build();

// idle gaps are skipped: the driver leaps to the deadline
sleep(Duration::from_secs(1)).await;  // completes in 0 real microseconds`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const mk = () => Array.from({ length: NODES }, () => ({ clock: 0, crashed: false, sleepUntil: null }));
    const st = { now: 0, step: 0, nodes: mk(), wallAngle: 0, playing: false, busy: false, speed: 1 };
    let svg, content, anim, logBody, c, wallAnim = null;
    const dur = (ms) => ms / st.speed;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step (+${TICK}ms)</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸ Pause</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">faults</span>
          <button class="dstk-btn dstk-btn--amber t-sleep">n0.sleep(1s)</button>
          <button class="dstk-btn dstk-btn--red t-crash">crash n2</button>
          <button class="dstk-btn dstk-btn--ghost t-bounce">bounce n2</button></div>
        <span class="dstk-sp"></span>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Paused per-node clock', sub: 'time jumps, it does not flow',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'now', label: 'sim elapsed' }, { id: 'step', label: 'step' }],
        cap: K.highlightRust(SNIPPET),
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); startWallClock(); render();
      K.addLog(logBody, '🌱 clocks paused — they only move when the driver ticks', 'hl');
    }

    function id(k, i) { return `${uid}-${k}-${i}`; }
    function E(k, i) { return svg.querySelector('#' + CSS.escape(id(k, i))); }

    function drawScene() {
      content.innerHTML = '';
      // wall clock face — gray, continuous, ignored by the sim
      K.el('circle', { cx: WALL.cx, cy: WALL.cy, r: WALL.r, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 2 }, content);
      K.el('circle', { cx: WALL.cx, cy: WALL.cy, r: 2.6, fill: c.gray }, content);
      K.el('line', { id: id('hand', 0), x1: WALL.cx, y1: WALL.cy, x2: WALL.cx, y2: WALL.cy - WALL.r + 6,
        stroke: c.gray, 'stroke-width': 2, 'stroke-linecap': 'round', filter: K.glow(uid) }, content);
      K.el('text', { x: WALL.cx + WALL.r + 14, y: WALL.cy - 5, fill: c.muted, 'font-size': 11.5 }, content)
        .textContent = 'wall clock — real, continuous,';
      K.el('text', { x: WALL.cx + WALL.r + 14, y: WALL.cy + 12, fill: c.muted, 'font-size': 11.5 }, content)
        .textContent = 'and completely ignored by the sim.';

      // node clock cards
      for (let i = 0; i < NODES; i++) {
        const x = cardX(i);
        K.el('rect', { id: id('card', i), x, y: CARD.y, width: CARD.w, height: CARD.h, rx: 10,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: CARD.y + 20, r: 4.5, fill: c.purple }, content);
        K.el('text', { x: x + 28, y: CARD.y + 24, fill: c.text, 'font-size': 14, 'font-weight': 700 }, content)
          .textContent = 'n' + i;
        K.el('text', { id: id('state', i), x: x + CARD.w - 12, y: CARD.y + 24, 'text-anchor': 'end',
          fill: c.green, 'font-size': 11, 'font-weight': 600 }, content).textContent = 'running';
        K.el('text', { x: x + 14, y: CARD.y + 58, fill: c.muted, 'font-size': 11 }, content)
          .textContent = 'tokio Instant (paused)';
        K.el('text', { id: id('clk', i), x: x + 14, y: CARD.y + 98, fill: c.purple, 'font-size': 28,
          'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
        K.el('text', { id: id('hint', i), x: x + 14, y: CARD.y + 128, fill: c.muted, 'font-size': 10 }, content)
          .textContent = '';
      }
    }

    function startWallClock() {
      if (wallAnim && wallAnim.pause) wallAnim.pause();
      const proxy = { a: st.wallAngle };
      wallAnim = animate(proxy, { a: st.wallAngle + 360, duration: dur(2600), ease: 'linear',
        loop: true, onUpdate: () => { st.wallAngle = proxy.a % 360; setHand(st.wallAngle); } });
    }
    function setHand(deg) {
      const hand = E('hand', 0); if (!hand) return;
      const rad = (deg - 90) * Math.PI / 180, len = WALL.r - 6;
      hand.setAttribute('x2', WALL.cx + Math.cos(rad) * len);
      hand.setAttribute('y2', WALL.cy + Math.sin(rad) * len);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function render() {
      stat('now', st.now + ' ms'); stat('step', st.step);
      for (let i = 0; i < NODES; i++) {
        const n = st.nodes[i];
        E('clk', i).textContent = n.clock + ' ms';
        E('clk', i).setAttribute('fill', n.crashed ? c.muted : c.purple);
        const sEl = E('state', i), card = E('card', i);
        if (n.crashed) {
          sEl.textContent = 'crashed'; sEl.setAttribute('fill', c.red);
          card.setAttribute('fill', K.grad(uid, 'red')); card.setAttribute('stroke', c.red); card.setAttribute('stroke-dasharray', '6,4');
        } else if (n.sleepUntil != null) {
          sEl.textContent = 'sleeping'; sEl.setAttribute('fill', c.amber);
          card.setAttribute('fill', K.grad(uid, 'amber')); card.setAttribute('stroke', c.amber); card.setAttribute('stroke-dasharray', '0');
        } else {
          sEl.textContent = 'running'; sEl.setAttribute('fill', c.green);
          card.setAttribute('fill', K.grad(uid, 'purple')); card.setAttribute('stroke', c.purple); card.setAttribute('stroke-dasharray', '0');
        }
        E('hint', i).textContent = n.crashed ? 'Instant reset to 0 on crash (global marches on)'
          : (n.sleepUntil != null ? `will leap to ${n.sleepUntil} ms` : '');
      }
    }

    function jumpClock(i, to, color) {
      const node = st.nodes[i], from = node.clock; node.clock = to;
      const t = E('clk', i), card = E('card', i), proxy = { v: from };
      animate(card, { opacity: [1, 0.55, 1], duration: dur(220), ease: 'inOut(2)' });
      return animate(proxy, { v: to, duration: dur(260), ease: 'out(2)',
        onUpdate: () => { t.textContent = Math.round(proxy.v) + ' ms'; t.setAttribute('fill', color); },
        onComplete: () => { t.textContent = to + ' ms'; t.setAttribute('fill', color); } });
    }

    async function step() {
      if (st.busy) return;
      st.busy = true; setLock(true);

      // auto-advance: if a sleeping node's wake is the next deadline, the driver leaps straight to it
      const sleepers = st.nodes.map((n, i) => ({ n, i })).filter((x) => !x.n.crashed && x.n.sleepUntil != null);
      if (sleepers.length) {
        const next = Math.min(...sleepers.map((x) => x.n.sleepUntil));
        K.addLog(logBody, `⏩ auto-advance ${st.now}→${next} ms (no work in between)`, 'warn');
        st.now = next;
        for (let i = 0; i < NODES; i++) {
          const n = st.nodes[i];
          if (n.crashed) continue;
          if (n.sleepUntil != null && n.sleepUntil <= next) { await jumpClock(i, next, c.amber); n.sleepUntil = null; }
          else await jumpClock(i, next, c.purple);
        }
        st.step++; render(); st.busy = false; setLock(false); return;
      }

      // ordinary tick: every running node's paused clock jumps by exactly one tick
      st.now += TICK;
      for (let i = 0; i < NODES; i++) if (!st.nodes[i].crashed) await jumpClock(i, st.now, c.purple);
      st.step++; render();
      st.busy = false; setLock(false);
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-sleep').onclick = () => {
        if (st.busy || st.nodes[0].crashed) return;
        st.nodes[0].sleepUntil = st.now + 1000;
        K.addLog(logBody, 'n0 calls sleep(1000ms) → far-future wake scheduled; next Step leaps to it', 'warn');
        render();
      };
      root.querySelector('.t-crash').onclick = () => {
        if (st.busy) return;
        const n = st.nodes[2]; n.crashed = true; n.clock = 0; n.sleepUntil = null;
        K.addLog(logBody, 'crash(n2) → runtime rebuilt; its paused Instant resets to 0 (sim elapsed unaffected)', 'err');
        render();
      };
      root.querySelector('.t-bounce').onclick = () => {
        if (st.busy || !st.nodes[2].crashed) return;
        st.nodes[2].crashed = false; // resumes from 0 — the discontinuity
        K.addLog(logBody, 'bounce(n2) → fresh runtime; clock resumes from 0 while global elapsed is ' + st.now + ' ms', 'hl');
        render();
      };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); startWallClock(); };
    }

    async function play() {
      if (st.playing) return;
      st.playing = true; pp();
      while (st.playing) { await step(); if (!st.playing) break; await K.delay(dur(420)); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      st.now = 0; st.step = 0; st.nodes = mk(); st.busy = false; setLock(false);
      drawScene(); render(); K.addLog(logBody, '↺ reset — clocks paused at 0', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-sleep', '.t-crash', '.t-bounce', '.t-reset'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTPausedClock = { init };
})();
