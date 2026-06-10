/**
 * DST Tokio Runtime (dst-kit) — paused time + ticks on one current-thread runtime.
 * Builder::new_current_thread().enable_time().start_paused(true) freezes the clock: the runtime
 * polls ready tasks to exhaustion, parks with a zero-timeout I/O check, then — because the clock is
 * PAUSED and nothing else woke us — AUTO-ADVANCES virtual time straight to the next timer deadline
 * and fires that sleep waker. Wall-clock is irrelevant: sleep(1h) completes in zero real µs; virtual
 * time is a pure function of driver calls. Exposes window.DSTTokioRuntime.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('tokio-runtime: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('tokio-runtime: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 248;
  const QUEUE = { x: 18, y: 40, w: 214, h: 178, rowH: 28, pad: 12, max: 5 };
  const POLLER = { x: 290, y: 64, w: 196, h: 124 };
  const CLOCK = { x: 548, y: 40, w: 214, h: 178 };
  // Virtual-time spans (nanoseconds) for the demo timers.
  const SEC = 1_000_000_000;

  const SRC =
`let rt = Builder::new_current_thread()
    .enable_time().start_paused(true).build();
rt.block_on(async {
    sleep(Duration::from_secs(1)).await; // 0 real µs
});`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      vt: 0, polls: 0, parks: 0, seq: 0,
      // ready: tasks whose waker has fired and are queued to be polled.
      // timers: parked sleeps keyed by virtual deadline (ns).
      ready: [], timers: [],
      phase: 0, // 0 poll → 1 park → 2 auto-advance → 3 wake → back to 0
      playing: false, busy: false, speed: 1,
    };
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const fmtVt = (ns) => {
      if (ns === 0) return '0 ns';
      if (ns % SEC === 0) return (ns / SEC) + ' s';
      if (ns >= SEC) return (ns / SEC).toFixed(3) + ' s';
      if (ns % 1_000_000 === 0) return (ns / 1_000_000) + ' ms';
      return ns + ' ns';
    };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step phase</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--amber t-spawn">+ spawn sleep(1s)</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Tokio: paused time + ticks', sub: 'time only moves when we tick it',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'vt', label: 'virtual time' }, { id: 'polls', label: 'polls' }, { id: 'parks', label: 'parks' }],
        cap: 'start_paused(true): the runtime polls to exhaustion, parks, then leaps virtual time to the next deadline. ' +
          'Wall-clock is irrelevant — sleep(1h) finishes in zero real µs; virtual time is a pure function of driver calls.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      // syntax-highlighted snippet sits above the stage, injected after container build.
      const code = document.createElement('div');
      code.innerHTML = K.highlightRust(SRC);
      const head = root.querySelector('.dstk-toolbar');
      head.insertAdjacentElement('afterend', code.firstChild);
      drawScene(); bind(); render();
    }

    function id(k) { return `${uid}-${k}`; }
    function E(k) { return svg.querySelector('#' + CSS.escape(id(k))); }

    function drawScene() {
      content.innerHTML = '';
      // ── TASK QUEUE (purple) ───────────────────────────────────────────
      K.el('text', { x: QUEUE.x, y: QUEUE.y - 22, fill: c.purple, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'task queue';
      K.el('text', { x: QUEUE.x, y: QUEUE.y - 9, fill: c.muted, 'font-size': 9 }, content).textContent = 'ready tasks (waker fired)';
      K.el('rect', { id: id('qbox'), x: QUEUE.x, y: QUEUE.y, width: QUEUE.w, height: QUEUE.h, rx: 10,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);

      // ── RUNTIME / POLLER ──────────────────────────────────────────────
      K.el('text', { x: POLLER.x, y: POLLER.y - 22, fill: c.green, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'current-thread runtime';
      K.el('text', { x: POLLER.x, y: POLLER.y - 9, fill: c.muted, 'font-size': 9 }, content).textContent = 'poll · park · advance';
      K.el('rect', { id: id('pbox'), x: POLLER.x, y: POLLER.y, width: POLLER.w, height: POLLER.h, rx: 10,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: POLLER.x + POLLER.w / 2, cy: POLLER.y + 40, r: 16, fill: 'none', stroke: c.green, 'stroke-width': 2 }, content);
      K.el('text', { id: id('pstate'), x: POLLER.x + POLLER.w / 2, y: POLLER.y + 78, 'text-anchor': 'middle',
        fill: c.text, 'font-size': 12, 'font-weight': 700 }, content).textContent = 'idle';
      K.el('text', { id: id('psub'), x: POLLER.x + POLLER.w / 2, y: POLLER.y + 98, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 9 }, content).textContent = 'press Step phase';

      // connector queue → poller (directional)
      K.el('line', { x1: QUEUE.x + QUEUE.w, y1: POLLER.y + 30, x2: POLLER.x - 4, y2: POLLER.y + 30,
        stroke: c.purple, 'stroke-width': 1.6, 'marker-end': K.arrow(uid, 'purple') }, content);
      // connector clock → poller (timer fires waker)
      K.el('line', { x1: CLOCK.x - 4, y1: POLLER.y + 90, x2: POLLER.x + POLLER.w + 4, y2: POLLER.y + 90,
        stroke: c.amber, 'stroke-width': 1.6, 'marker-end': K.arrow(uid, 'amber') }, content);

      // ── VIRTUAL CLOCK (amber, frozen) ─────────────────────────────────
      K.el('text', { x: CLOCK.x, y: CLOCK.y - 22, fill: c.amber, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'virtual clock';
      K.el('text', { id: id('cstate'), x: CLOCK.x, y: CLOCK.y - 9, fill: c.muted, 'font-size': 9 }, content).textContent = 'PAUSED — frozen';
      K.el('rect', { id: id('cbox'), x: CLOCK.x, y: CLOCK.y, width: CLOCK.w, height: CLOCK.h, rx: 10,
        fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6 }, content);
      K.el('text', { x: CLOCK.x + 14, y: CLOCK.y + 30, fill: c.muted, 'font-size': 10 }, content).textContent = 'now() =';
      K.el('text', { id: id('clk'), x: CLOCK.x + CLOCK.w / 2, y: CLOCK.y + 78, 'text-anchor': 'middle',
        fill: c.amber, 'font-size': 30, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ns';
      K.el('text', { x: CLOCK.x + 14, y: CLOCK.y + 112, fill: c.muted, 'font-size': 10 }, content).textContent = 'next deadline';
      K.el('text', { id: id('deadline'), x: CLOCK.x + 14, y: CLOCK.y + 134, fill: c.text,
        'font-size': 14, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '—';
      K.el('text', { x: CLOCK.x + 14, y: CLOCK.y + 160, fill: c.muted, 'font-size': 9, 'font-style': 'italic' }, content).textContent = 'real wall-clock: 0 µs';
    }

    function slotY(i) { return QUEUE.y + QUEUE.pad + i * QUEUE.rowH; }

    function render() {
      stat('vt', fmtVt(st.vt)); stat('polls', st.polls); stat('parks', st.parks);
      E('clk').textContent = fmtVt(st.vt);
      const next = nextDeadline();
      E('deadline').textContent = next == null ? '— (no timers)' : fmtVt(next);
      // rebuild ready-task chips in a sub-group
      let g = svg.querySelector('#' + CSS.escape(id('q'))); if (g) g.remove();
      g = K.el('g', { id: id('q') }, content);
      if (!st.ready.length) {
        K.el('text', { x: QUEUE.x + QUEUE.pad, y: slotY(0) + 16, fill: c.muted, 'font-size': 10, 'font-style': 'italic' }, g)
          .textContent = '(empty — all parked)';
      }
      st.ready.slice(0, QUEUE.max).forEach((t, idx) => {
        const y = slotY(idx);
        K.el('rect', { id: id('chip-' + t.id), x: QUEUE.x + QUEUE.pad, y, width: QUEUE.w - QUEUE.pad * 2, height: QUEUE.rowH - 7,
          rx: 5, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.4 }, g);
        K.el('text', { x: QUEUE.x + QUEUE.pad + 8, y: y + 14, fill: c.text, 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums' }, g)
          .textContent = t.label;
      });
      if (st.ready.length > QUEUE.max)
        K.el('text', { x: QUEUE.x + QUEUE.pad, y: slotY(QUEUE.max) + 12, fill: c.muted, 'font-size': 9 }, g)
          .textContent = `+${st.ready.length - QUEUE.max} more`;
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function nextDeadline() { return st.timers.length ? Math.min(...st.timers.map((t) => t.deadline)) : null; }

    function setState(s, sub, color) {
      E('pstate').textContent = s; E('pstate').setAttribute('fill', color || c.text);
      E('psub').textContent = sub || '';
    }

    // ── phase machine: one Step = one phase of the runtime loop ─────────
    async function stepOnce() {
      if (st.busy) return; st.busy = true; setLock(true);
      try {
        if (st.phase === 0) await phasePoll();
        else if (st.phase === 1) await phasePark();
        else if (st.phase === 2) await phaseAdvance();
        else await phaseWake();
      } finally { st.busy = false; setLock(false); }
    }

    // (1) poll ready tasks to exhaustion
    async function phasePoll() {
      setState('polling', 'drain ready queue', c.green);
      pulse(E('pbox'), c.green);
      if (!st.ready.length) {
        K.addLog(logBody, 'poll: ready queue already empty', 'warn');
      } else {
        // drain every ready task this phase (poll to exhaustion).
        while (st.ready.length) {
          const t = st.ready.shift();
          st.polls++; stat('polls', st.polls);
          await drainChip(t);
          K.addLog(logBody, `poll: ${t.label} → ${t.completes ? 'Ready(())' : 'Pending'}`, t.completes ? 'ok' : 'hl');
          render();
        }
      }
      st.phase = 1; cue('next: park'); render();
    }

    // (2) park with a zero-timeout I/O check
    async function phasePark() {
      setState('parking', 'epoll_wait(timeout=0)', c.blue);
      st.parks++; stat('parks', st.parks);
      await pulse(E('pbox'), c.blue, 220);
      const next = nextDeadline();
      K.addLog(logBody, 'park: non-blocking I/O check, timeout=0 — no I/O ready', 'warn');
      if (next == null) {
        K.addLog(logBody, 'no timers parked — runtime is idle (spawn a sleep)', 'warn');
        setState('idle', 'nothing to do', c.muted);
        st.phase = 0; cue('next: poll'); render(); return;
      }
      st.phase = 2; cue('next: auto-advance'); render();
    }

    // (3) clock PAUSED + nothing woke us → auto-advance to next deadline, fire waker
    async function phaseAdvance() {
      const next = nextDeadline();
      if (next == null) { st.phase = 0; cue('next: poll'); render(); return; }
      setState('advancing', 'clock paused ⇒ leap', c.amber);
      const from = st.vt;
      K.addLog(logBody, `auto-advance: virtual time ${fmtVt(from)} → ${fmtVt(next)} (0 real µs)`, 'hl');
      await leapClock(from, next);
      st.vt = next;
      // fire wakers for every timer at this deadline → tasks become ready
      const fired = st.timers.filter((t) => t.deadline === next);
      st.timers = st.timers.filter((t) => t.deadline !== next);
      for (const t of fired) {
        st.ready.push({ id: t.id, label: t.label + ' woke', completes: true });
        await flyWake(t);
        K.addLog(logBody, `fire waker: ${t.label} deadline reached @ ${fmtVt(next)}`, 'ok');
      }
      E('cstate').textContent = 'PAUSED — leapt';
      st.phase = 3; cue('next: wake'); render();
    }

    // (4) the woken task is polled and returns
    async function phaseWake() {
      setState('polling', 'woken task resumes', c.green);
      pulse(E('pbox'), c.green);
      if (!st.ready.length) {
        K.addLog(logBody, 'wake: nothing to resume', 'warn');
      } else {
        while (st.ready.length) {
          const t = st.ready.shift();
          st.polls++; stat('polls', st.polls);
          await drainChip(t);
          K.addLog(logBody, `resume: ${t.label} → Ready(()) — sleep returned`, 'ok');
          render();
        }
      }
      setState('idle', 'loop complete', c.muted);
      st.phase = 0; cue('next: poll'); render();
    }

    function cue(txt) { /* psub already set per-phase; keep deadline fresh */ E('psub').textContent = txt; }

    // ── animation primitives ───────────────────────────────────────────
    function pulse(box, color, d) {
      box.setAttribute('stroke', color);
      return animate(box, { opacity: [1, 0.62, 1], duration: dur(d || 240), ease: 'inOut(2)' });
    }
    async function drainChip(t) {
      const chip = svg.querySelector('#' + CSS.escape(id('chip-' + t.id)));
      const sy = chip ? (+chip.getAttribute('y') + (QUEUE.rowH - 7) / 2) : slotY(0);
      const sx = QUEUE.x + QUEUE.w - QUEUE.pad;
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: t.completes ? c.green : c.purple, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: POLLER.x + POLLER.w / 2, cy: POLLER.y + 40, duration: dur(300), ease: 'inOutQuad' });
      await animate(dot, { r: [6, 13], opacity: [1, 0], duration: dur(150), ease: 'out(2)' });
      dot.remove();
    }
    async function flyWake(t) {
      // amber pulse travels clock → poller → queue (waker fires, task re-queued)
      const dot = K.el('circle', { cx: CLOCK.x, cy: POLLER.y + 90, r: 6, fill: c.amber, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: POLLER.x + POLLER.w / 2, cy: POLLER.y + 90, duration: dur(280), ease: 'inOutQuad' });
      await animate(dot, { cx: QUEUE.x + QUEUE.w / 2, cy: slotY(Math.max(0, st.ready.length - 1)) + 8, duration: dur(280), ease: 'inOutQuad' });
      await animate(dot, { r: [6, 12], opacity: [1, 0], duration: dur(150), ease: 'out(2)' });
      dot.remove();
    }
    function leapClock(a, b) {
      const clk = E('clk');
      // glow surge while the number leaps
      animate(clk, { opacity: [1, 0.55, 1], duration: dur(420), ease: 'inOut(2)' });
      const p = { v: a };
      return animate(p, {
        v: b, duration: dur(420), ease: 'out(2)',
        onUpdate: () => clk.textContent = fmtVt(Math.round(p.v)),
        onComplete: () => clk.textContent = fmtVt(b),
      });
    }

    function spawnSleep() {
      // schedule a far-future wake exactly 1s of VIRTUAL time past the current clock.
      const deadline = st.vt + SEC;
      const tid = ++st.seq;
      st.timers.push({ id: tid, label: `task#${tid} sleep(1s)`, deadline });
      K.addLog(logBody, `spawn: task#${tid} → sleep(1s), parks until ${fmtVt(deadline)} (virtual)`, 'hl');
      // if we're mid-loop at idle, the next auto-advance leaps to this deadline.
      if (st.phase === 0 || st.phase === 1) { /* will be picked up by park→advance */ }
      render();
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-spawn').onclick = () => { if (!st.busy) spawnSleep(); };
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }
    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await stepOnce(); if (!st.playing) break; await K.delay(dur(420)); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      st.vt = 0; st.polls = 0; st.parks = 0; st.seq = 0; st.phase = 0;
      st.ready = []; st.timers = []; st.busy = false; setLock(false);
      // seed two ready tasks + one parked sleep so phase 1 has something to leap to.
      st.ready = [
        { id: ++st.seq, label: `task#${st.seq} hello`, completes: true },
        { id: ++st.seq, label: `task#${st.seq} setup`, completes: true },
      ];
      const tid = ++st.seq;
      st.timers = [{ id: tid, label: `task#${tid} sleep(1s)`, deadline: SEC }];
      drawScene(); render(); setState('idle', 'press Step phase', c.muted);
      K.addLog(logBody, '↺ reset — start_paused(true) · clock frozen at 0', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-reset', '.t-spawn'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    // initial seed
    st.ready = [
      { id: ++st.seq, label: `task#${st.seq} hello`, completes: true },
      { id: ++st.seq, label: `task#${st.seq} setup`, completes: true },
    ];
    const tid0 = ++st.seq;
    st.timers = [{ id: tid0, label: `task#${tid0} sleep(1s)`, deadline: SEC }];
    render(); setState('idle', 'press Step phase', c.muted);
    K.addLog(logBody, '🌱 ready — start_paused(true) · sleep(1h) costs 0 real µs', 'hl');

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTokioRuntime = { init };
})();
