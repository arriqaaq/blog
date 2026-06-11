/**
 * DST Tokio Runtime (dst-kit) — a paused current-thread runtime leaps over a sleep.
 *
 * Follows the exact code below — block_on(async { sleep(1s).await }) — through the runtime's loop,
 * one loud phase at a time:
 *   ① poll  — poll the task; sleep(1s) isn't done → returns Pending and arms a timer at virtual 1s;
 *   ② park  — no ready task; the runtime parks with a zero-timeout I/O check (epoll_wait(0));
 *   ③ leap  — the clock is PAUSED and nothing woke us, so virtual time JUMPS straight to the next
 *             deadline (0s → 1s) — in 0 µs of real time;
 *   ④ wake  — the 1s timer fires its waker → the task is ready → poll it → Ready(()), block_on returns.
 * Virtual time is a pure function of these driver calls; the wall clock never moves. sleep(1h) is
 * just as free. Exposes window.DSTTokioRuntime.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('tokio-runtime: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('tokio-runtime: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 196, SEC = 1_000_000_000;
  const PHASES = [
    { t: '① poll task', zone: 'purple' },
    { t: '② park', zone: 'blue' },
    { t: '③ leap clock', zone: 'amber' },
    { t: '④ wake timer', zone: 'green' },
  ];
  const PILL = { y: 14, h: 28, w: 174, gap: 8, x0: 14 };
  const pillX = (i) => PILL.x0 + i * (PILL.w + PILL.gap);
  const TASK = { x: 14, y: 58, w: 360, h: 126 };
  const CLK = { x: 406, y: 58, w: 360, h: 126 };

  const SRC =
`let rt = Builder::new_current_thread()
    .enable_time().start_paused(true).build();
rt.block_on(async {
    sleep(Duration::from_secs(1)).await; // 0 real µs
});`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    // task: state ∈ ready | pending | done ; slept = has it returned Pending once?
    const fresh = () => ({ vt: 0, polls: 0, phase: 0, deadline: null, slept: false, state: 'ready', done: false, busy: false, playing: false, speed: 1 });
    const st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const fmt = (ns) => ns == null ? '—' : ns === 0 ? '0 ns' : ns % SEC === 0 ? (ns / SEC) + ' s' : (ns / SEC).toFixed(3) + ' s';

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step phase</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'A paused runtime leaps over a sleep', sub: 'poll → park → jump the clock → wake · 0 real time',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'vt', label: 'virtual time' }, { id: 'real', label: 'real time' }, { id: 'polls', label: 'polls' }],
        cap: 'start_paused(true): the runtime polls to exhaustion, parks, then — because the clock is paused — '
           + 'JUMPS virtual time straight to the next timer. Virtual time grows; the wall clock stays at 0. sleep(1h) is just as free.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      const code = document.createElement('div');
      code.innerHTML = K.highlightRust(SRC);
      root.querySelector('.dstk-toolbar').insertAdjacentElement('afterend', code.firstChild);
      drawScene(); bind(); render(); setPhase(-1);
      K.addLog(logBody, '🌱 paused at 0 — the task is about to be polled for the first time', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // phase pills
      PHASES.forEach((p, i) => {
        K.el('rect', { id: `${uid}-pill-${i}`, x: pillX(i), y: PILL.y, width: PILL.w, height: PILL.h, rx: 8, fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: `${uid}-pt-${i}`, x: pillX(i) + PILL.w / 2, y: PILL.y + PILL.h / 2 + 4, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = p.t;
        if (i < PHASES.length - 1) K.el('text', { x: pillX(i) + PILL.w + PILL.gap / 2, y: PILL.y + PILL.h / 2 + 4, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11 }, content).textContent = '→';
      });

      // TASK panel
      K.el('rect', { id: `${uid}-tbox`, x: TASK.x, y: TASK.y, width: TASK.w, height: TASK.h, rx: 10, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
      K.el('text', { x: TASK.x + 16, y: TASK.y + 24, fill: c.purple, 'font-size': 12, 'font-weight': 700 }, content).textContent = 'the task';
      K.el('text', { x: TASK.x + TASK.w - 14, y: TASK.y + 24, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5,
        'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = 'sleep(1s).await';
      K.el('text', { id: `${uid}-tstate`, x: TASK.x + 16, y: TASK.y + 78, fill: c.purple, 'font-size': 28,
        'font-weight': 700, filter: K.glow(uid) }, content).textContent = 'ready';
      K.el('text', { id: `${uid}-tsub`, x: TASK.x + 16, y: TASK.y + 104, fill: c.muted, 'font-size': 10 }, content).textContent = 'about to be polled';

      // CLOCK panel
      K.el('rect', { id: `${uid}-cbox`, x: CLK.x, y: CLK.y, width: CLK.w, height: CLK.h, rx: 10, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6 }, content);
      K.el('text', { x: CLK.x + 16, y: CLK.y + 24, fill: c.amber, 'font-size': 12, 'font-weight': 700 }, content).textContent = 'virtual clock';
      K.el('text', { id: `${uid}-ctag`, x: CLK.x + CLK.w - 14, y: CLK.y + 24, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5, 'font-weight': 600 }, content).textContent = 'PAUSED';
      K.el('text', { x: CLK.x + 16, y: CLK.y + 48, fill: c.muted, 'font-size': 10 }, content).textContent = 'now() =';
      K.el('text', { id: `${uid}-clk`, x: CLK.x + 150, y: CLK.y + 78, 'text-anchor': 'middle', fill: c.amber, 'font-size': 34,
        'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ns';
      K.el('text', { id: `${uid}-dl`, x: CLK.x + 16, y: CLK.y + 104, fill: c.text, 'font-size': 11, 'font-weight': 600 }, content).textContent = 'next timer: —';
      K.el('text', { x: CLK.x + CLK.w - 14, y: CLK.y + 104, 'text-anchor': 'end', fill: c.green, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'real wall-clock: 0 µs';
    }

    function setPhase(k) {
      PHASES.forEach((p, i) => {
        const r = E('pill-' + i), t = E('pt-' + i); if (!r) return;
        const on = i === k;
        r.setAttribute('fill', on ? K.grad(uid, p.zone) : 'none');
        r.setAttribute('stroke', on ? c[p.zone] : c.separator);
        r.setAttribute('stroke-width', on ? 2.2 : 1.4);
        if (on) r.setAttribute('filter', K.glow(uid)); else r.removeAttribute('filter');
        t.setAttribute('fill', on ? c[p.zone] : c.muted);
      });
    }

    function setTask(state, sub, zone) {
      const s = E('tstate'), sub2 = E('tsub'), box = E('tbox');
      s.textContent = state; s.setAttribute('fill', c[zone] || c.purple);
      sub2.textContent = sub || '';
      box.setAttribute('fill', K.grad(uid, zone || 'purple')); box.setAttribute('stroke', c[zone] || c.purple);
    }

    function render() {
      stat('vt', fmt(st.vt)); stat('real', '0 µs'); stat('polls', st.polls);
      E('clk').textContent = fmt(st.vt);
      E('dl').textContent = 'next timer: ' + (st.deadline == null ? '—' : fmt(st.deadline));
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    async function stepOnce() {
      if (st.busy || st.done) return; st.busy = true; setLock(true);
      try {
        if (st.phase === 0) await phasePoll();
        else if (st.phase === 1) await phasePark();
        else if (st.phase === 2) await phaseLeap();
        else await phaseWake();
      } finally { st.busy = false; setLock(false); }
    }

    // ① poll: the task isn't done → returns Pending and arms a timer at virtual 1s
    async function phasePoll() {
      setPhase(0); st.polls++; render();
      pulse(E('tbox'), c.purple);
      setTask('running', 'poll → runs until it hits .await', 'purple');
      await K.delay(dur(360));
      st.slept = true; st.deadline = st.vt + SEC; st.state = 'pending';
      setTask('pending', 'sleep(1s) → Pending · timer armed @ ' + fmt(st.deadline), 'purple');
      K.addLog(logBody, '① poll → sleep(1s) returns Pending; timer armed @ ' + fmt(st.deadline), 'hl');
      st.phase = 1; render();
    }

    // ② park: nothing ready; park with a zero-timeout I/O check (paused → won't actually block)
    async function phasePark() {
      setPhase(1);
      await pulse(E('tbox'), c.blue, 260);
      K.addLog(logBody, '② park → epoll_wait(timeout=0): no I/O ready, no ready tasks', 'warn');
      st.phase = 2; render();
    }

    // ③ leap: clock PAUSED + nothing woke us → jump virtual time to the next deadline, 0 real time
    async function phaseLeap() {
      setPhase(2);
      const from = st.vt, to = st.deadline;
      K.addLog(logBody, '③ clock paused & idle → JUMP virtual time ' + fmt(from) + ' → ' + fmt(to) + ' (0 real µs)', 'hl');
      E('ctag').textContent = 'PAUSED — leapt';
      flashStat('real');
      await leapClock(from, to);
      st.vt = to;
      leapBanner('⏭ clock jumped ' + fmt(from) + ' → ' + fmt(to) + ' · 0 µs real time');
      st.phase = 3; render();
    }

    // ④ wake: the timer fires its waker → task ready → poll → Ready(()), block_on returns
    async function phaseWake() {
      setPhase(3); st.polls++;
      setTask('ready', 'timer fired → waker → re-queued', 'green');
      await flyWake();
      K.addLog(logBody, '④ timer fires waker → task ready → poll → Ready(())', 'ok');
      st.deadline = null; st.state = 'done'; st.done = true;
      setTask('done', 'sleep returned · block_on() returns — total real time: 0 µs', 'green');
      render(); setPhase(-1);
      K.addLog(logBody, '✓ done — virtual time advanced to ' + fmt(st.vt) + ', wall clock never moved', 'ok');
    }

    function pulse(box, color, d) { box.setAttribute('stroke', color); return animate(box, { opacity: [1, 0.6, 1], duration: dur(d || 240), ease: 'inOut(2)' }); }
    function leapClock(a, b) {
      const clk = E('clk'); animate(clk, { opacity: [1, 0.5, 1], duration: dur(460), ease: 'inOut(2)' });
      const p = { v: a };
      return animate(p, { v: b, duration: dur(460), ease: 'out(2)', onUpdate: () => clk.textContent = fmt(Math.round(p.v)), onComplete: () => clk.textContent = fmt(b) });
    }
    async function flyWake() {
      const y = CLK.y + 78;
      const dot = K.el('circle', { cx: CLK.x, cy: y, r: 6, fill: c.green, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: TASK.x + TASK.w / 2, cy: TASK.y + TASK.h / 2, duration: dur(360), ease: 'inOutQuad' });
      flash(E('tbox'), c.green);
      await animate(dot, { r: [6, 13], opacity: [1, 0], duration: dur(150), ease: 'out(2)' }); dot.remove();
    }
    function flash(b, col) { if (!b) return; const o = b.getAttribute('stroke'); b.setAttribute('stroke', col); animate(b, { opacity: [1, 0.5, 1], duration: dur(280), ease: 'inOut(2)', onComplete: () => b.setAttribute('stroke', o) }); }
    function flashStat(k) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (!e) return;
      e.style.color = c.green; animate(e, { opacity: [1, 0.4, 1], duration: dur(420), ease: 'inOut(2)', onComplete: () => { e.style.color = ''; } });
    }
    function leapBanner(msg) {
      const old = content.querySelector('#' + CSS.escape(uid + '-leap')); if (old) old.remove();
      const bw = 360, bh = 30, bx = (W - bw) / 2, by = TASK.y - 2;
      const g = K.el('g', { id: uid + '-leap', opacity: 0 }, content);
      K.el('rect', { x: bx, y: by, width: bw, height: bh, rx: 8, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.8, filter: K.glow(uid) }, g);
      K.el('text', { x: W / 2, y: by + 20, 'text-anchor': 'middle', fill: c.amber, 'font-size': 12.5, 'font-weight': 700 }, g).textContent = msg;
      animate(g, { opacity: [0, 1], duration: dur(200), ease: 'out(2)' });
      animate(g, { opacity: [1, 0], delay: dur(1300), duration: dur(650), ease: 'in(2)', onComplete: () => g.remove() });
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }
    async function play() { if (st.playing || st.done) return; st.playing = true; pp(); while (st.playing && !st.done) { await stepOnce(); if (!st.playing) break; await K.delay(dur(520)); } st.playing = false; pp(); }
    function pause() { st.playing = false; pp(); }
    function reset() {
      const sp = st.speed; Object.assign(st, fresh()); st.speed = sp;
      pp(); setLock(false); drawScene(); render(); setPhase(-1);
      setTask('ready', 'about to be polled', 'purple');
      K.addLog(logBody, '↺ reset — start_paused(true), clock frozen at 0', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing || st.done; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b || st.done; }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTokioRuntime = { init };
})();
