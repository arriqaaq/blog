/**
 * FS Path Walk (dst-kit) — a path is resolved one component at a time.
 *
 * "/home/kfarhan/src/main.rs" is not a key you look up. The kernel WALKS it: for every component
 * it asks the dentry cache for (parent inode, name). On a HIT it gets the child dentry — and its
 * inode — for free. On a MISS it has to go to the filesystem: read the parent directory's data
 * block, scan the entries for the name, read the inode that name points at, and only then insert
 * the result into the dentry cache. Two disk reads per missed component; a path of depth N misses
 * N times when cold. Step it, Play it, then 🧹 drop caches and watch the same path get expensive
 * again — and Reset-and-replay to watch it cost nothing. Exposes window.FSPathWalk.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-path-walk: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-path-walk: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 318;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const PATH = '/home/kfarhan/src/main.rs';
  const COMPS = ['home', 'kfarhan', 'src', 'main.rs'];
  // The chain the walk descends. entries = the directory's name → inode map ('.' and '..' elided).
  const LEVELS = [
    { name: '/', ino: 2, entries: [['bin', 11], ['home', 45], ['tmp', 7]] },
    { name: 'home', ino: 45, entries: [['kfarhan', 812], ['alice', 77], ['bob', 91]] },
    { name: 'kfarhan', ino: 812, entries: [['.zshrc', 900], ['docs', 944], ['src', 1337]] },
    { name: 'src', ino: 1337, entries: [['lib.rs', 2001], ['main.rs', 2048], ['mod.rs', 2077]] },
    { name: 'main.rs', ino: 2048, entries: null },
  ];
  const ROW = { x: 16, w: 528, h: 34, y: (i) => 74 + i * 46 };
  const INO = { x: 118, w: 52, h: 20 };
  const ENT = { x: 186, w: 112, gap: 6, h: 20 };
  const DC = { x: 556, y: 64, w: 208, h: 160, sx: 566, sw: 188, sh: 23, sy: (i) => 100 + i * 29 };
  const DISK = { x: 556, y: 234, w: 208, h: 58, cx: 584, cy: 270, r: 13 };
  const CHIP = (() => { const o = []; let x = 118; for (const n of COMPS) { const w = 16 + n.length * 7; o.push({ x, w }); x += w + 16; } return o; })();

  function codeHtml(uid) {
    return `<pre class="dstk-code"><span class="k">for</span> name <span class="k">in</span> path.split(<span class="s">'/'</span>) {         <span class="c">// fs/namei.c :: link_path_walk()</span>
<span id="${uid}-c-hit">    <span class="k">let</span> d = d_lookup(parent, name)    <span class="c">// dcache: (parent, name) → dentry</span></span>
<span id="${uid}-c-miss">        .unwrap_or(lookup_slow(..));  <span class="c">// miss → i_op-&gt;lookup(): disk</span></span>
    <span class="k">let</span> ino = d.inode;                <span class="c">// what the name actually points at</span>
    parent = d;                       <span class="c">// one component deeper — repeat</span>
}</pre>`;
  }

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 7 : seed, rnd = K.rng(s);
      // A cached dentry pins its parent, so the warm part of a path is always a PREFIX.
      // 0..3 → the last component is never pre-cached, so a first walk always touches disk.
      const warm = Math.floor(rnd() * COMPS.length);
      const cached = COMPS.map((_, i) => i < warm);
      return { seed: s, cached, block: cached.slice(), i: 0, hits: 0, reads: 0, walks: 0,
        busy: false, playing: false, speed: 1 };
    };
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const R = (k) => root.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const T = (a, s, p) => { const e = K.el('text', a, p || content); e.textContent = s; return e; };
    const rowMid = (i) => ROW.y(i) + ROW.h / 2;
    const slotMid = (i) => DC.sy(i) + DC.sh / 2;
    const entX = (j) => ENT.x + j * (ENT.w + ENT.gap);
    const warmCount = () => st.cached.filter(Boolean).length;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ step</button>
        <button class="dstk-btn dstk-btn--red t-drop">🧹 drop caches</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Resolving a path is a walk, not a lookup',
        sub: 'component by component — and the dentry cache is what makes it cheap',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'comp', label: 'components' }, { id: 'hits', label: 'dcache hits' },
          { id: 'reads', label: 'disk reads' }],
        cap: "A path is resolved one component at a time — each step needs the directory's entries to map a "
           + 'name to an inode. The dentry cache exists because doing that from disk every time would be unaffordable.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      const code = document.createElement('div');
      code.innerHTML = codeHtml(uid);
      root.querySelector('.dstk-toolbar').insertAdjacentElement('afterend', code.firstChild);
      root.querySelector('.t-speed').value = String(st.speed);
      drawScene(); bind(); render(); pp(); setLock(false);
      K.addLog(logBody, `🌱 seed ${st.seed} — ${warmCount()} of ${COMPS.length} components start warm `
        + '(a cached dentry pins its parent, so warmth is always a prefix)', 'hl');
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      T({ x: 16, y: 36, fill: c.muted, 'font-size': 9.5 }, 'resolving:');
      T({ id: uid + '-status', x: 764, y: 36, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5 }, '');
      // the path, laid out as the components the walk will consume
      K.el('rect', { x: 82, y: 20, width: 24, height: 24, rx: 6, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.3 }, content);
      T({ x: 94, y: 36, 'text-anchor': 'middle', fill: c.text, 'font-size': 11, 'font-weight': 700, 'font-family': MONO }, '/');
      COMPS.forEach((n, i) => {
        const done = i < st.i, zone = done ? 'green' : 'gray', col = done ? c.green : c.gray;
        T({ x: CHIP[i].x - 8, y: 36, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11, 'font-family': MONO }, '/');
        K.el('rect', { id: `${uid}-comp-${i}`, x: CHIP[i].x, y: 20, width: CHIP[i].w, height: 24, rx: 6,
          fill: K.grad(uid, zone), stroke: col, 'stroke-width': 1.3 }, content);
        T({ x: CHIP[i].x + CHIP[i].w / 2, y: 36, 'text-anchor': 'middle', fill: c.text, 'font-size': 10.5,
          'font-weight': 600, 'font-family': MONO, 'pointer-events': 'none' }, n);
      });
      T({ x: 16, y: 60, fill: c.blue, 'font-size': 9, 'font-weight': 700, 'letter-spacing': '.06em' },
        'THE WALK · directory entries map name → inode  (. and .. elided)');
      T({ x: 556, y: 60, fill: c.text, 'font-size': 9, 'font-weight': 700, 'letter-spacing': '.06em' }, 'THE DENTRY CACHE');
      drawRows(); drawCache(); drawDisk();
      T({ x: 16, y: 308, fill: c.muted, 'font-size': 9 },
        'A cached dentry pins its parent — so the warm part of a path is always a prefix, never a hole in the middle.');
    }

    function drawRows() {
      LEVELS.forEach((lv, i) => {
        const y = ROW.y(i), done = i <= st.i, zone = done ? 'green' : 'gray', col = done ? c.green : c.gray;
        K.el('rect', { id: `${uid}-row-${i}`, x: ROW.x, y, width: ROW.w, height: ROW.h, rx: 8,
          fill: K.grad(uid, zone), stroke: col, 'stroke-width': 1.3, opacity: done ? 1 : 0.62 }, content);
        T({ x: ROW.x + 12, y: y + 22, fill: c.text, 'font-size': 11, 'font-weight': 700, 'font-family': MONO }, lv.name);
        K.el('rect', { id: `${uid}-ino-${i}`, x: INO.x, y: y + 7, width: INO.w, height: INO.h, rx: 4,
          fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1 }, content);
        T({ x: INO.x + INO.w / 2, y: y + 21, 'text-anchor': 'middle', fill: c.text, 'font-size': 8.5, 'font-family': MONO }, 'ino ' + lv.ino);
        if (!lv.entries) {
          K.el('rect', { x: ENT.x, y: y + 7, width: 348, height: ENT.h, rx: 4, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1 }, content);
          T({ x: ENT.x + 174, y: y + 21, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 },
            'regular file — the inode points at the data blocks');
          return;
        }
        const seen = st.block[i];
        lv.entries.forEach((e, j) => {
          K.el('rect', { id: `${uid}-ent-${i}-${j}`, x: entX(j), y: y + 7, width: ENT.w, height: ENT.h, rx: 4,
            fill: K.grad(uid, seen ? 'blue' : 'gray'), stroke: seen ? c.blue : c.gray, 'stroke-width': 1,
            opacity: seen ? 1 : 0.3 }, content);
          T({ id: `${uid}-entt-${i}-${j}`, x: entX(j) + ENT.w / 2, y: y + 21, 'text-anchor': 'middle',
            fill: seen ? c.text : c.muted, 'font-size': 8.5, 'font-family': MONO, opacity: seen ? 1 : 0.35 },
          e[0] + ' → ' + e[1]);
        });
      });
    }

    function drawCache() {
      K.el('rect', { x: DC.x, y: DC.y, width: DC.w, height: DC.h, rx: 10, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
      T({ x: DC.x + 12, y: DC.y + 16, fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, 'dentry cache');
      T({ x: DC.x + 12, y: DC.y + 28, fill: c.text, 'font-size': 8.5, 'font-family': MONO, opacity: 0.8 }, '(parent ino, name) → inode');
      COMPS.forEach((n, i) => {
        const on = st.cached[i];
        K.el('rect', { id: `${uid}-slot-${i}`, x: DC.sx, y: DC.sy(i), width: DC.sw, height: DC.sh, rx: 5,
          fill: K.grad(uid, on ? 'green' : 'gray'), stroke: on ? c.green : c.gray, 'stroke-width': 1,
          opacity: on ? 1 : 0.45 }, content);
        T({ id: `${uid}-slott-${i}`, x: DC.sx + 8, y: DC.sy(i) + 15.5, fill: on ? c.text : c.muted, 'font-size': 8.5, 'font-family': MONO },
          on ? `(${LEVELS[i].ino}, "${n}") → ${LEVELS[i + 1].ino}` : '— empty —');
      });
    }

    function drawDisk() {
      K.el('rect', { id: uid + '-disk', x: DISK.x, y: DISK.y, width: DISK.w, height: DISK.h, rx: 10,
        fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.4 }, content);
      T({ x: DISK.x + 12, y: DISK.y + 16, fill: c.muted, 'font-size': 10, 'font-weight': 700 }, 'disk — the slow path');
      T({ id: uid + '-diskn', x: DISK.x + DISK.w - 12, y: DISK.y + 17, 'text-anchor': 'end', fill: c.amber,
        'font-size': 12, 'font-weight': 700, 'font-family': MONO }, String(st.reads));
      K.el('circle', { cx: DISK.cx, cy: DISK.cy, r: DISK.r, fill: 'none', stroke: c.gray, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: DISK.cx, cy: DISK.cy, r: 3.5, fill: c.gray }, content);
      T({ id: uid + '-diskop', x: DISK.cx + 22, y: DISK.cy + 3, fill: c.muted, 'font-size': 8.5 }, 'idle');
    }

    function stat(k, v) { const e = R('stat-' + k); if (e) e.textContent = v; }
    function render() {
      stat('comp', st.i + ' / ' + COMPS.length); stat('hits', st.hits); stat('reads', st.reads);
      const dn = E('diskn'); if (dn) dn.textContent = st.reads;
      const e = E('status'); if (!e) return;
      const pend = COMPS.reduce((n, _, i) => (i >= st.i && !st.cached[i] ? n + 1 : n), 0);
      e.textContent = st.i >= COMPS.length
        ? `resolved ${PATH} → inode ${LEVELS[COMPS.length].ino}`
        : pend === 0 ? `warm — ${COMPS.length - st.i} components left, 0 disk reads ahead`
          : `${pend} miss${pend > 1 ? 'es' : ''} ahead → ${pend * 2} disk reads`;
      e.setAttribute('fill', pend === 0 ? c.green : c.amber);
    }

    function lite(id, col, w) {
      const e = E(id); if (!e) return;
      e.setAttribute('stroke', col); e.setAttribute('stroke-width', w || 2.4);
      e.setAttribute('opacity', 1); e.setAttribute('filter', K.glow(uid));
    }
    function guide(x1, y1, x2, y2, col) {
      K.el('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 1.2, opacity: 0.4, 'stroke-dasharray': '3 3' }, anim);
    }
    async function pulse(x1, y1, x2, y2, col) {
      const dot = K.el('circle', { cx: x1, cy: y1, r: 4.6, fill: col, filter: K.glow(uid) }, anim);
      const p = { t: 0 };
      await animate(p, { t: 1, duration: dur(320), ease: 'inOut(2)', onUpdate: () => {
        dot.setAttribute('cx', x1 + (x2 - x1) * p.t); dot.setAttribute('cy', y1 + (y2 - y1) * p.t);
      } });
      dot.remove();
    }
    function cGlow(id, col) {
      const e = R('c-' + id); if (!e) return;
      e.style.background = col; e.style.borderRadius = '3px';
      setTimeout(() => { e.style.background = ''; }, dur(700));
    }
    function diskOp(txt, col) {
      const e = E('diskop'); if (!e) return;
      e.textContent = txt; e.setAttribute('fill', col || c.muted);
    }
    async function spin() {
      const d = E('disk'); if (!d) return;
      lite('disk', c.amber, 2.2);
      await animate(d, { opacity: [1, 0.55, 1], duration: dur(300), ease: 'inOut(2)' });
      d.setAttribute('stroke', c.gray); d.setAttribute('stroke-width', 1.4); d.removeAttribute('filter');
    }

    async function step() {
      if (st.busy || st.i >= COMPS.length) return; st.busy = true; setLock(true);
      const i = st.i, name = COMPS[i], parent = LEVELS[i], child = LEVELS[i + 1];
      drawScene();
      lite('comp-' + i, c.amber); lite('row-' + i, c.amber); lite('ino-' + i, c.amber, 2);
      K.addLog(logBody, `component ${i + 1}/${COMPS.length}: resolve "${name}" inside ${parent.name} (inode ${parent.ino})`);
      guide(INO.x + INO.w, rowMid(i), DC.sx, slotMid(i), c.muted);
      cGlow('hit', 'rgba(22,163,74,.26)');
      await pulse(INO.x + INO.w, rowMid(i), DC.sx, slotMid(i), c.amber);

      if (st.cached[i]) {
        lite('slot-' + i, c.green); st.hits++; render();
        K.addLog(logBody, `dcache hit — (${parent.ino}, "${name}") → inode ${child.ino} · no disk read`, 'ok');
        guide(DC.sx, slotMid(i), INO.x + INO.w, rowMid(i + 1), c.green);
        await pulse(DC.sx, slotMid(i), INO.x + INO.w, rowMid(i + 1), c.green);
        lite('row-' + (i + 1), c.green); lite('ino-' + (i + 1), c.green, 2);
      } else {
        lite('slot-' + i, c.red); cGlow('miss', 'rgba(220,38,38,.24)');
        K.addLog(logBody, `dcache miss — (${parent.ino}, "${name}") is not resident · go to the filesystem`, 'err');
        await K.delay(dur(200));
        await readBlock(i, parent);
        const j = parent.entries.findIndex((e) => e[0] === name);
        await scanEntries(i, j, parent, name, child);
        await readInode(i, child);
        await insertDentry(i, parent, name, child);
      }
      st.i++; render();
      if (st.i >= COMPS.length) finish();
      st.busy = false; setLock(false);
    }

    async function readBlock(i, parent) {
      st.reads++; render();
      diskOp(`read ${parent.name} data block`, c.amber);
      K.addLog(logBody, `disk read #${st.reads} — ${parent.name}'s directory data block (inode ${parent.ino})`, 'warn');
      await pulse(ROW.x + ROW.w, rowMid(i), DISK.cx, DISK.cy, c.amber);
      await spin();
      await pulse(DISK.cx, DISK.cy, ROW.x + ROW.w, rowMid(i), c.amber);
      st.block[i] = true;
      parent.entries.forEach((e, j) => {
        const r = E(`ent-${i}-${j}`), t = E(`entt-${i}-${j}`);
        if (r) { r.setAttribute('opacity', 1); r.setAttribute('stroke', c.blue); r.setAttribute('fill', K.grad(uid, 'blue')); }
        if (t) { t.setAttribute('opacity', 1); t.setAttribute('fill', c.text); }
      });
    }

    async function scanEntries(i, j, parent, name, child) {
      for (let k = 0; k < parent.entries.length; k++) {
        lite(`ent-${i}-${k}`, k === j ? c.green : c.amber, 2);
        await K.delay(dur(170));
        if (k === j) break;
        const r = E(`ent-${i}-${k}`);
        if (r) { r.setAttribute('stroke', c.blue); r.setAttribute('stroke-width', 1); r.removeAttribute('filter'); }
      }
      K.addLog(logBody, `linear scan of ${parent.entries.length} entries → "${name}" = inode ${child.ino}`
        + '  (big directories use an htree index instead)');
    }

    async function readInode(i, child) {
      st.reads++; render();
      diskOp(`read inode ${child.ino}`, c.amber);
      K.addLog(logBody, `disk read #${st.reads} — inode ${child.ino} itself (mode, size, block pointers)`, 'warn');
      await pulse(ROW.x + ROW.w, rowMid(i), DISK.cx, DISK.cy, c.amber);
      await spin();
      await pulse(DISK.cx, DISK.cy, INO.x + INO.w, rowMid(i + 1), c.amber);
      lite('row-' + (i + 1), c.green); lite('ino-' + (i + 1), c.green, 2);
      diskOp('idle');
    }

    async function insertDentry(i, parent, name, child) {
      st.cached[i] = true;
      await pulse(INO.x + INO.w, rowMid(i + 1), DC.sx, slotMid(i), c.green);
      const r = E('slot-' + i), t = E('slott-' + i);
      if (t) { t.textContent = `(${parent.ino}, "${name}") → ${child.ino}`; t.setAttribute('fill', c.text); }
      if (r) { r.setAttribute('fill', K.grad(uid, 'green')); r.setAttribute('opacity', 1); animate(r, { opacity: [0.2, 1], duration: dur(280), ease: 'out(2)' }); }
      lite('slot-' + i, c.green);
      K.addLog(logBody, `dcache insert (${parent.ino}, "${name}") → ${child.ino} · this component is free from now on`, 'ok');
    }

    function finish() {
      st.walks++;
      const leaf = LEVELS[COMPS.length];
      if (st.reads === 0) {
        K.addLog(logBody, `⚡ same path, same walk, ${st.hits} dcache hits — 0 disk reads. That is what the dentry cache buys you.`, 'ok');
      } else {
        K.addLog(logBody, `resolved ${PATH} → inode ${leaf.ino} · ${st.hits} hits, ${st.reads} disk reads. `
          + 'Now press ↺ Reset and walk it again — the cache is warm.', 'hl');
      }
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      const my = st;
      while (st === my && my.playing && my.i < COMPS.length) { await step(); await K.delay(dur(420)); }
      if (st === my) { my.playing = false; pp(); }
    }
    function pause() { st.playing = false; pp(); }

    // Reset rewinds the WALK but keeps the dentry cache — that is the whole second act.
    function reset() {
      st.playing = false;
      const kc = st.cached.slice(), kb = st.block.slice(), sp = st.speed;
      st = fresh(st.seed); st.cached = kc; st.block = kb; st.speed = sp;
      pp(); drawScene(); render(); setLock(false);
      const n = warmCount();
      K.addLog(logBody, n === COMPS.length
        ? `↺ reset — walk rewound, dcache still holds all ${n} entries: the same path now costs 0 disk reads`
        : `↺ reset — walk rewound, dcache kept (${n}/${COMPS.length} warm; counters cleared)`, 'hl');
    }
    function reseed() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 0); st.speed = sp;
      pp(); drawScene(); render(); setLock(false);
      K.addLog(logBody, `🌱 seed ${st.seed} — ${warmCount()} of ${COMPS.length} components start warm (warmth is always a prefix)`, 'hl');
    }
    function drop() {
      st.playing = false;
      const sp = st.speed, sd = st.seed;
      st = fresh(sd); st.speed = sp;
      st.cached = COMPS.map(() => false); st.block = COMPS.map(() => false);
      pp(); drawScene(); render(); setLock(false);
      K.addLog(logBody, '🧹 dropped the dentry cache (echo 3 > /proc/sys/vm/drop_caches) — '
        + `the next walk is cold: ${COMPS.length} misses, ${COMPS.length * 2} disk reads`, 'err');
    }

    function pp() { root.querySelector('.t-play').disabled = st.playing || st.i >= COMPS.length; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-drop', '.t-reset'], b);
      root.querySelector('.t-step').disabled = b || st.i >= COMPS.length;
      if (!st.playing) root.querySelector('.t-play').disabled = b || st.i >= COMPS.length;
    }
    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy && !st.playing) step(); };
      root.querySelector('.t-drop').onclick = () => { if (!st.busy) drop(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = () => { if (!st.busy) reset(); };
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
      root.querySelector('.t-seed').onchange = () => { if (!st.busy) reseed(); };
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSPathWalk = { init };
})();
