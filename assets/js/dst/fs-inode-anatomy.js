/**
 * FS Inode Anatomy (dst-kit) — the name and the file are two different objects.
 *
 * The post's most load-bearing idea: a directory is a file of (name → inode number) records, and
 * an inode holds mode, uid, size, i_links_count and block pointers — and no name at all. So a
 * hard link is nothing more than a second directory entry carrying the same inode number, and
 * unlink(2) removes a NAME: it drops i_links_count by one and only frees the inode and its data
 * blocks when that count reaches zero (and no process still holds the file open). A symlink is a
 * different animal: its own inode, whose contents are a path string — stored inline in i_block
 * when the target is short enough (ext4's "fast symlink") — resolved by NAME all over again.
 * Exposes window.FSInodeAnatomy.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-inode-anatomy: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-inode-anatomy: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 330;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const DIR = { x: 16, w: 196, h: 26, step: 33, y0: 46, max: 6 };
  const INO = { x: 272, w: 252, h: 84, ys: [46, 136, 226] };
  const BLK = { x: 584, w: 80, gap: 100, h: 26, dy: 50 };
  const LINK_NAMES = ['backup.md', 'copy.md', 'alias.md', 'draft.md'];
  const rowY = (i) => DIR.y0 + i * DIR.step;
  const blkX = (j) => BLK.x + j * BLK.gap;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 12 : seed;
      const rng = K.rng(s);
      const b0 = 4100 + Math.floor(rng() * 900);                 // seeded free-space layout
      const b1 = b0 + 1 + Math.floor(rng() * 40);
      const b2 = b1 + 1 + Math.floor(rng() * 60);
      const inodes = {
        12: { no: 12, kind: 'file', mode: '0644', uid: 1000, size: 4096 + Math.floor(rng() * 4000),
              blocks: [b0, b0 + 1], free: false },
        13: { no: 13, kind: 'file', mode: '0644', uid: 1000, size: 200 + Math.floor(rng() * 3000),
              blocks: [b1], free: false },
      };
      return { seed: s, rng, order: [12, 13],
        entries: [{ name: 'report.md', ino: 12 }, { name: 'notes.txt', ino: 13 }],
        inodes, spare: b2, sel: 0, linked: 0, busy: false, playing: false, speed: 1 };
    };
    let st = fresh(12);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const R = (k) => root.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const links = (no) => st.entries.filter((e) => e.ino === no).length;
    const slotOf = (no) => st.order.indexOf(no);
    const inoY = (no) => INO.ys[slotOf(no)];

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-link">🔗 hard link</button>
        <button class="dstk-btn dstk-btn--amber t-un1">🗑 unlink one</button>
        <button class="dstk-btn dstk-btn--red t-unlast">🗑 unlink last</button>
        <button class="dstk-btn dstk-btn--blue t-sym">↪ symlink</button></div>
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
        title: 'A name is not a file', sub: 'directory entries · inodes · data blocks — three separate things',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'names', label: 'names' }, { id: 'inodes', label: 'inodes' }, { id: 'links', label: 'link count' }],
        cap: 'An inode holds metadata and block pointers — never a name. Names live in directory entries, '
           + "which is why a file can have two of them and why deleting one doesn't delete the file.",
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 click any name on the left to follow it — then press 🔗 hard link and watch the count', 'hl');
    }

    function head(x, w, title, sub, mid) {
      K.el('text', { x: mid ? x + w / 2 : x, y: 28, 'text-anchor': mid ? 'middle' : 'start',
        fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = title;
      K.el('text', { x: mid ? x + w / 2 : x, y: 39, 'text-anchor': mid ? 'middle' : 'start',
        fill: c.muted, 'font-size': 8.5 }, content).textContent = sub;
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      K.el('text', { x: 16, y: 14, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'A directory is a file of (name → inode number) records. Follow one and see what the inode does — and does not — contain.';
      head(DIR.x, DIR.w, 'directory /home/kf', 'name → inode number');
      head(INO.x, INO.w, 'inode table', 'metadata + block pointers · no names', true);
      head(BLK.x, 180, 'data blocks', '4 KiB each', true);
      drawArrows(); drawEntries(); drawInodes(); drawBlocks(); drawNotes();
    }

    // entry → inode connectors, drawn first so the boxes sit on top of them
    function drawArrows() {
      const g = K.el('g', { id: uid + '-arrows' }, content);
      st.entries.forEach((e, i) => {
        const ino = st.inodes[e.ino]; if (!ino) return;
        K.el('line', { id: `${uid}-ar-${i}`, x1: DIR.x + DIR.w, y1: rowY(i) + DIR.h / 2,
          x2: INO.x - 3, y2: inoY(e.ino) + 42, stroke: ino.free ? c.gray : c.muted,
          'stroke-width': 1.1, opacity: 0.55, 'marker-end': K.arrow(uid, 'gray') }, g);
      });
      // a symlink is resolved by NAME: it points back at the directory, not at an inode number
      const sym = st.order.map((n) => st.inodes[n]).filter((n) => n && n.kind === 'symlink')[0];
      const tgt = sym && st.entries.findIndex((e) => e.name === sym.target);
      if (sym && tgt >= 0)
        K.el('path', { d: `M ${INO.x - 3},${inoY(sym.no) + 20} C ${INO.x - 44},${inoY(sym.no) + 20} `
          + `${DIR.x + DIR.w + 40},${rowY(tgt) + 13} ${DIR.x + DIR.w + 3},${rowY(tgt) + 13}`,
          fill: 'none', stroke: c.blue, 'stroke-width': 1.3, 'stroke-dasharray': '4,3',
          'marker-end': K.arrow(uid, 'blue'), opacity: 0.9 }, g);
    }

    function drawEntries() {
      const g = K.el('g', { id: uid + '-entries' }, content);
      st.entries.forEach((e, i) => {
        const y = rowY(i), on = i === st.sel;
        const ino = st.inodes[e.ino];
        const dead = !ino || ino.free;
        K.el('rect', { id: `${uid}-e-${i}`, x: DIR.x, y, width: DIR.w, height: DIR.h, rx: 6,
          fill: K.grad(uid, on ? 'purple' : 'gray'), stroke: on ? c.purple : c.gray,
          'stroke-width': on ? 1.8 : 1, filter: on ? K.glow(uid) : '' }, g);
        K.el('text', { x: DIR.x + 10, y: y + 17, fill: dead ? c.gray : c.text, 'font-size': 10,
          'font-weight': 700, 'font-family': MONO }, g).textContent = e.name;
        K.el('text', { x: DIR.x + DIR.w - 10, y: y + 17, 'text-anchor': 'end', fill: dead ? c.gray : c.muted,
          'font-size': 9.5, 'font-family': MONO }, g).textContent = '→ ' + e.ino;
        const hit = K.el('rect', { x: DIR.x, y, width: DIR.w, height: DIR.h, rx: 6, fill: 'transparent',
          style: 'cursor:pointer' }, g);
        hit.addEventListener('click', () => { if (!st.busy && !st.playing) trace(i); });
      });
      if (!st.entries.length)
        K.el('text', { x: DIR.x, y: DIR.y0 + 16, fill: c.gray, 'font-size': 9.5 }, g)
          .textContent = '(no entries left)';
    }

    function drawInodes() {
      const g = K.el('g', { id: uid + '-inodes' }, content);
      st.order.forEach((no, k) => {
        const n = st.inodes[no]; if (!n) return;
        const y = INO.ys[k], z = n.free ? 'gray' : 'purple', line = n.free ? c.gray : c.purple;
        const lc = links(no);
        K.el('rect', { id: `${uid}-i-${no}`, x: INO.x, y, width: INO.w, height: INO.h, rx: 8,
          fill: K.grad(uid, z), stroke: line, 'stroke-width': 1.6 }, g);
        K.el('text', { x: INO.x + 12, y: y + 16, fill: n.free ? c.gray : c.text, 'font-size': 11.5, 'font-weight': 700 }, g)
          .textContent = 'inode ' + no;
        K.el('text', { x: INO.x + INO.w - 12, y: y + 16, 'text-anchor': 'end', fill: n.free ? c.gray : c.muted, 'font-size': 8.5 }, g)
          .textContent = n.free ? 'FREED — back on the free list' : (n.kind === 'symlink' ? 'symlink' : 'regular file');
        K.el('text', { x: INO.x + 12, y: y + 31, fill: n.free ? c.gray : c.muted, 'font-size': 8.5, 'font-family': MONO }, g)
          .textContent = `mode ${n.mode}  uid ${n.uid}  gid 1000  size ${n.size} B`;
        K.el('text', { x: INO.x + 12, y: y + 52, fill: n.free ? c.gray : c.muted, 'font-size': 9 }, g)
          .textContent = 'i_links_count';
        K.el('text', { id: `${uid}-lc-${no}`, x: INO.x + 92, y: y + 54, fill: n.free ? c.red : (lc > 1 ? c.green : c.text),
          'font-size': 16, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums' }, g).textContent = lc;
        K.el('text', { x: INO.x + INO.w - 12, y: y + 52, 'text-anchor': 'end', fill: n.free ? c.gray : c.muted, 'font-size': 8.5 }, g)
          .textContent = 'no name field in here';
        if (n.free) {
          ptrChip(g, INO.x + 12, y + 59, INO.w - 24, 'i_block[] — every pointer cleared', true, 'gray');
        } else if (n.kind === 'symlink') {
          ptrChip(g, INO.x + 12, y + 59, INO.w - 24, `i_block[] = "${n.target}"  (fast symlink)`, false, 'blue');
        } else {
          n.blocks.forEach((b, j) => ptrChip(g, INO.x + 12 + j * 120, y + 59, 110, `i_block[${j}] → ${b}`, false, 'blue'));
        }
      });
    }

    function ptrChip(g, x, y, w, label, dead, zone) {
      K.el('rect', { x, y, width: w, height: 16, rx: 4, fill: K.grad(uid, dead ? 'gray' : zone),
        stroke: dead ? c.gray : c[zone], 'stroke-width': 1 }, g);
      K.el('text', { x: x + w / 2, y: y + 11.5, 'text-anchor': 'middle', fill: dead ? c.gray : c[zone],
        'font-size': 8.5, 'font-family': MONO }, g).textContent = label;
    }

    function drawBlocks() {
      const g = K.el('g', { id: uid + '-blocks' }, content);
      st.order.forEach((no, k) => {
        const n = st.inodes[no]; if (!n || n.kind === 'symlink') return;
        const y = INO.ys[k] + BLK.dy;
        if (!n.blocks.length) {
          K.el('text', { x: BLK.x, y: y + 17, fill: c.gray, 'font-size': 8.5 }, g).textContent = '(blocks returned to the free list)';
          return;
        }
        n.blocks.forEach((b, j) => {
          const x = blkX(j);
          K.el('line', { id: `${uid}-bl-${no}-${j}`, x1: INO.x + INO.w, y1: INO.ys[k] + 67, x2: x - 3, y2: y + BLK.h / 2,
            stroke: n.free ? c.gray : c.muted, 'stroke-width': 1, opacity: 0.5, 'marker-end': K.arrow(uid, 'gray') }, g);
          K.el('rect', { id: `${uid}-b-${no}-${j}`, x, y, width: BLK.w, height: BLK.h, rx: 5,
            fill: K.grad(uid, n.free ? 'gray' : 'blue'), stroke: n.free ? c.gray : c.blue, 'stroke-width': 1.4 }, g);
          K.el('text', { x: x + BLK.w / 2, y: y + 17, 'text-anchor': 'middle', fill: n.free ? c.gray : c.blue,
            'font-size': 9, 'font-weight': 700, 'font-family': MONO }, g).textContent = n.free ? 'free' : String(b);
        });
      });
    }

    function drawNotes() {
      const t = (y, s, col, size) =>
        K.el('text', { x: DIR.x, y, fill: col || c.muted, 'font-size': size || 8.5 }, content).textContent = s;
      t(262, 'open("/home/kf/report.md") =');
      t(274, 'read the directory file → find the name →');
      t(286, 'take its inode number → load that inode.');
      t(300, '▸ click any name to trace it', c.blue, 9.5);
      t(314, 'i_links_count counts directory entries, not bytes: it is simply how many names point here, and unlink() is a decrement.');
      t(325, 'A directory also counts its own "." and one ".." per subdirectory, so an empty one starts at 2 — and hard-linking a directory is forbidden.');
    }

    // follow one name: entry → arrow → inode → block pointers → data blocks
    async function trace(i) {
      if (st.busy) return; st.busy = true; setLock(true);
      st.sel = i; drawScene(); render();
      const e = st.entries[i];
      if (!e) { st.busy = false; setLock(false); return; }
      const n = st.inodes[e.ino];
      const ar = E('ar-' + i);
      if (ar) { ar.setAttribute('stroke', c.purple); ar.setAttribute('stroke-width', 2.2); ar.setAttribute('opacity', 1); }
      K.addLog(logBody, `lookup "${e.name}" in /home/kf → the record holds inode number ${e.ino}, nothing else`, null);
      await K.delay(dur(320));
      const box = E('i-' + e.ino);
      if (box) animate(box, { opacity: [0.35, 1], duration: dur(420), ease: 'out(2)' });
      await K.delay(dur(300));
      if (!n) { st.busy = false; setLock(false); return; }
      if (n.kind === 'symlink') {
        K.addLog(logBody, `inode ${n.no} is a symlink: its contents are the string "${n.target}" — short targets live inline in `
          + 'i_block, so a fast symlink owns no data block', 'hl');
        K.addLog(logBody, `now resolve "${n.target}" from the start — a symlink stores a NAME, a hard link stores an inode number`, 'warn');
      } else if (n.free) {
        K.addLog(logBody, `inode ${n.no} is freed — the name is dangling; nothing to read`, 'err');
      } else {
        for (let j = 0; j < n.blocks.length; j++) {
          const b = E(`b-${n.no}-${j}`), ln = E(`bl-${n.no}-${j}`);
          if (ln) { ln.setAttribute('stroke', c.blue); ln.setAttribute('stroke-width', 1.8); ln.setAttribute('opacity', 1); }
          if (b) { b.setAttribute('filter', K.glow(uid)); animate(b, { opacity: [0.3, 1], duration: dur(360), ease: 'out(2)' }); }
          await K.delay(dur(240));
        }
        K.addLog(logBody, `inode ${n.no}: mode ${n.mode}, size ${n.size} B, ${links(n.no)} link${links(n.no) > 1 ? 's' : ''}, `
          + `${n.blocks.length} block pointer${n.blocks.length > 1 ? 's' : ''} → ${n.blocks.join(', ')} — and no name anywhere in it`, 'hl');
      }
      st.busy = false; setLock(false);
    }

    function targetIno() {                                        // the selected regular file, else any
      const sel = st.entries[st.sel];
      if (sel && st.inodes[sel.ino] && !st.inodes[sel.ino].free && st.inodes[sel.ino].kind === 'file') return sel.ino;
      const any = st.order.find((no) => st.inodes[no] && !st.inodes[no].free && st.inodes[no].kind === 'file'
        && links(no) > 0);
      return any == null ? null : any;
    }

    async function hardLink() {
      if (st.busy) return;
      const no = targetIno();
      if (no == null) { K.addLog(logBody, '🔗 no live file to link to — press ↺ Reset', 'warn'); return; }
      if (st.entries.length >= DIR.max) { K.addLog(logBody, '🔗 the drawing holds 6 entries — unlink one first', 'warn'); return; }
      st.busy = true; setLock(true);
      const name = LINK_NAMES[st.linked % LINK_NAMES.length]; st.linked++;
      const before = links(no);
      st.entries.push({ name, ino: no });
      st.sel = st.entries.length - 1;
      drawScene(); render();
      const lc = E('lc-' + no);
      if (lc) animate(lc, { opacity: [0.2, 1], duration: dur(500), ease: 'out(2)' });
      const box = E('i-' + no);
      if (box) animate(box, { opacity: [0.35, 1], duration: dur(500), ease: 'out(2)' });
      K.addLog(logBody, `🔗 link("${st.entries.find((e) => e.ino === no).name}", "${name}") → one new directory record, `
        + `zero bytes copied; i_links_count ${before} → ${before + 1}`, 'ok');
      K.addLog(logBody, 'two names, one inode — that is all a hard link is', 'hl');
      await K.delay(dur(420));
      st.busy = false; setLock(false);
    }

    async function unlinkOne() {
      if (st.busy) return;
      const no = st.order.find((n) => st.inodes[n] && !st.inodes[n].free && links(n) > 1);
      if (no == null) { K.addLog(logBody, '🗑 no file has two names — press 🔗 hard link first', 'warn'); return; }
      st.busy = true; setLock(true);
      const idx = st.entries.map((e, i) => (e.ino === no ? i : -1)).filter((i) => i >= 0).pop();
      const gone = st.entries[idx].name, before = links(no);
      st.entries.splice(idx, 1);
      st.sel = Math.max(0, st.entries.findIndex((e) => e.ino === no));
      drawScene(); render();
      const lc = E('lc-' + no);
      if (lc) animate(lc, { opacity: [0.2, 1], duration: dur(500), ease: 'out(2)' });
      K.addLog(logBody, `🗑 unlink("${gone}") → the directory record is erased; i_links_count ${before} → ${before - 1}`, 'warn');
      K.addLog(logBody, 'the data lives until the last name is gone', 'ok');
      await K.delay(dur(420));
      st.busy = false; setLock(false);
    }

    async function unlinkLast() {
      if (st.busy) return;
      const no = targetIno() != null && links(targetIno()) === 1 ? targetIno()
        : st.order.find((n) => st.inodes[n] && !st.inodes[n].free && links(n) === 1);
      if (no == null) { K.addLog(logBody, '🗑 every live file still has more than one name — unlink one first', 'warn'); return; }
      st.busy = true; setLock(true);
      const idx = st.entries.findIndex((e) => e.ino === no);
      const gone = st.entries[idx].name;
      const n = st.inodes[no], freed = n.blocks.slice();
      st.entries.splice(idx, 1);
      drawScene(); render();
      const lc = E('lc-' + no);
      if (lc) { lc.setAttribute('fill', c.red); animate(lc, { opacity: [0.2, 1], duration: dur(420), ease: 'out(2)' }); }
      K.addLog(logBody, `🗑 unlink("${gone}") → i_links_count 1 → 0`, 'warn');
      await K.delay(dur(520));
      n.free = true;
      st.sel = Math.min(st.sel, Math.max(0, st.entries.length - 1));
      drawScene(); render();
      K.addLog(logBody, 'link count reached 0 — now the blocks are freed', 'err');
      K.addLog(logBody, `inode ${no} and block${freed.length > 1 ? 's' : ''} ${freed.join(', ')} return to the free lists. `
        + 'Had a process still held the file open, the kernel would wait for the last close()', null);
      await K.delay(dur(300));
      st.busy = false; setLock(false);
    }

    async function symlink() {
      if (st.busy) return;
      if (st.order.length >= INO.ys.length) { K.addLog(logBody, '↪ the drawing holds three inodes — press ↺ Reset', 'warn'); return; }
      if (st.entries.length >= DIR.max) { K.addLog(logBody, '↪ the drawing holds six entries — unlink one first', 'warn'); return; }
      const tgt = st.entries.find((e) => st.inodes[e.ino] && !st.inodes[e.ino].free && st.inodes[e.ino].kind === 'file');
      if (!tgt) { K.addLog(logBody, '↪ nothing live to point at — press ↺ Reset', 'warn'); return; }
      st.busy = true; setLock(true);
      const no = Math.max.apply(null, st.order) + 1;
      st.inodes[no] = { no, kind: 'symlink', mode: '0777', uid: 1000, size: tgt.name.length,
        target: tgt.name, blocks: [], free: false };
      st.order.push(no);
      st.entries.push({ name: 'latest', ino: no });
      st.sel = st.entries.length - 1;
      drawScene(); render();
      const box = E('i-' + no);
      if (box) animate(box, { opacity: [0.3, 1], duration: dur(520), ease: 'out(2)' });
      K.addLog(logBody, `↪ symlink("${tgt.name}", "latest") → a brand new inode ${no}, whose contents are the ${tgt.name.length}-byte `
        + `string "${tgt.name}" stored inline in i_block`, 'ok');
      K.addLog(logBody, `inode ${tgt.ino}'s link count did NOT move — a symlink records a name, so it dangles if that name goes away`, 'hl');
      await K.delay(dur(420));
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = R('stat-' + k); if (e) e.textContent = v; }
    function render() {
      const live = st.order.filter((no) => st.inodes[no] && !st.inodes[no].free).length;
      const sel = st.entries[st.sel];
      const lc = sel && st.inodes[sel.ino] && !st.inodes[sel.ino].free ? links(sel.ino) : 0;
      stat('names', st.entries.length); stat('inodes', live); stat('links', lc);
      const e = R('stat-links'); if (e) e.style.color = lc > 1 ? c.green : (lc === 0 ? c.red : '');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      const my = st;
      let i = my.sel;
      while (st === my && my.playing && my.entries.length) {
        i = (i + 1) % my.entries.length;
        await trace(i);                                       // trace() owns busy + the button lock
        if (st !== my || !my.playing) break;
        await K.delay(dur(900));
      }
      if (st === my) { my.playing = false; pp(); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 12); st.speed = sp;
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed} lays the data blocks out fresh; two names, two inodes`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-link', '.t-un1', '.t-unlast', '.t-sym', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-link').onclick = hardLink;
      root.querySelector('.t-un1').onclick = unlinkOne;
      root.querySelector('.t-unlast').onclick = unlinkLast;
      root.querySelector('.t-sym').onclick = symlink;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSInodeAnatomy = { init };
})();
