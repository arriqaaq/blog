/**
 * SKV Fork Lifecycle (dst-kit) — what a fork actually copies, and where the child's answer comes
 * from as rows move underneath it.
 *
 * The question this exists to answer: a fork copies NOTHING — not the active memtable, not the
 * immutable ones, not a single SSTable, not even a hard link. The only durable artifact is one
 * catalog record holding {parent, parent_generation, fork_seq}. So how does the child read main's
 * pre-existing tables, and what happens when they flush out from under it?
 *
 * Verified against src/lsm.rs (fork_branch publishes one catalog version and touches the level
 * manifest read-only for a single scalar), src/branch_runtime.rs (a runtime and its first arena are
 * created lazily on the owner's first routed write), src/snapshot.rs (a SnapshotLayer holds an Arc to
 * the ancestor's LIVE runtime, and resolves levels_for(owner) against a manifest read fresh on every
 * get), src/levels/mod.rs (ensure_owner_levels creates the child's partition on its first flush; a
 * changeset whose table owner disagrees is a Corruption error) and src/compaction/compactor.rs
 * (retention anchors are derived from the catalog when the job is built).
 *
 * Step through it and watch the bottom row: the component that answers `get user:7` changes from
 * main's memtable, to main's L0 table, to the child's own memtable, while the value the child sees
 * stays the one that was current at its anchor. Flip to checkpoint mode to see the alternative that
 * does copy. Exposes window.SKVForkLifecycle.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-fork-lifecycle: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-fork-lifecycle: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 386;
  const MONO = "ui-monospace,'SF Mono',monospace";

  // fixed layout: every component keeps its place whether it holds anything or not
  const CAT = { x: 18, y: 54, w: 176, h: 116 };
  const PAR = { x: 210, y: 54, w: 272, h: 208 };
  const CHI = { x: 498, y: 54, w: 264, h: 208 };
  const inner = (p, dy, h) => ({ x: p.x + 10, y: p.y + dy, w: p.w - 20, h });
  const PMEM = inner(PAR, 30, 54), PL0 = inner(PAR, 92, 50), PL1 = inner(PAR, 148, 50);
  const CMEM = inner(CHI, 30, 54), CL0 = inner(CHI, 92, 50), CL1 = inner(CHI, 148, 50);
  const PROBE = { x: 18, y: 276, w: 744, h: 50 };

  // Main flushes BEFORE it writes again, so a reader arriving at step 7 is looking at exactly the
  // arrangement the static figures draw: the pre-fork rows on disk, main's post-fork rows live in
  // its memtable, and the child holding one flushed table plus one row still in memory.
  const STEPS = [
    'before the fork',
    'fork',
    'main flushes',
    'main writes above the anchor',
    'child writes a new key',
    'child flushes',
    'child overwrites user:7',
    'main compacts',
  ];

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    // One fixed trace, the same one every static figure in the post draws, so a reader stepping
    // this widget is watching the picture they already have rather than a second example.
    // Commit order: 9 · 14 · 22 | fork at 25 | main 26, 27 | child 28, 31 | reader's snapshot 34
    function fresh(seed) {
      const rng = K.rng(seed);
      const s = {
        old: 9,          // user:2, old enough to have reached L1 in sst-1
        cur: 14,         // user:7 as of the anchor — in main's memtable until it flushes
        other: 22,       // user:9 as of the anchor, flushed alongside it
        anchor: 25,      // ParentLink.fork_seq
        above: 26,       // main overwrites user:7 after the fork
        otherAbove: 27,  // main overwrites user:9 after the fork
        newkey: 28,      // the child's first write, to a key nobody else has
        child: 31,       // the child overwrites a key it inherited
        nb: 'user:9',
      };
      return { seed, rng, seq: s, step: 0, mode: 'fork', busy: false, playing: false, speed: 1 };
    }
    let st = fresh(5);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const S = () => st.seq;

    // ---- the model: derive the whole scene from (seed, step) ------------------------------
    // Nothing here mutates; Back is a recompute, never a reversed animation.
    function scene() {
      const q = S(), k = st.step;
      const forked = k >= 1;
      const checkpoint = st.mode === 'checkpoint' && forked;

      // main's memtable: the pre-fork rows until it flushes, then only what it writes afterwards
      const pmem = [];
      if (k <= 1) {
        pmem.push({ key: 'user:7', seq: q.cur });
        pmem.push({ key: q.nb, seq: q.other });
      } else if (k >= 3 && k < 7) {
        pmem.push({ key: 'user:7', seq: q.above, above: true });
        pmem.push({ key: q.nb, seq: q.otherAbove, above: true });
      }
      // checkpoint force-flushes main's memtable at capture time
      const pmemEmpty = checkpoint || pmem.length === 0;

      // main's levels
      const pl0 = [];
      const pl1 = [];
      pl0.push({ id: 'sst-3', rows: ['user:1@11'] });
      pl1.push({ id: 'sst-1', rows: ['user:2@' + q.old] });
      if (k >= 2) {
        pl0.push({ id: 'sst-7', rows: ['user:7@' + q.cur, q.nb + '@' + q.other], fresh: k === 2 });
      }
      let compacted = false;
      if (k >= 7) {
        compacted = true;
        pl0.length = 0;
        pl1.length = 0;
        pl1.push({
          id: 'sst-11',
          rows: ['user:7@' + q.above, 'user:7@' + q.cur + ' ⟵ pinned',
                 q.nb + '@' + q.otherAbove, q.nb + '@' + q.other + ' ⟵ pinned'],
          fresh: true,
        });
      }

      // the child: first a key nobody else has, then an overwrite of one it inherited
      const cmem = [];
      if (k === 4) cmem.push({ key: 'user:4', seq: q.newkey, own: true });
      if (k >= 6) cmem.push({ key: 'user:7', seq: q.child, own: true });
      const cl0 = [];
      if (k >= 5) cl0.push({ id: 'sst-9', rows: ['user:4@' + q.newkey], owner: 'child', fresh: k === 5 });

      // Two probes, because they answer two different questions. `user:7` is the key the child
      // eventually writes, so it shows shadowing. The neighbour key is one the child NEVER writes,
      // so it tracks the inherited read the whole way through and is the one that shows what
      // compaction's pin is protecting.
      const inherited = () => {
        if (checkpoint) return { where: 'the copy · its own files', seq: q.other, note: 'a second store, sharing nothing' };
        if (compacted) return { where: 'main · L1 sst-11', seq: q.other, note: `the rewrite kept @${q.other} because the anchor still needs it` };
        if (k >= 3) return { where: 'main · L0 sst-7', seq: q.other, note: `main's @${q.otherAbove} sits above the anchor, so it stays invisible` };
        if (k >= 2) return { where: 'main · L0 sst-7', seq: q.other, note: 'the row moved to disk, and the read followed it' };
        return { where: 'main · memtable', seq: q.other, note: 'read live through main, capped at the anchor' };
      };
      let own;
      if (!forked) {
        own = { where: 'main · memtable', seq: q.cur, note: 'no child yet' };
      } else if (cmem.some((r) => r.key === 'user:7')) {
        own = { where: 'child · memtable', seq: q.child, own: true, note: 'its own row shadows the one it inherited' };
      } else if (checkpoint) {
        own = { where: 'the copy · its own files', seq: q.cur, note: 'a second store, sharing nothing' };
      } else if (compacted) {
        own = { where: 'main · L1 sst-11', seq: q.cur, note: `@${q.cur} was superseded by @${q.above} and pinned anyway` };
      } else if (k >= 2) {
        own = { where: 'main · L0 sst-7', seq: q.cur, note: 'the row moved to disk; the answer did not change' };
      } else {
        own = { where: 'main · memtable', seq: q.cur, note: 'read live through the parent, capped at the anchor' };
      }

      const copied = checkpoint ? { tables: 2 + (k >= 2 ? 1 : 0), bytes: 'every table' } : { tables: 0, bytes: '0' };
      return { forked, checkpoint, pmem, pmemEmpty, pl0, pl1, cmem, cl0, cl1: [],
               answer: own, inherited: inherited(), copied, compacted };
    }

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      return `<div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-back">◀ Back</button>
          <button class="dstk-btn dstk-btn--purple t-next">Next ▶</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">on create</span>
          <select class="t-mode">
            <option value="fork" selected>fork · copy nothing</option>
            <option value="checkpoint">checkpoint · copy everything</option></select></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'What a fork copies, and where the answer comes from',
        sub: 'one catalog record · the child\'s row moves, its answer does not',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'copied', label: 'copied at create' }, { id: 'own', label: 'child owns' },
                { id: 'from', label: 'answer read from' }, { id: 'seen', label: 'child sees' }],
        cap: 'Step through and watch the bottom row only. The component that answers the child\'s read changes at almost '
           + 'every step — main\'s memtable, then main\'s new L0 table, then the child\'s own memtable — while the version '
           + 'the child sees stays the one that was current at its anchor. Then switch to checkpoint mode and compare what '
           + 'gets copied.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      draw(); bind(); render();
      K.addLog(logBody, '🌱 a fork writes one catalog record — press Next and watch what does not get copied', 'hl');
    }

    // ---- drawing helpers ------------------------------------------------------------------
    function panel(box, zone, title, sub) {
      K.el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 9, fill: 'none',
        stroke: c[zone], 'stroke-width': 1.4, opacity: 0.5 }, content);
      const t = K.el('text', { x: box.x + 12, y: box.y + 19, 'font-size': 11.5, 'font-weight': 700,
        fill: c[zone] }, content);
      t.textContent = title;
      if (sub) {
        const s = K.el('text', { x: box.x + box.w - 12, y: box.y + 19, 'text-anchor': 'end',
          'font-size': 9.5, fill: c.muted, 'font-family': MONO }, content);
        s.textContent = sub;
      }
    }
    function slot(box, label, empty) {
      K.el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 6, fill: 'none',
        stroke: 'currentColor', 'stroke-width': 1, opacity: empty ? 0.22 : 0.4,
        'stroke-dasharray': empty ? '4 3' : '' }, content);
      const t = K.el('text', { x: box.x + 7, y: box.y + 13, 'font-size': 9, fill: c.muted,
        'font-family': MONO }, content);
      t.textContent = label;
    }
    function chip(x, y, w, text, zone, opts) {
      const o = opts || {};
      const col = zone ? c[zone] : c.muted;
      K.el('rect', { x, y, width: w, height: 17, rx: 3,
        fill: o.hot ? K.grad(uid, zone || 'purple') : 'none',
        stroke: col, 'stroke-width': o.hot ? 1.5 : 1, opacity: o.dim ? 0.45 : 1,
        'stroke-dasharray': o.dash ? '3 2' : '' }, content);
      const t = K.el('text', { x: x + 5, y: y + 12.5, 'font-size': 8.5, fill: col,
        'font-family': MONO, opacity: o.dim ? 0.7 : 1 }, content);
      t.textContent = text;
      return x + w + 4;
    }
    function note(x, y, text, col) {
      const t = K.el('text', { x, y, 'font-size': 9, fill: col || c.muted }, content);
      t.textContent = text;
      return t;
    }

    // ---- the scene ------------------------------------------------------------------------
    function draw() {
      content.innerHTML = '';
      const sc = scene(), q = S();

      // step strip
      const head = K.el('text', { x: 18, y: 20, 'font-size': 10.5, fill: c.muted }, content);
      head.textContent = `step ${st.step + 1} of ${STEPS.length} — ${STEPS[st.step]}`;
      let sx = 18;
      STEPS.forEach((name, i) => {
        const on = i === st.step, past = i < st.step;
        const w = 90;
        K.el('rect', { x: sx, y: 28, width: w, height: 16, rx: 4,
          fill: on ? K.grad(uid, 'purple') : 'none', stroke: on ? c.purple : 'currentColor',
          'stroke-width': on ? 1.4 : 1, opacity: on ? 1 : past ? 0.4 : 0.18 }, content);
        const t = K.el('text', { x: sx + w / 2, y: 40, 'text-anchor': 'middle', 'font-size': 8,
          'font-weight': on ? 700 : 400, fill: on ? c.purple : c.muted, opacity: on ? 1 : past ? 0.9 : 0.5 }, content);
        t.textContent = name.length > 16 ? name.slice(0, 15) + '…' : name;
        sx += w + 3;
      });

      // ---- the catalog: the only thing a fork writes
      panel(CAT, 'purple', 'catalog', sc.forked ? '1 record' : 'empty');
      if (!sc.forked) {
        note(CAT.x + 12, CAT.y + 46, 'no child record yet');
      } else if (sc.checkpoint) {
        note(CAT.x + 12, CAT.y + 44, 'checkpoint writes no', c.red);
        note(CAT.x + 12, CAT.y + 57, 'catalog record — it is', c.red);
        note(CAT.x + 12, CAT.y + 70, 'a whole second store', c.red);
      } else {
        const rows = [['branch', 'child'], ['parent', 'main'], ['parent_gen', '1'], ['fork_seq', String(q.anchor)]];
        rows.forEach(([k2, v], i) => {
          const y = CAT.y + 32 + i * 19;
          const a = K.el('text', { x: CAT.x + 12, y: y + 12, 'font-size': 9, fill: c.muted,
            'font-family': MONO }, content);
          a.textContent = k2;
          const b = K.el('text', { x: CAT.x + CAT.w - 12, y: y + 12, 'text-anchor': 'end',
            'font-size': 9.5, 'font-weight': k2 === 'fork_seq' ? 700 : 400,
            fill: k2 === 'fork_seq' ? c.purple : 'currentColor', 'font-family': MONO }, content);
          b.textContent = v;
        });
      }
      note(CAT.x, CAT.y + CAT.h + 16, sc.checkpoint ? 'copied at create:' : 'written at fork:');
      const amt = K.el('text', { x: CAT.x, y: CAT.y + CAT.h + 32, 'font-size': 11.5,
        'font-weight': 700, fill: sc.checkpoint ? c.red : c.purple, 'font-family': MONO }, content);
      amt.textContent = sc.checkpoint ? `${sc.copied.tables} tables + flush` : '1 record · 0 rows';

      // ---- main
      panel(PAR, 'blue', 'main', 'owner');
      slot(PMEM, 'memtable', sc.pmemEmpty);
      if (sc.pmemEmpty) {
        note(PMEM.x + 8, PMEM.y + 34, sc.checkpoint ? 'force-flushed by the copy' : 'flushed and released', c.muted);
      } else {
        let x = PMEM.x + 7;
        sc.pmem.forEach((r) => {
          x = chip(x, PMEM.y + 22, 74, `${r.key}@${r.seq}`, r.above ? 'red' : 'blue',
            { hot: r.above && st.step === 3 });
        });
        if (sc.pmem.some((r) => r.above)) {
          note(PMEM.x + 7, PMEM.y + 50, `@${q.above} and @${q.otherAbove} are above the anchor`, c.red);
        }
      }
      slot(PL0, 'L0', sc.pl0.length === 0);
      let px = PL0.x + 7;
      sc.pl0.forEach((t) => {
        const w = 118;
        K.el('rect', { x: px, y: PL0.y + 20, width: w, height: 24, rx: 4,
          fill: t.fresh ? K.grad(uid, 'purple') : 'none', stroke: t.fresh ? c.purple : c.blue,
          'stroke-width': t.fresh ? 1.6 : 1 }, content);
        const a = K.el('text', { x: px + 6, y: PL0.y + 31, 'font-size': 8.5, 'font-weight': 700,
          fill: t.fresh ? c.purple : c.blue, 'font-family': MONO }, content);
        a.textContent = t.id;
        const b = K.el('text', { x: px + 6, y: PL0.y + 41, 'font-size': 7.5, fill: c.muted,
          'font-family': MONO }, content);
        b.textContent = t.rows.length + ' rows';
        px += w + 6;
      });
      if (!sc.pl0.length) note(PL0.x + 8, PL0.y + 32, 'merged away by compaction', c.muted);
      slot(PL1, 'L1', false);
      let px1 = PL1.x + 7;
      sc.pl1.forEach((t) => {
        const w = sc.compacted ? 232 : 118;
        K.el('rect', { x: px1, y: PL1.y + 20, width: w, height: 24, rx: 4,
          fill: t.fresh ? K.grad(uid, 'purple') : 'none', stroke: t.fresh ? c.purple : c.blue,
          'stroke-width': t.fresh ? 1.6 : 1 }, content);
        const a = K.el('text', { x: px1 + 6, y: PL1.y + 31, 'font-size': 8.5, 'font-weight': 700,
          fill: t.fresh ? c.purple : c.blue, 'font-family': MONO }, content);
        a.textContent = t.id;
        const b = K.el('text', { x: px1 + 6, y: PL1.y + 41, 'font-size': 7.5,
          fill: sc.compacted ? c.purple : c.muted, 'font-family': MONO }, content);
        b.textContent = sc.compacted ? `user:7@${q.cur} kept for the anchor` : t.rows.length + ' rows';
        px1 += w + 6;
      });

      // ---- the child
      panel(CHI, 'green', sc.checkpoint ? 'the copy' : 'child', sc.checkpoint ? 'second store' : 'owner');
      slot(CMEM, 'memtable', !sc.cmem.length);
      if (!sc.cmem.length) {
        note(CMEM.x + 8, CMEM.y + 34,
          st.step < 4 ? 'none — arrives on the first write' : 'flushed and released', c.muted);
      } else {
        let x = CMEM.x + 7;
        sc.cmem.forEach((r) => { x = chip(x, CMEM.y + 22, 74, `${r.key}@${r.seq}`, 'green', { hot: true }); });
        note(CMEM.x + 7, CMEM.y + 50, 'created lazily, empty — not a clone', c.green);
      }
      slot(CL0, 'L0', !sc.cl0.length);
      if (!sc.cl0.length) {
        note(CL0.x + 8, CL0.y + 32,
          sc.checkpoint ? '2 hard-linked tables' : 'no partition in levels_by_owner', sc.checkpoint ? c.red : c.muted);
      } else {
        sc.cl0.forEach((t) => {
          K.el('rect', { x: CL0.x + 7, y: CL0.y + 20, width: 150, height: 24, rx: 4,
            fill: t.fresh ? K.grad(uid, 'purple') : 'none', stroke: t.fresh ? c.purple : c.green,
            'stroke-width': t.fresh ? 1.6 : 1 }, content);
          const a = K.el('text', { x: CL0.x + 13, y: CL0.y + 31, 'font-size': 8.5, 'font-weight': 700,
            fill: t.fresh ? c.purple : c.green, 'font-family': MONO }, content);
          a.textContent = `${t.id} · owner=child`;
          const b = K.el('text', { x: CL0.x + 13, y: CL0.y + 41, 'font-size': 7.5, fill: c.muted,
            'font-family': MONO }, content);
          b.textContent = t.rows[0];
        });
      }
      slot(CL1, 'L1', true);
      note(CL1.x + 8, CL1.y + 32, 'empty', c.muted);

      // the read-through arrow: the child has no components of its own, so it reads main's
      if (sc.forked && !sc.checkpoint) {
        const y = CHI.y + 116;
        K.el('line', { x1: CHI.x - 4, y1: y, x2: PAR.x + PAR.w + 4, y2: y, stroke: c.green,
          'stroke-width': 1.6, 'marker-end': `url(#${uid}-arr-green)`, 'stroke-dasharray': '5 3' }, content);
        const t = K.el('text', { x: (CHI.x + PAR.x + PAR.w) / 2, y: y - 6, 'text-anchor': 'middle',
          'font-size': 8, fill: c.green, 'font-family': MONO }, content);
        t.textContent = `≤ ${q.anchor}`;
      }

      // ---- the read probe: the whole point
      const a = sc.answer;
      K.el('rect', { x: PROBE.x, y: PROBE.y, width: PROBE.w, height: PROBE.h, rx: 8,
        fill: K.grad(uid, a.own ? 'green' : 'blue'), stroke: a.own ? c.green : c.blue,
        'stroke-width': 1.5 }, content);
      const q1 = K.el('text', { x: PROBE.x + 14, y: PROBE.y + 20, 'font-size': 10,
        fill: c.muted, 'font-family': MONO }, content);
      q1.textContent = sc.forked ? 'get user:7  on the child' : 'get user:7  on main';
      const q2 = K.el('text', { x: PROBE.x + 14, y: PROBE.y + 38, 'font-size': 12,
        'font-weight': 700, fill: a.own ? c.green : c.blue, 'font-family': MONO }, content);
      q2.textContent = `answered by  ${a.where}   →   user:7@${a.seq}`;
      const q3 = K.el('text', { x: PROBE.x + PROBE.w - 14, y: PROBE.y + 32, 'text-anchor': 'end',
        'font-size': 9.5, fill: c.muted }, content);
      q3.textContent = a.note;

      // footer
      note(18, Hh - 22, sc.checkpoint
        ? 'A checkpoint force-flushes the memtables and hard-links every SSTable, so the two stores share nothing from that moment on.'
        : 'A fork copies no row, no table and no link. The child holds a parent pointer and a number; everything else is resolved at read time.');
      note(18, Hh - 8, sc.checkpoint
        ? 'Its reads never touch main again — which is also why there is no diff and no merge back.'
        : 'Each read re-resolves the parent\'s live memtables and its live per-owner level set, then filters by sequence. Rows move; the answer does not.');
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      const sc = scene();
      stat('copied', sc.checkpoint ? `${sc.copied.tables} tables` : '0 rows');
      const own = [];
      if (sc.cmem.length) own.push('memtable');
      if (sc.cl0.length) own.push('1 table');
      stat('own', sc.forked ? (own.length ? own.join(' + ') : 'nothing') : '—');
      stat('from', sc.answer.where.replace(' · ', ' '));
      stat('seen', 'user:7@' + sc.answer.seq);
      root.querySelector('.t-back').disabled = st.step === 0;
      root.querySelector('.t-next').disabled = st.step >= STEPS.length - 1;
    }

    const LOG = [
      () => '↩ back to main on its own, before any fork',
      (q) => `🌿 fork at ${q.anchor}: ONE catalog record written — {parent: main, fork_seq: ${q.anchor}}. `
        + `No memtable, no level set, no table, no hard link. The child reads entirely through main`,
      (q) => `⇥ main flushes: user:7@${q.cur} and ${q.nb}@${q.other} move out of memory into sst-7. The child's `
        + `read follows them, because the ancestor layer resolves main's live level set on every read`,
      (q) => `✍ main commits user:7@${q.above} and ${q.nb}@${q.otherAbove}, both above the anchor. Both rows sit in `
        + `the very memtable the child reads through, and the cap at ${q.anchor} is all that hides them`,
      (q) => `✍ the child's first write creates its runtime — a fresh empty memtable, not a copy. user:4@${q.newkey} `
        + `is a key main has never held`,
      () => `⇥ the child flushes to sst-9, stamped owner=child, and levels_by_owner gets a child partition. `
        + `A changeset whose table owner disagrees is refused as Corruption`,
      (q) => `✍ now the child overwrites a key it inherited: user:7@${q.child}. It outranks main's user:7@${q.cur} `
        + `because ${q.child} > ${q.cur} under the one global counter, with no override map anywhere`,
      (q) => `✂ main compacts. user:7@${q.cur} is superseded by @${q.above} and would normally be dropped — the `
        + `anchor at ${q.anchor} pins it, so the child's answer survives in a brand new file`,
    ];

    async function go(dir) {
      if (st.busy) return;
      const next = st.step + dir;
      if (next < 0 || next >= STEPS.length) return;
      st.busy = true; setLock(true);
      st.step = next;
      draw(); render();
      const f = LOG[st.step];
      K.addLog(logBody, f(S()), st.step === 1 || st.step === 6 ? 'ok' : st.step === 3 ? 'warn' : 'hl');
      await K.delay(dur(300));
      st.busy = false; setLock(false);
    }

    function setMode(m) {
      st.mode = m;
      draw(); render();
      K.addLog(logBody, m === 'checkpoint'
        ? '📋 checkpoint mode: the memtables are force-flushed and every SSTable is hard-linked, so the copy shares nothing from here on'
        : '🌿 fork mode: one catalog record, nothing copied', m === 'checkpoint' ? 'warn' : 'ok');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        if (st.step >= STEPS.length - 1) {
          await K.delay(dur(900));
          if (!st.playing) break;
          st.step = 0; draw(); render();
          await K.delay(dur(500));
          continue;
        }
        await go(1);
        if (!st.playing) break;
        await K.delay(dur(900));
      }
    }
    function pause() { st.playing = false; pp(); }

    function reset() {
      const sp = st.speed, m = st.mode, playing = st.playing;
      st = fresh(5);
      st.speed = sp; st.mode = m; st.playing = playing;
      root.querySelector('.t-mode').value = m;
      pp(); setLock(false); draw(); render();
      K.addLog(logBody, '↺ back to before the fork', 'hl');
    }

    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-next', '.t-back', '.t-mode', '.t-reset'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
      if (!b) { root.querySelector('.t-back').disabled = st.step === 0;
                root.querySelector('.t-next').disabled = st.step >= STEPS.length - 1; }
    }
    function bind() {
      root.querySelector('.t-next').onclick = () => go(1);
      root.querySelector('.t-back').onclick = () => go(-1);
      root.querySelector('.t-mode').onchange = (e) => setMode(e.target.value);
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value) || 1; };
    }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.SKVForkLifecycle = { init };
})();
