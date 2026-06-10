/**
 * DST Pure-Function (re-skinned via dst-kit) — same input, same output (until a clock leaks in).
 *
 * Animates the post's opening `checkout_total(300, 2)` example as three stacked lanes, each
 * firing the SAME call repeatedly as dots flowing left→right into an output column:
 *   1. PURE      — `price * qty` → always 600 (green). Replays identically forever.
 *   2. IMPURE     — reads the wall clock (`if now % 20 == 0 { subtotal/2 }`) → ~1 call in 20
 *                  returns 300 (amber). WHICH calls hit is different every run; modelled with
 *                  Math.random() because this lane is *supposed* to be nondeterministic.
 *   3. SEEDED     — `now_nanos` passed in → deterministic given a seed via K.rng(seed). Same
 *                  seed ⇒ identical 300-sequence; replays exactly.
 *
 * Run fires all lanes; Replay re-runs (1 & 3 reproduce identically, 2 diverges). The seed input
 * binds lane 3. Exposes window.DSTPureFunction.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('pure-function: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('pure-function: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 264, CALLS = 18, ODDS = 5; // 1-in-ODDS hit rate, lively for a short demo
  const LANE = { x0: 40, w: W - 80, h: 62, gap: 12, y0: 22 };
  const SRC = { x: 132, OUT: W - 132 };          // call column x, output column x
  const laneY = (i) => LANE.y0 + i * (LANE.h + LANE.gap);

  // Lane definitions — the verbatim code each one illustrates.
  const LANES = [
    { key: 'pure', color: 'green', name: 'pure', code: 'price * qty', mode: 'always-600' },
    { key: 'impure', color: 'amber', name: 'impure', code: 'if now % 20 == 0 { subtotal/2 }', mode: 'wall-clock' },
    { key: 'seeded', color: 'purple', name: 'seeded', code: 'if now_nanos % 20 == 0 { … }', mode: 'seeded' },
  ];

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { seed: 1337, running: false, run: 0, pure: 0, impure: 0, seeded: 0, prevSeeded: null };
    let svg, content, anim, logBody, c;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--green t-run">▶ Run</button>
        <button class="dstk-btn dstk-btn--ghost t-replay">↺ Replay</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed (lane 3)</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Same input, same output', sub: 'checkout_total(300, 2) — fired 18× per lane',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [
          { id: 'pure', label: "pure 300's" },
          { id: 'impure', label: "impure 300's" },
          { id: 'seeded', label: "seeded 300's" },
        ],
        cap: "Same input, same output — until a hidden clock leaks in. Hand the clock in and it's pure again.",
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 ready — three lanes, same call · press Run', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      LANES.forEach((L, i) => {
        const y = laneY(i), my = y + LANE.h / 2;
        // lane frame
        K.el('rect', { x: LANE.x0, y, width: LANE.w, height: LANE.h, rx: 9,
          fill: K.grad(uid, L.color), stroke: c[L.color], 'stroke-width': 1.6 }, content);
        // lane label + the code it runs
        K.el('text', { x: LANE.x0 + 12, y: y + 18, fill: c[L.color], 'font-size': 11.5, 'font-weight': 700 }, content)
          .textContent = (i + 1) + '. ' + L.name;
        K.el('text', { x: LANE.x0 + 12, y: y + 36, fill: c.muted, 'font-size': 10,
          'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = L.code;
        // flight rail
        K.el('line', { x1: SRC.x, y1: my, x2: SRC.OUT, y2: my, stroke: c.separator,
          'stroke-width': 1, 'stroke-dasharray': '4,5' }, content);
        // call chip on the left
        K.el('text', { x: SRC.x, y: my - 14, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, content)
          .textContent = 'call';
        K.el('circle', { cx: SRC.x, cy: my, r: 8, fill: K.grad(uid, L.color), stroke: c[L.color], 'stroke-width': 1.4 }, content);
        // output column on the right
        K.el('text', { x: SRC.OUT, y: my - 22, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, content)
          .textContent = 'returns';
        K.el('text', { id: id('out', i), x: SRC.OUT, y: my + 7, 'text-anchor': 'middle', fill: c[L.color],
          'font-size': 22, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content)
          .textContent = '—';
        // per-lane note (right edge)
        K.el('text', { id: id('note', i), x: SRC.OUT, y: my + 24, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content)
          .textContent = noteFor(L, null);
      });
    }

    function noteFor(L, diverged) {
      if (L.mode === 'always-600') return 'pure · invariant';
      if (L.mode === 'seeded') return diverged === false ? 'seed → reproducible' : 'seed=' + st.seed;
      return diverged ? 'wall clock · diverged' : 'wall clock · nondeterministic';
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('pure', st.pure + ' / ' + CALLS);
      stat('impure', st.impure + ' / ' + CALLS);
      stat('seeded', st.seeded + ' / ' + CALLS);
    }

    // Decide, per call index, whether each lane returns the discounted 300.
    //  • pure   — never (always 600).
    //  • impure — Math.random(): genuinely nondeterministic, differs every run (correct here).
    //  • seeded — K.rng(seed): deterministic, same seed ⇒ same sequence.
    function plan() {
      const r = K.rng(st.seed >>> 0);
      const impure = [], seeded = [];
      for (let i = 0; i < CALLS; i++) {
        impure.push(Math.random() < 1 / ODDS);
        seeded.push(r() < 1 / ODDS);
      }
      return { impure, seeded };
    }

    async function runAll(replay) {
      if (st.running) return;
      st.running = true; setLock(true);
      st.run++;
      st.pure = 0; st.impure = 0; st.seeded = 0;
      LANES.forEach((L, i) => { E('out', i).textContent = '—'; E('out', i).setAttribute('fill', c[L.color]); });
      render();

      const p = plan();
      const hit = [() => false, (i) => p.impure[i], (i) => p.seeded[i]]; // per-lane predicate
      const seq = []; // seeded result sequence, to compare against the previous run

      for (let i = 0; i < CALLS; i++) {
        await Promise.all(LANES.map((L, lane) => {
          const discount = hit[lane](i);
          const val = discount ? 300 : 600;
          if (lane === 2) seq.push(val);
          return fly(lane, L, val, discount);
        }));
        await K.delay(70);
      }

      // compare seeded run to the previous one — proves determinism vs the seed
      let seededDiverged = false;
      if (st.prevSeeded) seededDiverged = st.prevSeeded.join(',') !== seq.join(',');
      st.prevSeeded = seq;

      LANES.forEach((L, i) => E('note', i).textContent =
        noteFor(L, i === 2 ? seededDiverged : (i === 1 ? true : null)));
      render();

      const tag = 'run ' + st.run + ': ';
      if (replay) {
        K.addLog(logBody, '↺ replay — pure+seeded identical, impure diverged', 'hl');
      }
      K.addLog(logBody, tag + 'pure ' + st.pure + " 300's (always 0 — invariant)", st.pure === 0 ? 'ok' : 'err');
      K.addLog(logBody, tag + 'impure ' + st.impure + " 300's @ wall-clock — unreproducible", 'warn');
      K.addLog(logBody, tag + 'seeded ' + st.seeded + " 300's @ seed=" + st.seed
        + (seededDiverged ? ' — DIVERGED?!' : ' — reproducible'), seededDiverged ? 'err' : 'ok');

      st.running = false; setLock(false);
    }

    // One call: a dot flies the rail; on arrival the output snaps to 600 or 300.
    async function fly(lane, L, val, discount) {
      const y = laneY(lane) + LANE.h / 2;
      const dot = K.el('circle', { cx: SRC.x, cy: y, r: 6,
        fill: discount ? c.amber : c[L.color], filter: K.glow(uid) }, anim);
      await animate(dot, { cx: SRC.OUT, duration: 460, ease: 'inOutQuad' });
      dot.remove();
      // tally + paint the output
      if (discount) { if (L.key === 'pure') st.pure++; else if (L.key === 'impure') st.impure++; else st.seeded++; }
      const out = E('out', lane);
      out.textContent = String(val);
      out.setAttribute('fill', discount ? c.amber : c[L.color]);
      flash(out, discount ? c.amber : c[L.color]);
      render();
    }
    function flash(el, col) {
      const old = el.getAttribute('fill');
      animate(el, { opacity: [1, 0.4, 1], duration: 220, ease: 'inOut(2)', onComplete: () => el.setAttribute('fill', old || col) });
    }

    function bind() {
      root.querySelector('.t-run').onclick = () => runAll(false);
      root.querySelector('.t-replay').onclick = () => { if (st.run === 0) return runAll(false); runAll(true); };
      root.querySelector('.t-seed').onchange = (e) => {
        st.seed = parseInt(e.target.value, 10) || 0; st.prevSeeded = null;
        E('note', 2).textContent = 'seed=' + st.seed;
        K.addLog(logBody, '🌱 seed → ' + st.seed + ' · lane 3 will reproduce this', 'hl');
      };
    }

    function setLock(b) { K.lock(root, ['.t-run', '.t-replay', '.t-seed'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTPureFunction = { init };
})();
