/**
 * MEM Detector Cost (dst-kit) — the same wrong suspicion, two very different bills.
 *
 * A failure detector wrongly says "n2 is dead" (n2 is fine). What that mistake costs depends
 * entirely on WHERE the signal goes:
 *   • lane 1 — routed through an agreement step: everyone sees the same (wrong) verdict, in the
 *     same order. Worst case: a spurious leader election. Cost: a latency blip. Performance.
 *   • lane 2 — wired straight into the voter set: nodes act on the signal at
 *     different moments, the config forks, two disjoint "majorities" commit two values. Cost:
 *     split brain. Safety.
 * Same input, opposite stakes — which is why the soft layer is ALLOWED to be wrong, and the
 * config layer is not. Exposes window.MEMDetectorCost.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-detector-cost: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-detector-cost: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 312;
  const DET = { x: 24, y: 118, w: 158, h: 76 };
  const ABOX = { x: 250, y: 42, w: 150, h: 54 };
  const NODES = [{ id: 'n1', x: 490 }, { id: 'n2', x: 575 }, { id: 'n3', x: 660 }];
  const NAY = 112, NR = 16;
  const CFG = { x: 250, y: 216, w: 160, h: 50 };
  const FORK1 = { x: 470, y: 196, w: 140, h: 40 };
  const FORK2 = { x: 470, y: 252, w: 140, h: 40 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = () => ({ suspicions: 0, elections: 0, forks: 0, leader: 'n2', busy: false, speed: 1, forked: false });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-lane1">suspicion → agreement → consensus</button>
        <button class="dstk-btn dstk-btn--red t-lane2">suspicion → straight into the config</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'What a wrong suspicion costs', sub: 'a detector error versus a configuration error',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'sus', label: 'false suspicions' }, { id: 'elec', label: 'spurious elections' }, { id: 'forks', label: 'forked histories' }],
        cap: 'The detector is wrong both times — n2 is alive. Routed through agreement, the mistake costs one '
           + 'unnecessary leader election and nothing else. Wired straight into the config, nodes act on it at '
           + 'different moments and the member set forks: disjoint majorities, two committed values, split brain.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 fire the same false suspicion down each lane and compare the bill', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // detector
      K.el('rect', { x: DET.x, y: DET.y, width: DET.w, height: DET.h, rx: 10, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.8 }, content);
      K.el('text', { x: DET.x + DET.w / 2, y: DET.y + 22, 'text-anchor': 'middle', fill: c.amber, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'failure detector';
      K.el('text', { x: DET.x + DET.w / 2, y: DET.y + 42, 'text-anchor': 'middle', fill: c.text, 'font-size': 10 }, content).textContent = 'says: “n2 is dead”';
      K.el('text', { x: DET.x + DET.w / 2, y: DET.y + 60, 'text-anchor': 'middle', fill: c.red, 'font-size': 9, 'font-weight': 700 }, content).textContent = '(it is not — false positive)';
      // lane labels
      K.el('text', { x: 250, y: 28, fill: c.purple, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'lane 1 — through the agreement box';
      K.el('text', { x: 250, y: 206, fill: c.red, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'lane 2 — no agreement box';
      // lane 1: agreement box + consensus group
      K.el('rect', { x: ABOX.x, y: ABOX.y, width: ABOX.w, height: ABOX.h, rx: 9, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.8 }, content);
      K.el('text', { x: ABOX.x + ABOX.w / 2, y: ABOX.y + 24, 'text-anchor': 'middle', fill: c.purple, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'AGREEMENT BOX';
      K.el('text', { x: ABOX.x + ABOX.w / 2, y: ABOX.y + 40, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'one ordered verdict for all';
      K.el('line', { x1: DET.x + DET.w, y1: DET.y + 16, x2: ABOX.x - 4, y2: ABOX.y + ABOX.h / 2 + 8, stroke: c.purple, 'stroke-width': 1.2, 'stroke-dasharray': '4,4', opacity: 0.5 }, content);
      NODES.forEach((n) => {
        K.el('circle', { id: `${uid}-c-${n.id}`, cx: n.x, cy: NAY, r: NR, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { x: n.x, y: NAY + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 10, 'font-weight': 700 }, content).textContent = n.id;
      });
      K.el('text', { id: `${uid}-crown`, x: NODES.find((n) => n.id === st.leader).x, y: NAY - 22, 'text-anchor': 'middle', fill: c.amber, 'font-size': 14 }, content).textContent = '♔';
      K.el('text', { id: `${uid}-verdA`, x: 490, y: 158, fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = '';
      // divider
      K.el('line', { x1: 24, y1: 178, x2: 756, y2: 178, stroke: c.separator, 'stroke-width': 1 }, content);
      // lane 2: config chip (+ fork targets, hidden)
      K.el('rect', { id: `${uid}-cfgbox`, x: CFG.x, y: CFG.y, width: CFG.w, height: CFG.h, rx: 9, fill: K.grad(uid, 'red'), stroke: c.red, 'stroke-width': 1.8 }, content);
      K.el('text', { x: CFG.x + CFG.w / 2, y: CFG.y + 22, 'text-anchor': 'middle', fill: c.red, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'voter set';
      K.el('text', { id: `${uid}-cfgtxt`, x: CFG.x + CFG.w / 2, y: CFG.y + 39, 'text-anchor': 'middle', fill: c.text, 'font-size': 10 }, content).textContent = '{ n1, n2, n3 }';
      K.el('line', { x1: DET.x + DET.w, y1: DET.y + 62, x2: CFG.x - 4, y2: CFG.y + CFG.h / 2 - 6, stroke: c.red, 'stroke-width': 1.2, 'stroke-dasharray': '4,4', opacity: 0.5 }, content);
      const f1 = K.el('g', { id: `${uid}-fork1`, opacity: 0 }, content);
      K.el('rect', { x: FORK1.x, y: FORK1.y, width: FORK1.w, height: FORK1.h, rx: 8, fill: K.grad(uid, 'red'), stroke: c.red, 'stroke-width': 1.6 }, f1);
      K.el('text', { x: FORK1.x + FORK1.w / 2, y: FORK1.y + 17, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, f1).textContent = 'node A kept: {n1,n2,n3}';
      K.el('text', { id: `${uid}-f1v`, x: FORK1.x + FORK1.w / 2, y: FORK1.y + 32, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, f1).textContent = '';
      const f2 = K.el('g', { id: `${uid}-fork2`, opacity: 0 }, content);
      K.el('rect', { x: FORK2.x, y: FORK2.y, width: FORK2.w, height: FORK2.h, rx: 8, fill: K.grad(uid, 'red'), stroke: c.red, 'stroke-width': 1.6 }, f2);
      K.el('text', { x: FORK2.x + FORK2.w / 2, y: FORK2.y + 17, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, f2).textContent = 'node B moved to: {n3,n4,n5}';
      K.el('text', { id: `${uid}-f2v`, x: FORK2.x + FORK2.w / 2, y: FORK2.y + 32, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, f2).textContent = '';
      K.el('text', { id: `${uid}-verdB`, x: 630, y: 236, fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = '';
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 5, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 500), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }

    async function lane1() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.suspicions++;
      K.addLog(logBody, '⚠ detector fires: “n2 is dead” — routed through the agreement box', 'warn');
      await fly(DET.x + DET.w, DET.y + 16, ABOX.x + ABOX.w / 2, ABOX.y + ABOX.h, c.amber, 550);
      animate(E('crown'), { opacity: [1, 0.4, 1], duration: dur(300) });
      K.addLog(logBody, 'agreed verdict v7: “suspect n2” — every node sees the same thing, in the same order', 'hl');
      await Promise.all(NODES.map((n) => fly(ABOX.x + ABOX.w, ABOX.y + ABOX.h / 2, n.x, NAY - NR - 4, c.purple, 480)));
      // leader election: crown moves n2 → n1
      const from = NODES.find((n) => n.id === st.leader), to = NODES[0];
      st.leader = to.id; st.elections++;
      const crown = E('crown');
      const o = { x: from.x };
      await animate(o, { x: to.x, duration: dur(600), ease: 'inOut(2)', onUpdate: () => crown.setAttribute('x', o.x) });
      const v = E('verdA'); v.textContent = 'cost: one spurious election — n2 is fine, history intact ✓'; v.setAttribute('fill', c.amber);
      K.addLog(logBody, 'n1 elected. n2 (alive) is now a follower. Total damage: a latency blip.', 'ok');
      render();
      st.busy = false; setLock(false);
    }

    async function lane2() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.suspicions++;
      K.addLog(logBody, '⚠ detector fires: “n2 is dead” — wired straight into the configuration', 'warn');
      await fly(DET.x + DET.w, DET.y + 62, CFG.x + CFG.w / 2, CFG.y, c.red, 550);
      // fork: different nodes apply the removal at different times
      animate(E('cfgbox'), { opacity: [1, 0.35, 1], duration: dur(360) });
      await Promise.all([
        fly(CFG.x + CFG.w, CFG.y + 10, FORK1.x, FORK1.y + FORK1.h / 2, c.red, 480, 4),
        fly(CFG.x + CFG.w, CFG.y + CFG.h - 10, FORK2.x, FORK2.y + FORK2.h / 2, c.red, 620, 4),
      ]);
      await Promise.all([
        animate(E('fork1'), { opacity: [0, 1], duration: dur(300), ease: 'out(2)' }),
        animate(E('fork2'), { opacity: [0, 1], duration: dur(300), ease: 'out(2)' }),
      ]);
      K.addLog(logBody, 'no agreement step → node A still has {n1,n2,n3}, node B reconfigured to {n3,n4,n5} — the sets drifted apart by more than one node', 'err');
      // both sides commit — the chosen majorities share no member
      const f1v = E('f1v'), f2v = E('f2v');
      f1v.textContent = 'majority {n1,n2} commits x=1 ✓'; f1v.setAttribute('fill', c.text);
      await K.delay(dur(350));
      f2v.textContent = 'majority {n4,n5} commits x=2 ✓'; f2v.setAttribute('fill', c.text);
      st.forks++; st.forked = true;
      const v = E('verdB'); v.textContent = '☠ two histories — split brain'; v.setAttribute('fill', c.red);
      K.addLog(logBody, 'two configs → quorums that never intersect → x=1 AND x=2 both “committed”. Irreparable.', 'err');
      render();
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('sus', st.suspicions); stat('elec', st.elections); stat('forks', st.forks); }

    function reset() {
      if (st.busy) return;
      const sp = st.speed;
      st = fresh(); st.speed = sp;
      anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, '↺ reset — n2 restored as leader, one config, one history', 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-lane1', '.t-lane2', '.t-reset'], b); }

    function bind() {
      root.querySelector('.t-lane1').onclick = lane1;
      root.querySelector('.t-lane2').onclick = lane2;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMDetectorCost = { init };
})();
