/**
 * MEM Raft Reconfig (dst-kit) — changing the voter set can split unless the change stays small.
 *
 * A cluster moving from C_old to C_new. Draw a majority of each and watch whether they share a
 * member. NAIVE mode replaces several voters at once (C_old={A,B,C} → C_new={C,D,E}): a majority
 * of the old set and a majority of the new set can be DISJOINT — two independent majorities in one
 * cluster, split brain caused by the reconfiguration itself. ONE-AT-A-TIME mode changes a single
 * voter (C_old={A,B,C} → C_new={A,B,C,D}): a one-member difference makes disjoint majorities
 * impossible, so every draw overlaps. JOINT mode keeps the big jump but makes every decision a
 * majority of BOTH sets at once, so two decisions must overlap. All randomness via K.rng(seed).
 * Exposes window.MEMRaftReconfig.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-raft-reconfig: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-raft-reconfig: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 258, NY = 132, NR = 22;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({ mode: 'naive', seed: seed == null ? 5 : seed, rng: K.rng(seed == null ? 5 : seed),
      draws: 0, safe: 0, split: 0, busy: false, playing: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    const nodesFor = () => st.mode === 'single' ? ['A', 'B', 'C', 'D'] : ['A', 'B', 'C', 'D', 'E'];
    const cfgOld = () => ['A', 'B', 'C'];
    const cfgNew = () => st.mode === 'single' ? ['A', 'B', 'C', 'D'] : ['C', 'D', 'E'];
    const maj = (cfg) => Math.floor(cfg.length / 2) + 1;
    const xFor = (id) => {
      const ns = nodesFor(), i = ns.indexOf(id), span = 108, x0 = (W - (ns.length - 1) * span) / 2;
      return x0 + i * span;
    };
    const bx = (ids) => { const xs = ids.map(xFor); return [Math.min(...xs) - 30, Math.max(...xs) + 30]; };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Draw two majorities</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--red t-naive">naive switch</button>
          <button class="dstk-btn dstk-btn--ghost t-single">one-at-a-time</button>
          <button class="dstk-btn dstk-btn--ghost t-joint">joint consensus</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Reconfiguring the voter set', sub: 'a change is safe only when consecutive majorities must overlap',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'draws', label: 'draws' }, { id: 'safe', label: 'overlap' }, { id: 'split', label: 'split brain' }],
        cap: 'Naive switch (C_old={A,B,C} → C_new={C,D,E}): a majority of the old set and a majority of the new set '
           + 'can be disjoint — two majorities decide independently, which is split brain. One-at-a-time '
           + '(C_new={A,B,C,D}): a single-member change cannot produce disjoint majorities, so every draw overlaps. '
           + 'Joint consensus: every decision must be a majority of BOTH sets, so two decisions always overlap.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 keep drawing in naive mode — sooner or later two majorities miss each other', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      const ns = nodesFor(), old = cfgOld(), nu = cfgNew();
      const [oa, ob] = bx(old);
      K.el('line', { x1: oa, y1: NY - 52, x2: ob, y2: NY - 52, stroke: c.blue, 'stroke-width': 1.3, 'stroke-dasharray': '4,4', opacity: 0.75 }, content);
      K.el('text', { x: oa, y: NY - 60, fill: c.blue, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'C_old = {' + old.join(',') + '}  — Q1 is a majority of this';
      const [na, nb] = bx(nu);
      K.el('line', { x1: na, y1: NY + 56, x2: nb, y2: NY + 56, stroke: c.pink, 'stroke-width': 1.3, 'stroke-dasharray': '4,4', opacity: 0.75 }, content);
      K.el('text', { x: nb, y: NY + 72, 'text-anchor': 'end', fill: c.pink, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'C_new = {' + nu.join(',') + '}  — Q2 is a majority of this';
      ns.forEach((id) => {
        K.el('circle', { id: `${uid}-n-${id}`, cx: xFor(id), cy: NY, r: NR, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { x: xFor(id), y: NY + 4.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = id;
      });
      K.el('text', { id: `${uid}-verdict`, x: W / 2, y: H - 22, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = '';
      K.el('g', { id: `${uid}-rings` }, content);
    }

    function pickN(list, n) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(st.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a.slice(0, n).sort();
    }
    // a joint quorum: a majority of the old set AND a majority of the new set, unioned
    function pickJoint() {
      const u = new Set([...pickN(cfgOld(), maj(cfgOld())), ...pickN(cfgNew(), maj(cfgNew()))]);
      return [...u].sort();
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      const rings = E('rings'); rings.innerHTML = '';
      nodesFor().forEach((id) => { const e = E('n-' + id); e.setAttribute('stroke', c.green); e.removeAttribute('filter'); });
      let q1, q2;
      if (st.mode === 'joint') { q1 = pickJoint(); q2 = pickJoint(); }
      else { q1 = pickN(cfgOld(), maj(cfgOld())); q2 = pickN(cfgNew(), maj(cfgNew())); }
      const shared = q1.filter((x) => q2.includes(x));
      st.draws++;
      const g1 = K.el('g', { opacity: 0 }, rings), g2 = K.el('g', { opacity: 0 }, rings);
      q1.forEach((id) => K.el('circle', { cx: xFor(id), cy: NY, r: NR + 6, fill: 'none', stroke: c.blue, 'stroke-width': 2.4 }, g1));
      q2.forEach((id) => K.el('circle', { cx: xFor(id), cy: NY, r: NR + 11, fill: 'none', stroke: c.pink, 'stroke-width': 2.4 }, g2));
      await animate(g1, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
      await animate(g2, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
      const verdict = E('verdict');
      if (shared.length) {
        st.safe++;
        shared.forEach((id) => { const e = E('n-' + id); e.setAttribute('stroke', c.amber); e.setAttribute('filter', K.glow(uid)); animate(e, { r: [NR, NR + 5, NR], duration: dur(480), ease: 'inOut(2)' }); });
        const why = st.mode === 'naive' ? 'this draw happened to overlap — but a naive switch can still split; keep drawing'
          : (st.mode === 'single' ? 'a one-member change → majorities must overlap' : 'joint → both majorities → they must overlap');
        verdict.textContent = `Q1={${q1.join(',')}} ∩ Q2={${q2.join(',')}} = {${shared.join(',')}} — ${why}`;
        verdict.setAttribute('fill', st.mode === 'naive' ? c.amber : c.green);
        K.addLog(logBody, `overlap at {${shared.join(',')}}`, 'ok');
      } else {
        st.split++;
        q1.concat(q2).forEach((id) => { E('n-' + id).setAttribute('stroke', c.red); });
        verdict.textContent = `Q1={${q1.join(',')}} and Q2={${q2.join(',')}} share NOTHING → SPLIT BRAIN`;
        verdict.setAttribute('fill', c.red);
        K.addLog(logBody, 'disjoint majorities across the change — two histories can now commit independently', 'err');
      }
      render();
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('draws', st.draws); stat('safe', st.safe); stat('split', st.split); }

    function setMode(m) {
      if (st.busy || st.playing) return;
      const sp = st.speed, sd = st.seed;
      st = fresh(sd); st.speed = sp; st.mode = m;
      for (const k of ['naive', 'single', 'joint']) {
        const on = k === m, col = k === 'naive' ? 'red' : (k === 'single' ? 'green' : 'blue');
        root.querySelector('.t-' + k).className = 'dstk-btn ' + (on ? 'dstk-btn--' + col : 'dstk-btn--ghost') + ' t-' + k;
      }
      drawScene(); render();
      const msg = m === 'naive' ? 'naive switch — a big jump; majorities of old and new can miss each other'
        : (m === 'single' ? 'one-at-a-time — a single-member change; majorities must overlap'
          : 'joint consensus — every decision needs a majority of both sets');
      K.addLog(logBody, msg, 'hl');
    }

    async function play() { if (st.playing) return; st.playing = true; pp(); while (st.playing) { await step(); await K.delay(dur(650)); } }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      if (st.busy) return;
      const sp = st.speed, m = st.mode;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 5); st.speed = sp; st.mode = m;
      st.playing = false; pp(); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-naive', '.t-single', '.t-joint'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-naive').onclick = () => setMode('naive');
      root.querySelector('.t-single').onclick = () => setMode('single');
      root.querySelector('.t-joint').onclick = () => setMode('joint');
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMRaftReconfig = { init };
})();
