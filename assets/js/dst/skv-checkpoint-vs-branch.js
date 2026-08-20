/**
 * SKV Checkpoint vs Branch (dst-kit) — the same store, the same four steps, two lanes.
 *
 * SurrealKV already had something close to a branch: a checkpoint (src/checkpoint.rs) flushes the
 * mutable state, copies or hard-links every SSTable the manifest references, takes the level
 * manifest and the metadata, and restores by reopening through normal recovery. This widget runs
 * CREATE → WRITE → READ → DELETE over one starting store, once per lane, so the two can be compared
 * step by step rather than described:
 *   • checkpoint — create writes one entry per live SSTable into a second, independent store; a
 *     write afterwards diverges the two, so bytes that were shared stop being shared; a read is
 *     served entirely by the copy; delete removes the whole second store.
 *   • branch     — create publishes one catalog record; a write lands in the branch's own
 *     components at a sequence above its anchor; a read of an untouched key is answered by the
 *     parent's shared tables at the anchor cap; delete reclaims the branch's own components and
 *     releases the anchor.
 *
 * Every stage is recomputed from the seed and the table count, so Back is exact.
 * Exposes window.SKVCheckpointVsBranch.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-checkpoint-vs-branch: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-checkpoint-vs-branch: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 414;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const STRIP = { x: 20, y: 8, w: 740, h: 22 };
  const LANE_H = 166;
  const LA = { x: 20, y: 42, w: 740, h: LANE_H };    // checkpoint
  const LB = { x: 20, y: 222, w: 740, h: LANE_H };   // branch
  const STORE = { dx: 10, dy: 38, w: 296, h: 118 };  // relative to a lane
  const RES = { dx: 376, dy: 38, w: 364, h: 118 };
  const STAGES = ['CREATE', 'WRITE', 'READ', 'DELETE'];

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    // ---- deterministic scene ------------------------------------------------------------
    // The seed varies each table's size, the size of the table the write produces, how many
    // superseded versions the branch's anchor pins, the sequence the fork lands on, and which key
    // the read asks for. The table count comes from the control, because that is the number a
    // checkpoint's create cost tracks.
    function fresh(seed, tables) {
      const rng = K.rng(seed);
      const n = Math.max(3, Math.min(10, tables || 6));
      const sizes = [];
      for (let i = 0; i < n; i++) sizes.push(18 + Math.floor(rng() * 22));
      const own = 8 + Math.floor(rng() * 9);
      const pinned = 2 + Math.floor(rng() * 5);
      const h = 18 + Math.floor(rng() * 9);
      const memRows = 2 + Math.floor(rng() * 3);
      const keys = ['user:3', 'user:5', 'user:8'];
      const wk = keys[Math.floor(rng() * keys.length)];
      let rk = keys[Math.floor(rng() * keys.length)];
      if (rk === wk) rk = keys[(keys.indexOf(wk) + 1) % keys.length];
      return { seed, rng, tables: n, i: 0, busy: false, playing: false, speed: 1,
               base: { sizes, own, pinned, h, memRows, wk, rk } };
    }
    let st = fresh(19, 6);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const total = () => st.base.sizes.reduce((a, b) => a + b, 0);

    // ---- the four stages, per lane ------------------------------------------------------
    function stages() {
      const b = st.base, n = st.tables, tot = total();
      const entries = n + 2;                       // one per live SSTable, + level manifest + metadata
      const unshared = b.sizes[0];                 // the first linked table either side rewrites
      const ckAdd = b.own + unshared;
      const brAdd = b.own + b.pinned;
      const out = [];

      out.push({
        name: 'CREATE',
        ck: { copy: { links: n, meta: true, own: [] }, mid: { t: `link ${entries} entries`, dir: 'r', zone: 'red' },
              note: `${entries} entries written: one per live SSTable, plus the level manifest and the metadata` },
        br: { record: true, own: [], pin: [b.h], mid: { t: 'publish 1 record', dir: 'r', zone: 'green' },
              note: `1 entry written; the parent's ${n} tables are neither copied nor linked` },
        stats: { entries: `${entries} / 1`, shared: `0 / ${n}` },
        log: [
          { msg: `▣ CREATE — mutable state flushed, then ${n} SSTable entries linked into a second store, plus the `
            + `level manifest and the metadata: ${entries} entries. The count tracks file count, not data size`, cls: 'warn' },
          { msg: `⑂ CREATE — one catalog version names the child, its parent link and anchor s${b.h}. The parent's `
            + `${n} tables stay where they are and the branch reads them through its parent layer`, cls: 'ok' },
        ],
      });

      out.push({
        name: 'WRITE',
        ck: { copy: { links: n, meta: true, own: [{ id: 't' + (n + 1), mib: b.own }], unshared: 1 },
              mid: { t: `write ${b.wk}`, dir: 'r', zone: 'red' },
              note: `+${b.own} MiB of its own, and t1 (${unshared} MiB) stops being shared once either side rewrites it` },
        br: { record: true, own: [{ id: 'b·t1', mib: b.own }], pin: [b.h], mid: { t: `write ${b.wk}`, dir: 'r', zone: 'green' },
              note: `+${b.own} MiB of its own, and the anchor keeps ~${b.pinned} MiB the parent would have dropped` },
        stats: { entries: `${entries} / 1`, shared: `0 / ${n}`, space: `+${ckAdd} / +${brAdd}` },
        log: [
          { msg: `▣ WRITE — ${b.wk} landed in the copy's own memtable and flushed as its own table (${b.own} MiB). `
            + `The two stores are independent, so a linked table stops sharing bytes as soon as either side rewrites it`, cls: 'warn' },
          { msg: `⑂ WRITE — ${b.wk} landed in the branch's own components at s${b.h + 1}, above its anchor, so it is `
            + `already the newest version of that key. The cost on the parent's side is retention: ~${b.pinned} MiB pinned`, cls: 'ok' },
        ],
      });

      out.push({
        name: 'READ',
        ck: { copy: { links: n, meta: true, own: [{ id: 't' + (n + 1), mib: b.own }], unshared: 1 },
              probe: 'copy', mid: { t: `read ${b.rk}`, dir: 'r', zone: 'blue' },
              note: 'answered inside the copy: it holds a full set of tables and its own bloom filters' },
        br: { record: true, own: [{ id: 'b·t1', mib: b.own }], pin: [b.h], probe: 'parent',
              mid: { t: `read ${b.rk}`, dir: 'r', zone: 'blue' },
              note: `layer 1 misses, layer 2 answers from the parent's tables at cap s${b.h}` },
        stats: { entries: `${entries} / 1`, shared: `0 / ${n}`, space: `+${ckAdd} / +${brAdd}` },
        log: [
          { msg: `▣ READ — ${b.rk} was answered entirely inside the copy. One store, one set of levels, and the `
            + 'original never consulted — reads are the part a full copy makes simple', cls: 'ok' },
          { msg: `⑂ READ — ${b.rk} is not in the branch's own components, so layer 2 answered it from the parent's `
            + `shared tables at cap min(s${b.h + 1}, anchor s${b.h}) = s${b.h}`, cls: 'ok' },
        ],
      });

      out.push({
        name: 'DELETE',
        ck: { copy: null, dropped: true, mid: { t: 'drop the store', dir: 'x', zone: 'red' },
              note: `the directory goes, and with it ${entries} entries and ${b.own + unshared} MiB; no rows were deleted` },
        br: { record: false, tomb: true, own: [], pin: [], mid: { t: 'reclaim + tombstone', dir: 'x', zone: 'green' },
              note: `${b.own} MiB reclaimed and the ~${b.pinned} MiB the anchor pinned becomes droppable again; no rows were deleted` },
        stats: { entries: `${entries} / 1`, shared: `0 / ${n}`, space: `+${ckAdd} / +${brAdd}`, rows: '0 / 0' },
        log: [
          { msg: `▣ DELETE — the second store is removed: its ${entries} entries and its own ${b.own} MiB table go with `
            + 'it. Nothing is deleted from the original, because nothing in it belonged to the checkpoint', cls: 'ok' },
          { msg: '⑂ DELETE — the branch\'s own components are reclaimed and its catalog record becomes a tombstone, '
            + 'retired after the reclamation order completes. The released anchor lets the parent drop what it pinned', cls: 'ok' },
        ],
      });
      return out;
    }

    const cur = () => stages()[st.i];

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      const sp = [0.5, 1, 2].map((v) =>
        `<option value="${v}"${v === st.speed ? ' selected' : ''}>${v}×</option>`).join('');
      return `<div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-back">◀ Back</button>
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--purple t-next">Next ▶</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">live sstables</span>
          <input class="t-tables" type="number" value="${st.tables}" min="3" max="10" style="width:3.4rem"></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}" min="1" max="999" style="width:4.2rem"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed">${sp}</select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Checkpoint and branch, side by side', sub: 'one starting store · create, write, read, delete',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'entries', label: 'entries at create' }, { id: 'shared', label: 'tables shared' },
                { id: 'space', label: 'MiB at divergence' }, { id: 'rows', label: 'rows deleted' }],
        cap: 'Both lanes start from the same store and run the same four steps; the stat cards read checkpoint / branch. '
           + 'Raising the live-SSTable count moves the checkpoint\'s create cost and leaves the branch\'s at one record. '
           + 'The branch is not free either: its cost is on the parent\'s side, as versions the anchor keeps alive. '
           + 'MiB figures are illustrative sizes rather than measurements.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 step all four stages, then change the live-SSTable count and step again', 'hl', 4);
    }

    // ---- drawing ------------------------------------------------------------------------
    function chip(g, x, y, w, h, zone, label, o) {
      const opt = o || {};
      const grp = K.el('g', { opacity: opt.dim ? 0.45 : 1 }, g);
      K.el('rect', { x, y, width: w, height: h, rx: 3, fill: opt.hollow ? 'none' : K.grad(uid, zone),
        stroke: c[zone], 'stroke-width': opt.bold ? 1.6 : 1.1,
        'stroke-dasharray': opt.dash ? '3 2' : 'none' }, grp);
      const t = K.el('text', { x: x + w / 2, y: y + h / 2 + 3.2, 'text-anchor': 'middle', 'font-size': 7.6,
        'font-weight': 600, fill: c[zone], 'font-family': MONO }, grp);
      t.textContent = label;
      if (opt.strike) {
        K.el('line', { x1: x + 3, y1: y + h - 3, x2: x + w - 3, y2: y + 3, stroke: c.red, 'stroke-width': 1.3 }, grp);
      }
      return grp;
    }

    function drawStrip(i) {
      const n = STAGES.length, gap = 8;
      const w = (STRIP.w - gap * (n - 1)) / n;
      STAGES.forEach((nm, k) => {
        const x = STRIP.x + k * (w + gap);
        const isCur = k === i, past = k < i;
        const r = K.el('rect', { x, y: STRIP.y, width: w, height: STRIP.h, rx: 5,
          fill: isCur ? K.grad(uid, 'purple') : (past ? K.grad(uid, 'green') : 'none'),
          stroke: isCur ? c.purple : (past ? c.green : c.separator), 'stroke-width': isCur ? 1.8 : 1.1 }, content);
        if (isCur) r.setAttribute('filter', K.glow(uid));
        const t = K.el('text', { x: x + w / 2, y: STRIP.y + 15, 'text-anchor': 'middle', 'font-size': 9.5,
          'font-weight': isCur ? 700 : 600, fill: isCur ? c.purple : (past ? c.green : c.muted),
          'font-family': MONO }, content);
        t.textContent = `${k + 1}. ${nm}`;
      });
    }

    // the starting store, drawn identically in both lanes
    function drawStore(lane, zone, footNote) {
      const x = lane.x + STORE.dx, y = lane.y + STORE.dy;
      K.el('rect', { x, y, width: STORE.w, height: STORE.h, rx: 8, fill: 'none',
        stroke: c.separator, 'stroke-width': 1 }, content);
      const hd = K.el('text', { x: x + 8, y: y + 14, 'font-size': 9, 'font-weight': 700, fill: c.text,
        'font-family': MONO }, content);
      hd.textContent = `store · ${st.tables} live sstables · ${total()} MiB`;
      chip(content, x + 8, y + 20, 104, 16, 'green', `memtable · ${st.base.memRows} rows`, { hollow: true });
      st.base.sizes.forEach((mib, i) => {
        const cx = x + 8 + (i % 5) * 56, cy = y + 44 + Math.floor(i / 5) * 22;
        chip(content, cx, cy, 52, 18, zone, `t${i + 1}·${mib}`);
      });
      const t = K.el('text', { x: x + 8, y: y + STORE.h - 8, 'font-size': 8.5, fill: c.muted }, content);
      t.textContent = footNote;
    }

    function drawMid(lane, mid) {
      if (!mid) return;
      const x1 = lane.x + STORE.dx + STORE.w + 6, x2 = lane.x + RES.dx - 6;
      const y = lane.y + 86;
      if (mid.dir === 'x') {
        const t = K.el('text', { x: (x1 + x2) / 2, y: y + 4, 'text-anchor': 'middle', 'font-size': 8.5,
          'font-weight': 700, fill: c[mid.zone], 'font-family': MONO }, content);
        t.textContent = '✗';
        const t2 = K.el('text', { x: (x1 + x2) / 2, y: y + 18, 'text-anchor': 'middle', 'font-size': 7.6,
          fill: c[mid.zone], 'font-family': MONO }, content);
        t2.textContent = mid.t;
        return;
      }
      K.el('line', { x1, y1: y, x2, y2: y, stroke: c[mid.zone], 'stroke-width': 1.6,
        'marker-end': K.arrow(uid, mid.zone) }, content);
      const t = K.el('text', { x: (x1 + x2) / 2, y: y - 6, 'text-anchor': 'middle', 'font-size': 7.6,
        'font-weight': 600, fill: c[mid.zone], 'font-family': MONO }, content);
      t.textContent = mid.t;
    }

    function drawCkResult(s) {
      const lane = LA, x = lane.x + RES.dx, y = lane.y + RES.dy;
      const on = !!s.ck.copy;
      K.el('rect', { x, y, width: RES.w, height: RES.h, rx: 8, fill: 'none',
        stroke: on ? c.red : c.separator, 'stroke-width': on ? 1.6 : 1,
        'stroke-dasharray': on ? 'none' : '4 3' }, content);
      const hd = K.el('text', { x: x + 8, y: y + 14, 'font-size': 9, 'font-weight': 700,
        fill: on ? c.red : c.muted, 'font-family': MONO }, content);
      hd.textContent = on ? 'second store — independent, restored by normal recovery'
        : (s.ck.dropped ? 'second store — removed' : 'second store — nothing yet');
      if (!on) {
        const t = K.el('text', { x: x + 8, y: y + 44, 'font-size': 8.5, fill: c.muted }, content);
        t.textContent = s.ck.dropped
          ? 'the whole directory is gone; the original store is exactly as it was'
          : 'a checkpoint has not been taken yet';
        if (s.ck.note) {
          const n = K.el('text', { x: x + 8, y: y + RES.h - 8, 'font-size': 8.5, fill: c.muted }, content);
          n.textContent = s.ck.note;
        }
        return;
      }
      // one entry per live SSTable, then the manifest and the metadata
      for (let i = 0; i < s.ck.copy.links; i++) {
        const cx = x + 8 + (i % 8) * 40, cy = y + 22 + Math.floor(i / 8) * 21;
        const broke = s.ck.copy.unshared && i === 0;
        chip(content, cx, cy, 36, 17, broke ? 'amber' : 'red', `→t${i + 1}`, { dash: !broke });
      }
      const row2 = y + 64;
      chip(content, x + 8, row2, 56, 17, 'red', 'manifest');
      chip(content, x + 68, row2, 56, 17, 'red', 'metadata');
      (s.ck.copy.own || []).forEach((o, i) => chip(content, x + 132 + i * 62, row2, 58, 17, 'blue', `${o.id}·${o.mib}`, { bold: true }));
      if (s.ck.copy.unshared) {
        const t = K.el('text', { x: x + 8, y: y + 84, 'font-size': 8, fill: c.amber }, content);
        t.textContent = 'a hard link stops sharing bytes the moment either side rewrites that table';
      }
      if (s.ck.probe) {
        const t = K.el('text', { x: x + 8, y: y + 97, 'font-size': 8.5, 'font-weight': 600, fill: c.blue }, content);
        t.textContent = `read ${st.base.rk} → answered here, from this store's own tables`;
      }
      const n = K.el('text', { x: x + 8, y: y + RES.h - 8, 'font-size': 8.5, fill: c.muted }, content);
      n.textContent = s.ck.note;
    }

    function drawBrResult(s) {
      const lane = LB, x = lane.x + RES.dx, y = lane.y + RES.dy;
      const on = s.br.record;
      K.el('rect', { x, y, width: RES.w, height: RES.h, rx: 8, fill: 'none',
        stroke: on ? c.green : c.separator, 'stroke-width': on ? 1.6 : 1,
        'stroke-dasharray': on ? 'none' : '4 3' }, content);
      const hd = K.el('text', { x: x + 8, y: y + 14, 'font-size': 9, 'font-weight': 700,
        fill: on ? c.green : c.muted, 'font-family': MONO }, content);
      hd.textContent = on ? 'branch — one catalog record, plus whatever it writes itself'
        : (s.br.tomb ? 'branch — tombstoned, then retired' : 'branch — nothing yet');
      if (!on) {
        const t = K.el('text', { x: x + 8, y: y + 44, 'font-size': 8.5, fill: c.muted }, content);
        t.textContent = s.br.tomb
          ? 'the component set is reclaimed and the record retires; the parent keeps every table'
          : 'no catalog record has been published yet';
        const n = K.el('text', { x: x + 8, y: y + RES.h - 8, 'font-size': 8.5, fill: c.muted }, content);
        n.textContent = s.br.note || '';
        return;
      }
      chip(content, x + 8, y + 22, 230, 17, 'purple',
        `catalog: child · parent=main · anchor s${st.base.h}`);
      (s.br.pin || []).forEach((p, i) => chip(content, x + 244 + i * 46, y + 22, 42, 17, 'amber', `pin s${p}`));
      // the branch's own component set
      K.el('rect', { x: x + 8, y: y + 46, width: RES.w - 16, height: 34, rx: 5, fill: 'none',
        stroke: c.green, 'stroke-width': 1.2 }, content);
      const l = K.el('text', { x: x + 14, y: y + 58, 'font-size': 8, fill: c.green, 'font-family': MONO }, content);
      l.textContent = "the branch's own components";
      if (!s.br.own.length) {
        const t = K.el('text', { x: x + 130, y: y + 68, 'font-size': 8, fill: c.muted }, content);
        t.textContent = 'empty — allocated on the first write';
      }
      s.br.own.forEach((o, i) => chip(content, x + 14 + i * 66, y + 62, 62, 15, 'green', `${o.id}·${o.mib}`, { bold: true }));
      if (s.br.probe === 'parent') {
        const t = K.el('text', { x: x + 8, y: y + 94, 'font-size': 8.5, 'font-weight': 600, fill: c.blue }, content);
        t.textContent = `read ${st.base.rk} → miss here, then the parent's tables at cap s${st.base.h}`;
        // the probe crosses back into the shared store
        const x1 = x - 4, x2 = lane.x + STORE.dx + STORE.w + 4, yy = lane.y + 120;
        K.el('line', { x1, y1: yy, x2, y2: yy, stroke: c.blue, 'stroke-width': 1.5,
          'marker-end': K.arrow(uid, 'blue') }, content);
        const t2 = K.el('text', { x: (x1 + x2) / 2, y: yy - 5, 'text-anchor': 'middle', 'font-size': 7.6,
          fill: c.blue, 'font-family': MONO }, content);
        t2.textContent = 'layer 2';
      }
      const n = K.el('text', { x: x + 8, y: y + RES.h - 8, 'font-size': 8.5, fill: c.muted }, content);
      n.textContent = s.br.note;
    }

    function drawLaneHead(lane, zone, name, mech) {
      chip(content, lane.x + 10, lane.y + 6, 126, 20, zone, name, { bold: true });
      const t = K.el('text', { x: lane.x + 146, y: lane.y + 20, 'font-size': 9, fill: c.muted }, content);
      t.textContent = mech;
    }

    function drawScene() {
      content.innerHTML = '';
      anim.innerHTML = '';
      const s = cur();
      drawStrip(st.i);
      drawLaneHead(LA, 'red', 'checkpoint', 'flush, then one entry per live SSTable into a second store (src/checkpoint.rs)');
      drawStore(LA, 'blue', s.ck.dropped
        ? 'untouched throughout — the checkpoint never wrote into it'
        : 'the source of the copy; every table here got an entry over there');
      drawMid(LA, s.ck.mid);
      drawCkResult(s);

      drawLaneHead(LB, 'green', 'branch', 'one catalog record naming the child, its parent link and its anchor');
      drawStore(LB, 'blue', s.br.tomb
        ? `all ${st.tables} tables still here, and free to compact again`
        : `all ${st.tables} tables shared — the branch reads them through its parent layer`);
      drawMid(LB, s.br.mid);
      drawBrResult(s);

      const f = K.el('text', { x: 20, y: Hh - 8, 'font-size': 9.5, fill: c.muted }, content);
      f.textContent = `stage ${st.i + 1} of ${STAGES.length} · ${s.name} — top lane: ${s.ck.note}`;
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      const s = cur();
      ['entries', 'shared', 'space', 'rows'].forEach((k) => stat(k, s.stats[k] || '—'));
      root.querySelector('.t-back').disabled = st.busy || st.i === 0;
      root.querySelector('.t-next').disabled = st.busy || st.i >= STAGES.length - 1;
      root.querySelector('.t-play').textContent = st.playing ? '⏸ Pause' : '▶ Play';
    }

    // ---- animation ----------------------------------------------------------------------
    function pulse(box) {
      const r = K.el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 8, fill: 'none',
        stroke: c[box.zone || 'purple'], 'stroke-width': 2, opacity: 0.8 }, anim);
      const p = { o: 0.8, s: 0 };
      animate(p, { o: 0, s: 8, duration: dur(600), ease: 'outQuad',
        onUpdate: () => {
          r.setAttribute('opacity', p.o);
          r.setAttribute('x', box.x - p.s); r.setAttribute('y', box.y - p.s);
          r.setAttribute('width', box.w + p.s * 2); r.setAttribute('height', box.h + p.s * 2);
        },
        onComplete: () => r.remove() });
    }

    async function flow() {
      const jobs = [LA, LB].map((lane, i) => {
        const y = lane.y + 86;
        const x1 = lane.x + STORE.dx + STORE.w + 6, x2 = lane.x + RES.dx - 6;
        pulse({ x: lane.x + RES.dx, y: lane.y + RES.dy, w: RES.w, h: RES.h, zone: i === 0 ? 'red' : 'green' });
        const dot = K.el('circle', { cx: x1, cy: y, r: 4, fill: c[i === 0 ? 'red' : 'green'] }, anim);
        const p = { t: 0 };
        return animate(p, { t: 1, duration: dur(460), delay: i * dur(120), ease: 'inOutQuad',
          onUpdate: () => dot.setAttribute('cx', x1 + (x2 - x1) * p.t),
          onComplete: () => dot.remove() });
      });
      await Promise.all(jobs);
      await K.delay(dur(120));
    }

    // ---- stepping -----------------------------------------------------------------------
    async function goTo(i, announce) {
      st.i = Math.max(0, Math.min(STAGES.length - 1, i));
      st.busy = true; setLock(true);
      drawScene(); render();
      if (announce) for (const l of cur().log) K.addLog(logBody, l.msg, l.cls, 4);
      await flow();
      st.busy = false; setLock(false); render();
    }
    async function next() {
      if (st.busy) return;
      if (st.i >= STAGES.length - 1) {
        K.addLog(logBody, '⏹ DELETE is the last stage — step Back, or change the table count and start over', 'warn', 4);
        return;
      }
      await goTo(st.i + 1, true);
    }
    async function back() {
      if (st.busy || st.i === 0) return;
      const nm = STAGES[st.i - 1];
      await goTo(st.i - 1, false);
      K.addLog(logBody, `◀ back to ${nm} — both lanes are recomputed at this stage from the same seed`, 'hl', 4);
    }
    async function play() {
      if (st.playing) { st.playing = false; render(); return; }
      st.playing = true; render();
      while (st.playing && st.i < STAGES.length - 1) {
        await goTo(st.i + 1, true);
        if (!st.playing) break;
        await K.delay(dur(900));
      }
      st.playing = false; render();
    }

    function reset(msg) {
      const sp = st.speed;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 19;
      const tables = parseInt(root.querySelector('.t-tables').value, 10) || 6;
      st = fresh(seed, tables);
      st.speed = sp;
      setLock(false); drawScene(); render();
      K.addLog(logBody, msg || `↺ reset to seed ${seed} — back to the starting store, with the sizes it began with`, 'hl', 4);
    }

    function setLock(b) {
      K.lock(root, ['.t-reset', '.t-seed', '.t-tables'], b);
      root.querySelector('.t-back').disabled = b || st.i === 0;
      root.querySelector('.t-next').disabled = b || st.i >= STAGES.length - 1;
    }

    function bind() {
      root.querySelector('.t-back').onclick = back;
      root.querySelector('.t-next').onclick = next;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-reset').onclick = () => reset();
      root.querySelector('.t-seed').onchange = () => reset();
      root.querySelector('.t-tables').onchange = () => {
        const n = parseInt(root.querySelector('.t-tables').value, 10) || 6;
        reset(`⇄ ${n} live sstables — a checkpoint now writes ${n + 2} entries at create, a branch still writes 1`);
      };
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value) || 1; };
    }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.SKVCheckpointVsBranch = { init };
})();
