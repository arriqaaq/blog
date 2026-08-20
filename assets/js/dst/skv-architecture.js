/**
 * SKV Architecture (dst-kit) — every named component laid out once, with one operation
 * stepped across it at a time.
 *
 * The layout never moves: the global sequence rail (one counter, one WAL, one commit pipeline for
 * the whole store), the catalog (the durable authority for branch records, parent links and
 * anchors), the parent's component set and the child's own component set (memtable + level sets,
 * allocated on first write), the layer stack a read walks (child layer, then parent layer capped at
 * the anchor), and the retention pin compaction consults.
 *
 * Pick an operation and step it. Only the components that operation touches are lit, the movement
 * between them is drawn, and the log says what each stage did:
 *   • fork  — FENCE → DRAIN → RESOLVE → PUBLISH   (one catalog version; no data component moves)
 *   • write — ADMIT → SEQ → MEMTABLE              (the child's own components; sequence from the rail)
 *   • read  — OWN → PARENT ≤cap → ANSWER          (the cap narrows down the chain)
 *   • merge — DIFF → CLASSIFY → COMMIT → EDGE     (data first, edge second)
 *
 * Stage state is recomputed from the seed for any stage index, so Back is exact rather than a
 * reversed animation. Exposes window.SKVArchitecture.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-architecture: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-architecture: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 392;
  const MONO = "ui-monospace,'SF Mono',monospace";

  // ---- fixed layout: every component has one place, whether it is lit or not ---------------
  const STRIP = { x: 20, y: 8, w: 740, h: 22 };
  const RAIL = { x: 20, y: 42, w: 740, h: 44 };
  const CAT = { x: 20, y: 102, w: 214, h: 94 };
  const PIN = { x: 20, y: 206, w: 214, h: 42 };
  const PAR = { x: 248, y: 102, w: 222, h: 146 };
  const CHI = { x: 534, y: 102, w: 226, h: 146 };
  const PMEM = { x: PAR.x + 10, y: 126, w: PAR.w - 20, h: 38 };
  const PLEV = { x: PAR.x + 10, y: 168, w: PAR.w - 20, h: 70 };
  const CMEM = { x: CHI.x + 10, y: 126, w: CHI.w - 20, h: 38 };
  const CLEV = { x: CHI.x + 10, y: 168, w: CHI.w - 20, h: 70 };
  const L1B = { x: 20, y: 272, w: 490, h: 32 };
  const L2B = { x: 20, y: 310, w: 490, h: 32 };
  const ANS = { x: 526, y: 272, w: 234, h: 70 };

  const BOX = { rail: RAIL, catalog: CAT, pin: PIN, pmem: PMEM, plev: PLEV,
    cmem: CMEM, clev: CLEV, layer1: L1B, layer2: L2B, answer: ANS };
  const ZONE = { rail: 'purple', catalog: 'purple', pin: 'amber', pmem: 'blue', plev: 'blue',
    cmem: 'green', clev: 'green', layer1: 'green', layer2: 'blue', answer: 'purple' };

  // Movement is drawn along fixed routes, so the same flow always looks the same.
  const EDGE = {
    'rail-cat': { x1: CAT.x + CAT.w / 2, y1: RAIL.y + RAIL.h, x2: CAT.x + CAT.w / 2, y2: CAT.y - 2, zone: 'purple' },
    'cat-pin': { x1: CAT.x + 46, y1: CAT.y + CAT.h, x2: CAT.x + 46, y2: PIN.y - 2, zone: 'amber' },
    'rail-cmem': { x1: CHI.x + CHI.w / 2, y1: RAIL.y + RAIL.h, x2: CHI.x + CHI.w / 2, y2: CHI.y - 2, zone: 'green' },
    'rail-pmem': { x1: PAR.x + PAR.w / 2, y1: RAIL.y + RAIL.h, x2: PAR.x + PAR.w / 2, y2: PAR.y - 2, zone: 'blue' },
    'chi-par': { x1: CHI.x - 4, y1: PMEM.y + 20, x2: PAR.x + PAR.w + 4, y2: PMEM.y + 20, zone: 'green' },
    'chi-cat': { x1: CHI.x - 4, y1: PLEV.y + 46, x2: CAT.x + CAT.w + 4, y2: CAT.y + 62, zone: 'purple' },
    'chi-l1': { x1: CHI.x + 30, y1: CHI.y + CHI.h, x2: L1B.x + L1B.w - 40, y2: L1B.y - 2, zone: 'green' },
    'par-l2': { x1: PAR.x + 30, y1: PAR.y + PAR.h, x2: L2B.x + L2B.w - 130, y2: L2B.y - 2, zone: 'blue' },
    'l1-ans': { x1: L1B.x + L1B.w + 3, y1: L1B.y + L1B.h / 2, x2: ANS.x - 3, y2: ANS.y + 26, zone: 'green' },
    'l2-ans': { x1: L2B.x + L2B.w + 3, y1: L2B.y + L2B.h / 2, x2: ANS.x - 3, y2: ANS.y + 44, zone: 'blue' },
  };

  const OPS = {
    fork: { label: 'fork', names: ['FENCE', 'DRAIN', 'RESOLVE', 'PUBLISH'] },
    write: { label: 'write', names: ['ADMIT', 'SEQ', 'MEMTABLE'] },
    read: { label: 'read', names: ['OWN', 'PARENT ≤cap', 'ANSWER'] },
    merge: { label: 'merge', names: ['DIFF', 'CLASSIFY', 'COMMIT', 'EDGE'] },
  };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    // ---- deterministic scene ------------------------------------------------------------
    // The seed varies the parent's head at the fork, how many commits are still in flight when
    // the fence goes up, which inherited key the child overwrites, and which one it reads. It
    // varies nothing about the order of the stages.
    function fresh(seed) {
      const rng = K.rng(seed);
      const h0 = 11 + Math.floor(rng() * 6);
      const inflight = 1 + Math.floor(rng() * 3);
      const pool = ['a', 'b', 'c', 'd'];
      const wi = Math.floor(rng() * pool.length);
      const ri = (wi + 1 + Math.floor(rng() * (pool.length - 1))) % pool.length;
      return { seed, rng, op: 'fork', i: 0, busy: false, playing: false, speed: 1,
               base: { h0, inflight, wk: pool[wi], rk: pool[ri] } };
    }
    let st = fresh(11);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    // ---- the store, and one operation across it -----------------------------------------
    // Every stage is a full description of the scene at that point, folded from the seed, so
    // stepping backwards is a recompute rather than a reversed animation.
    function keySeq(b) {
      const h = b.h0;
      return { a: h - 9, b: h - 7, c: h - 5, d: h - 3, e: h - 1 };
    }

    function stagesFor(op) {
      const b = st.base, h = b.h0, ks = keySeq(b);
      const P = () => ({
        mem: [['e', ks.e]],
        l0: [['d', ks.d]],
        l1: [['a', ks.a], ['b', ks.b], ['c', ks.c]],
      });
      const wk = b.wk, rk = b.rk, wSeq = h + 1, mSeq = h + 2, tSeq = h + 3;
      const out = [];

      if (op === 'fork') {
        out.push({ name: 'FENCE', lit: ['rail'], edges: [], seq: h - b.inflight, inflight: b.inflight,
          parent: P(), child: null, anchor: null, pin: [], meta: 0, marker: null,
          note: 'the fence stops write admission for the whole store, not only for the parent',
          log: { msg: `⑂ FENCE — write admission stopped store-wide under the branch-op mutex. `
            + `${b.inflight} commit(s) are still in flight, so the visible head is approximate here`, cls: 'warn' } });
        out.push({ name: 'DRAIN', lit: ['rail'], edges: [], seq: h, inflight: 0,
          parent: P(), child: null, anchor: null, pin: [], meta: 0, marker: null,
          note: 'the pipeline reports drained, so the visible head is exactly one number',
          log: { msg: `⑂ DRAIN — the in-flight commits landed and the pipeline reports drained; visible head is ${h}. `
            + `Missing the drain deadline returns ForkFenceTimeout, which is retryable`, cls: 'ok' } });
        out.push({ name: 'RESOLVE', lit: ['rail', 'catalog', 'pin'], edges: [{ k: 'rail-cat', t: `fork seq ${h}` }],
          seq: h, inflight: 0, parent: P(), child: null, anchor: null, pin: [], meta: 0, marker: { seq: h, t: 'fork seq' },
          note: 'the catalog is read here: depth budget, then whether the parent can still answer at this sequence',
          log: { msg: `⑂ RESOLVE — ForkPoint::Head resolves to ${h}. The chain is checked against MAX_VIEW_DEPTH, `
            + `and view_is_complete_at(cap, retained_floor) decides whether the parent can still answer there`, cls: 'ok' } });
        out.push({ name: 'PUBLISH', lit: ['catalog', 'pin'], edges: [{ k: 'cat-pin', t: `anchor ${h}` }],
          seq: h, inflight: 0, parent: P(), child: { mem: [], l0: [], l1: [] }, anchor: h, pin: [h], meta: 96,
          marker: { seq: h, t: `anchor ${h}` },
          note: 'no data component was touched; the child\'s memtable and level set arrive on its first write',
          log: { msg: `⑂ PUBLISH — one catalog version names the child, its parent link and anchor ${h}. `
            + `That publish is the commit point, and the anchor is now a pin compaction has to read`, cls: 'ok' } });
      }

      if (op === 'write') {
        const p = P();
        out.push({ name: 'ADMIT', lit: ['rail'], edges: [], seq: h, inflight: 0,
          parent: p, child: { mem: [], l0: [], l1: [] }, anchor: h, pin: [h], meta: 0,
          marker: { seq: h, t: `anchor ${h}` },
          note: 'the batch carries one owner; a memtable accepts batches from that owner only',
          log: { msg: '＋ ADMIT — the batch carries one BatchOwner (branch id, generation). A memtable is '
            + 'branch-pure, so it rejects a batch belonging to anyone else', cls: 'ok' } });
        out.push({ name: 'SEQ', lit: ['rail'], edges: [{ k: 'rail-cmem', t: `seq ${wSeq}` }], seq: wSeq, inflight: 0,
          parent: p, child: { mem: [], l0: [], l1: [] }, anchor: h, pin: [h], meta: 0,
          marker: { seq: h, t: `anchor ${h}` },
          note: 'the number comes from the store\'s one counter, which every branch draws from',
          log: { msg: `＋ SEQ — the commit drew ${wSeq} from the store's single counter. The child has no counter `
            + 'of its own, and no per-branch head', cls: 'ok' } });
        out.push({ name: 'MEMTABLE', lit: ['cmem'], edges: [], seq: wSeq, inflight: 0,
          parent: p, child: { mem: [[wk, wSeq]], l0: [], l1: [] }, anchor: h, pin: [h], meta: 0,
          marker: { seq: h, t: `anchor ${h}` },
          note: 'no parent component changed; the row sits in the child\'s own memtable',
          log: { msg: `＋ MEMTABLE — ${wk} · s${wSeq} landed in the child's own memtable. The parent still holds `
            + `${wk} · s${ks[wk]}; the higher sequence is what a read on the child reaches first`, cls: 'ok' } });
      }

      if (op === 'read') {
        const p = P(), ch = { mem: [[wk, wSeq]], l0: [], l1: [] };
        const snap = wSeq;
        out.push({ name: 'OWN', lit: ['cmem', 'clev', 'layer1'], edges: [{ k: 'chi-l1', t: `cap ${snap}` }],
          seq: snap, inflight: 0, parent: p, child: ch, anchor: h, pin: [h], meta: 0,
          marker: { seq: h, t: `anchor ${h}` }, caps: { own: snap, parent: null }, answer: null,
          note: `layer 1 holds only what the child wrote — ${wk} · s${wSeq}. The read is for ${rk}`,
          log: { msg: `? OWN — layer 1 is the child's own components at cap ${snap}: active memtable, immutable `
            + `memtables newest-first, then L0 and the levels below. ${rk} is not there`, cls: 'ok' } });
        out.push({ name: 'PARENT ≤cap', lit: ['pmem', 'plev', 'layer2'], edges: [{ k: 'par-l2', t: `cap ${h}` }],
          seq: snap, inflight: 0, parent: p, child: ch, anchor: h, pin: [h], meta: 0,
          marker: { seq: h, t: `anchor ${h}` }, caps: { own: snap, parent: h }, answer: null,
          note: 'the cap narrows nearest-first down the chain, and never widens again',
          log: { msg: `? PARENT ≤cap — layer 2 is the parent at cap min(${snap}, anchor ${h}) = ${h}. Each of the `
            + 'layer\'s iterators is capped before the merge rather than after it', cls: 'ok' } });
        out.push({ name: 'ANSWER', lit: ['answer'], edges: [{ k: 'l2-ans', t: '' }], seq: snap, inflight: 0,
          parent: p, child: ch, anchor: h, pin: [h], meta: 0, marker: { seq: h, t: `anchor ${h}` },
          caps: { own: snap, parent: h }, answer: `${rk} · s${ks[rk]}`,
          note: `a tombstone in layer 1 would have answered "absent" instead of letting layer 2 reply`,
          log: { msg: `? ANSWER — ${rk} · s${ks[rk]}, from the parent layer. The first visible version wins and `
            + 'the walk stops', cls: 'ok' } });
      }

      if (op === 'merge') {
        const ch = { mem: [[wk, wSeq], ['f', mSeq]], l0: [], l1: [] };
        const merged = P();
        merged.mem = merged.mem.concat([[wk, tSeq], ['f', tSeq]]);
        out.push({ name: 'DIFF', lit: ['cmem', 'clev'], edges: [], seq: mSeq, inflight: 0,
          parent: P(), child: ch, anchor: h, pin: [h], meta: 0, marker: { seq: h, t: `base ${h}` },
          note: 'the branch\'s own component set holds only rows it wrote, so this scan is diff-sized',
          log: { msg: `⇉ DIFF — read through the branch's own components with no ancestor layers, then filtered `
            + `seq > ${h}: 2 entries (${wk} · s${wSeq}, f · s${mSeq}). Tombstones would be included too`, cls: 'ok' } });
        out.push({ name: 'CLASSIFY', lit: ['cmem', 'clev', 'pmem', 'plev', 'layer2'],
          edges: [{ k: 'chi-par', t: 'three-way' }], seq: mSeq, inflight: 0,
          parent: P(), child: ch, anchor: h, pin: [h], meta: 0, marker: { seq: h, t: `base ${h}` },
          caps: { own: mSeq, parent: h },
          note: 'absence is treated as an ordinary value, so delete-vs-delete and delete-vs-modify need no special case',
          log: { msg: `⇉ CLASSIFY — three values per key: the base (the source snapshot at source_through ${h}), `
            + `the source now, and the target now. ${wk} is a modify, f is an add; the target has not touched `
            + 'either since the base', cls: 'ok' } });
        out.push({ name: 'COMMIT', lit: ['rail', 'pmem'], edges: [{ k: 'rail-pmem', t: `seq ${tSeq}` }],
          seq: tSeq, inflight: 0, parent: merged, child: ch, anchor: h, pin: [h], meta: 0,
          marker: { seq: h, t: `base ${h}` },
          note: 'merges use the ordinary commit path, so they get conflict detection, the WAL and sequences from it',
          log: { msg: `⇉ COMMIT — 2 rows applied into the target at ${tSeq} through the ordinary commit path. `
            + 'MergeOutcome::chunks is 1 for this data, so it landed in one transaction', cls: 'ok' } });
        out.push({ name: 'EDGE', lit: ['catalog', 'pin'], edges: [{ k: 'chi-cat', t: 'edge' }, { k: 'cat-pin', t: '+2' }],
          seq: tSeq, inflight: 0, parent: merged, child: ch, anchor: h, pin: [tSeq, mSeq, h], meta: 64,
          marker: { seq: h, t: `base ${h}` },
          note: 'data commits first and the edge second: a crash in between re-offers what was already applied',
          log: { msg: `⇉ EDGE — the merge edge is published after the data: source_through ${mSeq}, target_at ${tSeq}, `
            + `fork_at ${h}. Both of the edge's sequences become retention anchors as soon as it lands`, cls: 'ok' } });
      }

      // fold the cumulative counters so a stage index is enough to render the whole scene
      const touched = new Set();
      let meta = 0;
      for (const s of out) {
        s.lit.forEach((x) => touched.add(x));
        meta += s.meta || 0;
        s.touchedCum = touched.size;
        s.metaCum = meta;
      }
      return out;
    }

    const stages = () => stagesFor(st.op);
    const cur = () => stages()[st.i];

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      const opts = Object.keys(OPS).map((k) =>
        `<option value="${k}"${k === st.op ? ' selected' : ''}>${OPS[k].label}</option>`).join('');
      const sp = [0.5, 1, 2].map((v) =>
        `<option value="${v}"${v === st.speed ? ' selected' : ''}>${v}×</option>`).join('');
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">operation</span>
          <select class="t-op" style="width:auto">${opts}</select></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-back">◀ Back</button>
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--purple t-next">Next ▶</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}" min="1" max="999" style="width:4.2rem"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed">${sp}</select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'The components an operation touches', sub: 'one fixed layout · fork, write, read, merge stepped across it',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'seq', label: 'global seq' }, { id: 'anchor', label: "child's anchor" },
                { id: 'touched', label: 'components touched' }, { id: 'meta', label: 'metadata bytes' }],
        cap: 'The layout is the same for every operation, so what changes between them is which components light up. '
           + 'Fork writes one catalog record and moves no data. Write touches the child\'s own components and takes its '
           + 'sequence from the shared rail. Read walks two layers, the second one capped at the anchor. Merge commits '
           + 'data before it publishes the edge. Byte figures are illustrative record sizes, not measurements.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 step the four fork stages, then switch operation and step again', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function chip(g, x, y, w, h, zone, label, o) {
      const opt = o || {};
      const grp = K.el('g', { opacity: opt.dim ? 0.45 : 1 }, g);
      K.el('rect', { x, y, width: w, height: h, rx: 3, fill: opt.hollow ? 'none' : K.grad(uid, zone),
        stroke: c[zone], 'stroke-width': 1.1, 'stroke-dasharray': opt.dash ? '3 2' : 'none' }, grp);
      const t = K.el('text', { x: x + w / 2, y: y + h / 2 + 3.2, 'text-anchor': 'middle', 'font-size': 8,
        'font-weight': 600, fill: c[zone], 'font-family': MONO }, grp);
      t.textContent = label;
      return grp;
    }

    function panel(box, zone, lit, title, sub) {
      const g = K.el('g', {}, content);
      const r = K.el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 8,
        fill: lit ? K.grad(uid, zone) : 'none', stroke: lit ? c[zone] : c.separator,
        'stroke-width': lit ? 1.8 : 1 }, g);
      if (lit) r.setAttribute('filter', K.glow(uid));
      if (title) {
        const t = K.el('text', { x: box.x + 10, y: box.y + 15, 'font-size': 9.5, 'font-weight': 700,
          fill: lit ? c[zone] : c.muted, 'font-family': MONO }, g);
        t.textContent = title;
      }
      if (sub) {
        const t = K.el('text', { x: box.x + box.w - 10, y: box.y + 15, 'text-anchor': 'end',
          'font-size': 8.5, fill: lit ? c[zone] : c.muted, 'font-family': MONO, opacity: 0.9 }, g);
        t.textContent = sub;
      }
      return g;
    }

    function drawStrip(sts, i) {
      const n = sts.length, gap = 8;
      const w = (STRIP.w - gap * (n - 1)) / n;
      sts.forEach((s, k) => {
        const x = STRIP.x + k * (w + gap);
        const isCur = k === i, past = k < i;
        const zone = isCur ? 'purple' : 'green';
        const r = K.el('rect', { x, y: STRIP.y, width: w, height: STRIP.h, rx: 5,
          fill: isCur ? K.grad(uid, 'purple') : (past ? K.grad(uid, 'green') : 'none'),
          stroke: isCur ? c.purple : (past ? c.green : c.separator),
          'stroke-width': isCur ? 1.8 : 1.1 }, content);
        if (isCur) r.setAttribute('filter', K.glow(uid));
        const t = K.el('text', { x: x + w / 2, y: STRIP.y + 15, 'text-anchor': 'middle', 'font-size': 9.5,
          'font-weight': isCur ? 700 : 600, fill: isCur ? c.purple : (past ? c[zone] : c.muted),
          'font-family': MONO }, content);
        t.textContent = `${k + 1}. ${s.name}`;
      });
    }

    function drawRail(s) {
      const lit = s.lit.includes('rail');
      panel(RAIL, ZONE.rail, lit, 'global sequence rail',
        'one counter, shared by the whole store');
      // a window of sequences around the head
      const lo = Math.max(0, s.seq - 9), hi = s.seq + 4;
      const X = (q) => RAIL.x + 14 + ((q - lo) / (hi - lo)) * (RAIL.w - 28);
      for (let q = lo; q <= hi; q++) {
        const x = X(q);
        K.el('line', { x1: x, y1: RAIL.y + 22, x2: x, y2: RAIL.y + 30, stroke: lit ? c.purple : c.muted,
          'stroke-width': 0.9, opacity: lit ? 0.55 : 0.3 }, content);
        if (q % 2 === 0 && q !== s.seq) {
          const t = K.el('text', { x, y: RAIL.y + 40, 'text-anchor': 'middle', 'font-size': 8,
            fill: lit ? c.purple : c.muted, opacity: lit ? 0.9 : 0.5, 'font-family': MONO }, content);
          t.textContent = q;
        }
      }
      // the head
      const hx = X(s.seq);
      K.el('line', { x1: hx, y1: RAIL.y + 18, x2: hx, y2: RAIL.y + 34, stroke: c.text, 'stroke-width': 2.2 }, content);
      const ht = K.el('text', { x: hx, y: RAIL.y + 40, 'text-anchor': 'middle', 'font-size': 8.5,
        'font-weight': 700, fill: c.text, 'font-family': MONO }, content);
      ht.textContent = `head ${s.seq}`;
      // the resolved fork sequence / anchor, once there is one
      if (s.marker) {
        const mx = X(s.marker.seq);
        K.el('line', { x1: mx, y1: RAIL.y + 16, x2: mx, y2: RAIL.y + 36, stroke: c.amber,
          'stroke-width': 2, 'stroke-dasharray': '4 3' }, content);
        const t = K.el('text', { x: mx, y: RAIL.y + 56, 'text-anchor': 'middle', 'font-size': 8.5,
          fill: c.amber, 'font-family': MONO }, content);
        t.textContent = s.marker.t;
      }
      // commits still in flight while the fence is up
      if (s.inflight) {
        for (let j = 0; j < s.inflight; j++) {
          const x = X(s.seq + 1 + j);
          K.el('circle', { cx: x, cy: RAIL.y + 26, r: 4, fill: 'none', stroke: c.red,
            'stroke-width': 1.4, 'stroke-dasharray': '2 2' }, content);
        }
        const t = K.el('text', { x: RAIL.x + RAIL.w - 8, y: RAIL.y + 56, 'text-anchor': 'end',
          'font-size': 8.5, fill: c.red, 'font-family': MONO }, content);
        t.textContent = `${s.inflight} commit(s) in flight — the head is not exact yet`;
      }
    }

    function drawCatalog(s) {
      const lit = s.lit.includes('catalog');
      panel(CAT, ZONE.catalog, lit, 'catalog', 'durable authority');
      const rows = [['branch main', 'root · no parent']];
      if (s.anchor != null) rows.push(['branch child', `parent=main · anchor ${s.anchor}`]);
      else rows.push(['branch child', 'not published yet']);
      if (s.pin.length > 1) rows.push(['merge edge', `source_through ${s.pin[1]} · target_at ${s.pin[0]}`]);
      rows.forEach(([k, v], i) => {
        const y = CAT.y + 28 + i * 21;
        const dim = k === 'branch child' && s.anchor == null;
        const t = K.el('text', { x: CAT.x + 10, y, 'font-size': 8.5, 'font-weight': 700,
          fill: lit ? c.purple : c.text, opacity: dim ? 0.45 : 0.95, 'font-family': MONO }, content);
        t.textContent = k;
        const t2 = K.el('text', { x: CAT.x + 10, y: y + 10, 'font-size': 8, fill: c.muted,
          opacity: dim ? 0.45 : 0.95, 'font-family': MONO }, content);
        t2.textContent = v;
      });
    }

    function drawPin(s) {
      const lit = s.lit.includes('pin');
      panel(PIN, ZONE.pin, lit, 'retention pin', 'read by compaction');
      if (!s.pin.length) {
        const t = K.el('text', { x: PIN.x + 10, y: PIN.y + 32, 'font-size': 8.5, fill: c.muted }, content);
        t.textContent = 'no anchors — compaction applies its ordinary rules';
        return;
      }
      let x = PIN.x + 10;
      for (const a of s.pin) { chip(content, x, PIN.y + 21, 40, 15, 'amber', 's' + a); x += 44; }
      const t = K.el('text', { x, y: PIN.y + 32, 'font-size': 8, fill: c.muted }, content);
      t.textContent = s.pin.length === 1 ? 'one anchor' : `${s.pin.length} anchors`;
    }

    function drawSet(outer, memBox, levBox, zone, s, which, title) {
      const set = which === 'parent' ? s.parent : s.child;
      const memLit = s.lit.includes(which === 'parent' ? 'pmem' : 'cmem');
      const levLit = s.lit.includes(which === 'parent' ? 'plev' : 'clev');
      panel(outer, zone, memLit || levLit, title, which === 'parent' ? 'owner: main' : 'owner: child');
      if (!set) {
        const t = K.el('text', { x: outer.x + outer.w / 2, y: outer.y + 80, 'text-anchor': 'middle',
          'font-size': 9, fill: c.muted }, content);
        t.textContent = 'no component set yet — the fork has not published';
        return;
      }
      // memtable
      const mg = K.el('g', { opacity: memLit ? 1 : 0.62 }, content);
      K.el('rect', { x: memBox.x, y: memBox.y, width: memBox.w, height: memBox.h, rx: 5, fill: 'none',
        stroke: memLit ? c[zone] : c.separator, 'stroke-width': memLit ? 1.5 : 1 }, mg);
      const ml = K.el('text', { x: memBox.x + 8, y: memBox.y + 12, 'font-size': 8,
        fill: memLit ? c[zone] : c.muted, 'font-family': MONO }, mg);
      ml.textContent = 'memtable';
      if (!set.mem.length) {
        const t = K.el('text', { x: memBox.x + 62, y: memBox.y + 30, 'font-size': 8, fill: c.muted }, mg);
        t.textContent = 'empty — arrives on the first write';
      }
      set.mem.slice(-4).forEach(([k, q], i) => chip(mg, memBox.x + 8 + i * 50, memBox.y + 17, 46, 17, zone, `${k}·s${q}`));
      // level sets
      const lg = K.el('g', { opacity: levLit ? 1 : 0.62 }, content);
      K.el('rect', { x: levBox.x, y: levBox.y, width: levBox.w, height: levBox.h, rx: 5, fill: 'none',
        stroke: levLit ? c[zone] : c.separator, 'stroke-width': levLit ? 1.5 : 1 }, lg);
      const ll = K.el('text', { x: levBox.x + 8, y: levBox.y + 12, 'font-size': 8,
        fill: levLit ? c[zone] : c.muted, 'font-family': MONO }, lg);
      ll.textContent = 'level sets · one partition per owner';
      [['L0', set.l0], ['L1', set.l1]].forEach(([name, rows], r) => {
        const y = levBox.y + 18 + r * 24;
        const t = K.el('text', { x: levBox.x + 8, y: y + 12, 'font-size': 8, fill: c.muted, 'font-family': MONO }, lg);
        t.textContent = name;
        if (!rows.length) {
          const e = K.el('text', { x: levBox.x + 28, y: y + 12, 'font-size': 8, fill: c.muted, opacity: 0.7 }, lg);
          e.textContent = '—';
        }
        rows.slice(0, 3).forEach(([k, q], i) => chip(lg, levBox.x + 28 + i * 50, y, 46, 17, zone, `${k}·s${q}`));
      });
    }

    function drawReadStack(s) {
      const l1 = s.lit.includes('layer1'), l2 = s.lit.includes('layer2');
      const hd = K.el('text', { x: 20, y: 264, 'font-size': 9.5, 'font-weight': 700, fill: c.text }, content);
      hd.textContent = 'read stack — layers walked nearest-first, each seeking at its own cap';
      const caps = s.caps || {};
      panel(L1B, ZONE.layer1, l1, '', '');
      const t1 = K.el('text', { x: L1B.x + 12, y: L1B.y + 21, 'font-size': 9,
        fill: l1 ? c.green : c.muted, 'font-family': MONO }, content);
      t1.textContent = 'layer 1 · child · memtable → immutable → L0 → L1'
        + (caps.own != null ? `   cap = snapshot seq ${caps.own}` : '');
      panel(L2B, ZONE.layer2, l2, '', '');
      const t2 = K.el('text', { x: L2B.x + 12, y: L2B.y + 21, 'font-size': 9,
        fill: l2 ? c.blue : c.muted, 'font-family': MONO }, content);
      t2.textContent = 'layer 2 · parent · same order inside the layer'
        + (caps.parent != null ? `   cap = min(${caps.own}, anchor ${s.anchor}) = ${caps.parent}` : '');
      const aLit = s.lit.includes('answer');
      panel(ANS, ZONE.answer, aLit, 'answer', '');
      if (s.answer) {
        chip(content, ANS.x + 12, ANS.y + 26, 116, 20, 'purple', s.answer);
        const t = K.el('text', { x: ANS.x + 12, y: ANS.y + 60, 'font-size': 8, fill: c.muted }, content);
        t.textContent = 'first visible version wins';
      } else {
        const t = K.el('text', { x: ANS.x + 12, y: ANS.y + 40, 'font-size': 8.5, fill: c.muted }, content);
        t.textContent = 'nothing returned yet';
      }
    }

    function drawEdges(s) {
      for (const e of s.edges) {
        const g = EDGE[e.k]; if (!g) continue;
        K.el('line', { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, stroke: c[g.zone], 'stroke-width': 1.6,
          'marker-end': K.arrow(uid, g.zone) }, content);
        if (e.t) {
          const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2;
          const w = Math.max(26, e.t.length * 5 + 8);
          K.el('rect', { x: mx - w / 2, y: my - 8, width: w, height: 14, rx: 3, fill: c.stage,
            stroke: c[g.zone], 'stroke-width': 0.9, opacity: 0.95 }, content);
          const t = K.el('text', { x: mx, y: my + 2.5, 'text-anchor': 'middle', 'font-size': 8,
            fill: c[g.zone], 'font-family': MONO }, content);
          t.textContent = e.t;
        }
      }
    }

    function drawScene() {
      content.innerHTML = '';
      anim.innerHTML = '';
      const sts = stages(), s = sts[st.i];
      drawStrip(sts, st.i);
      drawRail(s);
      drawCatalog(s);
      drawPin(s);
      drawSet(PAR, PMEM, PLEV, 'blue', s, 'parent', 'parent components');
      drawSet(CHI, CMEM, CLEV, 'green', s, 'child', "child's own components");
      drawReadStack(s);
      drawEdges(s);
      const n = K.el('text', { x: 20, y: Hh - 8, 'font-size': 9.5, fill: c.muted }, content);
      n.textContent = `${OPS[st.op].label} · stage ${st.i + 1} of ${sts.length} — ${s.note}`;
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      const s = cur();
      stat('seq', s.seq);
      stat('anchor', s.anchor == null ? '—' : s.anchor);
      stat('touched', s.touchedCum);
      stat('meta', s.metaCum);
      const n = stages().length;
      root.querySelector('.t-back').disabled = st.i === 0 || st.busy;
      root.querySelector('.t-next').disabled = st.i >= n - 1 || st.busy;
      root.querySelector('.t-play').textContent = st.playing ? '⏸ Pause' : '▶ Play';
    }

    // ---- animation ----------------------------------------------------------------------
    function pulse(box, zone) {
      const r = K.el('rect', { x: box.x - 3, y: box.y - 3, width: box.w + 6, height: box.h + 6, rx: 10,
        fill: 'none', stroke: c[zone], 'stroke-width': 2, opacity: 0.85 }, anim);
      const p = { o: 0.85, s: 0 };
      animate(p, { o: 0, s: 9, duration: dur(620), ease: 'outQuad',
        onUpdate: () => {
          r.setAttribute('opacity', p.o);
          r.setAttribute('x', box.x - 3 - p.s); r.setAttribute('y', box.y - 3 - p.s);
          r.setAttribute('width', box.w + 6 + p.s * 2); r.setAttribute('height', box.h + 6 + p.s * 2);
        },
        onComplete: () => r.remove() });
    }

    async function flow(s) {
      s.lit.forEach((id) => { if (BOX[id]) pulse(BOX[id], ZONE[id]); });
      const jobs = s.edges.map((e, i) => {
        const g = EDGE[e.k]; if (!g) return null;
        const dot = K.el('circle', { cx: g.x1, cy: g.y1, r: 4.5, fill: c[g.zone] }, anim);
        const p = { t: 0 };
        return animate(p, { t: 1, duration: dur(520), delay: i * dur(140), ease: 'inOutQuad',
          onUpdate: () => {
            dot.setAttribute('cx', g.x1 + (g.x2 - g.x1) * p.t);
            dot.setAttribute('cy', g.y1 + (g.y2 - g.y1) * p.t);
          },
          onComplete: () => dot.remove() });
      }).filter(Boolean);
      if (jobs.length) await Promise.all(jobs);
      await K.delay(dur(120));
    }

    // ---- stepping -----------------------------------------------------------------------
    async function goTo(i, announce) {
      const sts = stages();
      const j = Math.max(0, Math.min(sts.length - 1, i));
      st.i = j;
      st.busy = true; setLock(true);
      drawScene(); render();
      const s = sts[j];
      if (announce) K.addLog(logBody, s.log.msg, s.log.cls);
      await flow(s);
      st.busy = false; setLock(false); render();
    }

    async function next() {
      const n = stages().length;
      if (st.busy) return;
      if (st.i >= n - 1) {
        K.addLog(logBody, `⏹ ${OPS[st.op].label} is at its last stage — step Back, or pick another operation`, 'warn');
        return;
      }
      await goTo(st.i + 1, true);
    }
    async function back() {
      if (st.busy || st.i === 0) return;
      const s = stages()[st.i - 1];
      await goTo(st.i - 1, false);
      K.addLog(logBody, `◀ back to ${s.name} — the scene is recomputed at this stage, not rewound`, 'hl');
    }

    async function play() {
      if (st.playing) { st.playing = false; render(); return; }
      st.playing = true; render();
      while (st.playing && st.i < stages().length - 1) {
        await goTo(st.i + 1, true);
        if (!st.playing) break;
        await K.delay(dur(760));
      }
      st.playing = false; render();
    }

    function setOp(op) {
      st.playing = false;
      st.op = op; st.i = 0;
      drawScene(); render();
      const s = cur();
      K.addLog(logBody, `⇄ operation → ${OPS[op].label} · ${OPS[op].names.join(' → ')}`
        + (op === 'fork' ? '' : ` (the store starts from a child forked at anchor ${st.base.h0})`), 'hl');
      K.addLog(logBody, s.log.msg, s.log.cls);
    }

    function reset() {
      const sp = st.speed, op = st.op;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 11;
      st = fresh(seed);
      st.speed = sp; st.op = op;
      root.querySelector('.t-op').value = op;
      setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset to seed ${seed} — the head, the keys and the stage order all come back identical`, 'hl');
    }

    function setLock(b) {
      K.lock(root, ['.t-op', '.t-reset', '.t-seed'], b);
      const back = root.querySelector('.t-back'), nx = root.querySelector('.t-next');
      const n = stages().length;
      back.disabled = b || st.i === 0;
      nx.disabled = b || st.i >= n - 1;
    }

    function bind() {
      root.querySelector('.t-op').onchange = (e) => setOp(e.target.value);
      root.querySelector('.t-back').onclick = back;
      root.querySelector('.t-next').onclick = next;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-seed').onchange = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value) || 1; };
    }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.SKVArchitecture = { init };
})();
