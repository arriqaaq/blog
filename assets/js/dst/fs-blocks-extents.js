/**
 * FS Blocks & Extents (dst-kit) — two ways to say where a file's bytes are.
 *
 * The post's point, shown on ONE file in two representations:
 *   • indirect (ext2/ext3): i_block[] holds 12 direct block numbers, then a single, a double and a
 *     triple indirect pointer. Past block 12 the filesystem must ALLOCATE a whole block just to
 *     hold more block numbers — that block costs space, costs an extra read on every access to the
 *     blocks it covers, and (being allocated from the same free space) punches a hole through the
 *     file's own contiguous run. With 4 KiB blocks and 4-byte block numbers: 1024 pointers per
 *     block → 12 direct = 48 KiB, +1024 = 4 MiB, +1024² = 4 GiB, +1024³ = 4 TiB.
 *   • extents (ext4): a 12-byte ext4_extent record says (logical, physical start, length), length
 *     up to 32,768 blocks. Four records fit inline in the 60-byte i_block, so a contiguous file is
 *     described by one record and read with zero extra lookups. Fragment it and the records
 *     multiply until they no longer fit inline and spill into an extent-tree block — one extra
 *     read again. Contiguity is the whole reason extents win.
 * Exposes window.FSBlocksExtents.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-blocks-extents: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-blocks-extents: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 330;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const COLS = 18, ROWS = 8, NB = COLS * ROWS;            // 144 drawn blocks
  const CW = 25, CH = 17, SX = 28, SY = 21, GX0 = 262, GY0 = 52;
  const LP = { x: 16, w: 228 };                           // the i_block[] panel
  const PTR = { x0: 18, y0: 52, w: 52, h: 18, sx: 56, sy: 22 };
  const IND = { x: 18, w: 220, h: 20, ys: [130, 154, 178] };
  const EXT = { x: 18, w: 220, h: 20, hy: 60, ys: [86, 110, 134, 158, 182] };
  const STRIP = { x0: 16, y: 260, w: 210, step: 240, h: 34 };
  const BASE = 4096;                                      // physical block numbers
  const MAXF = 44;                                        // keep the drawing readable
  const cellX = (b) => GX0 + (b % COLS) * SX;
  const cellY = (b) => GY0 + Math.floor(b / COLS) * SY;

  // contiguous physical runs, walked in LOGICAL order — exactly what one extent record can cover
  function runs(arr) {
    const r = [];
    arr.forEach((b) => {
      const t = r[r.length - 1];
      if (t && b === t.start + t.len) t.len++;
      else r.push({ start: b, len: 1 });
    });
    return r;
  }

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 9 : seed;
      const rng = K.rng(s);
      const used = new Set();                             // blocks other files already hold
      let i = 0;
      while (i < NB) {
        if (rng() < 0.17) { const n = 1 + Math.floor(rng() * 4); for (let j = 0; j < n && i + j < NB; j++) used.add(i + j); i += n; }
        else i += 1 + Math.floor(rng() * 3);
      }
      const s0 = { seed: s, rng, used, mode: 'indirect', file: [], meta: [], frags: 0,
        busy: false, playing: false, speed: 1 };
      for (let k = 0; k < 6; k++) {                       // 6 starting blocks, laid down contiguously where it can
        const last = s0.file.length ? s0.file[s0.file.length - 1] : -1;
        let b = -1;
        for (let q = last + 1; q < NB; q++) if (!used.has(q)) { b = q; break; }
        if (b < 0) break;
        s0.file.push(b);
      }
      return s0;
    };
    let st = fresh(9);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const R = (k) => root.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const isFree = (b) => b >= 0 && b < NB && !st.used.has(b) && st.file.indexOf(b) < 0 && st.meta.indexOf(b) < 0;
    const nextFree = (from) => { for (let b = Math.max(0, from); b < NB; b++) if (isFree(b)) return b; return -1; };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--blue t-grow">＋ grow file</button>
        <button class="dstk-btn dstk-btn--purple t-mode">⇄ switch to extents</button>
        <button class="dstk-btn dstk-btn--amber t-frag">🧩 fragment</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Where a file’s bytes are recorded', sub: 'ext2 indirect pointers vs ext4 extents — the same file, both ways',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'fb', label: 'file blocks' }, { id: 'mb', label: 'metadata blocks' },
          { id: 'ex', label: 'extents' }, { id: 'lk', label: 'last-block lookups' }],
        cap: 'Indirect pointers cost extra blocks and extra reads as a file grows. An extent replaces a run of '
           + 'pointers with (start, length) — which is why one record can cover thousands of blocks, and why '
           + 'fragmentation is what makes it degrade.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      modeBtn(); drawScene(); bind(); render();
      K.addLog(logBody, '🌱 press ＋ grow until the file passes 12 blocks, then ⇄ switch and compare the two pictures', 'hl');
    }

    function modeBtn() {
      root.querySelector('.t-mode').textContent = st.mode === 'indirect' ? '⇄ switch to extents' : '⇄ switch to indirect';
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      K.el('text', { x: 16, y: 14, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'The same file, described two ways. Left: what the inode stores. Right: where the blocks physically sit.';
      if (st.mode === 'indirect') drawIndirect(); else drawExtents();
      drawGrid(); drawStrip();
    }

    function head(x, w, title, sub) {
      K.el('text', { x, y: 32, fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = title;
      K.el('text', { x, y: 43, fill: c.muted, 'font-size': 8.5 }, content).textContent = sub;
    }
    function box(g, x, y, w, h, label, zone, on, size) {
      K.el('rect', { x, y, width: w, height: h, rx: 4, fill: on ? K.grad(uid, zone) : 'none',
        stroke: on ? c[zone] : c.gray, 'stroke-width': on ? 1.4 : 0.8, opacity: on ? 1 : 0.6 }, g);
      K.el('text', { x: x + w / 2, y: y + h / 2 + 3.2, 'text-anchor': 'middle', fill: on ? c[zone] : c.gray,
        'font-size': size || 8.5, 'font-weight': on ? 700 : 400, 'font-family': MONO }, g).textContent = label;
    }

    function drawIndirect() {
      const g = K.el('g', {}, content);
      head(LP.x, LP.w, 'inode i_block[15]', '12 direct + single/double/triple indirect');
      for (let j = 0; j < 12; j++) {
        const x = PTR.x0 + (j % 4) * PTR.sx, y = PTR.y0 + Math.floor(j / 4) * PTR.sy;
        const b = st.file[j];
        box(g, x, y, PTR.w, PTR.h, b == null ? '[' + j + '] —' : String(BASE + b), 'blue', b != null);
      }
      const n = st.file.length;
      const rows = [
        { t: 'i_block[12] single → 1024 ptrs · 4 MiB', on: n > 12 },
        { t: 'i_block[13] double → 1024² · 4 GiB', on: n > 12 + 1024 },
        { t: 'i_block[14] triple → 1024³ · 4 TiB', on: n > 12 + 1024 + 1024 * 1024 },
      ];
      rows.forEach((r, k) => {
        const label = r.on && k === 0 && st.meta.length ? `i_block[12] → indirect block ${BASE + st.meta[0]}` : r.t;
        box(g, IND.x, IND.ys[k], IND.w, IND.h, label, 'purple', r.on);
      });
      K.el('text', { x: LP.x + 2, y: 212, fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = n > 12 ? `blocks 12…${n - 1} live in that indirect block` : `${12 - n} direct slot${12 - n === 1 ? '' : 's'} left before indirection`;
      K.el('text', { x: LP.x + 2, y: 224, fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = 'an indirect block holds only block numbers';
    }

    function drawExtents() {
      const g = K.el('g', {}, content);
      const rs = runs(st.file), depth = (rs.length > 4 && st.meta.length) ? 1 : 0;
      head(LP.x, LP.w, 'inode i_block[60 bytes]', 'ext4_extent_header + 12-byte records');
      box(g, EXT.x, EXT.hy, EXT.w, EXT.h,
        `hdr: entries ${rs.length} · max 4 · depth ${depth}`, depth ? 'amber' : 'purple', true);
      // when the records overflow the drawn slots, keep the last slot for a "… N more" summary
      const shown = rs.length > EXT.ys.length ? EXT.ys.length - 1 : rs.length;
      for (let k = 0; k < shown; k++) {
        const r = rs[k];
        box(g, EXT.x, EXT.ys[k], EXT.w, EXT.h, `start ${BASE + r.start} · len ${r.len}`, 'purple', true);
        K.el('line', { x1: EXT.x + EXT.w, y1: EXT.ys[k] + EXT.h / 2, x2: cellX(r.start) - 2, y2: cellY(r.start) + CH / 2,
          stroke: c.purple, 'stroke-width': 0.9, opacity: 0.4 }, g);
      }
      for (let k = shown; k < EXT.ys.length; k++)
        box(g, EXT.x, EXT.ys[k], EXT.w, EXT.h,
          rs.length > EXT.ys.length ? `… ${rs.length - shown} more records` : '(empty record slot)', 'gray', false);
      K.el('text', { x: LP.x + 2, y: 212, fill: depth ? c.amber : c.green, 'font-size': 8.5, 'font-weight': 700 }, content)
        .textContent = depth ? `depth 1 — records spilled into extent block ${BASE + st.meta[0]}`
                             : `${rs.length} record${rs.length === 1 ? '' : 's'} inline in the inode — 0 extra reads`;
      K.el('text', { x: LP.x + 2, y: 224, fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = 'one record covers up to 32,768 blocks (128 MiB)';
    }

    function drawGrid() {
      head(GX0, 502, 'disk — free space layout (seeded)', `${NB} blocks of 4 KiB · other files already hold some of them`);
      const g = K.el('g', { id: uid + '-grid' }, content);
      const fileSet = new Set(st.file), metaSet = new Set(st.meta);
      const starts = new Set(runs(st.file).map((r) => r.start));
      for (let b = 0; b < NB; b++) {
        const x = cellX(b), y = cellY(b);
        const meta = metaSet.has(b), mine = fileSet.has(b), other = st.used.has(b);
        const z = meta ? 'purple' : mine ? 'blue' : 'gray';
        K.el('rect', { id: `${uid}-c-${b}`, x, y, width: CW, height: CH, rx: 3,
          fill: (meta || mine || other) ? K.grad(uid, z) : 'none',
          stroke: meta ? c.purple : mine ? c.blue : c.gray,
          'stroke-width': (meta || mine) ? 1.3 : 0.7, opacity: (other && !mine && !meta) ? 0.7 : 1 }, g);
        if (mine && starts.has(b) && st.mode === 'extents')
          K.el('path', { d: `M ${x + 1},${y + 1} L ${x + 7},${y + 1} L ${x + 1},${y + 7} Z`, fill: c.purple }, g);
        if (meta)
          K.el('text', { x: x + CW / 2, y: y + 12, 'text-anchor': 'middle', fill: c.text, 'font-size': 8.5, 'font-weight': 700 }, g)
            .textContent = st.mode === 'indirect' ? 'IND' : 'EXT';
      }
      const leg = [['this file', c.blue], ['metadata block', c.purple], ['another file', c.gray], ['free', c.gray]];
      let lx = GX0;
      leg.forEach((l, i) => {
        K.el('rect', { x: lx, y: 224, width: 11, height: 9, rx: 2, fill: i === 3 ? 'none' : K.grad(uid, i === 0 ? 'blue' : i === 1 ? 'purple' : 'gray'),
          stroke: l[1], 'stroke-width': i === 3 ? 0.7 : 1.1, opacity: i === 2 ? 0.7 : 1 }, content);
        K.el('text', { x: lx + 16, y: 232, fill: c.muted, 'font-size': 8.5 }, content).textContent = l[0];
        lx += 22 + l[0].length * 4.7;
      });
    }

    // the read path for the file's LAST block — this is where the two schemes visibly differ
    function chain() {
      const n = st.file.length;
      if (!n) return [];
      const last = BASE + st.file[n - 1], idx = n - 1;
      if (st.mode === 'indirect') {
        if (idx < 12 || !st.meta.length) return [
          { t: 'inode (already in memory)', s: `i_block[${Math.min(idx, 11)}] = ${last}`, z: 'purple' },
          { t: 'data block ' + last, s: 'read #1 — the only read', z: 'blue' }];
        return [
          { t: 'inode (already in memory)', s: 'i_block[12] · single indirect', z: 'purple' },
          { t: 'indirect block ' + (BASE + st.meta[0]), s: 'EXTRA read — pointers only, no data', z: 'purple' },
          { t: 'data block ' + last, s: 'read #2', z: 'blue' }];
      }
      const rs = runs(st.file), depth = (rs.length > 4 && st.meta.length) ? 1 : 0, k = rs.length - 1;
      if (!depth) return [
        { t: 'inode (already in memory)', s: `record ${k}: (${BASE + rs[k].start}, len ${rs[k].len})`, z: 'purple' },
        { t: 'data block ' + last, s: 'read #1 — the only read', z: 'blue' }];
      return [
        { t: 'inode (already in memory)', s: `extent tree root · depth 1 · ${rs.length} records`, z: 'purple' },
        { t: 'extent block ' + (BASE + st.meta[0]), s: 'EXTRA read — records outgrew the inode', z: 'purple' },
        { t: 'data block ' + last, s: 'read #2', z: 'blue' }];
    }

    function drawStrip() {
      const g = K.el('g', { id: uid + '-strip' }, content);
      K.el('text', { x: STRIP.x0, y: 250, fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, g)
        .textContent = 'reading the LAST block of the file';
      const ch = chain();
      ch.forEach((s, i) => {
        const x = STRIP.x0 + i * STRIP.step;
        K.el('rect', { x, y: STRIP.y, width: STRIP.w, height: STRIP.h, rx: 6, fill: K.grad(uid, s.z),
          stroke: c[s.z], 'stroke-width': 1.5 }, g);
        K.el('text', { x: x + 10, y: STRIP.y + 14, fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, g).textContent = s.t;
        K.el('text', { x: x + 10, y: STRIP.y + 26, fill: c.muted, 'font-size': 8.5, 'font-family': MONO }, g).textContent = s.s;
        if (i < ch.length - 1)
          K.el('line', { x1: x + STRIP.w + 4, y1: STRIP.y + STRIP.h / 2, x2: x + STRIP.step - 6, y2: STRIP.y + STRIP.h / 2,
            stroke: c.muted, 'stroke-width': 1.2, 'marker-end': K.arrow(uid, 'gray') }, g);
      });
      const extra = Math.max(0, ch.length - 2);
      K.el('text', { x: 764, y: STRIP.y + 21, 'text-anchor': 'end', fill: extra ? c.amber : c.green,
        'font-size': 10.5, 'font-weight': 700 }, g).textContent = extra ? extra + ' extra read' : '0 extra reads';
      const n1 = st.mode === 'indirect'
        ? '12 direct → 48 KiB · +1024 ptrs → 4 MiB · +1024² → 4 GiB · +1024³ → 4 TiB   (4 KiB blocks, 4-byte block numbers)'
        : 'one ext4_extent = (logical, physical start, length ≤ 32,768 blocks) · 12 bytes · four fit inline in the 60-byte i_block';
      const n2 = st.mode === 'indirect'
        ? 'An indirect block is a real block: it costs space, costs a read, and is allocated out of the same free space the file wanted.'
        : 'Contiguous file ⇒ few records ⇒ zero extra reads. Fragment it and the records multiply until they spill into an extent-tree block.';
      K.el('text', { x: STRIP.x0, y: 308, fill: c.muted, 'font-size': 8.5, 'font-family': MONO }, g).textContent = n1;
      K.el('text', { x: STRIP.x0, y: 321, fill: c.muted, 'font-size': 8.5 }, g).textContent = n2;
    }

    // one block at a time, so the allocator's behaviour is visible rather than asserted
    function allocOne(frag) {
      const last = st.file.length ? st.file[st.file.length - 1] : -1;
      if (!frag) return (last >= 0 && isFree(last + 1)) ? last + 1 : nextFree(last + 1);
      return nextFree(last + 2 + Math.floor(st.rng() * 3));   // deliberately skip → a new run starts
    }
    function metaNeed() {
      if (st.mode === 'indirect') return st.file.length > 12 ? 1 : 0;
      return runs(st.file).length > 4 ? 1 : 0;
    }
    function syncMeta() {
      const need = metaNeed();
      while (st.meta.length > need) st.meta.pop();
      while (st.meta.length < need) {
        const b = nextFree(st.file.length ? st.file[st.file.length - 1] + 1 : 0);
        if (b < 0) break;
        st.meta.push(b);
      }
    }

    async function grow(frag) {
      if (st.busy) return;
      if (st.file.length >= MAXF) { K.addLog(logBody, '＋ the drawn disk is nearly full — press ↺ Reset', 'warn'); return; }
      st.busy = true; setLock(true);
      const want = Math.min(2 + Math.floor(st.rng() * 3), MAXF - st.file.length);
      const added = [];
      const before = { runs: runs(st.file).length, meta: st.meta.length, n: st.file.length };
      for (let i = 0; i < want; i++) {
        const b = allocOne(frag && i === 0);
        if (b < 0) break;
        st.file.push(b); added.push(b);
        syncMeta();
      }
      if (!added.length) { K.addLog(logBody, '＋ no free block left on the drawn disk — press ↺ Reset', 'warn'); st.busy = false; setLock(false); return; }
      if (frag) st.frags++;
      drawScene(); render();
      added.forEach((b, i) => {
        const e = E('c-' + b);
        if (e) animate(e, { opacity: [0.1, 1], duration: dur(420), delay: dur(70 * i), ease: 'out(2)' });
      });
      const n = st.file.length, rs = runs(st.file);
      if (frag)
        K.addLog(logBody, `🧩 the allocator had to skip ahead — logical block ${before.n} is not physically next to ${before.n - 1}. `
          + `The file is now ${rs.length} run${rs.length === 1 ? '' : 's'}`, 'warn');
      else
        K.addLog(logBody, `＋ ${added.length} block${added.length === 1 ? '' : 's'} appended → ${n} blocks (${(n * 4)} KiB)`, null);
      if (st.mode === 'indirect') {
        if (before.n <= 12 && n > 12 && st.meta.length)
          K.addLog(logBody, `i_block[0..11] are full → block ${BASE + st.meta[0]} is allocated as an INDIRECT block. It holds only `
            + 'block numbers, and it came out of the same free space the file wanted', 'warn');
        if (n > 12 && st.meta.length)
          K.addLog(logBody, `logical block ${n - 1} → i_block[12] → indirect block ${BASE + st.meta[0]} → data block ${BASE + st.file[n - 1]} `
            + '· 1 indirect lookup before a single byte of the file is read', 'hl');
      } else {
        if (before.runs <= 4 && rs.length > 4 && st.meta.length)
          K.addLog(logBody, `a 5th record no longer fits in the 60-byte i_block → extent block ${BASE + st.meta[0]} allocated, depth goes 0 → 1`, 'warn');
        K.addLog(logBody, `${rs.length} extent${rs.length === 1 ? '' : 's'} describe all ${n} blocks — at real scale four records like these `
          + 'cover up to 131,072 blocks (512 MiB)', 'hl');
      }
      await K.delay(dur(360));
      st.busy = false; setLock(false);
    }

    async function switchMode() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.mode = st.mode === 'indirect' ? 'extents' : 'indirect';
      syncMeta(); modeBtn(); drawScene(); render();
      const n = st.file.length, rs = runs(st.file);
      if (st.mode === 'extents')
        K.addLog(logBody, `⇄ same ${n} blocks as ext4 extents: ${rs.length} record${rs.length === 1 ? '' : 's'} replace `
          + `${n} block numbers${st.meta.length ? ' (+1 extent-tree block)' : ' — and no metadata block at all'}`, 'ok');
      else
        K.addLog(logBody, `⇄ same ${n} blocks as ext2 indirect pointers: ${Math.min(n, 12)} in the inode`
          + (n > 12 && st.meta.length ? `, ${n - 12} behind indirect block ${BASE + st.meta[0]}` : ', still all direct'), 'ok');
      const g = E('grid'); if (g) animate(g, { opacity: [0.35, 1], duration: dur(420), ease: 'out(2)' });
      await K.delay(dur(380));
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = R('stat-' + k); if (e) e.textContent = v; }
    function render() {
      const rs = runs(st.file), extra = Math.max(0, chain().length - 2);
      stat('fb', st.file.length); stat('mb', st.meta.length); stat('ex', rs.length); stat('lk', extra);
      const m = R('stat-mb'); if (m) m.style.color = st.meta.length ? c.purple : '';
      const l = R('stat-lk'); if (l) l.style.color = extra ? c.amber : c.green;
      const e = R('stat-ex'); if (e) e.style.color = rs.length > 4 ? c.amber : '';
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      const my = st;
      while (st === my && my.playing && my.file.length < MAXF) {
        await grow(my.rng() < 0.28);                        // seeded: most growth contiguous, some not
        if (st !== my || !my.playing) break;
        await K.delay(dur(650));
      }
      if (st === my) { my.playing = false; pp(); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false;
      const sp = st.speed, md = st.mode;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 9); st.speed = sp; st.mode = md;
      pp(); setLock(false); modeBtn(); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed} redraws the free-space layout, so contiguity is a different roll`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-grow', '.t-mode', '.t-frag', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-grow').onclick = () => grow(false);
      root.querySelector('.t-frag').onclick = () => grow(true);
      root.querySelector('.t-mode').onclick = switchMode;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSBlocksExtents = { init };
})();
