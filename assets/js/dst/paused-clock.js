/**
 * DST Paused Clock (dst-kit) — a node's now() jumps, it does not flow.
 *
 * The post's point: on a paused runtime, tokio::time::Instant::now() returns a value STORED inside
 * the runtime — it does not follow real time. So this widget puts two clocks side by side:
 *   • the WALL CLOCK — a real analog face whose hand sweeps continuously, all on its own, and which
 *     the simulator completely ignores;
 *   • the NODE CLOCK — one big now() number that sits perfectly FROZEN while the wall hand sweeps,
 *     and only JUMPS when the driver advances it: +10 ms per Step, or a single leap of +1000 ms when
 *     the node calls sleep(1s) (the idle gap is skipped — it costs 0 real time).
 * Watch the contrast live: real time flows, node time jumps. Exposes window.DSTPausedClock.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('paused-clock: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('paused-clock: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 214;
  const WALL = { cx: 96, cy: 120, r: 50 };
  const NODE = { x: 392, y: 52, w: 374, h: 122 };
  const HIST = { x: 392, y: 188, max: 6 };

  const SRC =
`let rt = Builder::new_current_thread()
    .enable_time().start_paused(true).build();   // now() is frozen
// real time keeps flowing and is ignored; the driver leaps over idle gaps
sleep(Duration::from_secs(1)).await;             // 0 real microseconds`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = () => ({ now: 0, step: 0, jumps: 0, armed: false, busy: false, playing: false, speed: 1, wallAnim: null });
    const st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const hist = [];

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step (+10 ms)</button>
        <button class="dstk-btn dstk-btn--amber t-sleep">node calls sleep(1s)</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: "A node's clock jumps — it doesn't flow", sub: 'tokio::time::Instant::now() is a stored value the driver moves',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'now', label: 'node now()' }, { id: 'step', label: 'step' }, { id: 'jumps', label: 'jumps' }],
        cap: 'The wall clock (left) is real and never stops — and the sim ignores it. The node clock (right) '
           + 'is frozen; it only moves when the driver advances it: +10 ms per Step, or one +1 s leap on sleep(1s).',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      const code = document.createElement('div');
      code.innerHTML = K.highlightRust(SRC);
      root.querySelector('.dstk-toolbar').insertAdjacentElement('afterend', code.firstChild);
      drawScene(); bind(); render(); startWall();
      K.addLog(logBody, '🌱 watch the wall hand sweep on its own — the node number stays frozen until you Step', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // intro line
      K.el('text', { x: 18, y: 24, fill: c.muted, 'font-size': 10.5 }, content)
        .textContent = 'Real time flows; the node clock jumps. Watch: the wall hand keeps sweeping while the node number sits still until a Step.';

      // WALL CLOCK — analog face, hand sweeps continuously (real time, ignored by the sim)
      K.el('circle', { cx: WALL.cx, cy: WALL.cy, r: WALL.r, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 2 }, content);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, r1 = WALL.r - 6, r2 = WALL.r - 2;
        K.el('line', { x1: WALL.cx + r1 * Math.sin(a), y1: WALL.cy - r1 * Math.cos(a), x2: WALL.cx + r2 * Math.sin(a), y2: WALL.cy - r2 * Math.cos(a), stroke: c.muted, 'stroke-width': 1 }, content);
      }
      K.el('line', { id: uid + '-hand', x1: WALL.cx, y1: WALL.cy, x2: WALL.cx, y2: WALL.cy - (WALL.r - 12), stroke: c.gray, 'stroke-width': 2.4, 'stroke-linecap': 'round' }, content);
      K.el('circle', { cx: WALL.cx, cy: WALL.cy, r: 3, fill: c.gray }, content);
      K.el('text', { x: WALL.cx, y: WALL.cy + WALL.r + 16, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'wall clock';
      K.el('text', { x: WALL.cx, y: WALL.cy + WALL.r + 29, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'real · never stops · ignored';

      // big "≠" between the two — they are not the same clock
      K.el('text', { x: (WALL.cx + WALL.r + NODE.x) / 2, y: WALL.cy + 6, 'text-anchor': 'middle', fill: c.muted, 'font-size': 22, 'font-weight': 700 }, content).textContent = '≠';

      // NODE CLOCK — frozen, jumps on Step
      K.el('rect', { id: uid + '-nbox', x: NODE.x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 11, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: NODE.x + 18, cy: NODE.y + 22, r: 4.5, fill: c.purple }, content);
      K.el('text', { x: NODE.x + 30, y: NODE.y + 26, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'node clock';
      K.el('text', { id: uid + '-ntag', x: NODE.x + NODE.w - 14, y: NODE.y + 26, 'text-anchor': 'end', fill: c.amber, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'FROZEN';
      K.el('text', { x: NODE.x + 16, y: NODE.y + 48, fill: c.muted, 'font-size': 10, 'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = 'tokio::time::Instant::now()';
      K.el('text', { id: uid + '-now', x: NODE.x + 16, y: NODE.y + 96, fill: c.purple, 'font-size': 38, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
      K.el('text', { id: uid + '-nsub', x: NODE.x + NODE.w - 14, y: NODE.y + 96, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5 }, content).textContent = 'moves only on Step';

      // history strip: the discrete jumps
      K.el('text', { x: HIST.x, y: HIST.y - 6, fill: c.muted, 'font-size': 9 }, content).textContent = 'jumps:';
      K.el('g', { id: uid + '-hist' }, content);
    }

    // continuous wall-clock sweep — runs on its own forever, regardless of stepping
    function startWall() {
      if (st.wallAnim && st.wallAnim.pause) st.wallAnim.pause();
      const hand = E('hand'); if (!hand) return;
      const p = { a: 0 };
      st.wallAnim = animate(p, { a: 360, duration: 2600, ease: 'linear', loop: true,
        onUpdate: () => hand.setAttribute('transform', `rotate(${p.a} ${WALL.cx} ${WALL.cy})`) });
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('now', st.now + ' ms'); stat('step', st.step); stat('jumps', st.jumps);
      E('now').textContent = st.now + ' ms';
      let g = E('hist'); if (g) g.remove();
      g = K.el('g', { id: uid + '-hist' }, content);
      const recent = hist.slice(-HIST.max);
      recent.forEach((v, i) => {
        const x = HIST.x + i * 62, last = i === recent.length - 1;
        K.el('rect', { x, y: HIST.y, width: 52, height: 20, rx: 5, fill: K.grad(uid, last ? 'amber' : 'purple'), stroke: last ? c.amber : c.purple, 'stroke-width': last ? 2 : 1 }, g);
        K.el('text', { x: x + 26, y: HIST.y + 14, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, g).textContent = v;
        if (i < recent.length - 1) K.el('text', { x: x + 56, y: HIST.y + 14, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10 }, g).textContent = '→';
      });
    }

    async function advance(amount, label) {
      if (st.busy) return; st.busy = true; setLock(true);
      const from = st.now; st.now += amount; st.step++; st.jumps++;
      E('ntag').textContent = 'JUMP +' + (amount >= 1000 ? (amount / 1000) + ' s' : amount + ' ms'); E('ntag').setAttribute('fill', c.amber);
      E('nbox').setAttribute('stroke', c.amber);
      await leapNumber(from, st.now);
      hist.push(st.now); render();
      E('nbox').setAttribute('stroke', c.purple);
      E('ntag').textContent = 'FROZEN';
      E('nsub').textContent = 'moves only on Step';
      if (amount >= 1000) leapBanner('⏭ idle gap skipped: now() leapt +' + (amount / 1000) + ' s in 0 real time');
      K.addLog(logBody, label, amount >= 1000 ? 'hl' : null);
      st.busy = false; setLock(false);
    }
    function step() {
      if (st.armed) { st.armed = false; advance(1000, '③ next Step → leap to the sleep deadline: now() +1000 ms (0 real time)'); }
      else advance(10, 'Step → now() jumps +10 ms (wall clock kept sweeping; node clock jumped)');
    }
    function sleep1s() {
      if (st.busy) return;
      st.armed = true;
      E('nsub').textContent = 'sleep(1s) armed → next Step leaps +1 s';
      K.addLog(logBody, '① node calls sleep(1000 ms) → far-future wake scheduled · ② now press Step to leap to it', 'warn');
    }

    function leapNumber(a, b) {
      const el = E('now'); animate(el, { opacity: [1, 0.5, 1], duration: dur(360), ease: 'inOut(2)' });
      const p = { v: a };
      return animate(p, { v: b, duration: dur(360), ease: 'out(2)', onUpdate: () => el.textContent = Math.round(p.v) + ' ms', onComplete: () => el.textContent = b + ' ms' });
    }
    function leapBanner(msg) {
      const old = content.querySelector('#' + CSS.escape(uid + '-leap')); if (old) old.remove();
      const bw = 400, bh = 28, bx = NODE.x + (NODE.w - bw) / 2, by = NODE.y - 2;
      const g = K.el('g', { id: uid + '-leap', opacity: 0 }, content);
      K.el('rect', { x: Math.max(8, bx), y: by, width: bw, height: bh, rx: 8, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.8, filter: K.glow(uid) }, g);
      K.el('text', { x: Math.max(8, bx) + bw / 2, y: by + 19, 'text-anchor': 'middle', fill: c.amber, 'font-size': 12, 'font-weight': 700 }, g).textContent = msg;
      animate(g, { opacity: [0, 1], duration: dur(200), ease: 'out(2)' });
      animate(g, { opacity: [1, 0], delay: dur(1300), duration: dur(650), ease: 'in(2)', onComplete: () => g.remove() });
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) step(); };
      root.querySelector('.t-sleep').onclick = sleep1s;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }
    async function play() { if (st.playing) return; st.playing = true; pp(); while (st.playing) { step(); await K.delay(dur(700)); } }
    function pause() { st.playing = false; pp(); }
    function reset() {
      const sp = st.speed; if (st.wallAnim && st.wallAnim.pause) st.wallAnim.pause();
      Object.assign(st, fresh()); st.speed = sp; hist.length = 0;
      pp(); setLock(false); drawScene(); render(); startWall();
      K.addLog(logBody, '↺ reset — clock frozen at 0; wall clock still sweeping', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-sleep', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTPausedClock = { init };
})();
