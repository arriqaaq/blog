/**
 * DST Work-stealing vs current-thread (built on dst-kit) — why DST needs a single-threaded runtime.
 *
 * Tokio's default multi-thread runtime gives each worker its own LIFO slot + a work-stealing run
 * queue. A worker polls its LIFO slot FIRST (the last task it scheduled), then its run queue; an
 * idle worker STEALS HALF of another worker's queue. Because OS thread scheduling and which
 * worker happens to be idle vary run-to-run, the resulting poll order is nondeterministic — two
 * ready tasks can be polled in either order, so a run is not replayable. (Modeled here with
 * Math.random() on purpose: this side is supposed to be irreproducible.)
 *
 * The current-thread runtime has ONE worker draining ONE FIFO VecDeque — no LIFO slot, no
 * stealing — so the poll order is fixed (T1·T2·T3·T4) on every run. That is exactly why dst builds
 * on new_current_thread + a sequential tick_step: it removes the race.
 *
 * Citations (tokio 1.52.x):
 *   • work-stealing run queues + steal_into() takes half  → runtime/scheduler/multi_thread/queue.rs
 *   • LIFO slot polled before the run queue (last-scheduled task runs next)
 *                                                         → runtime/scheduler/multi_thread/worker.rs:117-124
 *   • single worker, one VecDeque                          → runtime/scheduler/current_thread/mod.rs:62-63
 *
 * Exposes window.DSTWorkStealing.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('work-stealing: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('work-stealing: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 250;
  const TASKS = ['T1', 'T2', 'T3', 'T4'];
  // worker columns (multi-thread mode); current-thread mode uses just the first, widened
  const COL = { y: 40, w: 230, h: 170, gap: 36, x0: 70 };
  const wx = (i) => COL.x0 + i * (COL.w + COL.gap);
  const SLOT = { dy: 42, h: 30 };   // LIFO slot row
  const QROW = { dy: 86, h: 26, gap: 8 }; // run-queue rows below the slot

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      multi: true, run: 0, busy: false, speed: 1,
      order: [], prevOrder: null, seen: new Set(),
    };
    let svg, content, anim, logBody, c;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));
    const dur = (ms) => ms / st.speed;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-run">▶ Run</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">scheduler</span>
          <button class="dstk-btn ${st.multi ? 'dstk-btn--red' : 'dstk-btn--green'} t-mode">${modeLabel()}</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }
    function modeLabel() { return st.multi ? 'multi-thread' : 'current-thread'; }
    function workerCount() { return st.multi ? 2 : 1; }

    function build() {
      root.innerHTML = K.container({
        title: 'Work-stealing vs current-thread', sub: 'why DST pins to one worker',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'mode', label: 'mode' }, { id: 'run', label: 'runs' }, { id: 'seen', label: 'orders seen' }],
        cap: 'Two ready tasks can be polled in either order on a worker pool; one thread fixes the ' +
          'order. dst uses <code>new_current_thread</code> + a sequential <code>tick_step</code> to remove this race.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 ready — ' + modeLabel() + (st.multi ? ' · LIFO slot + steal-half' : ' · one FIFO VecDeque'), 'hl');
    }

    // Draw the worker columns. In multi-thread mode each worker has a LIFO slot + a run queue;
    // in current-thread mode a single wide worker has one FIFO VecDeque (no slot, no stealing).
    function drawScene() {
      content.innerHTML = '';
      const n = workerCount();
      for (let w = 0; w < n; w++) {
        const x = wx(w);
        const colW = st.multi ? COL.w : (COL.w * 2 + COL.gap);
        K.el('rect', { id: id('wbox', w), x, y: COL.y, width: colW, height: COL.h, rx: 11,
          fill: K.grad(uid, st.multi ? 'blue' : 'green'), stroke: st.multi ? c.blue : c.green, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: COL.y + 18, r: 4.5, fill: st.multi ? c.blue : c.green }, content);
        K.el('text', { x: x + 28, y: COL.y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content)
          .textContent = st.multi ? ('W' + w) : 'W0 · current_thread';
        K.el('text', { x: x + colW - 12, y: COL.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
          .textContent = st.multi ? 'work-stealing worker' : 'single worker';

        if (st.multi) {
          // LIFO slot (amber) — polled before the run queue.
          K.el('rect', { id: id('slot', w), x: x + 14, y: COL.y + SLOT.dy, width: colW - 28, height: SLOT.h, rx: 6,
            fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.4, 'stroke-dasharray': '5 3' }, content);
          K.el('text', { id: id('slotlbl', w), x: x + 22, y: COL.y + SLOT.dy + 19, fill: c.muted, 'font-size': 10 }, content)
            .textContent = 'LIFO slot (empty)';
          K.el('text', { x: x + 22, y: COL.y + QROW.dy - 6, fill: c.muted, 'font-size': 9 }, content)
            .textContent = 'run queue ↓';
        } else {
          K.el('text', { x: x + 22, y: COL.y + QROW.dy - 6, fill: c.muted, 'font-size': 9 }, content)
            .textContent = 'VecDeque · pop_front (FIFO) ↓';
        }
      }
      // task chips live in a re-rendered sub-group
      K.el('g', { id: uid + '-chips' }, content);
      // verdict strip
      K.el('text', { id: id('vline', 0), x: COL.x0, y: COL.y + COL.h + 22, fill: c.muted, 'font-size': 12 }, content).textContent = '';
    }

    // The chips show each worker's current run-queue contents (purple task tiles).
    function renderChips(queues) {
      let g = svg.querySelector('#' + CSS.escape(uid + '-chips')); if (g) g.remove();
      g = K.el('g', { id: uid + '-chips' }, content);
      const n = workerCount();
      for (let w = 0; w < n; w++) {
        const x = wx(w);
        const colW = st.multi ? COL.w : (COL.w * 2 + COL.gap);
        const q = queues[w] || [];
        q.forEach((t, idx) => {
          const ry = COL.y + QROW.dy + idx * (QROW.h + QROW.gap);
          K.el('rect', { id: uid + '-chip-' + t, x: x + 14, y: ry, width: colW - 28, height: QROW.h, rx: 6,
            fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.4 }, g);
          K.el('text', { x: x + 24, y: ry + 17, fill: c.text, 'font-size': 11, 'font-weight': 600 }, g).textContent = t;
          K.el('text', { x: x + colW - 24, y: ry + 17, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, g)
            .textContent = 'ready';
        });
      }
    }

    function render() {
      stat('mode', modeLabel());
      stat('run', st.run);
      stat('seen', st.seen.size);
      // initial queues for display before a run
      renderChips(initialQueues());
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    // Starting layout of ready tasks across workers.
    function initialQueues() {
      if (st.multi) return [[TASKS[0], TASKS[1]], [TASKS[2], TASKS[3]]]; // W0:T1,T2  W1:T3,T4
      return [[...TASKS]]; // current_thread: all four in one FIFO
    }

    // Compute the poll order.
    //   multi-thread: a worker checks its LIFO slot first, then pops its run queue; an idle worker
    //     steals HALF of the other worker's queue. WHICH worker goes first / who is idle varies by
    //     OS scheduling, so we shuffle the per-run choices with Math.random() — intentionally
    //     nondeterministic, mirroring queue.rs steal_into + worker.rs LIFO checks.
    //   current-thread: one worker, pop_front the single VecDeque — fixed FIFO every run.
    function computeOrder() {
      if (!st.multi) return [...TASKS];

      const q = initialQueues().map((x) => x.slice());
      const order = [];
      // randomly designate which worker the scheduler runs first
      const first = Math.random() < 0.5 ? 0 : 1;
      const wseq = first === 0 ? [0, 1] : [1, 0];

      // 50%: the worker scheduled its last task into the LIFO slot first → that task is polled next.
      for (const w of wseq) {
        if (q[w].length > 1 && Math.random() < 0.5) {
          order.push(q[w].pop()); // LIFO slot wins: last-scheduled runs first
        }
      }
      // 50%: the second-running worker is idle and steals half of the first worker's remaining queue.
      const idle = wseq[1], victim = wseq[0];
      if (Math.random() < 0.5 && q[victim].length >= 2) {
        const half = Math.ceil(q[victim].length / 2);
        const stolen = q[victim].splice(0, half);
        q[idle] = q[idle].concat(stolen);
      }
      // drain remaining queues, alternating workers in their scheduled order
      let any = true;
      while (any) {
        any = false;
        for (const w of wseq) {
          if (q[w].length) { order.push(q[w].shift()); any = true; }
        }
      }
      return order;
    }

    async function run() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.order = computeOrder();
      const key = st.order.join('·');
      K.addLog(logBody, 'run ' + (st.run + 1) + ' · ' + modeLabel(), 'hl');

      // animate the poll order: walk each task in order, flash its chip, append to the trace.
      const trace = [];
      for (let p = 0; p < st.order.length; p++) {
        const t = st.order[p];
        await pollChip(t);
        trace.push(t);
        E('vline', 0).textContent = 'poll order: ' + trace.join(' · ');
      }

      st.run++;
      st.seen.add(key);
      const diff = st.prevOrder != null && key !== st.prevOrder;
      render();
      E('vline', 0).textContent = 'poll order: ' + st.order.join(' · ');

      if (st.multi) {
        const verdict = st.prevOrder == null ? 'order recorded — re-run to compare'
          : (diff ? 'order ≠ previous run ✗ not replayable' : 'order = previous run (coincidence) ✗ still not replayable');
        E('vline', 0).textContent = 'poll order ' + st.order.join('·') + '  —  ' + verdict;
        E('vline', 0).setAttribute('fill', c.red);
        K.addLog(logBody, '→ ' + st.order.join('·') + ' · ' + verdict, 'err');
      } else {
        E('vline', 0).textContent = 'poll order ' + st.order.join('·') + '  —  same order every run ✓ replayable';
        E('vline', 0).setAttribute('fill', c.green);
        K.addLog(logBody, '→ ' + st.order.join('·') + ' · fixed FIFO ✓ replayable', 'ok');
      }
      st.prevOrder = key;
      st.busy = false; setLock(false);
    }

    async function pollChip(t) {
      const chip = svg.querySelector('#' + CSS.escape(uid + '-chip-' + t));
      if (!chip) return;
      chip.setAttribute('stroke', c.accent);
      await animate(chip, { opacity: [1, 0.45, 1], duration: dur(180), ease: 'inOut(2)' });
      // a small glow pulse to mark the poll
      const bx = parseFloat(chip.getAttribute('x')) + parseFloat(chip.getAttribute('width')) / 2;
      const by = parseFloat(chip.getAttribute('y')) + parseFloat(chip.getAttribute('height')) / 2;
      const dot = K.el('circle', { cx: bx, cy: by, r: 6, fill: c.purple, filter: K.glow(uid) }, anim);
      await animate(dot, { r: [6, 18], opacity: [0.9, 0], duration: dur(220), ease: 'out(2)' });
      dot.remove();
      chip.setAttribute('stroke', c.purple);
    }

    function bind() {
      root.querySelector('.t-run').onclick = () => { if (!st.busy) run(); };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-mode').onclick = () => {
        if (st.busy) return;
        st.multi = !st.multi;
        resetState();
        const btn = root.querySelector('.t-mode');
        btn.textContent = modeLabel();
        btn.className = 'dstk-btn ' + (st.multi ? 'dstk-btn--red' : 'dstk-btn--green') + ' t-mode';
        drawScene(); render();
        K.addLog(logBody, 'scheduler → ' + modeLabel() +
          (st.multi ? ' · poll order will vary' : ' · poll order is fixed'), 'hl');
      };
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
    }

    function resetState() {
      st.run = 0; st.order = []; st.prevOrder = null; st.seen = new Set();
      const v = E('vline', 0); if (v) { v.textContent = ''; v.setAttribute('fill', c.muted); }
    }
    function reset() {
      if (st.busy) return;
      resetState(); render();
      K.addLog(logBody, '↺ reset — ' + modeLabel(), 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-run', '.t-reset', '.t-mode'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTWorkStealing = { init };
})();
