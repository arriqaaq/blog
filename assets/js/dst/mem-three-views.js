/**
 * MEM Three Views (dst-kit) — one cluster seen through the three things "membership" means.
 *
 * Same seven nodes, three lenses:
 *   • lens 1 — the SOFT LIVENESS VIEW: per-observer booleans that flicker every tick, disagree
 *     between observers, and cost nothing when wrong (failure detection: SWIM-land);
 *   • lens 2 — the AGREED VIEW SEQUENCE: an append-only chain v1 → v2 → … that only advances
 *     when the observers' verdicts agree; same order everywhere (group membership service);
 *   • lens 3 — the QUORUM CONFIGURATION: the tiny replica set majorities are computed from;
 *     it changes rarely, atomically, and only via the agreed sequence.
 * Crash a replica and watch the same fact ripple through the layers at three different speeds
 * and three different consistency levels. Exposes window.MEMThreeViews.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-three-views: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-three-views: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 330, N = 7;
  const CL = { cx: 145, cy: 176, r: 96 };
  const P1 = { x: 300, y: 20, w: 460, h: 92 };
  const P2 = { x: 300, y: 122, w: 460, h: 92 };
  const P3 = { x: 300, y: 224, w: 460, h: 92 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({
      seed: seed == null ? 11 : seed, rng: K.rng(seed == null ? 11 : seed),
      tick: 0, alive: Array(N).fill(true), crashedAt: Array(N).fill(-1),
      obs: [{ dead: new Set(), lag: {} }, { dead: new Set(), lag: {} }],
      flick: [new Set(), new Set()], prevCells: null,
      views: [{ n: 1, members: [0, 1, 2, 3, 4, 5, 6], note: '7 nodes' }],
      cfg: [0, 1, 2], cfgPending: null,
      softFlips: 0, cfgChanges: 0, busy: false, playing: false, speed: 1,
    });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const nodePos = (i) => {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      return { x: CL.cx + CL.r * Math.cos(a), y: CL.cy + CL.r * Math.sin(a) };
    };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Tick</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--red t-crashr">💥 crash a replica</button>
        <button class="dstk-btn dstk-btn--amber t-crashn">💥 crash a non-replica</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'One cluster, three membership lenses', sub: 'soft view · agreed views · quorum config',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'tick', label: 'tick' }, { id: 'flips', label: 'soft flips' }, { id: 'views', label: 'views' }, { id: 'cfg', label: 'config changes' }],
        cap: 'The soft view (top) changes every tick and the two observers briefly disagree — that is fine, nothing '
           + 'safety-critical reads it raw. The agreed sequence (middle) advances only when the verdicts agree. The '
           + 'replica config (bottom) moves last, atomically. Crash a non-replica: lenses 1 and 2 react, lens 3 never does.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 press Play, then crash a replica — same fact, three speeds, three consistency levels', 'hl');
    }

    function panel(p, zone, title, sub) {
      K.el('rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: 10, fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.4 }, content);
      K.el('text', { x: p.x + 12, y: p.y + 18, fill: c[zone], 'font-size': 10.5, 'font-weight': 700 }, content).textContent = title;
      K.el('text', { x: p.x + p.w - 12, y: p.y + 18, 'text-anchor': 'end', fill: c.muted, 'font-size': 8.5 }, content).textContent = sub;
    }

    function drawScene() {
      content.innerHTML = '';
      // cluster
      K.el('text', { x: CL.cx, y: 26, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'the actual cluster';
      for (let i = 0; i < N; i++) {
        const p = nodePos(i);
        K.el('circle', { id: `${uid}-n-${i}`, cx: p.x, cy: p.y, r: 17, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { id: `${uid}-nl-${i}`, x: p.x, y: p.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'n' + i;
      }
      panel(P1, 'blue', 'lens 1 — soft liveness view', 'weak · per-observer · changes every tick');
      panel(P2, 'green', 'lens 2 — agreed view sequence', 'strong · ordered · append-only');
      panel(P3, 'red', 'lens 3 — quorum configuration', 'strong · tiny · safety-critical');
      // observer row labels + cell grid group
      K.el('text', { x: P1.x + 12, y: P1.y + 42, fill: c.muted, 'font-size': 9 }, content).textContent = 'obs A';
      K.el('text', { x: P1.x + 12, y: P1.y + 66, fill: c.muted, 'font-size': 9 }, content).textContent = 'obs B';
      for (let i = 0; i < N; i++)
        K.el('text', { x: P1.x + 62 + i * 34, y: P1.y + 84, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8 }, content).textContent = 'n' + i;
      K.el('g', { id: `${uid}-cells` }, content);
      K.el('g', { id: `${uid}-vchips` }, content);
      K.el('g', { id: `${uid}-cfgchip` }, content);
      redrawCluster(); redrawCells(); redrawViews(); redrawCfg();
    }

    function redrawCluster() {
      for (let i = 0; i < N; i++) {
        const e = E('n-' + i); if (!e) continue;
        const inCfg = st.cfg.includes(i);
        e.setAttribute('stroke', st.alive[i] ? (inCfg ? c.red : c.green) : c.gray);
        e.setAttribute('fill', st.alive[i] ? K.grad(uid, inCfg ? 'red' : 'green') : K.grad(uid, 'gray'));
        e.setAttribute('stroke-width', inCfg ? 3 : 2);
        const l = E('nl-' + i); if (l) l.textContent = st.alive[i] ? 'n' + i : '✗';
      }
    }

    function cellState(o, i) {
      if (st.obs[o].dead.has(i)) return 'dead';
      if (st.flick[o].has(i)) return 'suspect';
      return 'up';
    }
    function redrawCells() {
      const g = E('cells'); g.innerHTML = '';
      const cur = [];
      for (let o = 0; o < 2; o++) {
        cur.push([]);
        for (let i = 0; i < N; i++) {
          const s = cellState(o, i); cur[o].push(s);
          const col = s === 'dead' ? c.red : s === 'suspect' ? c.amber : c.green;
          const x = P1.x + 50 + i * 34, y = P1.y + (o === 0 ? 30 : 54);
          K.el('rect', { x, y, width: 24, height: 16, rx: 4, fill: col, opacity: s === 'up' ? 0.45 : 0.95 }, g);
          if (cellState(0, i) !== cellState(1, i))
            K.el('rect', { x: x - 2.5, y: (o === 0 ? P1.y + 27.5 : y - 2.5), width: 29, height: 21, rx: 5, fill: 'none', stroke: c.amber, 'stroke-width': 1.4, 'stroke-dasharray': '3,2' }, g);
        }
      }
      if (st.prevCells) {
        for (let o = 0; o < 2; o++) for (let i = 0; i < N; i++)
          if (st.prevCells[o][i] !== cur[o][i]) st.softFlips++;
      }
      st.prevCells = cur;
    }

    function redrawViews() {
      const g = E('vchips'); g.innerHTML = '';
      const recent = st.views.slice(-4);
      recent.forEach((v, i) => {
        const x = P2.x + 14 + i * 112, y = P2.y + 34, last = i === recent.length - 1;
        K.el('rect', { x, y, width: 96, height: 34, rx: 7, fill: K.grad(uid, last ? 'green' : 'gray'), stroke: last ? c.green : c.gray, 'stroke-width': last ? 2 : 1.2 }, g);
        K.el('text', { x: x + 48, y: y + 15, 'text-anchor': 'middle', fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, g).textContent = 'v' + v.n;
        K.el('text', { x: x + 48, y: y + 28, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, g).textContent = v.note;
        if (i < recent.length - 1)
          K.el('text', { x: x + 104, y: y + 21, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11 }, g).textContent = '→';
      });
    }

    function redrawCfg() {
      const g = E('cfgchip'); g.innerHTML = '';
      const x = P3.x + 14, y = P3.y + 34;
      K.el('rect', { id: `${uid}-cfgrect`, x, y, width: 240, height: 34, rx: 7, fill: K.grad(uid, 'red'), stroke: c.red, 'stroke-width': 2 }, g);
      K.el('text', { x: x + 120, y: y + 21, 'text-anchor': 'middle', fill: c.text, 'font-size': 11.5, 'font-weight': 700 }, g)
        .textContent = 'replicas { ' + st.cfg.map((i) => 'n' + i).join(', ') + ' }';
      K.el('text', { x: x + 256, y: y + 21, fill: c.muted, 'font-size': 9 }, g)
        .textContent = st.cfgPending != null ? 'change committing…' : 'majorities = 2 of 3, from THIS set';
    }

    function crash(kind) {
      if (st.busy) return;
      const pool = kind === 'replica'
        ? st.cfg.filter((i) => st.alive[i])
        : [0, 1, 2, 3, 4, 5, 6].filter((i) => st.alive[i] && !st.cfg.includes(i));
      if (!pool.length) { K.addLog(logBody, 'nothing left to crash there', 'warn'); return; }
      const i = pool[Math.floor(st.rng() * pool.length)];
      st.alive[i] = false; st.crashedAt = st.crashedAt || []; st.crashedAt[i] = st.tick;
      st.obs.forEach((o) => { o.lag[i] = 1 + Math.floor(st.rng() * 4); });
      redrawCluster();
      K.addLog(logBody, `💥 n${i} crashed (${kind}) — observers will notice at their own pace`, 'err');
    }

    function step() {
      if (st.busy) return; st.busy = true;
      st.tick++;
      // observers: flicker + lagged detection
      for (let o = 0; o < 2; o++) {
        st.flick[o].clear();
        if (st.rng() < 0.10) {
          const up = [0, 1, 2, 3, 4, 5, 6].filter((i) => st.alive[i]);
          if (up.length) st.flick[o].add(up[Math.floor(st.rng() * up.length)]);
        }
        for (let i = 0; i < N; i++)
          if (!st.alive[i] && !st.obs[o].dead.has(i) && st.tick >= st.crashedAt[i] + st.obs[o].lag[i]) {
            st.obs[o].dead.add(i);
            K.addLog(logBody, `obs ${o === 0 ? 'A' : 'B'} declares n${i} dead (lag ${st.obs[o].lag[i]} ticks)`, 'warn');
          }
      }
      // agreed view: both observers agree a current member is dead → append exactly one new view
      const cur = st.views[st.views.length - 1].members;
      const gone = cur.find((i) => st.obs[0].dead.has(i) && st.obs[1].dead.has(i));
      if (gone != null) {
        st.views.push({ n: st.views.length + 1, members: cur.filter((i) => i !== gone), note: '− n' + gone });
        K.addLog(logBody, `view v${st.views.length} agreed: n${gone} removed — same sequence everywhere`, 'ok');
        if (st.cfg.includes(gone) && st.cfgPending == null) st.cfgPending = gone;
      }
      // config: one tick after the view lands, swap the dead replica atomically
      else if (st.cfgPending != null) {
        const dead = st.cfgPending;
        const members = st.views[st.views.length - 1].members;
        const sub = members.find((i) => !st.cfg.includes(i) && st.alive[i]);
        st.cfg = st.cfg.map((i) => (i === dead ? sub : i)).filter((i) => i != null);
        st.cfgPending = null; st.cfgChanges++;
        K.addLog(logBody, `config change committed: n${dead} → n${sub} — one atomic step, via the agreed sequence`, 'ok');
        const r = E('cfgrect'); if (r) animate(r, { opacity: [0.3, 1], duration: dur(500), ease: 'out(2)' });
      }
      redrawCluster(); redrawCells(); redrawViews(); redrawCfg(); render();
      st.busy = false;
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('tick', st.tick); stat('flips', st.softFlips); stat('views', st.views.length); stat('cfg', st.cfgChanges); }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { step(); await K.delay(dur(620)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 11); st.speed = sp;
      pp(); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}, all seven up, replicas {n0,n1,n2}`, 'hl');
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-crashr').onclick = () => crash('replica');
      root.querySelector('.t-crashn').onclick = () => crash('non-replica');
      root.querySelector('.t-reset').onclick = () => { st.playing = false; reset(); };
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = () => { st.playing = false; reset(); };
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMThreeViews = { init };
})();
