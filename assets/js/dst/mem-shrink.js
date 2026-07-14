/**
 * MEM Shrink (dst-kit) — removing voters without losing committed data.
 *
 * A shrink is safe only when the voters you keep are still a majority of the voters you started
 * with:   retained ≥ ⌊n_old/2⌋+1.  Any two majorities of the same set share a member, so a kept
 * majority always overlaps the (unknown) majority that holds a committed write W — and W survives.
 * A cut that drops below an old majority is refused, because the dropped nodes could be exactly W's
 * holders. A big cut is staged (7 → 5 → 3) so every hop keeps an old majority and consecutive
 * quorums overlap.
 *
 * The write W is drawn on a worst-case majority — the nodes about to be dropped — so the danger is
 * visible: when the removed set can contain a whole old majority, W can be orphaned.
 *
 * Companion to mem-reconfig (the growth direction). Exposes window.MEMShrink.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-shrink: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-shrink: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 300;
  const SLOTX = (i) => 70 + i * 96;
  const NY = 150, NR = 26;
  const majOf = (n) => Math.floor(n / 2) + 1;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = () => ({ n: 5, view: 5, busy: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">operator · config reload</span>
        <button class="dstk-btn dstk-btn--green t-safe">remove 2 → 3</button>
        <button class="dstk-btn dstk-btn--red t-refuse">remove 3 → 2</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Removing voters without losing data', sub: 'keep a majority of the old set, or stage the cut',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'view', label: 'view' }, { id: 'nold', label: 'n_old' }, { id: 'maj', label: 'need ⌊n/2⌋+1' }, { id: 'kept', label: 'retained' }, { id: 'verdict', label: 'verdict' }],
        cap: 'A shrink is safe only when the voters you keep are still a majority of the old set — '
           + 'retained ≥ ⌊n_old/2⌋+1. Because any two majorities of the same set share a member, a kept '
           + 'majority always overlaps the (unknown) majority that holds a committed write W, so W '
           + 'survives. In a five-voter store, removing 2 keeps 3 — still a majority — so W survives. '
           + 'Removing 3 leaves only 2, below the old majority, and the dropped nodes could be exactly '
           + 'W’s holders, so that cut is refused. W is drawn on a worst-case majority — the nodes about '
           + 'to be dropped — to make the danger visible.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 a 5-voter cluster, quorum 3. A committed W lives on some majority. Remove 2 → 3 is safe; remove 3 → 2 is refused.', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // view badge
      K.el('rect', { x: 40, y: 24, width: 96, height: 30, rx: 8, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6 }, content);
      K.el('text', { id: `${uid}-viewbadge`, x: 88, y: 44, 'text-anchor': 'middle', fill: c.amber, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'view ' + st.view;
      // the one rule
      K.el('text', { x: W / 2 + 30, y: 44, 'text-anchor': 'middle', fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'safe  ⟺  retained ≥ ⌊ n_old / 2 ⌋ + 1';
      // legend
      K.el('circle', { cx: 54, cy: 268, r: 8, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
      K.el('text', { x: 68, y: 272, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'voter';
      K.el('circle', { cx: 150, cy: 268, r: 8, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 2 }, content);
      K.el('text', { x: 164, y: 272, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'holds committed write W';
      K.el('circle', { cx: 372, cy: 268, r: 8, fill: 'none', stroke: c.red, 'stroke-width': 2, 'stroke-dasharray': '4,3' }, content);
      K.el('text', { x: 386, y: 272, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'removed';
      K.el('g', { id: `${uid}-nodes` }, content);
      K.el('text', { id: `${uid}-note`, x: W / 2, y: 216, 'text-anchor': 'middle', fill: c.muted, 'font-size': 12, 'font-weight': 700 }, content).textContent = '';
      redrawNodes();
    }

    // W is committed on the last ⌊n/2⌋+1 nodes (a worst-case majority relative to a right-side cut).
    function redrawNodes() {
      const g = E('nodes'); if (!g) return; g.innerHTML = '';
      const n = st.n, wStart = n - majOf(n);
      for (let i = 0; i < n; i++) {
        const x = SLOTX(i), hasW = i >= wStart, zone = hasW ? 'amber' : 'green';
        const ng = K.el('g', { id: `${uid}-ng-${i}` }, g);
        K.el('circle', { id: `${uid}-nc-${i}`, cx: x, cy: NY, r: NR, fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 2.4 }, ng);
        K.el('text', { x, y: NY + 5, 'text-anchor': 'middle', fill: c.text, 'font-size': 15, 'font-weight': 700 }, ng).textContent = 'n' + (i + 1);
        K.el('text', { x, y: NY + NR + 16, 'text-anchor': 'middle', fill: hasW ? c.amber : c.green, 'font-size': 8.5, 'font-weight': 700 }, ng).textContent = hasW ? 'holds W' : 'voter';
        if (hasW) {
          K.el('circle', { cx: x + 19, cy: NY - 19, r: 10, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6 }, ng);
          K.el('text', { x: x + 19, y: NY - 15, 'text-anchor': 'middle', fill: c.amber, 'font-size': 10, 'font-weight': 800 }, ng).textContent = 'W';
        }
      }
    }

    function markRemoved(i) {
      const ng = E('ng-' + i); if (!ng) return;
      const circ = E('nc-' + i);
      if (circ) { circ.setAttribute('stroke', c.red); circ.setAttribute('stroke-dasharray', '5,4'); }
      const x = SLOTX(i);
      K.el('circle', { cx: x + 19, cy: NY + 19, r: 9, fill: c.red, opacity: 0.92 }, ng);
      K.el('text', { x: x + 19, y: NY + 23, 'text-anchor': 'middle', fill: '#fff', 'font-size': 11, 'font-weight': 800 }, ng).textContent = '✕';
      animate(ng, { opacity: [1, 0.4], duration: dur(400), ease: 'out(2)' });
    }

    function pulse(i, color) {
      const e = E('nc-' + i); if (!e) return;
      e.setAttribute('stroke', color); e.setAttribute('filter', K.glow(uid));
      animate(e, { r: [NR, NR + 6, NR], duration: dur(520), ease: 'inOut(2)', onComplete: () => e.removeAttribute('filter') });
    }

    function note(msg, color) {
      const nEl = E('note'); if (!nEl) return;
      nEl.textContent = msg; nEl.setAttribute('fill', color || c.muted);
      animate(nEl, { opacity: [0.3, 1], duration: dur(300), ease: 'out(2)' });
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('view', st.view); stat('nold', st.n); stat('maj', majOf(st.n)); stat('kept', '—'); stat('verdict', 'ready');
      const vb = E('viewbadge'); if (vb) vb.textContent = 'view ' + st.view;
    }

    function lockAll(b) { K.lock(root, ['.t-safe', '.t-refuse', '.t-reset'], b); }

    // One cut of k voters off a set of fromN. Draws W on a worst-case majority and shows the verdict.
    async function cut(fromN, k) {
      st.n = fromN; redrawNodes();
      const maj = majOf(fromN), retained = fromN - k, safe = retained >= maj;
      stat('view', st.view); stat('nold', fromN); stat('maj', maj); stat('kept', retained); stat('verdict', '…');
      const vb = E('viewbadge'); if (vb) vb.textContent = 'view ' + st.view;
      note(`drop ${k}: ${fromN} → ${retained} voters`, c.text);
      K.addLog(logBody, `operator drops ${k} (config reload): ${fromN} → ${retained}. A committed W lives on some majority of ${fromN} = ${maj} voters; worst case, on the ones being dropped.`, 'hl');
      await K.delay(dur(520));
      for (let i = fromN - k; i < fromN; i++) markRemoved(i);
      await K.delay(dur(680));
      if (!safe) {
        stat('verdict', 'refused');
        for (let i = fromN - maj; i < fromN; i++) pulse(i, c.red);
        note(`refused: kept ${retained} < majority of ${fromN} (${maj}) — W can be orphaned`, c.red);
        K.addLog(logBody, `refused: ${retained} kept < ${maj} needed. The ${k} dropped can contain a whole old majority, orphaning a committed W. The store rejects the cut; the view is unchanged.`, 'err');
        await K.delay(dur(950));
        st.n = fromN; redrawNodes(); stat('kept', '—');
      } else {
        st.view++;
        stat('verdict', 'safe'); stat('view', st.view);
        if (vb) vb.textContent = 'view ' + st.view;
        const survivor = fromN - maj; // leftmost W-holder — always kept when the cut is safe
        pulse(survivor, c.amber);
        note(`safe: kept ${retained} ≥ majority of ${fromN} (${maj}) — a W-holder survives`, c.green);
        K.addLog(logBody, `safe: ${retained} ≥ ${maj}. At most ${k} of W’s ${maj} holders are dropped, so ≥ ${maj - k} survive. View ${st.view}; the old and new quorums overlap.`, 'ok');
        await K.delay(dur(880));
        st.n = retained; redrawNodes();
        stat('nold', retained); stat('maj', majOf(retained)); stat('kept', '—'); stat('verdict', 'safe');
      }
    }

    function setup(n, view) { st.n = n; st.view = view; redrawNodes(); render(); }

    async function run(fn) {
      if (st.busy) return;
      st.busy = true; lockAll(true);
      try { await fn(); } finally { lockAll(false); st.busy = false; }
    }

    // function declarations (hoisted) so bind() can wire them during the initial build()
    function scenarioSafe() { return run(async () => { setup(5, 5); await K.delay(dur(280)); await cut(5, 2); }); }
    function scenarioRefuse() { return run(async () => { setup(5, 5); await K.delay(dur(280)); await cut(5, 3); }); }

    function reset() {
      if (st.busy) return;
      const sp = st.speed; st = fresh(); st.speed = sp;
      anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, '↺ reset — a 5-voter cluster, quorum 3. Try a cut.', 'hl');
    }

    function bind() {
      root.querySelector('.t-safe').onclick = scenarioSafe;
      root.querySelector('.t-refuse').onclick = scenarioRefuse;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMShrink = { init };
})();
