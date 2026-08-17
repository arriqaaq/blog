/**
 * FS Path Copy (dst-kit) — the namespace is a persistent (path-copying) Merkle tree.
 *
 * The post's point: directory nodes are immutable and named by their digest. Writing one file
 * rewrites ONLY the nodes on the route root→leaf — O(depth), ~3 nodes even in a 1,000-file tree —
 * and every off-route node is shared with the previous root by digest. Each write appends a new
 * root to the history column; diffing two roots skips whole subtrees whose digests already match.
 * Exposes window.FSPathCopy.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-path-copy: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-path-copy: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 246;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const DIRS = ['src', 'docs', 'data'];
  const POOL = [['main.rs', 'lib.rs', 'api.rs'], ['intro.md', 'spec.md', 'notes.md'], ['cfg.json', 'a.bin', 'b.bin']];
  const RY = 22, RH = 38, RW = 96;        // root box
  const DY = 112, DH = 36, DW = 96;       // dir boxes
  const LY = 190, LH = 34, LW = 60;       // leaf boxes
  const COLX = 592, COLW = 172, COLH = 27;// root-history column
  const leafCx = (i) => 42 + i * 66;

  // A node's NAME is a pure function of what it contains (stand-in for BLAKE3): FNV-1a → 'a3f2…9c'.
  function digest(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h >>>= 0;
    const x = h.toString(16).padStart(8, '0');
    return x.slice(0, 4) + '…' + x.slice(6, 8);
  }
  // Merkle digests bottom-up: leaf ← its bytes; dir ← its children's digests; root ← the dirs'.
  function snapDigests(leaves) {
    const d = {};
    leaves.forEach((lf, i) => { d['l' + i] = digest('f|' + lf.di + '|' + lf.name + '|' + lf.writes); });
    for (let di = 0; di < 3; di++) {
      const kids = leaves.map((lf, i) => (lf.di === di ? d['l' + i] : null)).filter(Boolean);
      d['d' + di] = digest('d|' + DIRS[di] + '|' + kids.join('+'));
    }
    d.root = digest('r|' + d.d0 + '+' + d.d1 + '+' + d.d2);
    return d;
  }

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 7 : seed;
      const rng = K.rng(s);
      const counts = [2, 2, 2];
      const extra = Math.floor(rng() * 3);                          // 6–8 leaves, seeded shape
      for (let e = 0; e < extra; e++) {
        const cand = [0, 1, 2].filter((i) => counts[i] < 3);
        counts[cand[Math.floor(rng() * cand.length)]]++;
      }
      const leaves = [];
      DIRS.forEach((dn, di) => { for (let j = 0; j < counts[di]; j++) leaves.push({ di, name: POOL[di][j], writes: 1 }); });
      const st0 = { seed: s, rng, leaves, versions: [], busy: false, playing: false, speed: 1 };
      st0.versions.push({ tag: 'v1', d: snapDigests(leaves) });
      return st0;
    };
    let st = fresh(7);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    // dir centers = mean of member leaf centers; root center = mean of dir centers
    function geo() {
      const dirs = [];
      for (let di = 0; di < 3; di++) {
        const xs = st.leaves.map((lf, i) => (lf.di === di ? leafCx(i) : null)).filter((x) => x != null);
        dirs.push(xs.reduce((a, b) => a + b, 0) / xs.length);
      }
      return { dirs, root: (dirs[0] + dirs[1] + dirs[2]) / 3 };
    }

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--amber t-write">✎ write a file</button>
        <button class="dstk-btn dstk-btn--blue t-diff">⇄ diff two roots</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="dstk-seed t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'One write rewrites O(depth) nodes', sub: 'persistent Merkle namespace · path copying, everything else shared',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'rw', label: 'nodes rewritten' }, { id: 'sh', label: 'nodes shared' }, { id: 'files', label: 'files (tree)' }],
        cap: 'The drawing is a slice of a notional 1,000-file tree. One write persists O(depth) new nodes — '
           + 'here 3 — and everything else is shared with the previous root by digest. That is why history is cheap.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 every node is named by its digest — press ✎ write and watch only the root→leaf route change', 'hl');
    }

    function node(key, cx, y, w, h, name, dgs, zone) {
      K.el('rect', { id: `${uid}-nd-${key}`, x: cx - w / 2, y, width: w, height: h, rx: 7,
        fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.4 }, content);
      K.el('text', { x: cx, y: y + 13, 'text-anchor': 'middle', fill: c.text, 'font-size': 8.5, 'font-weight': 700 }, content).textContent = name;
      K.el('text', { id: `${uid}-dg-${key}`, x: cx, y: y + h - 8, 'text-anchor': 'middle', fill: c.muted,
        'font-size': 8.5, 'font-family': MONO }, content).textContent = dgs;
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      const g = geo();
      const d = st.versions[st.versions.length - 1].d;
      // edges under the boxes
      for (let di = 0; di < 3; di++)
        K.el('line', { x1: g.root, y1: RY + RH, x2: g.dirs[di], y2: DY, stroke: c.gray, 'stroke-width': 1, opacity: 0.5 }, content);
      st.leaves.forEach((lf, i) =>
        K.el('line', { x1: g.dirs[lf.di], y1: DY + DH, x2: leafCx(i), y2: LY, stroke: c.gray, 'stroke-width': 1, opacity: 0.5 }, content));
      node('root', g.root, RY, RW, RH, '/ (root)', d.root, 'purple');
      for (let di = 0; di < 3; di++) node('d' + di, g.dirs[di], DY, DW, DH, DIRS[di] + '/', d['d' + di], 'gray');
      st.leaves.forEach((lf, i) => node('l' + i, leafCx(i), LY, LW, LH, lf.name, d['l' + i], 'blue'));
      redrawRoots();
    }

    function redrawRoots() {
      let g = E('roots'); if (g) g.remove();
      g = K.el('g', { id: uid + '-roots' }, content);
      K.el('text', { x: COLX + COLW / 2, y: 18, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9, 'font-weight': 700 }, g)
        .textContent = 'root history (immutable)';
      const recent = st.versions.slice(-6);
      recent.forEach((v, i) => {
        const y = 28 + i * 32, last = i === recent.length - 1;
        K.el('rect', { x: COLX, y, width: COLW, height: COLH, rx: 6, fill: K.grad(uid, last ? 'purple' : 'gray'),
          stroke: last ? c.purple : c.gray, 'stroke-width': last ? 1.8 : 1, filter: last ? K.glow(uid) : '' }, g);
        K.el('text', { x: COLX + COLW / 2, y: y + 18, 'text-anchor': 'middle', fill: last ? c.text : c.muted,
          'font-size': 9, 'font-weight': 700, 'font-family': MONO }, g).textContent = `${v.tag} · root ${v.d.root}`;
      });
    }

    function pulse(elm) { if (elm) animate(elm, { opacity: [0.12, 1], duration: dur(560), ease: 'out(2)' }); }

    async function write() {
      if (st.busy) return; st.busy = true; setLock(true);
      drawScene();                                                   // clear halos; scene shows the OLD digests
      const li = Math.floor(st.rng() * st.leaves.length);
      const lf = st.leaves[li];
      lf.writes++;                                                   // new bytes at this path
      const nw = snapDigests(st.leaves);
      const prev = st.versions[st.versions.length - 1];
      st.versions.push({ tag: 'v' + (st.versions.length + 1), d: nw });
      const route = ['l' + li, 'd' + lf.di, 'root'];
      const path = '/' + DIRS[lf.di] + '/' + lf.name;
      K.addLog(logBody, `✎ write ${path} → new bytes: leaf, parent dir and root each get a NEW digest (path copy)`, 'warn');
      for (const key of route) {                                     // O(depth): leaf → dir → root
        const r = E('nd-' + key), t = E('dg-' + key);
        if (r) { r.setAttribute('stroke', c.amber); r.setAttribute('stroke-width', 2.4); pulse(r); }
        if (t) { t.textContent = nw[key]; t.setAttribute('fill', c.amber); pulse(t); }
        await K.delay(dur(340));
      }
      // every off-route node keeps its digest — SHARED with the previous root, not copied
      Object.keys(nw).forEach((key) => {
        if (route.indexOf(key) >= 0) return;
        const r = E('nd-' + key); if (!r) return;
        const x = +r.getAttribute('x') - 3, y = +r.getAttribute('y') - 3;
        const hw = +r.getAttribute('width') + 6, hh = +r.getAttribute('height') + 6;
        const halo = K.el('rect', { x, y, width: hw, height: hh, rx: 9, fill: 'none', stroke: c.gray,
          'stroke-width': 1, 'stroke-dasharray': '3,3', opacity: 0 }, anim);
        animate(halo, { opacity: [0, 0.9], duration: dur(300), ease: 'out(2)' });
        const bt = K.el('text', { x: x + hw / 2, y: y + hh + 9, 'text-anchor': 'middle', fill: c.gray, 'font-size': 8.5, opacity: 0 }, anim);
        bt.textContent = 'shared';
        animate(bt, { opacity: [0, 0.9], duration: dur(300), ease: 'out(2)' });
      });
      redrawRoots(); render();
      K.addLog(logBody, `✓ ${st.versions[st.versions.length - 1].tag} = ${nw.root} · 3 nodes rewritten, ~1,127 shared with ${prev.tag}`, 'ok');
      st.busy = false; setLock(false);
    }

    async function diffRoots() {
      if (st.busy) return;
      if (st.versions.length < 2) { K.addLog(logBody, '⇄ need two roots to diff — write a file first', 'warn'); return; }
      st.busy = true; setLock(true);
      drawScene();
      const a = st.versions[st.versions.length - 2], b = st.versions[st.versions.length - 1];
      let skipped = 0;
      for (let di = 0; di < 3; di++) {                               // compare subtree digests, top-down
        const same = a.d['d' + di] === b.d['d' + di];
        if (same) skipped++;
        const xs = st.leaves.map((lf, i) => (lf.di === di ? leafCx(i) : null)).filter((x) => x != null);
        const x0 = Math.min.apply(null, xs) - LW / 2 - 6, x1 = Math.max.apply(null, xs) + LW / 2 + 6;
        const col = same ? c.green : c.amber;
        const halo = K.el('rect', { x: x0, y: DY - 6, width: x1 - x0, height: LY + LH - DY + 12, rx: 10, fill: 'none',
          stroke: col, 'stroke-width': 1.6, 'stroke-dasharray': same ? '' : '4,3', filter: same ? K.glow(uid) : '', opacity: 0 }, anim);
        animate(halo, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
        const t = K.el('text', { x: (x0 + x1) / 2, y: DY - 11, 'text-anchor': 'middle', fill: col, 'font-size': 8.5, 'font-weight': 700, opacity: 0 }, anim);
        t.textContent = same ? '✓ equal digest — skip' : '≠ differs — descend';
        animate(t, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
        await K.delay(dur(280));
      }
      K.addLog(logBody, `⇄ diff ${a.tag} ↔ ${b.tag}: ${skipped} of 3 subtrees equal by digest — skipped without reading a single block`, 'ok');
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      const wrote = st.versions.length > 1;
      stat('rw', wrote ? 3 : 0); stat('sh', wrote ? '1,127' : '—'); stat('files', '1,000');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await write(); await K.delay(dur(800)); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      const sp = st.speed;
      st.playing = false;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 7); st.speed = sp;
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}: ${st.leaves.length} leaves drawn, v1 = ${st.versions[0].d.root}`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-write', '.t-diff', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-write').onclick = write;
      root.querySelector('.t-diff').onclick = diffRoots;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSPathCopy = { init };
})();
