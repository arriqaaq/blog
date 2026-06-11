/**
 * DST Work-stealing vs current-thread (built on dst-kit) — "run the same tasks twice; same order?"
 *
 * Four ready tasks, polled by the runtime. We run them TWICE (run A, run B) and compare the order:
 *   • multi-thread (Tokio default): each worker runs its NEWEST task first (a LIFO slot) and an idle
 *     worker STEALS HALF of a neighbour's queue; the OS decides who runs first — so run A ≠ run B and
 *     the run can't be replayed. (Modelled with Math.random(): this side is meant to be irreproducible.)
 *   • current-thread: ONE worker draining ONE FIFO queue — no LIFO slot, no stealing — so run A = run B,
 *     fixed order every time. That is exactly why dst pins to new_current_thread + a sequential tick_step.
 *
 * Citations (tokio 1.52.1): work-stealing run queues + steal_into() takes half →
 * runtime/scheduler/multi_thread/queue.rs:443 ("Steals half the tasks from self"); the LIFO slot
 * + run_queue fields live at multi_thread/worker.rs:115-120, and the slot is polled BEFORE the run
 * queue in next_local_task — worker.rs:1124-1126 (run_queue.pop_lifo().or_else(|| run_queue.pop()));
 * single worker, one VecDeque → current_thread/mod.rs:62-63.
 * Exposes window.DSTWorkStealing.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('work-stealing: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('work-stealing: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 280, TASKS = ['T1', 'T2', 'T3', 'T4'], N = TASKS.length;
  const ROWX = 150, CELLW = 78, CELLH = 30, PITCH = 86;     // poll-order cell rows
  const rowY = (ab) => 150 + ab * 40;                        // ab: 0 = run A, 1 = run B
  const cellX = (col) => ROWX + col * PITCH;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { multi: true, busy: false, run: 0, diff: 0, speed: 1 };
    let svg, content, anim, logBody, c;
    const Eid = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const dur = (ms) => ms / st.speed;

    build();

    function modeLabel() { return st.multi ? 'multi-thread' : 'current-thread'; }

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-run">▶ Run twice (A &amp; B)</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">runtime</span>
          <button class="dstk-btn ${st.multi ? 'dstk-btn--red' : 'dstk-btn--green'} t-mode">${modeLabel()}</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Run the same 4 tasks twice — do you get the same order?', sub: 'multi-thread vs one thread',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'mode', label: 'runtime' }, { id: 'run', label: 'runs' }, { id: 'diff', label: 'A vs B' }],
        cap: 'A worker pool runs each worker\'s newest task first and steals from neighbours, and the OS '
           + 'picks who goes first — so the poll order changes every run and can\'t be replayed. One thread '
           + 'drains one FIFO queue → same order always. That\'s why dst uses <code>new_current_thread</code>.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 ready — ' + modeLabel() + (st.multi ? ' · LIFO + steal, OS-ordered' : ' · one FIFO queue'), 'hl');
    }

    function drawScene() {
      content.innerHTML = '';

      // --- mechanism strip: WHY the order is (or isn't) reproducible ---
      if (st.multi) {
        worker(70, 'W0', ['T2', 'T1']);   // newest (T2) sits on top of the LIFO slot
        worker(300, 'W1', ['T4', 'T3']);
        // steal arrow between the two workers
        K.el('line', { x1: 250, y1: 70, x2: 296, y2: 70, stroke: c.amber, 'stroke-width': 2,
          'stroke-dasharray': '4 3', 'marker-end': K.arrow(uid, 'amber') }, content);
        K.el('text', { x: 273, y: 60, 'text-anchor': 'middle', fill: c.amber, 'font-size': 8.5, 'font-weight': 600 }, content)
          .textContent = 'steal ½';
        K.el('text', { x: 540, y: 56, fill: c.red, 'font-size': 11, 'font-weight': 700 }, content)
          .textContent = 'the OS picks';
        K.el('text', { x: 540, y: 72, fill: c.red, 'font-size': 11, 'font-weight': 700 }, content)
          .textContent = 'who runs first';
        K.el('text', { x: 540, y: 92, fill: c.muted, 'font-size': 9 }, content).textContent = '→ order varies';
      } else {
        K.el('rect', { x: 70, y: 36, width: 430, height: 70, rx: 10, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, content);
        K.el('text', { x: 84, y: 58, fill: c.text, 'font-size': 12.5, 'font-weight': 700 }, content).textContent = 'one worker · one FIFO queue';
        ['T1', 'T2', 'T3', 'T4'].forEach((t, i) => {
          K.el('rect', { x: 90 + i * 64, y: 70, width: 54, height: 24, rx: 5, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.3 }, content);
          K.el('text', { x: 117 + i * 64, y: 87, 'text-anchor': 'middle', fill: c.text, 'font-size': 10.5, 'font-weight': 600 }, content).textContent = t;
          if (i < 3) K.el('text', { x: 148 + i * 64, y: 87, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11 }, content).textContent = '→';
        });
        K.el('text', { x: 540, y: 64, fill: c.green, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'drains in order';
        K.el('text', { x: 540, y: 84, fill: c.muted, 'font-size': 9 }, content).textContent = '→ order fixed';
      }

      // --- the hero: two poll-order rows (run A, run B) compared ---
      K.el('text', { x: 70, y: 138, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'poll order — run A vs run B:';
      [0, 1].forEach((ab) => {
        K.el('text', { x: ROWX - 14, y: rowY(ab) + CELLH / 2 + 4, 'text-anchor': 'end', fill: c.muted,
          'font-size': 10, 'font-weight': 700 }, content).textContent = ab === 0 ? 'A' : 'B';
        for (let col = 0; col < N; col++) {
          K.el('rect', { id: `${uid}-cell-${ab}-${col}`, x: cellX(col), y: rowY(ab), width: CELLW, height: CELLH, rx: 6,
            fill: c.separator, 'fill-opacity': 0.4 }, content);
          K.el('text', { id: `${uid}-ct-${ab}-${col}`, x: cellX(col) + CELLW / 2, y: rowY(ab) + CELLH / 2 + 4,
            'text-anchor': 'middle', fill: c.muted, 'font-size': 12, 'font-weight': 700 }, content).textContent = '';
        }
      });
      K.el('g', { id: `${uid}-ticks` }, content);
      // loud verdict to the right of the rows
      K.el('text', { id: `${uid}-v1`, x: cellX(N) + 18, y: rowY(0) + 28, fill: c.muted, 'font-size': 15, 'font-weight': 700 }, content).textContent = '—';
      K.el('text', { id: `${uid}-v2`, x: cellX(N) + 18, y: rowY(1) + 20, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'press Run';
    }

    // a worker mini-card with its LIFO-ordered queue (top chip = newest = polled first)
    function worker(x, name, stack) {
      K.el('rect', { x, y: 36, width: 180, height: 70, rx: 10, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
      K.el('text', { x: x + 14, y: 54, fill: c.text, 'font-size': 12, 'font-weight': 700 }, content).textContent = name;
      K.el('text', { x: x + 170, y: 54, 'text-anchor': 'end', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'newest first ↓';
      stack.forEach((t, i) => {
        K.el('rect', { x: x + 14 + i * 80, y: 70, width: 70, height: 24, rx: 5,
          fill: K.grad(uid, i === 0 ? 'amber' : 'purple'), stroke: i === 0 ? c.amber : c.purple, 'stroke-width': 1.3 }, content);
        K.el('text', { x: x + 49 + i * 80, y: 87, 'text-anchor': 'middle', fill: c.text, 'font-size': 10.5, 'font-weight': 600 }, content)
          .textContent = t + (i === 0 ? ' •' : '');
      });
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('mode', modeLabel()); stat('run', st.run); stat('diff', st.run ? (st.diff ? st.diff + ' differ' : 'match') : '—'); }

    // multi-thread: a worker checks its LIFO slot first, then an idle worker steals half — which
    // worker runs first is OS-decided, so shuffle the choices with Math.random(). current-thread: FIFO.
    function computeOrder() {
      if (!st.multi) return [...TASKS];
      const q = [['T1', 'T2'], ['T3', 'T4']].map((x) => x.slice());
      const order = [];
      const wseq = Math.random() < 0.5 ? [0, 1] : [1, 0];
      for (const w of wseq) if (q[w].length > 1 && Math.random() < 0.5) order.push(q[w].pop()); // LIFO slot
      const victim = wseq[0], idle = wseq[1];
      if (Math.random() < 0.5 && q[victim].length >= 2) q[idle] = q[idle].concat(q[victim].splice(0, Math.ceil(q[victim].length / 2)));
      let any = true;
      while (any) { any = false; for (const w of wseq) if (q[w].length) { order.push(q[w].shift()); any = true; } }
      return order;
    }

    async function paintRow(ab, order) {
      for (let col = 0; col < N; col++) {
        const r = Eid(`cell-${ab}-${col}`), t = Eid(`ct-${ab}-${col}`);
        const isMulti = st.multi;
        const fillCol = ab === 0 ? c.purple : (isMulti ? c.amber : c.purple);
        r.setAttribute('fill', fillCol); r.setAttribute('fill-opacity', 0.16);
        r.setAttribute('stroke', fillCol); r.setAttribute('stroke-opacity', 0.9);
        t.setAttribute('fill', fillCol); t.textContent = order[col];
        animate(r, { opacity: [0.2, 1], duration: dur(150), ease: 'out(2)' });
        await K.delay(dur(120));
      }
    }

    async function run() {
      if (st.busy) return; st.busy = true; setLock(true);
      // reset rows + ticks
      Eid('ticks').innerHTML = '';
      [0, 1].forEach((ab) => { for (let col = 0; col < N; col++) {
        const r = Eid(`cell-${ab}-${col}`); r.setAttribute('fill', c.separator); r.setAttribute('fill-opacity', 0.4); r.removeAttribute('stroke');
        Eid(`ct-${ab}-${col}`).textContent = '';
      } });
      Eid('v1').textContent = '…'; Eid('v2').textContent = '';
      st.run++;
      K.addLog(logBody, 'run ' + st.run + ' · ' + modeLabel(), 'hl');

      const A = computeOrder(), B = computeOrder();
      await paintRow(0, A);
      await paintRow(1, B);

      // compare position-by-position
      let diff = 0;
      for (let col = 0; col < N; col++) if (A[col] !== B[col]) { diff++; drawTick(col); }
      st.diff = diff;
      const same = diff === 0;
      const v1 = Eid('v1'), v2 = Eid('v2');
      v1.textContent = same ? '✓ A = B' : '✗ A ≠ B';
      v1.setAttribute('fill', same ? c.green : c.red);
      v2.setAttribute('fill', same ? c.green : c.red);
      v2.textContent = same ? 'same order — replayable' : 'order differs — can\'t replay';
      render();
      K.addLog(logBody, 'A: ' + A.join('·') + '   B: ' + B.join('·')
        + (same ? ' — identical ✓' : ' — ' + diff + ' positions differ ✗'), same ? 'ok' : 'err');

      st.busy = false; setLock(false);
    }

    function drawTick(col) {
      const g = Eid('ticks');
      const yTop = rowY(0) - 3, yBot = rowY(1) + CELLH + 3;
      const box = K.el('rect', { x: cellX(col) - 2, y: yTop, width: CELLW + 4, height: yBot - yTop, rx: 6,
        fill: 'none', stroke: c.red, 'stroke-width': 2, opacity: 0 }, g);
      animate(box, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
    }

    function bind() {
      root.querySelector('.t-run').onclick = () => { if (!st.busy) run(); };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-mode').onclick = () => {
        if (st.busy) return;
        st.multi = !st.multi; st.run = 0; st.diff = 0;
        const btn = root.querySelector('.t-mode');
        btn.textContent = modeLabel();
        btn.className = 'dstk-btn ' + (st.multi ? 'dstk-btn--red' : 'dstk-btn--green') + ' t-mode';
        drawScene(); render();
        K.addLog(logBody, 'runtime → ' + modeLabel() + (st.multi ? ' · order will vary' : ' · order is fixed'), 'hl');
      };
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
    }

    function reset() {
      if (st.busy) return;
      st.run = 0; st.diff = 0; drawScene(); render();
      K.addLog(logBody, '↺ reset — ' + modeLabel(), 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-run', '.t-reset', '.t-mode'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTWorkStealing = { init };
})();
