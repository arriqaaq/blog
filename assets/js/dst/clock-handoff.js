/**
 * DST Clock Handoff (re-skinned via dst-kit) — the driver advances the node clock, and skips the boring gaps.
 *
 * Left: the sim driver holds the canonical "now". Right: one node's current_thread runtime built
 * start_paused(true) — its tokio::time::Instant is frozen (runtime.rs:40-41). Each Step the driver calls
 *   rt.tick(sim_tick) -> block_on(run_until(sleep(sim_tick)))   // runtime.rs:111-122, a FIXED sim_tick
 * advancing the shared "now" by exactly sim_tick (tick.rs:69 `ctx.elapsed += sim_tick`; the fixed tick
 * is Sim::step passing self.sim_tick, core.rs:114-121). The dt handed over is ALWAYS that fixed sim_tick —
 * the driver never sizes dt to a sleep, and never leaps the SIM clock by a variable amount.
 *
 * The leap a far-future sleep buys you is in REAL (wall-clock) time, not sim time. Inside each
 * block_on(sleep(sim_tick)) the node's paused Instant auto-advances to the fence consuming ~0 real time
 * (tokio time/mod.rs:259-279, park_thread_timeout: can_auto_advance() => park_timeout(0) + clock.advance).
 * So node.sleep(1s) still resolves over MANY fixed sim_ticks of sim time (~1000 at a 1ms tick), but those
 * ticks cost ~0 wall-clock time — the idle gap is fast-forwarded for free. Below, a pending sleep makes the
 * next Step sweep through all those fixed ticks at once: SIM time climbs tick-by-tick to the wake while the
 * REAL-time cost stays ~0. (Distinct from paused-clock, which contrasts wall-vs-node; here it's driver→node:
 * the node clock only ever moves when the driver ticks it, and only ever by a fixed sim_tick.)
 *
 * Exposes window.DSTClockHandoff.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('clock-handoff: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('clock-handoff: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 232, TICK = 10, SLEEP = 1000;     // TICK = one FIXED sim_tick (1 ms, scaled ×10 for legibility); node.sleep(1s) = SLEEP, i.e. SLEEP/TICK fixed ticks
  const DRV = { x: 26, y: 64, w: 240, h: 150 };
  const NODE = { x: 470, y: 64, w: 284, h: 150 };
  const WIRE = { x1: DRV.x + DRV.w, x2: NODE.x, y: 116 };

  // three phases of one Step, lit one at a time as it animates (idiom borrowed from tick-loop)
  const PHASES = [
    { t: '① driver picks sim_tick', zone: 'green' },
    { t: '② hands tick to node', zone: 'blue' },
    { t: '③ node clock += sim_tick', zone: 'purple' },
  ];
  const PILL = { y: 16, h: 26, w: 178, gap: 12, x0: 26 };
  const pillX = (i) => PILL.x0 + i * (PILL.w + PILL.gap);

  const SNIPPET = `let rt = Builder::new_current_thread()
    .enable_time().start_paused(true).build();   // node Instant frozen

// the driver owns "now"; each Step hands the node the SAME fixed sim_tick
rt.block_on(rt.run_until(sleep(sim_tick)));   // node Instant fast-forwards to the fence in ~0 real time`;

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
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸ Pause</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">schedule</span>
          <button class="dstk-btn dstk-btn--amber t-sleep">node.sleep(1s)</button></div>
        <span class="dstk-sp"></span>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'The driver advances the node clock by a fixed tick — idle gaps cost ~0 real time',
        sub: 'the node clock only moves when the driver ticks it, and only by one fixed sim_tick',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'now', label: 'driver now' }, { id: 'node', label: 'node clock' }, { id: 'deadline', label: 'next wake' }],
        cap: 'The node’s clock is paused — it can’t move on its own. Every Step the driver hands it the SAME '
           + 'fixed sim_tick and sim time climbs by exactly that. Schedule a far-off sleep and the next Step '
           + 'sweeps through all the fixed ticks up to the wake — sim time still passes tick-by-tick, but the '
           + 'idle wall-clock (real) time is fast-forwarded for free.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render(); setPhase(-1);
      K.addLog(logBody, '🌱 paused — the node clock sits still until the driver ticks it', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';

      // phase pills along the top — light up as a Step runs
      PHASES.forEach((p, i) => {
        K.el('rect', { id: uid + '-pill-' + i, x: pillX(i), y: PILL.y, width: PILL.w, height: PILL.h, rx: 8,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: uid + '-pilltext-' + i, x: pillX(i) + PILL.w / 2, y: PILL.y + PILL.h / 2 + 4, 'text-anchor': 'middle',
          fill: c.muted, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = p.t;
        if (i < PHASES.length - 1) K.el('text', { x: pillX(i) + PILL.w + PILL.gap / 2, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 12 }, content).textContent = '→';
      });

      // sim driver card — green: owns canonical "now"
      K.el('rect', { id: uid + '-drv', x: DRV.x, y: DRV.y, width: DRV.w, height: DRV.h, rx: 12,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: DRV.x + 18, cy: DRV.y + 22, r: 4.5, fill: c.green }, content);
      K.el('text', { x: DRV.x + 30, y: DRV.y + 26, fill: c.text, 'font-size': 13.5, 'font-weight': 700 }, content).textContent = 'sim driver';
      K.el('text', { x: DRV.x + DRV.w - 14, y: DRV.y + 26, 'text-anchor': 'end', fill: c.muted, 'font-size': 10 }, content).textContent = 'owns "now"';
      K.el('text', { x: DRV.x + 16, y: DRV.y + 58, fill: c.muted, 'font-size': 10.5 }, content).textContent = 'driver clock';
      K.el('text', { id: uid + '-drvnow', x: DRV.x + 16, y: DRV.y + 98, fill: c.green, 'font-size': 30,
        'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
      K.el('text', { id: uid + '-drvhint', x: DRV.x + 16, y: DRV.y + 130, fill: c.muted, 'font-size': 10 }, content).textContent = 'hands a fixed sim_tick, then ticks the node';

      // handoff wire driver → node, carrying the fixed sim_tick
      K.el('line', { x1: WIRE.x1, y1: WIRE.y, x2: WIRE.x2, y2: WIRE.y, stroke: c.separator, 'stroke-width': 2,
        'marker-end': K.arrow(uid, 'blue') }, content);
      K.el('text', { id: uid + '-wirelbl', x: (WIRE.x1 + WIRE.x2) / 2, y: WIRE.y - 11, 'text-anchor': 'middle',
        fill: c.blue, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'tick(sim_tick)';

      // node runtime card — purple: frozen tokio Instant, advanced only by the driver
      K.el('rect', { id: uid + '-node', x: NODE.x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 12,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: NODE.x + 18, cy: NODE.y + 22, r: 4.5, fill: c.purple }, content);
      K.el('text', { x: NODE.x + 30, y: NODE.y + 26, fill: c.text, 'font-size': 13.5, 'font-weight': 700 }, content).textContent = 'node';
      K.el('text', { x: NODE.x + 124, y: NODE.y + 26, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'current_thread rt';
      K.el('text', { id: uid + '-state', x: NODE.x + NODE.w - 14, y: NODE.y + 26, 'text-anchor': 'end',
        fill: c.green, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'awake';
      K.el('text', { x: NODE.x + 16, y: NODE.y + 58, fill: c.muted, 'font-size': 10.5 }, content).textContent = 'node clock (paused tokio Instant)';
      K.el('text', { id: uid + '-nodeclk', x: NODE.x + 16, y: NODE.y + 98, fill: c.purple, 'font-size': 30,
        'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
      K.el('text', { id: uid + '-nodehint', x: NODE.x + 16, y: NODE.y + 130, fill: c.muted, 'font-size': 10 }, content).textContent = 'only the driver can move it';

      // transient banner layer (the loud leap moment)
      K.el('g', { id: uid + '-banner' }, content);
    }

    function setPhase(k) {
      PHASES.forEach((p, i) => {
        const r = E('pill-' + i), t = E('pilltext-' + i); if (!r) return;
        const on = i === k;
        r.setAttribute('fill', on ? K.grad(uid, p.zone) : 'none');
        r.setAttribute('stroke', on ? c[p.zone] : c.separator);
        r.setAttribute('stroke-width', on ? 2.2 : 1.4);
        if (on) r.setAttribute('filter', K.glow(uid)); else r.removeAttribute('filter');
        t.setAttribute('fill', on ? c[p.zone] : c.muted);
      });
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function render() {
      stat('now', st.now + ' ms'); stat('node', st.node + ' ms');
      stat('deadline', st.deadline == null ? '—' : st.deadline + ' ms');
      E('drvnow').textContent = st.now + ' ms';
      E('nodeclk').textContent = st.node + ' ms';
      const sEl = E('state'), card = E('node');
      if (st.deadline != null) {
        const ticks = Math.round((st.deadline - st.now) / TICK);
        sEl.textContent = `sleeping → ${st.deadline} ms`; sEl.setAttribute('fill', c.amber);
        card.setAttribute('fill', K.grad(uid, 'amber')); card.setAttribute('stroke', c.amber);
        E('nodehint').textContent = `next Step sweeps ${ticks} fixed ticks → ${st.deadline} ms · ~0 real time`;
        E('drvhint').textContent = 'still hands a fixed sim_tick, repeated';
      } else {
        sEl.textContent = 'awake'; sEl.setAttribute('fill', c.green);
        card.setAttribute('fill', K.grad(uid, 'purple')); card.setAttribute('stroke', c.purple);
        E('nodehint').textContent = 'only the driver can move it';
        E('drvhint').textContent = 'hands a fixed sim_tick, then ticks the node';
      }
    }

    // animate driver "now" and the node clock counting up together to `to` (they advance in lock-step)
    function jumpTo(to, color, ms, wireLabel) {
      const node = E('nodeclk'), drv = E('drvnow'), card = E('node'), wire = E('wirelbl');
      const fromNode = st.node, fromNow = st.now;
      st.node = to; st.now = to;
      wire.textContent = wireLabel;
      wire.setAttribute('fill', color);
      animate(card, { opacity: [1, 0.55, 1], duration: dur(ms), ease: 'inOut(2)' });
      const pN = { v: fromNode }, pD = { v: fromNow };
      animate(pD, { v: to, duration: dur(ms), ease: 'out(2)',
        onUpdate: () => { drv.textContent = Math.round(pD.v) + ' ms'; },
        onComplete: () => { drv.textContent = to + ' ms'; } });
      return animate(pN, { v: to, duration: dur(ms), ease: 'out(2)',
        onUpdate: () => { node.textContent = Math.round(pN.v) + ' ms'; node.setAttribute('fill', color); },
        onComplete: () => { node.textContent = to + ' ms'; node.setAttribute('fill', color); } });
    }

    // the loud moment: a transient banner spelling out the leap
    async function banner(msg, ms) {
      const g = E('banner'); g.innerHTML = '';
      const bw = Math.min(NODE.x + NODE.w - DRV.x, 12 * msg.length + 40);
      const bx = (W - bw) / 2, by = WIRE.y + 18;
      const rect = K.el('rect', { x: bx, y: by, width: bw, height: 30, rx: 8,
        fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 2, opacity: 0, filter: K.glow(uid) }, g);
      const txt = K.el('text', { x: W / 2, y: by + 20, 'text-anchor': 'middle', fill: c.amber,
        'font-size': 13, 'font-weight': 700, opacity: 0 }, g);
      txt.textContent = msg;
      await animate([rect, txt], { opacity: [0, 1], duration: dur(180), ease: 'out(2)' });
      await K.delay(dur(ms));
      await animate([rect, txt], { opacity: [1, 0], duration: dur(260), ease: 'inOut(2)' });
      g.innerHTML = '';
    }

    async function step() {
      if (st.busy) return;
      st.busy = true; setLock(true);
      st.step++;

      // ① The driver ALWAYS hands the node the same fixed sim_tick (core.rs:114-121 → tick.rs:60). It never
      //    sizes dt to a sleep. When a far-off sleep is pending, this Step still advances sim time by fixed
      //    sim_ticks — but it sweeps through ALL of them up to the wake, because each block_on(sleep(sim_tick))
      //    fast-forwards the node's paused Instant in ~0 real time (tokio time/mod.rs:259-279). So sim time
      //    climbs tick-by-tick to the deadline while the REAL (wall-clock) cost stays ~0.
      const leaping = st.deadline != null;
      const to = leaping ? st.deadline : st.now + TICK;
      const ticks = (to - st.now) / TICK;     // how many fixed sim_ticks this Step covers (1 normally; N over a gap)
      setPhase(0);
      K.addLog(logBody, leaping
        ? `① driver now ${st.now} ms · still hands the fixed sim_tick (${TICK} ms), ${ticks}× over the gap`
        : `① driver now ${st.now} ms · picks sim_tick = ${TICK} ms`, leaping ? 'warn' : 'hl');
      await animate(E('drv'), { opacity: [1, 0.6, 1], duration: dur(200), ease: 'inOut(2)' });

      // ② hand the fixed sim_tick across the wire to the node
      setPhase(1);
      await fly(WIRE.x1, WIRE.y, WIRE.x2, WIRE.y, leaping ? c.amber : c.blue);
      K.addLog(logBody, `② rt.tick(${TICK}ms) → block_on(run_until(sleep(${TICK}ms)))`, 'ok');

      // ③ node clock advances one fixed sim_tick (ctx.elapsed += sim_tick, tick.rs:69); over a gap, repeated
      setPhase(2);
      if (leaping) {
        await jumpTo(to, c.amber, 520, `tick(+${TICK}ms) ×${ticks}`);
        await banner(`⏩ ${ticks} fixed sim_ticks of sim time — but ~0 real (wall-clock) time`, 900);
        st.deadline = null;
        K.addLog(logBody, `③ node clock += ${TICK} ms ×${ticks} → ${to} ms · idle wall-clock skipped for free`, 'warn');
      } else {
        await jumpTo(to, c.purple, 260, `tick(+${TICK}ms)`);
        K.addLog(logBody, `③ node clock += ${TICK} ms → ${to} ms`, 'ok');
      }

      render(); setPhase(-1);
      st.busy = false; setLock(false);
    }

    async function fly(sx, sy, tx, ty, color) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: dur(300), ease: 'inOutQuad' });
      await animate(dot, { r: [6, 12], opacity: [1, 0], duration: dur(140), ease: 'out(2)' });
      dot.remove();
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-sleep').onclick = () => {
        if (st.busy || st.deadline != null) return;
        st.deadline = st.now + SLEEP;
        K.addLog(logBody, `node.sleep(1s) → wake at ${st.deadline} ms · ${SLEEP / TICK} fixed sim_ticks away, fast-forwarded in ~0 real time`, 'hl');
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
      drawScene(); render(); setPhase(-1);
      K.addLog(logBody, '↺ reset — driver and node clock both back at 0 ms', 'hl');
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
