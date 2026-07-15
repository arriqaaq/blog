/**
 * MEM Agreement Box (dst-kit) — the invariant this whole post is about.
 *
 * Between the soft, noisy detection signal at the top and the safety-critical quorum
 * configuration at the bottom there must be a step that produces AGREEMENT — one ordered
 * truth. Where that box lives varies (an external store like ZooKeeper/etcd, the consensus
 * protocol's own reconfiguration, or the membership layer itself, Rapid-style) — but it must
 * exist.
 *
 * With the box in place, flickering suspicions go in and single ordered view changes come
 * out. Remove the box and every raw signal mutates the config directly: different nodes apply
 * them at different moments, the config forks, and quorum intersection — the only reason
 * consensus is safe — silently evaporates. Exposes window.MEMAgreementBox.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-agreement-box: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-agreement-box: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 330;
  const DETS = [{ x: 220, y: 46 }, { x: 390, y: 46 }, { x: 560, y: 46 }];
  const BOX = { x: 250, y: 130, w: 280, h: 58 };
  const CFG = { x: 270, y: 246, w: 240, h: 50 };
  const FORKA = { x: 150, y: 246, w: 220, h: 50 };
  const FORKB = { x: 410, y: 246, w: 220, h: 50 };
  const MODES = {
    external: { label: 'external config store', note: 'ZooKeeper · etcd · a tiny consensus ensemble on the side' },
    self: { label: 'the protocol reconfigures itself', note: 'Raft conf-change · Matchmaker — agreement inherited from the log' },
    member: { label: 'the membership layer IS the authority', note: 'Rapid — the view-change layer does its own consensus' },
  };
  const TARGETS = [3, 5, 7, 2, 6];

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({ seed: seed == null ? 9 : seed, rng: K.rng(seed == null ? 9 : seed),
      mode: 'external', boxOn: true, signals: 0, changes: 0, forks: 0, forked: false,
      pending: 0, targetIdx: 0, view: 5, cfgA: ['n1', 'n2', 'n3'], cfgB: ['n1', 'n2', 'n3'],
      busy: false, playing: false, speed: 1 });
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
        <div class="dstk-tgroup"><span class="dstk-tlabel">box lives in</span>
          <select class="t-mode">
            <option value="external" selected>external store</option>
            <option value="self">the protocol itself</option>
            <option value="member">the membership layer</option>
          </select>
          <button class="dstk-btn dstk-btn--red t-nuke">✂ remove the box</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'The agreement box', sub: 'where the agreement step can live',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'sig', label: 'raw signals' }, { id: 'chg', label: 'agreed changes' }, { id: 'forks', label: 'config forks' }],
        cap: 'Noisy suspicions go in; ordered view changes come out — that is the box’s whole job, wherever it '
           + 'lives. Cut it out and each raw signal hits the config directly: node A and node B apply them at '
           + 'different moments, their member sets drift, and “majority” stops meaning anything.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 Play a while with the box in place — then remove it and watch the config fork', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // detectors
      K.el('text', { x: 390, y: 20, 'text-anchor': 'middle', fill: c.blue, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'soft detection — heartbeats, gossip, suspicion (weak, noisy)';
      DETS.forEach((d, i) => {
        K.el('circle', { cx: d.x, cy: d.y, r: 13, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 2 }, content);
        K.el('text', { x: d.x, y: d.y + 3.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 8.5, 'font-weight': 700 }, content).textContent = 'fd' + (i + 1);
      });
      // agreement box
      if (st.boxOn) {
        const m = MODES[st.mode];
        K.el('rect', { id: `${uid}-box`, x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h, rx: 10, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 2, filter: K.glow(uid) }, content);
        K.el('text', { x: BOX.x + BOX.w / 2, y: BOX.y + 24, 'text-anchor': 'middle', fill: c.purple, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = 'AGREEMENT BOX';
        K.el('text', { id: `${uid}-boxsub`, x: BOX.x + BOX.w / 2, y: BOX.y + 42, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5 }, content).textContent = m.label;
        K.el('text', { x: 390, y: BOX.y + BOX.h + 18, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = m.note;
      } else {
        K.el('rect', { x: BOX.x, y: BOX.y, width: BOX.w, height: BOX.h, rx: 10, fill: 'none', stroke: c.red, 'stroke-width': 1.4, 'stroke-dasharray': '7,5' }, content);
        K.el('text', { x: BOX.x + BOX.w / 2, y: BOX.y + 33, 'text-anchor': 'middle', fill: c.red, 'font-size': 11, 'font-weight': 700 }, content).textContent = '✂ (removed)';
      }
      // config(s)
      K.el('text', { x: 390, y: 234, 'text-anchor': 'middle', fill: c.red, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'the voter set — safety-critical';
      K.el('g', { id: `${uid}-cfgs` }, content);
      // quorum indicator
      K.el('circle', { id: `${uid}-qled`, cx: 700, cy: 268, r: 8, fill: c.green }, content);
      K.el('text', { id: `${uid}-qtxt`, x: 700, y: 292, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'intersection';
      redrawCfgs();
    }

    function cfgChip(g, b, name, set, zone) {
      K.el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 9, fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.8 }, g);
      K.el('text', { x: b.x + b.w / 2, y: b.y + 20, 'text-anchor': 'middle', fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, g).textContent = name;
      K.el('text', { x: b.x + b.w / 2, y: b.y + 38, 'text-anchor': 'middle', fill: c[zone], 'font-size': 10, 'font-weight': 700 }, g).textContent = '{ ' + set.join(', ') + ' }';
    }
    function redrawCfgs() {
      const g = E('cfgs'); g.innerHTML = '';
      const same = st.cfgA.join() === st.cfgB.join();
      if (same) {
        cfgChip(g, CFG, 'cfg — view v' + st.view, st.cfgA, 'green');
      } else {
        cfgChip(g, FORKA, "node A's cfg", st.cfgA, 'red');
        cfgChip(g, FORKB, "node B's cfg", st.cfgB, 'red');
      }
      const led = E('qled'), qt = E('qtxt');
      led.setAttribute('fill', same ? c.green : c.red);
      qt.textContent = same ? 'intersection ✓' : 'intersection GONE';
      qt.setAttribute('fill', same ? c.muted : c.red);
    }

    function fly(x1, y1, x2, y2, color, ms, r, labelTxt) {
      const g = K.el('g', {}, anim);
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 4.5, fill: color, filter: K.glow(uid) }, g);
      const t = labelTxt ? K.el('text', { x: x1, y: y1 - 8, 'text-anchor': 'middle', fill: color, 'font-size': 8.5, 'font-weight': 700 }, g) : null;
      if (t) t.textContent = labelTxt;
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 450), ease: 'inOut(2)',
        onUpdate: () => {
          const x = x1 + (x2 - x1) * o.t, y = y1 + (y2 - y1) * o.t;
          p.setAttribute('cx', x); p.setAttribute('cy', y);
          if (t) { t.setAttribute('x', x); t.setAttribute('y', y - 8); }
        },
        onComplete: () => g.remove() });
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      const target = 'n' + TARGETS[st.targetIdx % TARGETS.length];
      // 1-2 noisy signals this tick, sometimes a flicker retraction
      const n = 1 + (st.rng() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const d = DETS[Math.floor(st.rng() * DETS.length)];
        const retract = st.rng() < 0.2;
        const msg = (retract ? '+' : '−') + target + '?';
        st.signals++;
        if (st.boxOn) {
          await fly(d.x, d.y + 13, BOX.x + BOX.w / 2, BOX.y, retract ? c.green : c.amber, 420, 4.5, msg);
          animate(E('box'), { opacity: [1, 0.6, 1], duration: dur(240) });
          if (!retract) st.pending++;
          else st.pending = Math.max(0, st.pending - 1);
        } else {
          // raw signal straight into ONE node's copy of the config
          const toA = st.rng() < 0.5;
          const fb = toA ? FORKA : FORKB;
          const same = st.cfgA.join() === st.cfgB.join();
          const bx = same ? CFG : fb;
          await fly(d.x, d.y + 13, (toA ? bx.x + bx.w * 0.3 : bx.x + bx.w * 0.7), bx.y, c.red, 480, 4.5, msg);
          const setRef = toA ? 'cfgA' : 'cfgB';
          if (!retract && st[setRef].includes(target)) st[setRef] = st[setRef].filter((x) => x !== target);
          else if (retract && !st[setRef].includes(target)) st[setRef] = st[setRef].concat(target).sort();
          const nowSame = st.cfgA.join() === st.cfgB.join();
          if (!nowSame && !st.forked) {
            st.forked = true; st.forks++;
            K.addLog(logBody, `raw “${msg}” applied only at node ${toA ? 'A' : 'B'} — the config just FORKED`, 'err');
          }
          redrawCfgs();
        }
      }
      // the box emits one ordered change after enough consistent evidence
      if (st.boxOn && st.pending >= 3) {
        st.pending = 0; st.view++; st.changes++;
        st.cfgA = st.cfgA.filter((x) => x !== target);
        if (st.cfgA.length < 3) st.cfgA = st.cfgA.concat('n' + (8 + st.changes)).sort();
        st.cfgB = st.cfgA.slice();
        st.targetIdx++;
        await fly(BOX.x + BOX.w / 2, BOX.y + BOX.h, CFG.x + CFG.w / 2, CFG.y, c.purple, 480, 6, `v${st.view} ✓`);
        redrawCfgs();
        K.addLog(logBody, `view v${st.view} committed: −${target}, +n${8 + st.changes} — ONE ordered change, everyone applies the same thing`, 'ok');
      }
      render();
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('sig', st.signals); stat('chg', st.changes); stat('forks', st.forks); }

    function nuke() {
      if (st.busy) return;
      st.boxOn = !st.boxOn;
      root.querySelector('.t-nuke').textContent = st.boxOn ? '✂ remove the box' : '⊕ restore the box';
      if (!st.boxOn) K.addLog(logBody, '✂ box removed — raw suspicion now mutates the config directly', 'err');
      else K.addLog(logBody, st.forked
        ? '⊕ box restored — but the fork already happened. Safety violations don’t heal; Reset.'
        : '⊕ box restored', st.forked ? 'warn' : 'ok');
      drawScene();
    }

    function setBoxMode(mode) {
      st.mode = mode;
      if (st.boxOn) drawScene();
      K.addLog(logBody, `the box now lives in: ${MODES[mode].label} — ${MODES[mode].note}`, 'hl');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(420)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed, m = st.mode, on = st.boxOn;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 9); st.speed = sp; st.mode = m; st.boxOn = on;
      pp(); anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}, view v5, one config`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-nuke', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-nuke').onclick = nuke;
      root.querySelector('.t-mode').onchange = (e) => setBoxMode(e.target.value);
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMAgreementBox = { init };
})();
