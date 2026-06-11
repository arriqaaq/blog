/**
 * DST select! branch ordering (built on dst-kit) — "run it twice: does the same branch win?"
 *
 * tokio::select! polls its branches in an order chosen by the runtime. Under an UNSEEDED
 * runtime that order is pseudo-random, so when several branches are ready at once a different
 * one can win each run — a flaky, irreproducible race. Under a SEEDED runtime
 * (Builder::rng_seed(seed)) the poll order is a deterministic function of the seed: every run
 * with the same seed visits the branches in the SAME order, the SAME branch wins, and the
 * downstream history is identical. Three branches are ready together (recv A, recv B, timer).
 *
 * The widget is a run-twice A/B compare: it runs the SAME select! twice (run A, run B) and asks
 * whether run B picked the same winner as run A. Unseeded ⇒ different winner ⇒ "not replayable".
 * Seeded ⇒ same winner ⇒ "replayable". The unseeded poll order uses the non-seeded JS random API
 * (Math.random) on purpose, to genuinely demonstrate nondeterminism; the seeded order is drawn
 * from K.rng(seed) so it replays identically.
 *
 * Exposes window.DSTSelectSeed.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('select-seed: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('select-seed: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 270;
  const BR = { y: 96, w: 220, h: 96, gap: 24, x0: 40 };
  const BRANCHES = [
    { key: 'A', label: 'recv A', expr: 'rx_a.recv()', zone: 'blue' },
    { key: 'B', label: 'recv B', expr: 'rx_b.recv()', zone: 'green' },
    { key: 'T', label: 'timer fires', expr: 'sleep(d)', zone: 'amber' },
  ];
  const bx = (i) => BR.x0 + i * (BR.w + BR.gap);

  // Two phase pills: run A, then run B. They light up as each run resolves.
  const PHASES = [
    { t: 'run A', zone: 'purple' },
    { t: 'run B', zone: 'purple' },
  ];
  const PILL = { y: 50, h: 26, w: 150, gap: 14, x0: 40 };
  const pillX = (i) => PILL.x0 + i * (PILL.w + PILL.gap);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      seed: 7, seeded: false, busy: false, speed: 1,
      winA: null, winB: null, phase: -1,
    };
    let svg, content, anim, logBody, c;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));
    const dur = (ms) => ms / st.speed;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-run">▶ Run twice (A &amp; B)</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">select!</span>
          <button class="dstk-btn ${st.seeded ? 'dstk-btn--green' : 'dstk-btn--red'} t-mode">${modeLabel()}</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }
    function modeLabel() { return st.seeded ? 'seeded (rng_seed)' : 'unseeded (random)'; }

    function build() {
      root.innerHTML = K.container({
        title: 'select! picks a branch at random — unless you seed it',
        sub: 'three branches ready at once · run it twice · does the same one win?',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'winA', label: 'run A picked' }, { id: 'winB', label: 'run B picked' }, { id: 'verdict', label: 'replayable?' }],
        cap: 'When several select! branches are ready at once, the runtime polls them in a random '
           + 'order and the first one polled wins. Unseeded ⇒ a different branch can win each run '
           + '(can’t replay). Builder::rng_seed pins the order ⇒ the same branch always wins.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render(); setPhase(-1);
      K.addLog(logBody, '🌱 ready — press Run to poll the branches twice · ' + modeLabel(), 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // header line
      K.el('text', { x: BR.x0, y: 26, fill: c.accent, 'font-size': 12, 'font-weight': 700,
        'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = 'select! { … }';
      K.el('text', { x: BR.x0 + 96, y: 26, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'all three branches are ready — whichever is polled first wins';

      // two run pills (A, B) that light up as each run finishes
      PHASES.forEach((p, i) => {
        K.el('rect', { id: id('pill', i), x: pillX(i), y: PILL.y, width: PILL.w, height: PILL.h, rx: 8,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: id('pilltext', i), x: pillX(i) + 14, y: PILL.y + PILL.h / 2 + 4,
          fill: c.muted, 'font-size': 12, 'font-weight': 700 }, content).textContent = p.t;
        K.el('text', { id: id('pillwin', i), x: pillX(i) + PILL.w - 12, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'end', fill: c.muted, 'font-size': 11, 'font-weight': 700 }, content).textContent = '—';
        if (i < PHASES.length - 1) K.el('text', { x: pillX(i) + PILL.w + PILL.gap / 2, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 12 }, content).textContent = 'then';
      });

      // three branch cards
      for (let i = 0; i < BRANCHES.length; i++) {
        const b = BRANCHES[i], x = bx(i);
        K.el('rect', { id: id('box', i), x, y: BR.y, width: BR.w, height: BR.h, rx: 10,
          fill: K.grad(uid, b.zone), stroke: c[b.zone], 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: BR.y + 20, r: 4.5, fill: c[b.zone] }, content);
        K.el('text', { x: x + 28, y: BR.y + 24, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content)
          .textContent = b.label;
        K.el('text', { x: x + 14, y: BR.y + 50, fill: c.muted, 'font-size': 11,
          'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = b.expr;
        K.el('text', { x: x + 14, y: BR.y + 70, fill: c.green, 'font-size': 10 }, content).textContent = '● ready';
        // big winner mark, set during a run
        K.el('text', { id: id('mark', i), x: x + BR.w - 14, y: BR.y + 74, 'text-anchor': 'end',
          fill: c[b.zone], 'font-size': 15, 'font-weight': 700 }, content).textContent = '';
      }

      // loud verdict banner (filled in after run B)
      K.el('rect', { id: id('vbox', 0), x: BR.x0, y: 212, width: W - 2 * BR.x0, height: 40, rx: 9,
        fill: 'none', stroke: 'none', opacity: 0 }, content);
      K.el('text', { id: id('vline', 0), x: W / 2, y: 230, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 14, 'font-weight': 700 }, content).textContent = '';
      K.el('text', { id: id('vline', 1), x: W / 2, y: 246, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 10.5 }, content).textContent = '';
    }

    function setPhase(k) {
      PHASES.forEach((p, i) => {
        const r = E('pill', i), t = E('pilltext', i); if (!r) return;
        const on = i === k;
        r.setAttribute('fill', on ? K.grad(uid, p.zone) : 'none');
        r.setAttribute('stroke', on ? c[p.zone] : c.separator);
        r.setAttribute('stroke-width', on ? 2.2 : 1.4);
        if (on) r.setAttribute('filter', K.glow(uid)); else r.removeAttribute('filter');
        t.setAttribute('fill', on ? c[p.zone] : c.muted);
      });
    }

    function render() {
      stat('winA', st.winA == null ? '—' : BRANCHES[st.winA].key);
      stat('winB', st.winB == null ? '—' : BRANCHES[st.winB].key);
      let verdict = '—';
      if (st.winA != null && st.winB != null) verdict = st.winA === st.winB ? 'yes' : 'no';
      stat('verdict', verdict);
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    // The poll order is a shuffle of [A,B,T]; the branch polled first wins (all are ready).
    // SEEDED: draw from K.rng(seed) — both runs use the same seed ⇒ identical order ⇒ same winner.
    // UNSEEDED: draw from the non-seeded JS random API (Math.random) — deliberately nondeterministic,
    //   so the order (and winner) genuinely varies run to run. This is the bug we want to show.
    function pollWinner() {
      const rand = st.seeded ? K.rng(st.seed >>> 0) : Math.random;
      const a = [0, 1, 2];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a[0]; // first polled ⇒ winner
    }

    function clearMarks() {
      for (let i = 0; i < BRANCHES.length; i++) {
        E('mark', i).textContent = '';
        const box = E('box', i);
        box.setAttribute('stroke-width', 1.6);
        box.setAttribute('stroke', c[BRANCHES[i].zone]);
        box.removeAttribute('stroke-dasharray');
      }
    }

    // run one of the two passes; return the winning branch index
    async function onePass(phaseIdx, label) {
      setPhase(phaseIdx);
      clearMarks();
      const winner = pollWinner();
      // sweep all three branches (they're all ready); the first-polled one wins
      for (let i = 0; i < BRANCHES.length; i++) await poke(i);
      // crown the winner
      for (let i = 0; i < BRANCHES.length; i++) {
        const box = E('box', i);
        if (i === winner) {
          box.setAttribute('stroke-width', 2.8);
          E('mark', i).textContent = '✓ won';
        } else {
          box.setAttribute('stroke-dasharray', '4,4');
        }
      }
      await flashWin(winner);
      E('pillwin', phaseIdx).textContent = BRANCHES[winner].key + ' won';
      E('pillwin', phaseIdx).setAttribute('fill', c[BRANCHES[winner].zone]);
      K.addLog(logBody, label + ': branch ' + BRANCHES[winner].key + ' won'
        + (st.seeded ? ' (seed ' + (st.seed >>> 0) + ')' : ' (random order)'), st.seeded ? 'ok' : 'warn');
      return winner;
    }

    async function run() {
      if (st.busy) return; st.busy = true; setLock(true);
      resetVisual();
      K.addLog(logBody, '▶ running the same select! twice · ' + modeLabel(), 'hl');

      st.winA = await onePass(0, 'run A');
      render();
      await K.delay(dur(420));
      st.winB = await onePass(1, 'run B');
      render();

      setPhase(-1);
      verdict();
      st.busy = false; setLock(false);
    }

    function verdict() {
      const same = st.winA === st.winB;
      const v0 = E('vline', 0), v1 = E('vline', 1), vbox = E('vbox', 0);
      if (same) {
        v0.textContent = '✓ same branch won both runs — replayable';
        v0.setAttribute('fill', c.green);
        v1.textContent = st.seeded
          ? 'seed ' + (st.seed >>> 0) + ' pins the poll order, so branch ' + BRANCHES[st.winA].key + ' always wins'
          : 'matched by luck this time — run again and it may diverge';
        v1.setAttribute('fill', c.muted);
        vbox.setAttribute('stroke', c.green); vbox.setAttribute('fill', K.grad(uid, 'green'));
      } else {
        v0.textContent = '✗ run A picked ' + BRANCHES[st.winA].key + ', run B picked '
          + BRANCHES[st.winB].key + ' — NOT replayable';
        v0.setAttribute('fill', c.red);
        v1.textContent = 'the runtime polled the branches in a different random order — '
          + 'this race can never be reproduced';
        v1.setAttribute('fill', c.muted);
        vbox.setAttribute('stroke', c.red); vbox.setAttribute('fill', K.grad(uid, 'red'));
      }
      vbox.setAttribute('stroke-width', 1.8);
      animate(vbox, { opacity: [0, 1], duration: dur(300), ease: 'out(2)' });
      animate(v0, { opacity: [0, 1], duration: dur(360), ease: 'out(2)' });
      K.addLog(logBody, same ? 'verdict: same winner — reproducible' : 'verdict: different winner — flaky race',
        same ? 'ok' : 'err');
    }

    async function poke(i) {
      const box = E('box', i);
      box.setAttribute('stroke', c.accent);
      await animate(box, { opacity: [1, 0.6, 1], duration: dur(150), ease: 'inOut(2)' });
      box.setAttribute('stroke', c[BRANCHES[i].zone]);
    }
    async function flashWin(i) {
      const x = bx(i) + BR.w / 2, y = BR.y + BR.h / 2;
      const dot = K.el('circle', { cx: x, cy: y, r: 8, fill: c[BRANCHES[i].zone], filter: K.glow(uid) }, anim);
      await animate(dot, { r: [8, 28], opacity: [0.9, 0], duration: dur(360), ease: 'out(2)' });
      dot.remove();
    }

    function bind() {
      root.querySelector('.t-run').onclick = () => { if (!st.busy) run(); };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-mode').onclick = () => {
        if (st.busy) return;
        st.seeded = !st.seeded;
        const btn = root.querySelector('.t-mode');
        btn.textContent = modeLabel();
        btn.className = 'dstk-btn ' + (st.seeded ? 'dstk-btn--green' : 'dstk-btn--red') + ' t-mode';
        resetState();
        K.addLog(logBody, 'select! → ' + modeLabel()
          + (st.seeded ? ' · runs replay identically' : ' · runs may diverge'), 'hl');
      };
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 0; resetState(); K.addLog(logBody, 'seed = ' + (st.seed >>> 0), 'hl'); };
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
    }

    function resetVisual() {
      clearMarks();
      const vbox = E('vbox', 0); vbox.setAttribute('opacity', 0); vbox.setAttribute('stroke', 'none'); vbox.setAttribute('fill', 'none');
      E('vline', 0).textContent = ''; E('vline', 1).textContent = '';
      for (let i = 0; i < PHASES.length; i++) { E('pillwin', i).textContent = '—'; E('pillwin', i).setAttribute('fill', c.muted); }
    }
    function resetState() {
      st.winA = null; st.winB = null; st.phase = -1;
      resetVisual(); setPhase(-1); render();
    }
    function reset() {
      if (st.busy) return;
      resetState();
      K.addLog(logBody, '↺ reset — ' + modeLabel() + ' · seed ' + (st.seed >>> 0), 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-run', '.t-reset', '.t-mode', '.t-seed'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTSelectSeed = { init };
})();
