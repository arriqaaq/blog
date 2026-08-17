/**
 * FS Commit Graph (dst-kit) — history is a chain of names; fork/snapshot/revert write ONE row.
 *
 * The post's point: every commit points at an immutable, content-addressed state root (#digest).
 * A branch is a MUTABLE name→commit pointer; a snapshot is an IMMUTABLE name→commit. Because every
 * node under a root is shared by digest, fork/snapshot/revert are constant-time — one row written,
 * zero content moved, whatever the repository's size. Revert is a COMPENSATING commit: a new commit
 * whose root digest equals an older root. History is preserved, never rewritten.
 * Exposes window.FSCommitGraph.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-commit-graph: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-commit-graph: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 240, ROW = 148, R = 13, X0 = 56, DX = 70, MAXVIS = 10;
  const BR_NAMES = ['main', 'b2', 'b3', 'b4'];
  const BR_ZONES = ['purple', 'blue', 'amber', 'pink'];

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    let st = null, svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    function setup(seed) {
      const keepSpeed = st ? st.speed : 1;
      st = { seed, rand: K.rng(seed), speed: keepSpeed, playing: false, busy: false,
        commits: [], branches: [{ name: 'main', head: -1 }], snaps: [], cur: 0, cn: 0, sn: 0 };
      addCommit(); addCommit(); // c1 ← c2: enough history to fork/snapshot/revert right away
    }
    const hex4 = () => Math.floor(st.rand() * 65536).toString(16).padStart(4, '0');
    function addCommit(digest, reuse) {
      const b = st.branches[st.cur];
      const cm = { id: 'c' + (++st.cn), digest: digest || hex4(), parent: b.head,
        reuse: reuse == null ? -1 : reuse, dim: false };
      st.commits.push(cm); b.head = st.commits.length - 1;
      return cm;
    }

    build();

    function controls() {
      const spd = (v, l) => `<option value="${v}"${st.speed === v ? ' selected' : ''}>${l}</option>`;
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-commit">＋ commit</button>
        <button class="dstk-btn dstk-btn--blue t-fork">⑂ fork</button>
        <button class="dstk-btn dstk-btn--amber t-snap">📌 snapshot</button>
        <button class="dstk-btn dstk-btn--pink t-revert">↩ revert</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed">${spd(0.5, '0.5×')}${spd(1, '1×')}${spd(2, '2×')}</select></div>`;
    }

    function build() {
      setup(st ? st.seed : 7);
      root.innerHTML = K.container({
        title: 'Branches are pointers, history is immutable',
        sub: 'commit → root digest · fork/snapshot/revert = one row',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'commits', label: 'commits' }, { id: 'branches', label: 'branches' },
          { id: 'snaps', label: 'snapshots' }, { id: 'bytes', label: 'bytes moved' }],
        cap: 'Branches and snapshots are names bound to commits. Fork, snapshot, and revert write one '
           + 'row each — no content moves, whatever the repository’s size.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 fork, snapshot and revert each write ONE row — watch "bytes moved" stay 0', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      K.el('text', { x: 18, y: 20, fill: c.muted, 'font-size': 10 }, content).textContent =
        'Every commit points at an immutable root (#digest). Branch tags (• = current) and 📌 snapshots are just names bound to commits.';
      const lo = Math.max(0, st.commits.length - MAXVIS);
      const X = (i) => X0 + (i - lo) * DX;
      if (lo > 0) {
        K.el('text', { x: 10, y: ROW + 4, fill: c.muted, 'font-size': 12, opacity: 0.7 }, content).textContent = '⋯';
        K.el('text', { x: 10, y: ROW + 18, fill: c.muted, 'font-size': 8.5, opacity: 0.8 }, content).textContent = lo + ' older';
      }
      // parent edges (and the dashed "same root" arc for compensating commits)
      st.commits.forEach((cm, i) => {
        if (i < lo || cm.parent < 0) return;
        const px = cm.parent >= lo ? X(cm.parent) : X0 - 38;
        const ex = X(i);
        if (cm.parent === i - 1 && cm.parent >= lo) {
          K.el('line', { x1: px + R, y1: ROW, x2: ex - R - 2, y2: ROW, stroke: c.gray, 'stroke-width': 1.6,
            'marker-end': K.arrow(uid, 'gray'), opacity: cm.dim ? 0.5 : 0.9 }, content);
        } else {
          K.el('path', { d: `M ${px + R - 3} ${ROW - 9} Q ${(px + ex) / 2} ${ROW - 42} ${ex - R + 2} ${ROW - 9}`,
            fill: 'none', stroke: c.gray, 'stroke-width': 1.5, 'marker-end': K.arrow(uid, 'gray'), opacity: 0.85 }, content);
        }
        if (cm.reuse >= 0) {
          const tx = cm.reuse >= lo ? X(cm.reuse) : X0 - 38;
          K.el('path', { d: `M ${ex - 4} ${ROW + R} Q ${(ex + tx) / 2} ${ROW + 62} ${tx + 4} ${ROW + R + 2}`,
            fill: 'none', stroke: c.purple, 'stroke-width': 1.8, 'stroke-dasharray': '5 4',
            'marker-end': K.arrow(uid, 'purple'), filter: K.glow(uid) }, content);
          K.el('text', { x: (ex + tx) / 2, y: ROW + 52, 'text-anchor': 'middle', fill: c.purple,
            'font-size': 8.5, 'font-weight': 700 }, content).textContent = 'same root — reused, not copied';
        }
      });
      // commit circles + digests
      const last = st.commits.length - 1;
      st.commits.forEach((cm, i) => {
        if (i < lo) return;
        const x = X(i), zone = cm.dim ? 'gray' : (i === last ? 'green' : 'blue');
        K.el('circle', { id: `${uid}-n-${i}`, cx: x, cy: ROW, r: R, fill: K.grad(uid, zone),
          stroke: c[zone], 'stroke-width': i === last ? 2.4 : 1.8, opacity: cm.dim ? 0.55 : 1 }, content);
        K.el('text', { x, y: ROW + 3.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 9,
          'font-weight': 700, opacity: cm.dim ? 0.6 : 1 }, content).textContent = cm.id;
        K.el('text', { x, y: ROW + 27, 'text-anchor': 'middle', fill: cm.dim ? c.gray : c.muted,
          'font-size': 8.5, 'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = '#' + cm.digest;
      });
      // branch tags: mutable pointers, stacked above their head commit
      const byHead = new Map();
      st.branches.forEach((b, bi) => { const a = byHead.get(b.head) || []; a.push(bi); byHead.set(b.head, a); });
      let offK = 0;
      byHead.forEach((list, head) => {
        const off = head < lo;
        list.forEach((bi, k) => {
          const b = st.branches[bi], zone = BR_ZONES[bi], cur = bi === st.cur;
          const tw = b.name.length * 6.6 + (off ? 32 : 18);
          const x = off ? 16 : X(head) - tw / 2;
          const y = off ? 34 + (offK++) * 20 : ROW - R - 30 - k * 20;
          const attrs = { x, y, width: tw, height: 16, rx: 8, fill: K.grad(uid, zone), stroke: c[zone],
            'stroke-width': cur ? 2.2 : 1.2, opacity: off ? 0.6 : 1 };
          if (cur) attrs.filter = K.glow(uid);
          K.el('rect', attrs, content);
          K.el('text', { x: x + tw / 2, y: y + 11.5, 'text-anchor': 'middle', fill: c.text,
            'font-size': 9, 'font-weight': 700, opacity: off ? 0.75 : 1 }, content)
            .textContent = (off ? '← ' : '') + b.name + (cur ? ' •' : '');
          if (!off && k === 0) K.el('line', { x1: X(head), y1: y + 16, x2: X(head), y2: ROW - R - 1,
            stroke: c[zone], 'stroke-width': 1.2, opacity: 0.7 }, content);
        });
      });
      // snapshot pins: immutable names, stacked below their commit
      const snapBy = new Map();
      st.snaps.forEach((s) => { const a = snapBy.get(s.commit) || []; a.push(s); snapBy.set(s.commit, a); });
      snapBy.forEach((list, ci) => {
        if (ci < lo) return;
        list.forEach((s, k) => {
          const x = X(ci) - 22, y = ROW + 34 + k * 17;
          K.el('rect', { x, y, width: 44, height: 15, rx: 7, fill: K.grad(uid, 'gray'),
            stroke: c.gray, 'stroke-width': 1.2 }, content);
          K.el('text', { x: x + 22, y: y + 11, 'text-anchor': 'middle', fill: c.text,
            'font-size': 8.5, 'font-weight': 700 }, content).textContent = '📌 ' + s.name;
        });
      });
    }

    function popIn(i) {
      const n = E('n-' + i); if (!n) return;
      const p = { t: 0 };
      animate(p, { t: 1, duration: dur(420), ease: 'out(3)',
        onUpdate: () => n.setAttribute('r', (R * p.t).toFixed(2)),
        onComplete: () => n.setAttribute('r', R) });
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function flashStat(k, v, color) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (!e) return;
      e.textContent = v; e.style.color = color || '';
      animate(e, { opacity: [0.15, 1], duration: dur(600), ease: 'out(2)' });
    }
    function render() {
      stat('commits', st.commits.length); stat('branches', st.branches.length); stat('snaps', st.snaps.length);
    }

    async function commit() {
      if (st.busy) return; st.busy = true; setLock(true);
      const cm = addCommit();
      const nodes = 1 + Math.floor(st.rand() * 5);
      drawScene(); popIn(st.commits.length - 1); render();
      flashStat('bytes', nodes + (nodes === 1 ? ' node' : ' nodes'), c.blue);
      K.addLog(logBody, `＋ ${cm.id} on ${st.branches[st.cur].name}: new root #${cm.digest} — wrote ${nodes} changed node(s); every unchanged node is shared by digest`);
      await K.delay(dur(380));
      st.busy = false; setLock(false);
    }
    async function fork() {
      if (st.busy) return;
      if (st.branches.length >= BR_NAMES.length) { K.addLog(logBody, 'demo caps at 4 branches — reset to fork again', 'warn'); return; }
      st.busy = true; setLock(true);
      const from = st.branches[st.cur];
      const nb = { name: BR_NAMES[st.branches.length], head: from.head };
      st.branches.push(nb); st.cur = st.branches.length - 1;
      drawScene(); render();
      flashStat('bytes', '0', c.green);
      K.addLog(logBody, `⑂ fork = one row: "${nb.name}" bound to existing commit ${st.commits[nb.head].id} — bytes moved: 0. Now committing on ${nb.name}.`, 'ok');
      await K.delay(dur(380));
      st.busy = false; setLock(false);
    }
    async function snapshot() {
      if (st.busy) return; st.busy = true; setLock(true);
      const b = st.branches[st.cur];
      const s = { name: 's' + (++st.sn), commit: b.head };
      st.snaps.push(s);
      drawScene(); render();
      flashStat('bytes', '0', c.green);
      K.addLog(logBody, `📌 ${s.name} pinned to ${st.commits[b.head].id} — an immutable name→commit, one row, 0 bytes moved`, 'ok');
      await K.delay(dur(380));
      st.busy = false; setLock(false);
    }
    async function revert() {
      if (st.busy) return;
      const b = st.branches[st.cur];
      const depth = 2 + (st.rand() < 0.35 ? 1 : 0); // seeded target: 2 (sometimes 3) back
      let idx = b.head, steps = 0;
      while (steps < depth && st.commits[idx].parent >= 0) { idx = st.commits[idx].parent; steps++; }
      if (idx === b.head) { K.addLog(logBody, `not enough history on ${b.name} to revert — commit first`, 'warn'); return; }
      st.busy = true; setLock(true);
      let j = b.head;
      while (j >= 0 && j !== idx) { st.commits[j].dim = true; j = st.commits[j].parent; }
      const target = st.commits[idx];
      const cm = addCommit(target.digest, idx);
      drawScene(); popIn(st.commits.length - 1); render();
      flashStat('bytes', '0', c.green);
      K.addLog(logBody, `↩ ${cm.id} is a compensating commit — target root #${target.digest} (${target.id}) already exists, so this wrote commit metadata and nothing else`, 'hl');
      K.addLog(logBody, 'the reverted commits stay in history, dimmed — never deleted, never rewritten');
      await K.delay(dur(380));
      st.busy = false; setLock(false);
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        const r = st.rand();
        if (r < 0.5) await commit();
        else if (r < 0.65) { if (st.branches.length < BR_NAMES.length) await fork(); else await commit(); }
        else if (r < 0.8) await snapshot();
        else await revert();
        await K.delay(dur(850));
      }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      const seed = parseInt(root.querySelector('.t-seed').value, 10);
      st.playing = false;
      setup(Number.isFinite(seed) ? seed : 7);
      anim.innerHTML = ''; pp(); setLock(false); drawScene(); render(); stat('bytes', '0');
      K.addLog(logBody, `↺ reset — seed ${st.seed}: same seed, same graph, every time`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-commit', '.t-fork', '.t-snap', '.t-revert', '.t-reset'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-commit').onclick = () => commit();
      root.querySelector('.t-fork').onclick = () => fork();
      root.querySelector('.t-snap').onclick = () => snapshot();
      root.querySelector('.t-revert').onclick = () => revert();
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-seed').onchange = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSCommitGraph = { init };
})();
