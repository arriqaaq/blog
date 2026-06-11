/**
 * DST Pure-Function (re-skinned via dst-kit) — "run the same call twice; do the answers agree?"
 *
 * The question is the whole widget: we call checkout_total(300, 2) ten times, do that TWICE
 * (run A and run B), and ask whether run B matches run A. Each cell prints the returned value —
 * 600 (normal) or 300 (a "discount" glitch). Three versions of the function, labelled in plain
 * words (the pure/impure/seeded jargon is just a small tag):
 *   1. "uses only its inputs"        (pure)   → every call 600; A = B trivially. Reproducible.
 *   2. "secretly reads the clock"    (impure) → the glitch lands on different calls each run, so
 *                                               A ≠ B (red columns). Modelled with Math.random()
 *                                               because this version is *meant* to be irreproducible.
 *   3. "takes the clock as an input" (seeded) → still glitches, but both runs draw the SAME
 *                                               sequence from the seed, so A = B. Reproducible.
 *
 * Loud per-row verdict (✓ reproducible / ✗ can't reproduce) carries the lesson. Run re-rolls;
 * the seed input drives version 3. Exposes window.DSTPureFunction.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('pure-function: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('pure-function: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 300, CALLS = 10, P = 0.2;       // few calls, value printed in each cell
  const LANE = { x0: 20, h: 74, gap: 9, y0: 40, w: W - 40 };
  const CX0 = 212, CX1 = 612, PITCH = (CX1 - CX0) / CALLS, CW = PITCH - 6, CH = 22;
  const laneY = (i) => LANE.y0 + i * (LANE.h + LANE.gap);
  const rowY = (i, ab) => laneY(i) + 16 + ab * 28;     // ab: 0 = run A, 1 = run B
  const cellX = (col) => CX0 + col * PITCH;

  // Plain-English label first; the textbook term is a secondary tag.
  const LANES = [
    { plain: 'uses only its inputs',      code: 'price * qty',                tag: 'pure',   zone: 'green',  mode: 'pure' },
    { plain: 'secretly reads the clock',  code: 'if clock() % 5 == 0 { … }', tag: 'impure', zone: 'amber',  mode: 'wall' },
    { plain: 'takes the clock as input',  code: 'if now_in % 5 == 0 { … }',  tag: 'seeded', zone: 'purple', mode: 'seed' },
  ];

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { seed: 1337, running: false, diff: [0, 0, 0] };
    let svg, content, anim, logBody, c;
    const rid = (lane, ab, col) => `${uid}-r-${lane}-${ab}-${col}`;
    const tid = (lane, ab, col) => `${uid}-t-${lane}-${ab}-${col}`;
    const Rect = (l, a, col) => svg.querySelector('#' + CSS.escape(rid(l, a, col)));
    const Txt = (l, a, col) => svg.querySelector('#' + CSS.escape(tid(l, a, col)));
    const Eid = (k, i) => svg.querySelector('#' + CSS.escape(`${uid}-${k}-${i}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--green t-run">▶ Run twice (A &amp; B)</button>
        <button class="dstk-btn dstk-btn--ghost t-replay">↺ Try again</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed (row 3)</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Run the same call twice — do you get the same answer?', sub: 'checkout_total(300, 2)',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [
          { id: 'pure', label: 'top: A vs B' },
          { id: 'impure', label: 'mid: A vs B' },
          { id: 'seeded', label: 'low: A vs B' },
        ],
        cap: 'Each square is one call; the number is what it returned (600 normal, 300 a "discount" '
           + 'glitch). If run A and run B disagree (red columns), the bug can never be reproduced.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 ready — press Run to call each version twice and compare', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // header question + legend
      K.el('text', { x: LANE.x0 + 4, y: 22, fill: c.text, 'font-size': 11.5, 'font-weight': 700 }, content)
        .textContent = 'Call it 10× — then do it all again. Does run B match run A?';
      legendSwatch(CX1 - 156, 22, c.green, '600 normal');
      legendSwatch(CX1 - 56, 22, c.amber, '300 glitch');

      LANES.forEach((L, i) => {
        const y = laneY(i), accent = c[L.zone];
        K.el('rect', { x: LANE.x0, y, width: LANE.w, height: LANE.h, rx: 9,
          fill: K.grad(uid, L.zone), stroke: accent, 'stroke-width': 1.3 }, content);
        // left: plain words first, then code, then the textbook tag
        K.el('text', { x: LANE.x0 + 14, y: y + 20, fill: c.text, 'font-size': 12, 'font-weight': 700 }, content)
          .textContent = L.plain;
        K.el('text', { x: LANE.x0 + 14, y: y + 39, fill: c.muted, 'font-size': 9.5,
          'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = L.code;
        K.el('rect', { x: LANE.x0 + 14, y: y + 49, width: 13 + L.tag.length * 6, height: 15, rx: 7.5,
          fill: accent, 'fill-opacity': 0.16, stroke: accent, 'stroke-opacity': 0.5 }, content);
        K.el('text', { x: LANE.x0 + 20, y: y + 60, fill: accent, 'font-size': 9, 'font-weight': 700 }, content)
          .textContent = L.tag;

        // two run-rows of empty value cells
        [0, 1].forEach((ab) => {
          K.el('text', { x: CX0 - 9, y: rowY(i, ab) + CH / 2 + 4, 'text-anchor': 'end',
            fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = ab === 0 ? 'A' : 'B';
          for (let col = 0; col < CALLS; col++) {
            K.el('rect', { id: rid(i, ab, col), x: cellX(col), y: rowY(i, ab), width: CW, height: CH, rx: 3,
              fill: c.separator, 'fill-opacity': 0.4 }, content);
            K.el('text', { id: tid(i, ab, col), x: cellX(col) + CW / 2, y: rowY(i, ab) + CH / 2 + 4,
              'text-anchor': 'middle', fill: c.muted, 'font-size': 11, 'font-weight': 700,
              'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
          }
        });

        // mismatch boxes + the loud verdict
        K.el('g', { id: `${uid}-ticks-${i}` }, content);
        K.el('text', { id: `${uid}-v1-${i}`, x: CX1 + 16, y: y + 32, fill: c.muted, 'font-size': 13, 'font-weight': 700 }, content).textContent = '—';
        K.el('text', { id: `${uid}-v2-${i}`, x: CX1 + 16, y: y + 50, fill: c.muted, 'font-size': 9 }, content).textContent = 'press Run';
      });
    }

    function legendSwatch(x, y, color, label) {
      K.el('rect', { x, y: y - 9, width: 11, height: 11, rx: 2.5, fill: color, 'fill-opacity': 0.7, stroke: color }, content);
      K.el('text', { x: x + 15, y, fill: c.muted, 'font-size': 9 }, content).textContent = label;
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      const fmt = (d) => d === 0 ? 'match' : d + ' off';
      stat('pure', fmt(st.diff[0])); stat('impure', fmt(st.diff[1])); stat('seeded', fmt(st.diff[2]));
    }

    // pure → never glitches; impure → Math.random (nondeterministic, correct here);
    // seeded → two FRESH K.rng(seed) streams, so run A and run B draw the identical sequence.
    function plan() {
      const draw = (gen) => Array.from({ length: CALLS }, () => gen() < P);
      const s1 = K.rng(st.seed >>> 0), s2 = K.rng(st.seed >>> 0);
      return [
        [Array(CALLS).fill(false), Array(CALLS).fill(false)],
        [draw(Math.random), draw(Math.random)],
        [draw(s1), draw(s2)],
      ];
    }

    function paint(lane, ab, col, v) {
      const col2 = v ? c.amber : c.green, r = Rect(lane, ab, col), t = Txt(lane, ab, col);
      r.setAttribute('fill', col2); r.setAttribute('fill-opacity', 0.16);
      r.setAttribute('stroke', col2); r.setAttribute('stroke-opacity', 0.9);
      t.setAttribute('fill', col2); t.textContent = v ? '300' : '600';
      animate(r, { opacity: [0.2, 1], duration: 150, ease: 'out(2)' });
    }

    async function runAll(replay) {
      if (st.running) return;
      st.running = true; setLock(true);

      LANES.forEach((L, i) => {
        svg.querySelector('#' + CSS.escape(`${uid}-ticks-${i}`)).innerHTML = '';
        [0, 1].forEach((ab) => { for (let col = 0; col < CALLS; col++) {
          const r = Rect(i, ab, col); r.setAttribute('fill', c.separator); r.setAttribute('fill-opacity', 0.4);
          r.removeAttribute('stroke'); Txt(i, ab, col).textContent = '';
        } });
        Eid('v1', i).textContent = '…'; Eid('v2', i).textContent = '';
      });

      const data = plan();
      // sweep call-by-call across both runs and all three versions
      for (let col = 0; col < CALLS; col++) {
        LANES.forEach((L, i) => [0, 1].forEach((ab) => paint(i, ab, col, data[i][ab][col])));
        await K.delay(34);
      }

      LANES.forEach((L, i) => {
        const A = data[i][0], B = data[i][1];
        let diff = 0;
        for (let col = 0; col < CALLS; col++) if (A[col] !== B[col]) { diff++; drawTick(i, col); }
        st.diff[i] = diff;
        const same = diff === 0;
        const v1 = Eid('v1', i), v2 = Eid('v2', i);
        v1.textContent = same ? '✓ A = B' : '✗ A ≠ B';
        v1.setAttribute('fill', same ? c.green : c.red);
        v2.setAttribute('fill', same ? c.green : c.red);
        v2.textContent = L.mode === 'pure' ? 'always reproducible'
          : L.mode === 'seed' ? (same ? 'reproducible (seeded)' : 'seed mismatch?!')
          : 'can never reproduce';
      });
      render();

      K.addLog(logBody, (replay ? '↺ tried again' : '▶ ran') + ' — compared run A vs run B', 'hl');
      K.addLog(logBody, 'inputs only: A = B — same answer, always', st.diff[0] ? 'err' : 'ok');
      K.addLog(logBody, 'reads clock: ' + (st.diff[1] ? st.diff[1] + ' calls differ — unreproducible' : 'matched by luck this time'), 'warn');
      K.addLog(logBody, 'clock seeded in: A = B @ seed=' + st.seed + ' — reproducible', st.diff[2] ? 'err' : 'ok');

      st.running = false; setLock(false);
    }

    // red box around a column where run A and run B disagree — "this can't be replayed"
    function drawTick(lane, col) {
      const g = svg.querySelector('#' + CSS.escape(`${uid}-ticks-${lane}`));
      const yTop = rowY(lane, 0) - 3, yBot = rowY(lane, 1) + CH + 3;
      const box = K.el('rect', { x: cellX(col) - 2, y: yTop, width: CW + 4, height: yBot - yTop, rx: 3,
        fill: 'none', stroke: c.red, 'stroke-width': 2, opacity: 0 }, g);
      animate(box, { opacity: [0, 1], duration: 280, ease: 'out(2)' });
    }

    function bind() {
      root.querySelector('.t-run').onclick = () => runAll(false);
      root.querySelector('.t-replay').onclick = () => runAll(true);
      root.querySelector('.t-seed').onchange = (e) => {
        st.seed = parseInt(e.target.value, 10) || 0;
        K.addLog(logBody, '🌱 seed → ' + st.seed + ' · the seeded version reproduces this', 'hl');
        if (!st.running) runAll(true);
      };
    }

    function setLock(b) { K.lock(root, ['.t-run', '.t-replay', '.t-seed'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTPureFunction = { init };
})();
