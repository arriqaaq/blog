/**
 * MEM CAP (dst-kit) — a partition forces the choice: freeze the minority, or fork the view.
 *
 * CAP without the mysticism: consistency (linearizability) is a safety property, availability
 * is a liveness property, and the partition is just the bad network FLP warned about — localized
 * to a cut. When the wall goes up you keep one or the other:
 *   • CP — the majority side keeps serving and keeps appending to the ONE view history; the
 *     minority refuses writes (no quorum) and freezes. Heal: it catches up cleanly.
 *   • AP — both sides keep serving; their view histories FORK. Heal: someone has to reconcile
 *     two truths by hand.
 * A membership service faces exactly this fork — Rapid, for instance, reconfigures only the
 * side that still holds a majority. Exposes window.MEMCap.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-cap: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-cap: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 312;
  const LNODES = [{ x: 120, y: 120 }, { x: 210, y: 90 }, { x: 300, y: 120 }];
  const RNODES = [{ x: 520, y: 120 }, { x: 640, y: 120 }];
  const WALL = { x: 405, y: 40, h: 130 };
  const CHA = { x: 40, y: 216, max: 6 };
  const CHB = { x: 40, y: 262, max: 6 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = () => ({ mode: 'cp', partitioned: false, views: 1, left: ['v1'], right: ['v1'],
      servedL: 0, servedR: 0, rejected: 0, forked: false, needsRepair: false,
      busy: false, playing: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Serve requests</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--red t-part">⚡ Partition</button>
          <button class="dstk-btn dstk-btn--blue t-cp">CP</button>
          <button class="dstk-btn dstk-btn--ghost t-ap">AP</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'CAP under partition', sub: 'CP freezes the minority; AP lets the view diverge',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'sl', label: 'served (majority)' }, { id: 'sr', label: 'served (minority)' }, { id: 'rej', label: 'rejected' }, { id: 'forks', label: 'forked histories' }],
        cap: 'Consistency here is a safety property; availability is a liveness property; the partition is the '
           + 'condition, not a knob. CP: the 2-node side loses its liveness and keeps its truth. AP: both sides '
           + 'stay lively and the truth forks — healing then means reconciling two histories by hand.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 Play a few healthy ticks, then Partition — try CP first, Reset, then AP', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      K.el('text', { x: 210, y: 34, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'majority side (3 of 5)';
      K.el('text', { x: 580, y: 34, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'minority side (2 of 5)';
      LNODES.concat(RNODES).forEach((n, i) => {
        K.el('circle', { id: `${uid}-n-${i}`, cx: n.x, cy: n.y, r: 18, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { x: n.x, y: n.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'n' + i;
      });
      // clients
      K.el('text', { x: 60, y: 66, 'text-anchor': 'middle', fill: c.blue, 'font-size': 16 }, content).textContent = '⌨';
      K.el('text', { x: 60, y: 80, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'client A';
      K.el('text', { x: 720, y: 66, 'text-anchor': 'middle', fill: c.pink, 'font-size': 16 }, content).textContent = '⌨';
      K.el('text', { x: 720, y: 80, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'client B';
      // wall
      const wall = K.el('g', { id: `${uid}-wall`, opacity: st.partitioned ? 1 : 0 }, content);
      K.el('line', { x1: WALL.x, y1: WALL.y, x2: WALL.x, y2: WALL.y + WALL.h, stroke: c.red, 'stroke-width': 4, 'stroke-dasharray': '8,6' }, wall);
      K.el('text', { x: WALL.x, y: WALL.y - 8, 'text-anchor': 'middle', fill: c.red, 'font-size': 10, 'font-weight': 700 }, wall).textContent = 'PARTITION';
      // status labels per side
      K.el('text', { id: `${uid}-stL`, x: 210, y: 168, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = '';
      K.el('text', { id: `${uid}-stR`, x: 580, y: 168, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = '';
      // history chains
      K.el('text', { x: CHA.x, y: CHA.y - 8, fill: c.muted, 'font-size': 9, 'font-weight': 700 }, content).textContent = 'majority-side history';
      K.el('text', { x: CHB.x, y: CHB.y - 8, fill: c.muted, 'font-size': 9, 'font-weight': 700 }, content).textContent = 'minority-side history';
      K.el('g', { id: `${uid}-chainA` }, content);
      K.el('g', { id: `${uid}-chainB` }, content);
      redrawChains();
    }

    function chip(g, x, y, label, zone, strong) {
      K.el('rect', { x, y, width: 74, height: 26, rx: 6, fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': strong ? 2 : 1.2 }, g);
      K.el('text', { x: x + 37, y: y + 17, 'text-anchor': 'middle', fill: c.text, 'font-size': 10, 'font-weight': 700 }, g).textContent = label;
    }
    function redrawChains() {
      const gA = E('chainA'), gB = E('chainB');
      gA.innerHTML = ''; gB.innerHTML = '';
      const recA = st.left.slice(-CHA.max), recB = st.right.slice(-CHB.max);
      recA.forEach((v, i) => chip(gA, CHA.x + i * 84, CHA.y, v, v.endsWith('ᴬ') ? 'red' : 'green', i === recA.length - 1));
      recB.forEach((v, i) => {
        const diverged = v.endsWith('ᴮ');
        const frozen = st.partitioned && st.mode === 'cp';
        chip(gB, CHB.x + i * 84, CHB.y, v, diverged ? 'red' : frozen ? 'gray' : 'green', i === recB.length - 1);
      });
      if (st.partitioned && st.mode === 'cp')
        K.el('text', { x: CHB.x + recB.length * 84 + 8, y: CHB.y + 17, fill: c.gray, 'font-size': 9.5, 'font-weight': 700 }, gB).textContent = '❄ frozen — no quorum';
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 4.5, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 420), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      if (st.needsRepair) {
        K.addLog(logBody, 'histories diverged — reconcile (Reset) before serving again', 'err');
        st.busy = false; setLock(false); return;
      }
      const jobs = [];
      // client A → majority side
      jobs.push((async () => {
        await fly(70, 70, LNODES[1].x, LNODES[1].y - 20, c.blue);
        st.servedL++;
        if (st.partitioned) st.left.push(st.mode === 'ap' ? `v${++st.views}ᴬ` : `v${++st.views}`);
        else { st.views++; st.left.push('v' + st.views); st.right.push('v' + st.views); }
        await fly(LNODES[1].x, LNODES[1].y - 20, 70, 70, c.green, 420, 3.5);
      })());
      // client B → minority side
      jobs.push((async () => {
        await fly(710, 70, RNODES[1].x, RNODES[1].y - 20, c.pink);
        if (!st.partitioned) { st.servedR++; await fly(RNODES[1].x, RNODES[1].y - 20, 710, 70, c.green, 420, 3.5); }
        else if (st.mode === 'cp') {
          st.rejected++;
          const x = K.el('text', { x: RNODES[1].x, y: RNODES[1].y - 32, 'text-anchor': 'middle', fill: c.red, 'font-size': 12, 'font-weight': 700 }, anim);
          x.textContent = '✗ no quorum';
          animate(x, { opacity: [1, 0], duration: dur(900), ease: 'in(2)', onComplete: () => x.remove() });
        } else {
          st.servedR++;
          st.right.push(`v${st.views}ᴮ`);
          if (!st.forked) { st.forked = true; K.addLog(logBody, '⚠ the minority just committed its own view — the history has FORKED', 'err'); }
          await fly(RNODES[1].x, RNODES[1].y - 20, 710, 70, c.green, 420, 3.5);
        }
      })());
      await Promise.all(jobs);
      redrawChains(); render();
      st.busy = false; setLock(false);
    }

    function setSideLabels() {
      const l = E('stL'), r = E('stR');
      if (!st.partitioned) { l.textContent = ''; r.textContent = ''; return; }
      l.textContent = 'still has a quorum → keeps going'; l.setAttribute('fill', c.green);
      if (st.mode === 'cp') { r.textContent = 'unavailable — consistent'; r.setAttribute('fill', c.gray); }
      else { r.textContent = 'available — inconsistent'; r.setAttribute('fill', c.red); }
    }

    async function togglePartition() {
      if (st.busy) return;
      const wall = E('wall');
      if (!st.partitioned) {
        st.partitioned = true;
        animate(wall, { opacity: [0, 1], duration: dur(300), ease: 'out(2)' });
        RNODES.forEach((_, i) => { const e = E('n-' + (i + 3)); if (st.mode === 'cp') { e.setAttribute('stroke', c.gray); e.setAttribute('fill', K.grad(uid, 'gray')); } });
        root.querySelector('.t-part').textContent = '💚 Heal';
        K.addLog(logBody, `⚡ partition — 3 nodes left, 2 right; mode is ${st.mode.toUpperCase()}`, 'err');
      } else {
        st.partitioned = false;
        animate(wall, { opacity: [1, 0], duration: dur(300), ease: 'in(2)' });
        RNODES.forEach((_, i) => { const e = E('n-' + (i + 3)); e.setAttribute('stroke', c.green); e.setAttribute('fill', K.grad(uid, 'green')); });
        root.querySelector('.t-part').textContent = '⚡ Partition';
        if (st.mode === 'cp') {
          // minority catches up cleanly
          st.right = st.left.slice();
          redrawChains();
          K.addLog(logBody, '💚 healed — the frozen side replays the one true history and catches up. Clean.', 'ok');
        } else if (st.forked) {
          st.needsRepair = true;
          const g = K.el('g', { opacity: 0 }, anim);
          K.el('rect', { x: 140, y: 84, width: 500, height: 30, rx: 8, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.8, filter: K.glow(uid) }, g);
          K.el('text', { x: 390, y: 104, 'text-anchor': 'middle', fill: c.amber, 'font-size': 11, 'font-weight': 700 }, g)
            .textContent = '⚠ two histories survived the partition — reconciliation is now YOUR problem';
          animate(g, { opacity: [0, 1], duration: dur(300), ease: 'out(2)' });
          K.addLog(logBody, '💚 healed — but vᴬ and vᴮ both exist. AP kept liveness and sold the truth.', 'warn');
        }
      }
      setSideLabels();
    }

    function setMode(m) {
      if (st.busy || st.partitioned) { K.addLog(logBody, 'heal (or Reset) before switching modes', 'warn'); return; }
      st.mode = m;
      root.querySelector('.t-cp').className = 'dstk-btn ' + (m === 'cp' ? 'dstk-btn--blue' : 'dstk-btn--ghost') + ' t-cp';
      root.querySelector('.t-ap').className = 'dstk-btn ' + (m === 'ap' ? 'dstk-btn--pink' : 'dstk-btn--ghost') + ' t-ap';
      K.addLog(logBody, m === 'cp'
        ? 'CP — under partition, the minority will sacrifice availability'
        : 'AP — under partition, both sides will sacrifice consistency', 'hl');
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('sl', st.servedL); stat('sr', st.servedR); stat('rej', st.rejected); stat('forks', st.forked ? 1 : 0); }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(520)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed, m = st.mode;
      st = fresh(); st.speed = sp; st.mode = m;
      pp(); anim.innerHTML = '';
      root.querySelector('.t-part').textContent = '⚡ Partition';
      drawScene(); render(); setSideLabels();
      K.addLog(logBody, '↺ reset — one history, five nodes, no wall', 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-part', '.t-cp', '.t-ap', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-part').onclick = togglePartition;
      root.querySelector('.t-cp').onclick = () => setMode('cp');
      root.querySelector('.t-ap').onclick = () => setMode('ap');
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMCap = { init };
})();
