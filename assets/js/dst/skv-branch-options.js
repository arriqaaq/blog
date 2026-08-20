/**
 * SKV Branch Options (dst-kit) — four ways to build a branch on an LSM tree, run against the
 * same store, with the bill for each shown side by side.
 *
 * The same four-step story — ① fork ② the child writes a key ③ the child reads an inherited
 * key ④ the branch is deleted — replayed under each of the four designs from the post:
 * branch-id-in-every-key, full copy, a content-addressed tree, and a ceiling on one shared
 * sequence counter. The stage shows what each step physically does under the selected design;
 * the scoreboard underneath keeps every design you have already run, so the comparison
 * accumulates. Exposes window.SKVBranchOptions.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-branch-options: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-branch-options: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 372;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const PAR = { x: 24, y: 64, w: 330 };      // parent store, fixed
  const RIG = { x: 388, y: 64, w: 368 };     // strategy area, rebuilt on select
  const BOARD = { x: 24, y: 268, w: 732, h: 92 };
  const PKEYS = ['a', 'b', 'c', 'd', 'e', 'f'];

  const STRATS = [
    { id: 'prefix', name: 'branch id in every key', zone: 'pink',
      bill: { fork: '0 rows', read: 'd+1 scans', del: 'range-delete over live rows', scope: 'all branches at once' } },
    { id: 'copy', name: 'full copy', zone: 'red',
      bill: { fork: 'N rows (all 6)', read: '1 store', del: 'drop the copy', scope: 'per store' } },
    { id: 'tree', name: 'content-addressed tree', zone: 'blue',
      bill: { fork: '1 root', read: 'tree walk', del: 'drop root, GC', scope: 're-derived from scratch' } },
    { id: 'ceiling', name: 'ceiling on one counter', zone: 'green',
      bill: { fork: '1 record', read: '2 capped layers', del: 'drop own components', scope: 'single owner; parent pins' } },
  ];
  const STEPS = ['fork', "child writes c", 'child reads b', 'delete branch'];

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    function fresh(seed) {
      return { seed, rng: K.rng(seed), strat: 3, step: 0, busy: false, playing: false, speed: 1,
               board: {}, childRows: [], forked: false };
    }
    let st = fresh(21);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const S = () => STRATS[st.strat];

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      const opts = STRATS.map((s, i) =>
        `<option value="${i}"${i === st.strat ? ' selected' : ''}>${s.name}</option>`).join('');
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">design</span>
          <select class="t-strat" style="width:auto">${opts}</select></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--purple t-step">⇢ Step</button>
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}" min="1" max="999" style="width:4.2rem"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Four ways to build a branch', sub: 'the same four steps under each design',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'fork', label: 'fork wrote' }, { id: 'read', label: 'read cost' },
                { id: 'del', label: 'delete cost' }, { id: 'scope', label: 'compaction' }],
        cap: 'All four forks run against the same six keys, through the same four steps. The scoreboard keeps '
           + 'every design you have already run, so the comparison accumulates as you switch between them.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 pick a design and press Step four times — then pick another and compare', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function box(g, x, y, w, h, zone, title) {
      K.el('rect', { x, y, width: w, height: h, rx: 7, fill: 'none', stroke: c[zone] || c.separator,
        'stroke-width': 1.4 }, g);
      if (title) {
        const t = K.el('text', { x: x + 8, y: y + 14, 'font-size': 9.5, 'font-weight': 700,
          fill: c[zone] || c.muted, 'font-family': MONO }, g);
        t.textContent = title;
      }
    }
    function keyChip(g, x, y, label, zone, opts) {
      const o = opts || {};
      const grp = K.el('g', { opacity: o.dim ? 0.4 : 1 }, g);
      const wch = o.w || 46;
      K.el('rect', { x, y, width: wch, height: 18, rx: 3, fill: K.grad(uid, zone),
        stroke: c[zone], 'stroke-width': 1.1, 'stroke-dasharray': o.dash ? '3 2' : 'none' }, grp);
      const t = K.el('text', { x: x + wch / 2, y: y + 12.5, 'text-anchor': 'middle', 'font-size': 8.5,
        'font-weight': 600, fill: c[zone], 'font-family': MONO }, grp);
      t.textContent = label;
      return grp;
    }

    function drawParent() {
      const g = K.el('g', { 'data-parent': 1 }, content);
      const t = K.el('text', { x: PAR.x, y: PAR.y - 10, 'font-size': 10.5, 'font-weight': 700,
        fill: c.text }, g);
      t.textContent = 'parent store — the same six keys every time';
      // memtable: e,f · two SSTables: a–c, d
      box(g, PAR.x, PAR.y, PAR.w, 46, 'green', 'memtable');
      keyChip(g, PAR.x + 12, PAR.y + 22, 'e=v5', 'green');
      keyChip(g, PAR.x + 66, PAR.y + 22, 'f=v6', 'green');
      box(g, PAR.x, PAR.y + 58, PAR.w, 46, 'blue', 'sstable · a–c');
      ['a=v1', 'b=v2', 'c=v3'].forEach((s, i) => keyChip(g, PAR.x + 12 + i * 54, PAR.y + 80, s, 'blue'));
      box(g, PAR.x, PAR.y + 116, PAR.w, 46, 'blue', 'sstable · d');
      keyChip(g, PAR.x + 12, PAR.y + 138, 'd=v4', 'blue');
      // prefix strategy: the child's rows live IN these boxes
      if (S().id === 'prefix') {
        st.childRows.forEach((r, i) => {
          keyChip(g, PAR.x + 12 + (2 + i) * 66, PAR.y + 138, r, 'pink', { w: 60 });
        });
        if (st.forked) {
          const n = K.el('text', { x: PAR.x, y: PAR.y + 178, 'font-size': 9, fill: c.pink }, g);
          n.textContent = 'child rows interleave in the SAME keyspace — no separate store exists';
        }
      }
      // ceiling strategy: the pin lands on the parent
      if (S().id === 'ceiling' && st.forked) {
        const badge = K.el('g', {}, g);
        K.el('rect', { x: PAR.x + PAR.w - 96, y: PAR.y + 120, width: 88, height: 16, rx: 3,
          fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1 }, badge);
        const bt = K.el('text', { x: PAR.x + PAR.w - 52, y: PAR.y + 131.5, 'text-anchor': 'middle',
          'font-size': 8, 'font-weight': 700, fill: c.amber, 'font-family': MONO }, badge);
        bt.textContent = 'pinned ≤ anchor 6';
        const n = K.el('text', { x: PAR.x, y: PAR.y + 178, 'font-size': 9, fill: c.amber }, g);
        n.textContent = 'the cost lands here: compaction may not drop what the anchor still reads';
      }
    }

    function drawRight() {
      const g = K.el('g', { 'data-right': 1 }, content);
      const s = S();
      const t = K.el('text', { x: RIG.x, y: RIG.y - 10, 'font-size': 10.5, 'font-weight': 700,
        fill: c[s.zone] }, g);
      t.textContent = s.name;

      if (s.id === 'prefix') {
        box(g, RIG.x, RIG.y, RIG.w, 162, 'pink', 'the shared keyspace, as the comparator sees it');
        const rows = ['a=v1', 'b=v2', 'c=v3', 'd=v4', 'e=v5', 'f=v6'];
        const merged = [];
        rows.forEach((r) => {
          merged.push({ l: r, z: 'blue' });
          const k = r[0];
          st.childRows.forEach((cr) => { if (cr.includes('·' + k)) merged.push({ l: cr, z: 'pink' }); });
        });
        merged.slice(0, 12).forEach((m, i) => {
          keyChip(g, RIG.x + 12 + (i % 5) * 70, RIG.y + 26 + Math.floor(i / 5) * 26, m.l, m.z, { w: 62 });
        });
        const n1 = K.el('text', { x: RIG.x + 10, y: RIG.y + 118, 'font-size': 8.5, fill: c.muted }, g);
        n1.textContent = 'one key’s versions are no longer contiguous —';
        const n2 = K.el('text', { x: RIG.x + 10, y: RIG.y + 131, 'font-size': 8.5, fill: c.muted }, g);
        n2.textContent = 'the newest-first walk and the bloom filters assumed they were';
        const n3 = K.el('text', { x: RIG.x + 10, y: RIG.y + 150, 'font-size': 8.5, fill: c.pink }, g);
        n3.textContent = st.forked ? 'a read at fork depth d = d+1 scans, one per prefix' : '';
      }

      if (s.id === 'copy') {
        box(g, RIG.x, RIG.y, RIG.w, 162, 'red', 'a second, fully independent store');
        if (st.forked) {
          PKEYS.forEach((k, i) => {
            keyChip(g, RIG.x + 12 + (i % 3) * 60, RIG.y + 26 + Math.floor(i / 3) * 26, `${k}=v${i + 1}`, 'red');
          });
          st.childRows.forEach((r, i) => keyChip(g, RIG.x + 200 + i * 62, RIG.y + 26, r, 'pink', { w: 56 }));
          const n = K.el('text', { x: RIG.x + 10, y: RIG.y + 118, 'font-size': 8.5, fill: c.muted }, g);
          n.textContent = 'correct, isolated, and nothing is shared:';
          const n2 = K.el('text', { x: RIG.x + 10, y: RIG.y + 131, 'font-size': 8.5, fill: c.muted }, g);
          n2.textContent = 'the fork wrote every row, so its cost scales with the store';
        } else {
          const n = K.el('text', { x: RIG.x + 10, y: RIG.y + 34, 'font-size': 9, fill: c.muted }, g);
          n.textContent = 'empty until the fork copies all six rows in';
        }
      }

      if (s.id === 'tree') {
        box(g, RIG.x, RIG.y, RIG.w, 162, 'blue', 'not an LSM anymore: nodes named by content hash');
        const rx = RIG.x + 60, lv1 = RIG.y + 46, lv2 = RIG.y + 92, lv3 = RIG.y + 134;
        // shared base tree
        const edge = (x1, y1, x2, y2, zone, dash) => K.el('line', { x1, y1, x2, y2, stroke: c[zone],
          'stroke-width': 1.2, 'stroke-dasharray': dash ? '4 3' : 'none', opacity: dash ? 0.6 : 1 }, g);
        edge(rx + 40, lv1 + 9, rx - 10 + 30, lv2, 'blue'); edge(rx + 40, lv1 + 9, rx + 110 + 30, lv2, 'blue');
        edge(rx + 20, lv2 + 9, rx - 20 + 23, lv3, 'blue'); edge(rx + 20, lv2 + 9, rx + 40 + 23, lv3, 'blue');
        edge(rx + 140, lv2 + 9, rx + 120 + 23, lv3, 'blue'); edge(rx + 140, lv2 + 9, rx + 180 + 23, lv3, 'blue');
        keyChip(g, rx, lv1, 'root #9f2c', 'blue', { w: 80 });
        keyChip(g, rx - 10, lv2, 'inner #4a', 'blue', { w: 60 });
        keyChip(g, rx + 110, lv2, 'inner #b7', 'blue', { w: 60 });
        keyChip(g, rx - 20, lv3, 'a,b', 'blue'); keyChip(g, rx + 40, lv3, 'c,d', 'blue');
        keyChip(g, rx + 120, lv3, 'e', 'blue'); keyChip(g, rx + 180, lv3, 'f', 'blue');
        if (st.forked) {
          keyChip(g, rx + 160, lv1, st.childRows.length ? "root' #e81d" : "root' #9f2c", 'pink', { w: 84 });
          if (st.childRows.length) {
            // path copy root' → inner' → leaf'; everything else shared (dashed edges)
            edge(rx + 200, lv1 + 9, rx + 230 + 30, lv2, 'pink');
            edge(rx + 200, lv1 + 9, rx + 110 + 30, lv2, 'pink', true);
            edge(rx + 260, lv2 + 9, rx + 250 + 23, lv3, 'pink');
            edge(rx + 260, lv2 + 9, rx - 20 + 23, lv3, 'pink', true);
            keyChip(g, rx + 230, lv2, "inner' #c3", 'pink', { w: 60 });
            keyChip(g, rx + 250, lv3, "c',d", 'pink');
          } else {
            edge(rx + 200, lv1 + 9, rx - 10 + 30, lv2, 'pink', true);
            edge(rx + 200, lv1 + 9, rx + 110 + 30, lv2, 'pink', true);
          }
        }
        const n = K.el('text', { x: RIG.x + 10, y: RIG.y + 156, 'font-size': 8.5, fill: c.muted }, g);
        n.textContent = 'a new address space: MVCC, compaction and recovery all re-derived';
      }

      if (s.id === 'ceiling') {
        // mini sequence rail
        box(g, RIG.x, RIG.y, RIG.w, 40, 'purple', 'global commit sequence');
        for (let i = 1; i <= 8; i++) {
          const x = RIG.x + 30 + i * 38;
          K.el('line', { x1: x, y1: RIG.y + 22, x2: x, y2: RIG.y + 36, stroke: c.purple,
            'stroke-width': 0.9, opacity: 0.5 }, g);
          const tt = K.el('text', { x: x + 2, y: RIG.y + 34, 'font-size': 8, fill: c.purple,
            'font-family': MONO, opacity: 0.8 }, g);
          tt.textContent = i;
        }
        if (st.forked) {
          const ax = RIG.x + 30 + 6 * 38;
          K.el('line', { x1: ax, y1: RIG.y + 2, x2: ax, y2: RIG.y + 38, stroke: c.text, 'stroke-width': 2 }, g);
        }
        // catalog + the child's own components
        box(g, RIG.x, RIG.y + 52, 170, 46, 'purple', 'catalog');
        if (st.forked) keyChip(g, RIG.x + 12, RIG.y + 74, 'anchor=6', 'green', { w: 70 });
        box(g, RIG.x + 186, RIG.y + 52, 182, 46, 'green', "child's own components");
        st.childRows.forEach((r, i) => keyChip(g, RIG.x + 198 + i * 62, RIG.y + 74, r, 'green', { w: 56 }));
        if (st.forked && !st.childRows.length) {
          const n = K.el('text', { x: RIG.x + 198, y: RIG.y + 82, 'font-size': 8.5, fill: c.muted }, g);
          n.textContent = 'empty — allocated on first write';
        }
        const n1 = K.el('text', { x: RIG.x + 10, y: RIG.y + 120, 'font-size': 8.5, fill: c.muted }, g);
        n1.textContent = st.forked
          ? 'a read walks the child’s components, then the parent capped at 6'
          : 'a fork will write one catalog record and nothing else';
        const n2 = K.el('text', { x: RIG.x + 10, y: RIG.y + 135, 'font-size': 8.5, fill: c.muted }, g);
        n2.textContent = st.forked ? 'the child’s own writes (seq 7+) outrank everything it inherited' : '';
      }
    }

    function drawBoard() {
      const g = K.el('g', {}, content);
      K.el('rect', { x: BOARD.x, y: BOARD.y, width: BOARD.w, height: BOARD.h, rx: 7,
        fill: c.stage, stroke: c.separator, 'stroke-width': 1 }, g);
      const colw = (BOARD.w - 96) / 4;
      const rows = [['fork', 'fork wrote'], ['read', 'a read costs'], ['del', 'delete costs']];
      rows.forEach(([, label], r) => {
        const t = K.el('text', { x: BOARD.x + 8, y: BOARD.y + 36 + r * 18, 'font-size': 8,
          fill: c.muted, 'font-family': MONO }, g);
        t.textContent = label;
      });
      STRATS.forEach((s, i) => {
        const x = BOARD.x + 96 + i * colw;
        const hd = K.el('text', { x, y: BOARD.y + 16, 'font-size': 8.5, 'font-weight': 700,
          fill: c[s.zone] }, g);
        hd.textContent = s.name;
        if (i === st.strat) K.el('rect', { x: x - 6, y: BOARD.y + 4, width: colw - 4, height: BOARD.h - 8,
          rx: 4, fill: 'none', stroke: c[s.zone], 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.7 }, g);
        rows.forEach(([key], r) => {
          const done = st.board[s.id] && st.board[s.id][key];
          const t = K.el('text', { x, y: BOARD.y + 36 + r * 18, 'font-size': 8,
            fill: done ? c.text : c.muted, opacity: done ? 1 : 0.35, 'font-family': MONO }, g);
          t.textContent = done ? s.bill[key] : '—';
        });
      });
    }

    function drawScene() {
      content.innerHTML = '';
      const intro = K.el('text', { x: 18, y: 18, 'font-size': 10.5, fill: c.muted }, content);
      intro.textContent = 'The same four-step story under each design: fork, write, read, delete. Costs accumulate below.';
      const stepLbl = K.el('text', { x: W - 18, y: 18, 'text-anchor': 'end', 'font-size': 10,
        'font-weight': 700, fill: c.text, 'font-family': MONO }, content);
      stepLbl.textContent = st.step < 4 ? `next step: ${STEPS[st.step]}` : 'story complete — pick another design';
      drawParent(); drawRight(); drawBoard();
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      const b = st.board[S().id] || {};
      stat('fork', b.fork ? S().bill.fork : '—');
      stat('read', b.read ? S().bill.read : '—');
      stat('del', b.del ? S().bill.del : '—');
      stat('scope', st.forked || b.fork ? S().bill.scope : '—');
    }

    // ---- the four-step story ------------------------------------------------------------
    function mark(key) { (st.board[S().id] = st.board[S().id] || {})[key] = true; }

    async function step() {
      if (st.busy || st.step >= 4) {
        if (st.step >= 4) K.addLog(logBody, '⇢ story complete for this design — pick another, or Reset', 'warn');
        return;
      }
      st.busy = true; setLock(true);
      const s = S();
      const n = st.step;

      if (n === 0) {                                             // ① fork
        st.forked = true; mark('fork');
        const msg = {
          prefix: '⑂ fork wrote 0 rows — the branch exists only as a new key prefix',
          copy: '⑂ fork copied all 6 rows into a second store — cost scales with the data',
          tree: "⑂ fork wrote one new root pointer — every subtree below it is shared",
          ceiling: '⑂ fork wrote one catalog record: (child, parent, anchor=6) — no data moved',
        }[s.id];
        K.addLog(logBody, msg, s.id === 'copy' ? 'warn' : 'ok');
      }
      if (n === 1) {                                             // ② child writes c
        st.childRows = [{ prefix: 'B2·c=v7', copy: "c'=v7", tree: "c'", ceiling: 'c=v7' }[s.id]];
        mark('write');
        const msg = {
          prefix: '＋ child wrote c — the row landed inside the shared keyspace, beside the parent’s c',
          copy: '＋ child wrote c — into its own store; the two stores now diverge row by row',
          tree: '＋ child wrote c — path copy: a new leaf, a new inner node, a new root; the rest shared',
          ceiling: '＋ child wrote c at seq 7 — above its anchor, so it is the newest version of c the child can see',
        }[s.id];
        K.addLog(logBody, msg, 'ok');
      }
      if (n === 2) {                                             // ③ child reads b
        mark('read');
        const reads = {
          prefix: ['B2·b', 'b'], copy: ['b'], tree: ["root'", 'inner', 'leaf a,b'], ceiling: ['own components', 'parent ≤ 6'],
        }[s.id];
        for (let i = 0; i < reads.length; i++) {
          const y = 40 + i * 16;
          const t = K.el('text', { x: RIG.x + RIG.w - 4, y: RIG.y + 176 + (i % 2) * 13, 'text-anchor': 'end',
            'font-size': 8.5, fill: c[s.zone], 'font-family': MONO, opacity: 0 }, anim);
          t.textContent = `probe ${i + 1}: ${reads[i]}`;
          const p = { o: 0 };
          animate(p, { o: 0.95, duration: dur(260), delay: i * dur(300), ease: 'outQuad',
            onUpdate: () => t.setAttribute('opacity', p.o) });
          setTimeout(() => t.remove(), dur(2200)); void y;
        }
        await K.delay(dur(reads.length * 320));
        const msg = {
          prefix: `? read(b) took ${reads.length} scans — one per prefix on the fork path; depth d means d+1`,
          copy: '? read(b) took 1 lookup — the copy is a complete store, so a read consults one set of components',
          tree: '? read(b) walked the tree from the child’s root — shared nodes serve both branches',
          ceiling: '? read(b) missed the child’s components, then hit the parent capped at anchor 6',
        }[s.id];
        K.addLog(logBody, msg, 'ok');
      }
      if (n === 3) {                                             // ④ delete the branch
        mark('del');
        st.childRows = []; st.forked = false;
        const msg = {
          prefix: '🗑 delete = a range-delete sweep over B2·* — removing rows that interleave with live data',
          copy: '🗑 delete = drop the second store — nothing was shared, so nothing else is affected',
          tree: "🗑 delete = drop the child's root; unreferenced nodes are garbage-collected later",
          ceiling: '🗑 delete = reclaim the child’s component set and retire one catalog record — no rows deleted',
        }[s.id];
        K.addLog(logBody, msg, s.id === 'prefix' ? 'err' : 'ok');
      }

      st.step += 1;
      drawScene(); render();
      await K.delay(dur(420));
      st.busy = false; setLock(false);
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing && st.step < 4) {
        await step();
        await K.delay(dur(700));
      }
      st.playing = false; pp();
    }

    function setStrat(i) {
      st.strat = i; st.step = 0; st.childRows = []; st.forked = false;
      drawScene(); render();
      K.addLog(logBody, `⇄ now running: ${S().name} — same store, same four steps`, 'hl');
    }

    function reset() {
      const sp = st.speed;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 21;
      st = fresh(seed);
      st.speed = sp;
      build();
      K.addLog(logBody, `↺ reset — scoreboard cleared`, 'hl');
    }

    function pp() { root.querySelector('.t-play').disabled = st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-strat', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-step').onclick = step;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-strat').onchange = (e) => setStrat(parseInt(e.target.value, 10) || 0);
      root.querySelector('.t-seed').onchange = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value) || 1; };
    }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.SKVBranchOptions = { init };
})();
