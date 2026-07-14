/**
 * MEM Quorum Overlap (dst-kit) — any two majorities of ONE config share a node.
 *
 * The pigeonhole at the heart of consensus: two majorities of the same 5-node config are 3+3
 * picks out of 5, so they must share at least one node — every time, for every random draw.
 * That shared node is why a new leader always learns what was committed before it.
 *
 * Flip to "two configs" mode and the guarantee evaporates: a majority of {A..E} and a majority
 * of {D..H} can be completely disjoint. Same quorum math, no shared truth about the member set —
 * intersection is a property of one agreed configuration, not of "majorities" in general.
 * Exposes window.MEMQuorumOverlap.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-quorum-overlap: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-quorum-overlap: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 250, NY = 128, NR = 22;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({ mode: 'one', seed: seed == null ? 7 : seed, rng: K.rng(seed == null ? 7 : seed),
      draws: 0, overlaps: 0, disjoint: 0, busy: false, playing: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    const nodesFor = () => st.mode === 'one' ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const xFor = (id) => {
      const ns = nodesFor(), i = ns.indexOf(id);
      const span = ns.length === 5 ? 100 : 77, x0 = ns.length === 5 ? 190 : 120;
      return x0 + i * span;
    };
    const cfg1 = () => st.mode === 'one' ? ['A', 'B', 'C', 'D', 'E'] : ['A', 'B', 'C', 'D', 'E'];
    const cfg2 = () => st.mode === 'one' ? ['A', 'B', 'C', 'D', 'E'] : ['D', 'E', 'F', 'G', 'H'];

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Draw two majorities</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--blue t-one">one config</button>
          <button class="dstk-btn dstk-btn--ghost t-two">two configs</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Quorum intersection', sub: 'any two majorities of one set share a member',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'draws', label: 'draws' }, { id: 'overlaps', label: 'intersecting' }, { id: 'disjoint', label: 'disjoint' }],
        cap: 'One config: 3+3 picks out of 5 must collide — the amber node is the overlap, and it appears on every '
           + 'single draw. Two configs: a majority of {A…E} and a majority of {D…H} can miss each other entirely. '
           + 'Intersection belongs to the configuration, not to the word “majority”.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 draw as many pairs as you like — in one-config mode they always intersect', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      const ns = nodesFor();
      if (st.mode === 'two') {
        K.el('line', { x1: xFor('A') - 34, y1: NY - 48, x2: xFor('E') + 34, y2: NY - 48, stroke: c.blue, 'stroke-width': 1.2, 'stroke-dasharray': '4,4', opacity: 0.7 }, content);
        K.el('text', { x: xFor('A') - 34, y: NY - 56, fill: c.blue, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'config X = {A…E} — Q1 is a majority of this';
        K.el('line', { x1: xFor('D') - 34, y1: NY + 52, x2: xFor('H') + 34, y2: NY + 52, stroke: c.pink, 'stroke-width': 1.2, 'stroke-dasharray': '4,4', opacity: 0.7 }, content);
        K.el('text', { x: xFor('H') + 34, y: NY + 68, 'text-anchor': 'end', fill: c.pink, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'config Y = {D…H} — Q2 is a majority of this';
      } else {
        K.el('line', { x1: xFor('A') - 34, y1: NY - 48, x2: xFor('E') + 34, y2: NY - 48, stroke: c.green, 'stroke-width': 1.2, 'stroke-dasharray': '4,4', opacity: 0.7 }, content);
        K.el('text', { x: xFor('A') - 34, y: NY - 56, fill: c.green, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'one agreed config {A,B,C,D,E} — both quorums are majorities of THIS';
      }
      ns.forEach((id) => {
        K.el('circle', { id: `${uid}-n-${id}`, cx: xFor(id), cy: NY, r: NR, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { x: xFor(id), y: NY + 4.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = id;
      });
      K.el('text', { id: `${uid}-verdict`, x: W / 2, y: H - 28, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = '';
      K.el('g', { id: `${uid}-rings` }, content);
      // legend
      K.el('circle', { cx: 30, cy: H - 30, r: 6, fill: 'none', stroke: c.blue, 'stroke-width': 2.4 }, content);
      K.el('text', { x: 42, y: H - 26, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'Q1';
      K.el('circle', { cx: 72, cy: H - 30, r: 6, fill: 'none', stroke: c.pink, 'stroke-width': 2.4 }, content);
      K.el('text', { x: 84, y: H - 26, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'Q2';
    }

    function pick3(list) {
      const a = list.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(st.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a.slice(0, 3).sort();
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      const rings = E('rings'); rings.innerHTML = '';
      nodesFor().forEach((id) => { const e = E('n-' + id); e.setAttribute('stroke', c.green); e.removeAttribute('filter'); });
      const q1 = pick3(cfg1()), q2 = pick3(cfg2());
      const shared = q1.filter((x) => q2.includes(x));
      st.draws++;
      const g1 = K.el('g', { opacity: 0 }, rings), g2 = K.el('g', { opacity: 0 }, rings);
      q1.forEach((id) => K.el('circle', { cx: xFor(id), cy: NY, r: NR + 6, fill: 'none', stroke: c.blue, 'stroke-width': 2.4 }, g1));
      q2.forEach((id) => K.el('circle', { cx: xFor(id), cy: NY, r: NR + 11, fill: 'none', stroke: c.pink, 'stroke-width': 2.4 }, g2));
      await animate(g1, { opacity: [0, 1], duration: dur(280), ease: 'out(2)' });
      await animate(g2, { opacity: [0, 1], duration: dur(280), ease: 'out(2)' });
      const verdict = E('verdict');
      if (shared.length) {
        st.overlaps++;
        shared.forEach((id) => {
          const e = E('n-' + id);
          e.setAttribute('stroke', c.amber); e.setAttribute('filter', K.glow(uid));
          animate(e, { r: [NR, NR + 5, NR], duration: dur(500), ease: 'inOut(2)' });
        });
        verdict.textContent = `Q1={${q1.join(',')}} ∩ Q2={${q2.join(',')}} = {${shared.join(',')}} — they must meet`;
        verdict.setAttribute('fill', c.amber);
        K.addLog(logBody, `overlap at {${shared.join(',')}} — ${st.overlaps}/${st.draws} draws intersect`, 'ok');
      } else {
        st.disjoint++;
        q1.concat(q2).forEach((id) => E('n-' + id).setAttribute('stroke', c.red));
        verdict.textContent = `Q1={${q1.join(',')}} and Q2={${q2.join(',')}} share NOTHING — two histories are now possible`;
        verdict.setAttribute('fill', c.red);
        K.addLog(logBody, 'disjoint majorities — nothing forces the second quorum to see the first', 'err');
      }
      render();
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('draws', st.draws); stat('overlaps', st.overlaps); stat('disjoint', st.disjoint); }

    function setMode(m) {
      if (st.busy || st.playing) return;
      const sp = st.speed, sd = st.seed;
      st = fresh(sd); st.speed = sp; st.mode = m;
      root.querySelector('.t-one').className = 'dstk-btn ' + (m === 'one' ? 'dstk-btn--blue' : 'dstk-btn--ghost') + ' t-one';
      root.querySelector('.t-two').className = 'dstk-btn ' + (m === 'two' ? 'dstk-btn--pink' : 'dstk-btn--ghost') + ' t-two';
      drawScene(); render();
      K.addLog(logBody, m === 'one'
        ? 'one agreed config — intersection is guaranteed by arithmetic'
        : 'two configs — “majority” no longer implies overlap', 'hl');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(650)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      if (st.busy) return;
      const sp = st.speed, m = st.mode;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 7); st.speed = sp; st.mode = m;
      st.playing = false; pp(); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-one', '.t-two'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-one').onclick = () => setMode('one');
      root.querySelector('.t-two').onclick = () => setMode('two');
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMQuorumOverlap = { init };
})();
