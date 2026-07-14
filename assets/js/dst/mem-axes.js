/**
 * MEM Axes (dst-kit) — the design-space explorer: pick two systems, count shared coordinates.
 *
 * The literature's "membership papers" are not competitors on one axis; they are points in a
 * ten-dimensional space. Pick any two systems and this widget lights up their coordinate on
 * each axis — green where they genuinely share a position, muted where they differ. Rapid and
 * Matchmaker Paxos share exactly 2 of 10 (both strongly consistent, both fast-path-plus-
 * fallback) — asking which is "better" compares a fleet-scale stateless membership service to
 * a single-group stateful reconfiguration mechanism. Raft and Matchmaker, by contrast, share
 * 7: they really are relatives. Exposes window.MEMAxes.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-axes: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-axes: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 470;
  const ROWY = 66, RH = 37;
  const COL1 = { x: 190, w: 275 }, COL2 = { x: 483, w: 275 };

  const AXES = [
    { id: 'A', name: 'problem layer' },
    { id: 'B', name: 'output consistency' },
    { id: 'C', name: 'policy vs mechanism' },
    { id: 'D', name: 'architecture' },
    { id: 'E', name: 'detection model' },
    { id: 'F', name: 'state across change' },
    { id: 'G', name: 'fault model' },
    { id: 'H', name: 'FLP fast path' },
    { id: 'I', name: 'scale target' },
    { id: 'J', name: 'evaluation focus' },
  ];
  // t = display text, k = coordinate key ('—' never counts as shared)
  const SYS = {
    swim: { name: 'SWIM / Lifeguard', c: {
      A: { t: 'failure detection', k: 'detect' },
      B: { t: 'weak (eventual)', k: 'weak' },
      C: { t: 'policy — detection only', k: 'policy' },
      D: { t: 'decentralized, leaderless', k: 'leaderless' },
      E: { t: 'single-observer, per-node', k: 'single' },
      F: { t: 'stateless — swap the set', k: 'stateless' },
      G: { t: 'crash (weak on grey)', k: 'crash' },
      H: { t: 'none — eventually converges', k: 'none' },
      I: { t: 'fleet-wide', k: 'fleet' },
      J: { t: 'overhead / accuracy', k: 'overhead' } } },
    rapid: { name: 'Rapid', c: {
      A: { t: 'detection + agreed views', k: 'detectview' },
      B: { t: 'strong (agreed, ordered)', k: 'strong' },
      C: { t: 'both — cut detect + commit', k: 'both' },
      D: { t: 'leaderless fast path', k: 'leaderless' },
      E: { t: 'multi-observer, multi-node cut', k: 'multi' },
      F: { t: 'stateless — swap the set', k: 'stateless' },
      G: { t: 'crash + grey / asymmetric', k: 'grey' },
      H: { t: '¾ fast vote → classical Paxos', k: 'fastpath' },
      I: { t: 'fleet-wide', k: 'fleet' },
      J: { t: 'robustness under faults', k: 'robust' } } },
    matchmaker: { name: 'Matchmaker Paxos', c: {
      A: { t: 'reconfiguration mechanism', k: 'reconfig' },
      B: { t: 'strong (agreed, ordered)', k: 'strong' },
      C: { t: 'mechanism only — no policy', k: 'mech' },
      D: { t: 'leader + matchmaker tier', k: 'leader' },
      E: { t: '— (does no detection)', k: '—' },
      F: { t: 'stateful — carries chosen values', k: 'stateful' },
      G: { t: 'crash-only', k: 'crash' },
      H: { t: '1-RTT matchmaking → election', k: 'fastpath' },
      I: { t: 'one consensus group', k: 'group' },
      J: { t: 'cost of a reconfiguration', k: 'reconfigcost' } } },
    raft: { name: 'Raft (+ conf-change)', c: {
      A: { t: 'consensus/SMR + reconfig', k: 'smr' },
      B: { t: 'strong (agreed, ordered)', k: 'strong' },
      C: { t: 'mechanism — baked in', k: 'mech' },
      D: { t: 'leader-based', k: 'leader' },
      E: { t: 'election timeout (single)', k: 'single' },
      F: { t: 'stateful — the log', k: 'stateful' },
      G: { t: 'crash-only', k: 'crash' },
      H: { t: 'steady leader → election', k: 'fastpath' },
      I: { t: 'one consensus group', k: 'group' },
      J: { t: '(various)', k: '—' } } },
    zk: { name: 'ZooKeeper / etcd', c: {
      A: { t: 'external config/membership store', k: 'store' },
      B: { t: 'strong (agreed, ordered)', k: 'strong' },
      C: { t: 'both — it is the authority', k: 'both' },
      D: { t: 'centralized ensemble', k: 'central' },
      E: { t: '— (clients watch keys)', k: '—' },
      F: { t: 'stateful — the store itself', k: 'stateful' },
      G: { t: 'crash-only', k: 'crash' },
      H: { t: 'steady leader → election', k: 'fastpath' },
      I: { t: 'auxiliary service', k: 'aux' },
      J: { t: '(various)', k: '—' } } },
  };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { s1: 'rapid', s2: 'matchmaker', speed: 1 };
    let svg, content, anim, logBody, c;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function options(sel) {
      return Object.keys(SYS).map((k) =>
        `<option value="${k}"${k === sel ? ' selected' : ''}>${SYS[k].name}</option>`).join('');
    }
    function controls() {
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">system 1</span>
          <select class="t-s1" style="width:11rem">${options(st.s1)}</select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">system 2</span>
          <select class="t-s2" style="width:11rem">${options(st.s2)}</select></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><button class="dstk-btn dstk-btn--ghost t-reset">↺ Rapid vs Matchmaker</button></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'The design-space explorer', sub: 'ten orthogonal axes — pick two systems, count shared coordinates',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'shared', label: 'shared axes' }, { id: 'diff', label: 'differing axes' }],
        cap: 'Green rows are genuinely shared coordinates; a “—” never counts. Rapid ↔ Matchmaker: 2/10 — they '
           + 'pass each other in the night. Matchmaker ↔ Raft: 7/10 — those two really are relatives. When two '
           + '“membership papers” seem to disagree, check which axes they even share first.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); compare(false);
      K.addLog(logBody, '🌱 the headline pair loads first — try Matchmaker vs Raft next (7/10: real relatives)', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      K.el('text', { id: `${uid}-h1`, x: COL1.x + COL1.w / 2, y: 40, 'text-anchor': 'middle', fill: c.blue, 'font-size': 13, 'font-weight': 700 }, content);
      K.el('text', { id: `${uid}-h2`, x: COL2.x + COL2.w / 2, y: 40, 'text-anchor': 'middle', fill: c.pink, 'font-size': 13, 'font-weight': 700 }, content);
      AXES.forEach((ax, i) => {
        const y = ROWY + i * RH;
        K.el('text', { x: 16, y: y + 17, fill: c.muted, 'font-size': 9, 'font-weight': 700 }, content).textContent = ax.id + ' · ' + ax.name;
        [[COL1, '1'], [COL2, '2']].forEach(([col, n]) => {
          K.el('rect', { id: `${uid}-r${n}-${ax.id}`, x: col.x, y, width: col.w, height: RH - 9, rx: 7, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.2 }, content);
          K.el('text', { id: `${uid}-t${n}-${ax.id}`, x: col.x + col.w / 2, y: y + 18, 'text-anchor': 'middle', fill: c.text, 'font-size': 10 }, content);
        });
        K.el('text', { id: `${uid}-eq-${ax.id}`, x: 474, y: y + 19, 'text-anchor': 'middle', fill: c.muted, 'font-size': 12, 'font-weight': 700 }, content);
      });
      K.el('text', { id: `${uid}-verdict`, x: W / 2, y: ROWY + AXES.length * RH + 26, 'text-anchor': 'middle', fill: c.text, 'font-size': 12.5, 'font-weight': 700 }, content);
    }

    function compare(pulse) {
      const a = SYS[st.s1], b = SYS[st.s2];
      E('h1').textContent = a.name;
      E('h2').textContent = b.name;
      let shared = 0;
      const sharedAxes = [];
      AXES.forEach((ax) => {
        const ca = a.c[ax.id], cb = b.c[ax.id];
        const same = ca.k === cb.k && ca.k !== '—';
        if (same) { shared++; sharedAxes.push(ax.id); }
        const zone = same ? 'green' : 'gray';
        [['1', ca], ['2', cb]].forEach(([n, cc]) => {
          const r = E(`r${n}-${ax.id}`), t = E(`t${n}-${ax.id}`);
          r.setAttribute('fill', K.grad(uid, zone));
          r.setAttribute('stroke', same ? c.green : c.separator);
          r.setAttribute('stroke-width', same ? 1.8 : 1.2);
          if (same) r.setAttribute('filter', K.glow(uid)); else r.removeAttribute('filter');
          t.textContent = cc.t;
          t.setAttribute('fill', same ? c.text : c.muted);
          if (pulse) animate(r, { opacity: [0.35, 1], duration: 320, ease: 'out(2)' });
        });
        const eq = E('eq-' + ax.id);
        eq.textContent = same ? '=' : '≠';
        eq.setAttribute('fill', same ? c.green : c.muted);
      });
      const v = E('verdict');
      if (st.s1 === st.s2) {
        v.textContent = 'same system — pick two different ones';
        v.setAttribute('fill', c.muted);
      } else {
        v.textContent = `${a.name} ↔ ${b.name}: ${shared} / 10 shared` + (sharedAxes.length ? `  (${sharedAxes.join(', ')})` : '');
        v.setAttribute('fill', shared <= 3 ? c.amber : c.green);
      }
      stat('shared', shared); stat('diff', 10 - shared);
      const famous = (st.s1 === 'rapid' && st.s2 === 'matchmaker') || (st.s1 === 'matchmaker' && st.s2 === 'rapid');
      if (pulse) K.addLog(logBody,
        famous
          ? 'the headline pair: 2/10 — not rivals, adjacent layers. Compose them; don’t rank them.'
          : `${a.name} ↔ ${b.name}: ${shared}/10 shared coordinates`,
        shared <= 3 ? 'warn' : 'ok');
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function bind() {
      root.querySelector('.t-s1').onchange = (e) => { st.s1 = e.target.value; compare(true); };
      root.querySelector('.t-s2').onchange = (e) => { st.s2 = e.target.value; compare(true); };
      root.querySelector('.t-reset').onclick = () => {
        st.s1 = 'rapid'; st.s2 = 'matchmaker';
        root.querySelector('.t-s1').value = 'rapid';
        root.querySelector('.t-s2').value = 'matchmaker';
        compare(true);
      };
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMAxes = { init };
})();
