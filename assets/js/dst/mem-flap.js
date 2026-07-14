/**
 * MEM Flap (dst-kit) — flapping is not a safety bug; it will still ruin your week.
 *
 * One flaky link. In single-observer mode, every seeded loss burst makes the lone observer
 * remove node N from the view, and every recovery adds it back: join, leave, join, leave.
 * Each view change is technically CORRECT — and each one triggers a downstream rebalance,
 * so the cost meter climbs anyway. Stability is a QUALITY property, orthogonal to safety
 * and liveness.
 *
 * Flip to multi-observer + hysteresis: two more observers with healthy links outvote the
 * flaky one, and a removal needs an agreeing majority for 3 consecutive ticks. Same seed,
 * same fault pattern — one stable verdict, flat meter. Exposes window.MEMFlap.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-flap: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-flap: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 300;
  const NODE = { x: 96, y: 128 };
  const OBS = [{ x: 300, y: 62 }, { x: 300, y: 128 }, { x: 300, y: 194 }];
  const CHAIN = { x: 40, y: 246, max: 5 };
  const METER = { x: 700, y: 40, w: 40, h: 170, cap: 10 };
  const HYST = 3;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const mkLoss = (seed) => { // seeded burst pattern — identical for both modes at the same seed
      const r = K.rng(seed), loss = []; let burst = 0;
      for (let t = 0; t < 600; t++) {
        if (burst > 0) { loss.push(true); burst--; }
        else if (r() < 0.12) { burst = 1 + Math.floor(r() * 4); loss.push(true); }
        else loss.push(false);
      }
      return loss;
    };
    const fresh = (seed) => ({
      seed: seed == null ? 3 : seed, loss: mkLoss(seed == null ? 3 : seed),
      multi: false, tick: 0, inView: true, changes: 0, agreeStreak: 0,
      views: [{ n: 1, note: '+N joins' }], busy: false, playing: false, speed: 1,
    });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Tick</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--amber t-single">single observer</button>
          <button class="dstk-btn dstk-btn--ghost t-multi">multi + hysteresis</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Flapping and its cost', sub: 'each spurious view change triggers downstream work',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'tick', label: 'tick' }, { id: 'changes', label: 'view changes' }, { id: 'moved', label: 'data rebalanced' }],
        cap: 'Same seed → the flaky link drops the exact same pings in both modes. Single observer: every burst '
           + 'flips the verdict, and every flip triggers a ~30 GB rebalance downstream. Multi-observer + 3-tick '
           + 'hysteresis: the healthy observers outvote the flaky link — same fault, one stable view, flat meter.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 Play in single-observer mode, note the meter — then Reset, switch modes, same seed', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // node N
      K.el('circle', { id: `${uid}-node`, cx: NODE.x, cy: NODE.y, r: 24, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2.4 }, content);
      K.el('text', { x: NODE.x, y: NODE.y + 5, 'text-anchor': 'middle', fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'N';
      K.el('text', { x: NODE.x, y: NODE.y + 44, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, content).textContent = 'perfectly healthy the whole time';
      // observers + links
      OBS.forEach((o, i) => {
        const active = st.multi || i === 1;
        const flaky = i === 1;
        K.el('line', { id: `${uid}-link-${i}`, x1: NODE.x + 24, y1: NODE.y, x2: o.x - 15, y2: o.y, stroke: flaky ? c.amber : c.green, 'stroke-width': 1.6, opacity: active ? 0.8 : 0.15, 'stroke-dasharray': flaky ? '5,4' : 'none' }, content);
        K.el('circle', { id: `${uid}-obs-${i}`, cx: o.x, cy: o.y, r: 15, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 2, opacity: active ? 1 : 0.2 }, content);
        K.el('text', { x: o.x, y: o.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700, opacity: active ? 1 : 0.2 }, content).textContent = 'o' + (i + 1);
        K.el('text', { id: `${uid}-ov-${i}`, x: o.x + 24, y: o.y + 4, fill: c.muted, 'font-size': 9, opacity: active ? 1 : 0.2 }, content).textContent = '';
      });
      K.el('text', { x: 300, y: 30, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content)
        .textContent = st.multi ? 'three observers · removal needs majority × 3 ticks' : 'one observer, one flaky link, no hysteresis';
      // verdict
      K.el('text', { id: `${uid}-verdict`, x: 470, y: 132, fill: c.green, 'font-size': 12, 'font-weight': 700 }, content).textContent = 'view: N is IN';
      // view chain
      K.el('text', { x: CHAIN.x, y: CHAIN.y - 10, fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'view changes (each one triggers a rebalance):';
      K.el('g', { id: `${uid}-chain` }, content);
      // meter
      K.el('text', { x: METER.x + METER.w / 2, y: METER.y - 10, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'downstream cost';
      K.el('rect', { x: METER.x, y: METER.y, width: METER.w, height: METER.h, rx: 6, fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
      K.el('rect', { id: `${uid}-meter`, x: METER.x + 3, y: METER.y + METER.h - 3, width: METER.w - 6, height: 0, rx: 4, fill: c.amber, opacity: 0.85 }, content);
      K.el('text', { id: `${uid}-meterv`, x: METER.x + METER.w / 2, y: METER.y + METER.h + 18, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '0 GB';
      redrawChain(); redrawMeter();
    }

    function redrawChain() {
      const g = E('chain'); g.innerHTML = '';
      const recent = st.views.slice(-CHAIN.max);
      recent.forEach((v, i) => {
        const x = CHAIN.x + i * 118, last = i === recent.length - 1;
        const rm = v.note.startsWith('−');
        K.el('rect', { x, y: CHAIN.y, width: 104, height: 30, rx: 7, fill: K.grad(uid, last ? (rm ? 'red' : 'green') : 'gray'), stroke: last ? (rm ? c.red : c.green) : c.gray, 'stroke-width': last ? 2 : 1.2 }, g);
        K.el('text', { x: x + 52, y: CHAIN.y + 19, 'text-anchor': 'middle', fill: c.text, 'font-size': 10, 'font-weight': 700 }, g).textContent = `v${v.n} ${v.note}`;
        if (i < recent.length - 1) K.el('text', { x: x + 111, y: CHAIN.y + 19, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10 }, g).textContent = '→';
      });
    }
    function redrawMeter() {
      const units = Math.min(st.changes, METER.cap);
      const h = (units / METER.cap) * (METER.h - 6);
      const m = E('meter');
      m.setAttribute('height', h); m.setAttribute('y', METER.y + METER.h - 3 - h);
      m.setAttribute('fill', units >= 6 ? c.red : c.amber);
      E('meterv').textContent = (st.changes * 30) + ' GB';
    }

    function viewChange(note) {
      st.changes++;
      st.views.push({ n: st.views.length + 1, note });
      redrawChain(); redrawMeter();
      const m = E('meter'); animate(m, { opacity: [0.4, 0.85], duration: dur(300) });
    }

    function step() {
      if (st.busy) return; st.busy = true;
      st.tick++;
      const lost = st.loss[st.tick % st.loss.length];
      // flaky link pulse
      const link = E('link-1');
      link.setAttribute('stroke', lost ? c.red : c.amber);
      animate(link, { opacity: [1, 0.5, 0.8], duration: dur(300) });
      const votes = st.multi ? [lost, false, false] : [lost]; // o2/o3 have healthy links
      votes.forEach((deadVote, i) => {
        const idx = st.multi ? i : 1;
        const t = E('ov-' + idx);
        if (t) { t.textContent = deadVote ? 'dead?' : 'alive'; t.setAttribute('fill', deadVote ? c.red : c.green); }
      });
      if (!st.multi) { const t0 = E('ov-0'), t2 = E('ov-2'); if (t0) t0.textContent = ''; if (t2) t2.textContent = ''; }
      const deadVotes = votes.filter(Boolean).length;
      const wantsDead = st.multi ? deadVotes >= 2 : deadVotes >= 1;
      if (st.multi) {
        st.agreeStreak = wantsDead ? st.agreeStreak + 1 : 0;
        if (lost && st.inView) K.addLog(logBody, `o2 missed a ping — outvoted 2:1 by healthy observers, verdict unchanged`, 'ok');
        if (st.agreeStreak >= HYST && st.inView) { st.inView = false; viewChange('− N leaves'); K.addLog(logBody, 'majority agreed for 3 ticks → N removed', 'warn'); }
        if (!wantsDead && !st.inView) { st.inView = true; viewChange('+ N joins'); }
      } else {
        if (wantsDead && st.inView) {
          st.inView = false; viewChange('− N leaves');
          K.addLog(logBody, `tick ${st.tick}: ping lost → N declared dead → view change → rebalance (+30 GB)`, 'err');
        } else if (!wantsDead && !st.inView) {
          st.inView = true; viewChange('+ N joins');
          K.addLog(logBody, `tick ${st.tick}: ping came back → N re-joins → ANOTHER rebalance (+30 GB)`, 'warn');
        }
      }
      const vd = E('verdict');
      vd.textContent = 'view: N is ' + (st.inView ? 'IN' : 'OUT');
      vd.setAttribute('fill', st.inView ? c.green : c.red);
      render();
      st.busy = false;
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('tick', st.tick); stat('changes', st.changes); stat('moved', (st.changes * 30) + ' GB'); }

    function setMode(multi) {
      st.playing = false; pp();
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 3); st.speed = sp; st.multi = multi;
      root.querySelector('.t-single').className = 'dstk-btn ' + (!multi ? 'dstk-btn--amber' : 'dstk-btn--ghost') + ' t-single';
      root.querySelector('.t-multi').className = 'dstk-btn ' + (multi ? 'dstk-btn--blue' : 'dstk-btn--ghost') + ' t-multi';
      drawScene(); render();
      K.addLog(logBody, multi
        ? 'multi-observer + hysteresis — same seed, same loss bursts, watch the meter stay flat'
        : 'single observer — every burst is a verdict', 'hl');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { step(); await K.delay(dur(450)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() { setMode(st.multi); }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-single').onclick = () => setMode(false);
      root.querySelector('.t-multi').onclick = () => setMode(true);
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMFlap = { init };
})();
