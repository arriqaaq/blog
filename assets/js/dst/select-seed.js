/**
 * DST Seeded select! ordering (built on dst-kit) — same seed, same branch, same race.
 *
 * tokio::select! polls its branches in an order chosen by the runtime. Under an UNSEEDED
 * runtime that order is pseudo-random, so when several branches are ready at once a different
 * one can win each Run — a flaky, irreproducible race. Under a SEEDED runtime
 * (Builder::rng_seed(seed)) the poll order is a deterministic function of the seed: every Run
 * with the same seed visits the branches in the SAME order, the SAME branch wins, and the
 * downstream history is identical. Three branches are ready together (recv A, recv B, timer);
 * we show the poll order, the winner, and a verdict comparing this run to the first.
 *
 * Exposes window.DSTSelectSeed.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('select-seed: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('select-seed: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 250;
  const BR = { y: 54, w: 220, h: 96, gap: 24, x0: 40 };
  const BRANCHES = [
    { key: 'A', label: 'recv A', expr: 'rx_a.recv()', zone: 'blue' },
    { key: 'B', label: 'recv B', expr: 'rx_b.recv()', zone: 'green' },
    { key: 'T', label: 'timer fires', expr: 'sleep(d).await', zone: 'amber' },
  ];
  const bx = (i) => BR.x0 + i * (BR.w + BR.gap);

  const SNIPPET = `let rt = Builder::new_current_thread()
    .rng_seed(seed)   // deterministic select! poll order
    .build();

select! {
    a = rx_a.recv() => win("A"),  // all three are ready
    b = rx_b.recv() => win("B"),  // at the same instant
    _ = sleep(d)     => win("T"),
}`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      seed: 7, seeded: true, run: 0, busy: false, speed: 1,
      order: [0, 1, 2], winner: null, firstWinner: null, unseededTick: 0,
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
        <div class="dstk-tgroup"><span class="dstk-tlabel">mode</span>
          <button class="dstk-btn dstk-btn--green t-mode">${modeLabel()}</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }
    function modeLabel() { return st.seeded ? 'Seeded (rng_seed)' : 'Unseeded'; }

    function build() {
      root.innerHTML = K.container({
        title: 'Seeded select! ordering', sub: 'same seed, same branch, same race',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'run', label: 'runs' }, { id: 'winner', label: 'winner' }, { id: 'verdict', label: 'verdict' }],
        cap: K.highlightRust(SNIPPET),
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 ready — three branches ready at once · ' + modeLabel(), 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      K.el('text', { x: BR.x0, y: 30, fill: c.accent, 'font-size': 12, 'font-weight': 700 }, content)
        .textContent = 'select! { … }';
      K.el('text', { x: BR.x0 + 96, y: 30, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'all three branches ready — poll order decides the winner';
      for (let i = 0; i < BRANCHES.length; i++) {
        const b = BRANCHES[i], x = bx(i);
        K.el('rect', { id: id('box', i), x, y: BR.y, width: BR.w, height: BR.h, rx: 10,
          fill: K.grad(uid, b.zone), stroke: c[b.zone], 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: BR.y + 20, r: 4.5, fill: c[b.zone] }, content);
        K.el('text', { x: x + 28, y: BR.y + 24, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content)
          .textContent = b.label;
        K.el('text', { id: id('rank', i), x: x + BR.w - 12, y: BR.y + 24, 'text-anchor': 'end',
          fill: c.muted, 'font-size': 10, 'font-weight': 600 }, content).textContent = 'poll —';
        K.el('text', { x: x + 14, y: BR.y + 50, fill: c.muted, 'font-size': 11,
          'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = b.expr;
        K.el('text', { x: x + 14, y: BR.y + 70, fill: c.green, 'font-size': 10 }, content).textContent = 'ready';
        K.el('text', { id: id('mark', i), x: x + BR.w - 14, y: BR.y + 72, 'text-anchor': 'end',
          fill: c[b.zone], 'font-size': 16, 'font-weight': 700 }, content).textContent = '';
      }
      // verdict strip
      K.el('text', { id: id('vline', 0), x: BR.x0, y: 196, fill: c.muted, 'font-size': 12 }, content).textContent = '';
      K.el('text', { id: id('vline', 1), x: BR.x0, y: 214, fill: c.muted, 'font-size': 11 }, content).textContent = '';
    }

    function render() {
      stat('run', st.run);
      stat('winner', st.winner == null ? '—' : BRANCHES[st.winner].key);
      const verdict = st.run < 2 ? '—' : (st.seeded ? 'identical' : 'diverged');
      stat('verdict', verdict);
      for (let i = 0; i < BRANCHES.length; i++) {
        const pos = st.order.indexOf(i);
        E('rank', i).textContent = st.winner == null ? 'poll —' : ('poll #' + (pos + 1));
        E('rank', i).setAttribute('fill', i === st.winner ? c[BRANCHES[i].zone] : c.muted);
        E('mark', i).textContent = st.winner == null ? '' : (i === st.winner ? '✓ win' : '');
        const box = E('box', i);
        box.setAttribute('stroke-width', i === st.winner ? 2.6 : 1.6);
        box.setAttribute('stroke-dasharray', (st.winner != null && i !== st.winner) ? '4,4' : '0');
      }
      E('vline', 0).setAttribute('fill', verdict === 'diverged' ? c.red : (verdict === 'identical' ? c.green : c.muted));
      E('vline', 1).setAttribute('fill', c.muted);
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    // Deterministic Fisher–Yates from a seeded rng → the poll order. Seeded mode reuses the
    // seed every run (identical order). Unseeded mode mixes in a run-local nonce (order varies).
    function pollOrder() {
      const seed = st.seeded ? (st.seed >>> 0) : (((st.seed >>> 0) ^ (0x9e3779b1 * (++st.unseededTick))) >>> 0);
      const r = K.rng(seed);
      const a = [0, 1, 2];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    async function run() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.order = pollOrder();
      st.winner = null; render();
      K.addLog(logBody, 'run ' + (st.run + 1) + ': poll order ' + st.order.map((i) => BRANCHES[i].key).join('→'), 'hl');
      // sweep the branches in poll order; the first ready one wins (all are ready ⇒ order[0])
      for (let p = 0; p < st.order.length; p++) {
        const i = st.order[p];
        await poke(i);
        if (p === 0) { st.winner = i; await flashWin(i); }
      }
      st.run++;
      if (st.firstWinner == null) st.firstWinner = st.winner;
      render();
      const cur = BRANCHES[st.winner].key;
      const same = st.winner === st.firstWinner;
      K.addLog(logBody, '→ branch ' + cur + ' won' + (st.seeded ? ' (seed ' + (st.seed >>> 0) + ')' : ''),
        st.seeded ? 'ok' : 'warn');
      if (st.run >= 2) {
        if (st.seeded) {
          E('vline', 0).textContent = 'verdict: identical — every run with seed ' + (st.seed >>> 0) + ' replays the same race';
          E('vline', 1).textContent = 'first winner ' + BRANCHES[st.firstWinner].key + ' · this run ' + cur + ' · history matches';
          K.addLog(logBody, 'verdict: identical — reproducible', 'ok');
        } else {
          E('vline', 0).textContent = 'verdict: diverged — poll order reshuffles each run, winner is not reproducible';
          E('vline', 1).textContent = 'first winner ' + BRANCHES[st.firstWinner].key + ' · this run ' + cur + (same ? ' · (coincidental match)' : ' · history differs');
          K.addLog(logBody, 'verdict: diverged — flaky race', 'err');
        }
        render();
      }
      st.busy = false; setLock(false);
    }

    async function poke(i) {
      const box = E('box', i);
      box.setAttribute('stroke', c.accent);
      await animate(box, { opacity: [1, 0.6, 1], duration: dur(160), ease: 'inOut(2)' });
      box.setAttribute('stroke', c[BRANCHES[i].zone]);
    }
    async function flashWin(i) {
      const x = bx(i) + BR.w / 2, y = BR.y + BR.h / 2;
      const dot = K.el('circle', { cx: x, cy: y, r: 8, fill: c[BRANCHES[i].zone], filter: K.glow(uid) }, anim);
      await animate(dot, { r: [8, 26], opacity: [0.9, 0], duration: dur(360), ease: 'out(2)' });
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
        K.addLog(logBody, 'mode → ' + modeLabel() + (st.seeded ? ' · runs will replay identically' : ' · runs will diverge'), 'hl');
      };
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 0; resetState(); K.addLog(logBody, 'seed = ' + (st.seed >>> 0), 'hl'); };
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
    }

    function resetState() {
      st.run = 0; st.winner = null; st.firstWinner = null; st.unseededTick = 0; st.order = [0, 1, 2];
      E('vline', 0).textContent = ''; E('vline', 1).textContent = '';
      render();
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
