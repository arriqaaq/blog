/**
 * DST Clock Handoff (re-skinned via dst-kit) — the driver drives the clock.
 *
 * Left: the sim driver holds the canonical "now". Right: one node's current_thread runtime built
 * start_paused(true) — its tokio::time::Instant is frozen. Each Step the driver calls
 *   rt.tick(dt) -> block_on(run_until(sleep(dt)))
 * so the node's Instant JUMPS by exactly dt. node.sleep(1s) schedules a far-future wake; the next
 * Step makes the driver LEAP straight to that deadline — the idle gap is skipped in 0 real time,
 * logged as auto-advance. Time only moves when we tick it; idle gaps are free.
 *
 * Exposes window.DSTClockHandoff.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('clock-handoff: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('clock-handoff: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 250, TICK = 10;
  const DRV = { x: 28, y: 40, w: 250, h: 170 };
  const NODE = { x: 470, y: 40, w: 282, h: 170 };
  const WIRE = { x1: DRV.x + DRV.w, x2: NODE.x, y: 96 };

  const SNIPPET = `let rt = Builder::new_current_thread()
    .enable_time().start_paused(true).build();   // Instant frozen

// the driver owns "now"; the node's clock only moves when ticked
rt.block_on(rt.run_until(sleep(dt)));   // advance, then leap to deadline`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = () => ({ now: 0, node: 0, deadline: null, step: 0, playing: false, busy: false, speed: 1 });
    const st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(uid + '-' + k));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step (+${TICK}ms)</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸ Pause</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">timers</span>
          <button class="dstk-btn dstk-btn--amber t-sleep">node.sleep(1s)</button></div>
        <span class="dstk-sp"></span>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'The driver drives the clock', sub: 'advance, then leap to the next deadline',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'now', label: 'sim now' }, { id: 'node', label: 'node Instant' }, { id: 'deadline', label: 'next deadline' }],
        cap: K.highlightRust(SNIPPET),
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 paused clock — the node Instant only moves when the driver ticks it', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // sim driver card — green: owns canonical "now"
      K.el('rect', { id: uid + '-drv', x: DRV.x, y: DRV.y, width: DRV.w, height: DRV.h, rx: 12,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: DRV.x + 18, cy: DRV.y + 22, r: 4.5, fill: c.green }, content);
      K.el('text', { x: DRV.x + 30, y: DRV.y + 26, fill: c.text, 'font-size': 14, 'font-weight': 700 }, content).textContent = 'sim driver';
      K.el('text', { x: DRV.x + DRV.w - 14, y: DRV.y + 26, 'text-anchor': 'end', fill: c.muted, 'font-size': 10 }, content).textContent = 'owns "now"';
      K.el('text', { x: DRV.x + 16, y: DRV.y + 62, fill: c.muted, 'font-size': 11 }, content).textContent = 'canonical now';
      K.el('text', { id: uid + '-drvnow', x: DRV.x + 16, y: DRV.y + 104, fill: c.green, 'font-size': 30,
        'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
      K.el('text', { id: uid + '-drvhint', x: DRV.x + 16, y: DRV.y + 142, fill: c.muted, 'font-size': 10 }, content).textContent = 'tick(dt) hands dt to the node';

      // handoff wire driver → node
      K.el('line', { x1: WIRE.x1, y1: WIRE.y, x2: WIRE.x2, y2: WIRE.y, stroke: c.separator, 'stroke-width': 2,
        'marker-end': K.arrow(uid, 'green') }, content);
      K.el('text', { id: uid + '-wirelbl', x: (WIRE.x1 + WIRE.x2) / 2, y: WIRE.y - 12, 'text-anchor': 'middle',
        fill: c.green, 'font-size': 10.5, 'font-weight': 600 }, content).textContent = 'tick(dt)';

      // node runtime card — purple: frozen tokio Instant
      K.el('rect', { id: uid + '-node', x: NODE.x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 12,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: NODE.x + 18, cy: NODE.y + 22, r: 4.5, fill: c.purple }, content);
      K.el('text', { x: NODE.x + 30, y: NODE.y + 26, fill: c.text, 'font-size': 14, 'font-weight': 700 }, content).textContent = 'node · current_thread rt';
      K.el('text', { id: uid + '-state', x: NODE.x + NODE.w - 14, y: NODE.y + 26, 'text-anchor': 'end',
        fill: c.green, 'font-size': 11, 'font-weight': 600 }, content).textContent = 'running';
      K.el('text', { x: NODE.x + 16, y: NODE.y + 62, fill: c.muted, 'font-size': 11 }, content).textContent = 'tokio Instant (paused)';
      K.el('text', { id: uid + '-nodeclk', x: NODE.x + 16, y: NODE.y + 104, fill: c.purple, 'font-size': 30,
        'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
      K.el('text', { id: uid + '-nodehint', x: NODE.x + 16, y: NODE.y + 142, fill: c.muted, 'font-size': 10 }, content).textContent = 'run_until(sleep(dt)) → jumps by dt';
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function render() {
      stat('now', st.now + ' ms'); stat('node', st.node + ' ms');
      stat('deadline', st.deadline == null ? '—' : st.deadline + ' ms');
      E('drvnow').textContent = st.now + ' ms';
      E('nodeclk').textContent = st.node + ' ms';
      const sEl = E('state'), card = E('node');
      if (st.deadline != null) {
        sEl.textContent = 'sleeping'; sEl.setAttribute('fill', c.amber);
        card.setAttribute('fill', K.grad(uid, 'amber')); card.setAttribute('stroke', c.amber);
        E('nodehint').textContent = `wake at ${st.deadline} ms — next Step leaps there`;
      } else {
        sEl.textContent = 'running'; sEl.setAttribute('fill', c.green);
        card.setAttribute('fill', K.grad(uid, 'purple')); card.setAttribute('stroke', c.purple);
        E('nodehint').textContent = 'run_until(sleep(dt)) → jumps by dt';
      }
    }

    // animate the canonical now and the node Instant counting up to `to`
    function jumpTo(to, color, ms) {
      const node = E('nodeclk'), drv = E('drvnow'), card = E('node'), wire = E('wirelbl');
      const fromNode = st.node, fromNow = st.now;
      st.node = to; st.now = to;
      const dt = to - Math.max(fromNode, fromNow);
      wire.textContent = `tick(+${dt}ms)`;
      animate(card, { opacity: [1, 0.55, 1], duration: dur(ms), ease: 'inOut(2)' });
      const pN = { v: fromNode }, pD = { v: fromNow };
      animate(pD, { v: to, duration: dur(ms), ease: 'out(2)',
        onUpdate: () => { drv.textContent = Math.round(pD.v) + ' ms'; },
        onComplete: () => { drv.textContent = to + ' ms'; } });
      return animate(pN, { v: to, duration: dur(ms), ease: 'out(2)',
        onUpdate: () => { node.textContent = Math.round(pN.v) + ' ms'; node.setAttribute('fill', color); },
        onComplete: () => { node.textContent = to + ' ms'; node.setAttribute('fill', color); } });
    }

    async function step() {
      if (st.busy) return;
      st.busy = true; setLock(true);

      // auto-advance: a scheduled wake is the next deadline → the driver leaps straight to it
      if (st.deadline != null) {
        const next = st.deadline, gap = next - st.now;
        K.addLog(logBody, `⏩ auto-advance ${st.now}→${next} ms — idle gap of ${gap} ms skipped in 0 real time`, 'warn');
        await jumpTo(next, c.amber, 420);
        st.deadline = null; st.step++; render();
        st.busy = false; setLock(false); return;
      }

      // ordinary tick: rt.tick(dt) → block_on(run_until(sleep(dt))) → Instant jumps by exactly dt
      const to = st.now + TICK;
      K.addLog(logBody, `rt.tick(${TICK}ms) → block_on(run_until(sleep(${TICK}ms))) → Instant jumps to ${to} ms`, 'ok');
      await jumpTo(to, c.purple, 260);
      st.step++; render();
      st.busy = false; setLock(false);
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-sleep').onclick = () => {
        if (st.busy || st.deadline != null) return;
        st.deadline = st.now + 1000;
        K.addLog(logBody, `node.sleep(1s) → far-future wake scheduled at ${st.deadline} ms; next Step leaps to it`, 'hl');
        render();
      };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
    }

    async function play() {
      if (st.playing) return;
      st.playing = true; pp();
      while (st.playing) { await step(); if (!st.playing) break; await K.delay(dur(440)); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      Object.assign(st, fresh());
      drawScene(); render(); K.addLog(logBody, '↺ reset — sim now and node Instant paused at 0', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-sleep', '.t-reset'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTClockHandoff = { init };
})();
