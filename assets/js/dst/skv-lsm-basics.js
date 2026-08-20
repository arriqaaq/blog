/**
 * SKV LSM Basics (dst-kit) — an LSM tree operated by hand: put → WAL → memtable → flush →
 * SSTable → compact, plus a read walking the whole path.
 *
 * The primer's teaching model. Writes only ever append: a put lands in the WAL, then in the
 * sorted in-memory memtable; a full memtable is written out once, sequentially, as an immutable
 * SSTable in L0; compaction later merges overlapping tables into L1 and is the ONLY step that
 * destroys anything. A get consults the memtable, then L0 newest-first (bloom filters skip
 * tables that certainly miss), then L1. Watch a key written twice: the old version stays on
 * disk, superseded but readable, until a compaction decides nobody can reach it — the single
 * property the branching design is built on. Exposes window.SKVLsmBasics.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-lsm-basics: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-lsm-basics: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 348;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const KEYS = 'abcdefgh'.split('');
  const MEMCAP = 4;
  const MEM = { x: 24, y: 64, w: 200, h: 126 };
  const WAL = { x: 24, y: 236, w: 200, h: 54 };
  const SEP = 250;                       // memory | disk divider
  const L0 = { x: 272, y: 64, w: 484, h: 108 };
  const L1 = { x: 272, y: 208, w: 484, h: 94 };
  const L0CAP = 3;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    function fresh(seed) {
      const rng = K.rng(seed);
      const st = { seed, rng, seq: 0, busy: false, playing: false, speed: 1,
                   mem: [], wal: [], l0: [], l1: [], dropped: 0 };
      // Pre-seed one compacted L1 table so the read path has depth from the start.
      const base = [];
      for (const k of ['a', 'c', 'e', 'g']) { st.seq += 1; base.push({ key: k, seq: st.seq, kind: 'set' }); }
      st.l1.push({ entries: base });
      return st;
    }
    let st = fresh(11);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    const range = (entries) => {
      const ks = entries.map((e) => e.key).sort();
      return ks[0] === ks[ks.length - 1] ? ks[0] : `${ks[0]}–${ks[ks.length - 1]}`;
    };
    const hasKey = (entries, k) => entries.some((e) => e.key === k);
    const liveKeys = () => {
      const seen = new Map();
      const all = [...st.mem, ...st.l0.flatMap((t) => t.entries), ...st.l1.flatMap((t) => t.entries)];
      all.sort((a, b) => b.seq - a.seq);
      for (const e of all) if (!seen.has(e.key)) seen.set(e.key, e.kind);
      return [...seen.entries()].filter(([, kind]) => kind === 'set').map(([k]) => k);
    };
    const anyKeys = () => {
      const s = new Set([...st.mem, ...st.l0.flatMap((t) => t.entries), ...st.l1.flatMap((t) => t.entries)].map((e) => e.key));
      return [...s];
    };

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--green t-put">＋ Put</button>
        <button class="dstk-btn dstk-btn--blue t-get">? Get</button>
        <button class="dstk-btn dstk-btn--red t-del">⊘ Delete</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--amber t-flush">⇥ Flush</button>
          <button class="dstk-btn dstk-btn--purple t-compact">✂ Compact</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}" min="1" max="999" style="width:4.2rem"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'An LSM tree, operated by hand', sub: 'put → memtable → flush → SSTable → compact',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'seq', label: 'seq' }, { id: 'mem', label: 'memtable' },
                { id: 'tables', label: 'sstables' }, { id: 'dropped', label: 'dropped' }],
        cap: 'Nothing here is overwritten in place. Put the same key twice and the first version is still on '
           + 'disk, superseded but readable, until a compaction decides nobody can reach it.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 put a few keys, watch the memtable flush, then compact and read', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function chip(g, x, y, w, h, e, zone, opacity) {
      const grp = K.el('g', { opacity: opacity != null ? opacity : 1, 'data-chip': e.key + e.seq }, g);
      K.el('rect', { x, y, width: w, height: h, rx: 4, fill: K.grad(uid, zone),
        stroke: c[zone], 'stroke-width': 1.2 }, grp);
      const t = K.el('text', { x: x + w / 2, y: y + h / 2 + 3.5, 'text-anchor': 'middle',
        'font-size': 9.5, 'font-weight': 600, fill: c[zone], 'font-family': MONO }, grp);
      t.textContent = e.kind === 'del' ? `${e.key}=⊥·${e.seq}` : `${e.key}=v${e.seq}`;
      return grp;
    }

    function drawScene() {
      content.innerHTML = '';
      const intro = K.el('text', { x: 18, y: 18, 'font-size': 10.5, fill: c.muted }, content);
      intro.textContent = 'Writes only ever append. Left of the dashed line is memory; right of it nothing is ever modified.';

      // memory | disk divider
      K.el('line', { x1: SEP, y1: 34, x2: SEP, y2: Hh - 14, stroke: c.muted,
        'stroke-width': 1.2, 'stroke-dasharray': '5 4', opacity: 0.7 }, content);
      const memLbl = K.el('text', { x: SEP - 8, y: 44, 'text-anchor': 'end', 'font-size': 9, fill: c.muted }, content);
      memLbl.textContent = 'in memory';
      const dskLbl = K.el('text', { x: SEP + 8, y: 44, 'font-size': 9, fill: c.muted }, content);
      dskLbl.textContent = 'on disk · immutable';

      // memtable
      K.el('rect', { x: MEM.x, y: MEM.y, width: MEM.w, height: MEM.h, rx: 8,
        fill: 'none', stroke: c.green, 'stroke-width': 1.6 }, content);
      const mt = K.el('text', { x: MEM.x + 10, y: MEM.y + 16, 'font-size': 10.5, 'font-weight': 700,
        fill: c.green, 'font-family': MONO }, content);
      mt.textContent = `memtable · sorted · ${st.mem.length}/${MEMCAP}`;
      st.mem.forEach((e, i) => {
        chip(content, MEM.x + 12, MEM.y + 24 + i * 25, MEM.w - 24, 21, e, e.kind === 'del' ? 'red' : 'green');
      });

      // WAL
      K.el('rect', { x: WAL.x, y: WAL.y, width: WAL.w, height: WAL.h, rx: 8,
        fill: 'none', stroke: c.amber, 'stroke-width': 1.4 }, content);
      const wt = K.el('text', { x: WAL.x + 10, y: WAL.y + 15, 'font-size': 10, 'font-weight': 700,
        fill: c.amber, 'font-family': MONO }, content);
      wt.textContent = 'write-ahead log';
      st.wal.slice(-7).forEach((e, i) => {
        const g = K.el('g', {}, content);
        K.el('rect', { x: WAL.x + 10 + i * 26, y: WAL.y + 22, width: 22, height: 20, rx: 3,
          fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1 }, g);
        const t = K.el('text', { x: WAL.x + 21 + i * 26, y: WAL.y + 36, 'text-anchor': 'middle',
          'font-size': 9, fill: c.amber, 'font-family': MONO }, g);
        t.textContent = e.key;
      });

      // L0 shelf
      K.el('rect', { x: L0.x, y: L0.y, width: L0.w, height: L0.h, rx: 8,
        fill: 'none', stroke: c.separator, 'stroke-width': 1 }, content);
      const l0t = K.el('text', { x: L0.x + 10, y: L0.y + 16, 'font-size': 10.5, 'font-weight': 700,
        fill: c.blue, 'font-family': MONO }, content);
      l0t.textContent = `L0 · newest first · ranges may overlap`;
      st.l0.forEach((tbl, i) => {
        const x = L0.x + 12 + i * 158, y = L0.y + 26;
        const g = K.el('g', { 'data-l0': i }, content);
        K.el('rect', { x, y, width: 146, height: 68, rx: 6, fill: K.grad(uid, 'blue'),
          stroke: c.blue, 'stroke-width': 1.4 }, g);
        const t = K.el('text', { x: x + 8, y: y + 15, 'font-size': 9.5, 'font-weight': 700,
          fill: c.blue, 'font-family': MONO }, g);
        t.textContent = `sst · keys ${range(tbl.entries)}`;
        tbl.entries.slice(0, 4).forEach((e, j) => {
          const et = K.el('text', { x: x + 8 + (j % 2) * 70, y: y + 32 + Math.floor(j / 2) * 15,
            'font-size': 8.5, fill: e.kind === 'del' ? c.red : c.blue, 'font-family': MONO }, g);
          et.textContent = e.kind === 'del' ? `${e.key}=⊥·${e.seq}` : `${e.key}=v${e.seq}`;
        });
        if (tbl.entries.length > 4) {
          const m = K.el('text', { x: x + 8, y: y + 62, 'font-size': 8, fill: c.muted }, g);
          m.textContent = `+${tbl.entries.length - 4} more`;
        }
      });

      // L1 shelf
      K.el('rect', { x: L1.x, y: L1.y, width: L1.w, height: L1.h, rx: 8,
        fill: 'none', stroke: c.separator, 'stroke-width': 1 }, content);
      const l1t = K.el('text', { x: L1.x + 10, y: L1.y + 16, 'font-size': 10.5, 'font-weight': 700,
        fill: c.purple, 'font-family': MONO }, content);
      l1t.textContent = 'L1 · merged · non-overlapping';
      st.l1.forEach((tbl, i) => {
        const x = L1.x + 12 + i * 240, y = L1.y + 26;
        const g = K.el('g', { 'data-l1': i }, content);
        K.el('rect', { x, y, width: 226, height: 56, rx: 6, fill: K.grad(uid, 'purple'),
          stroke: c.purple, 'stroke-width': 1.4 }, g);
        const t = K.el('text', { x: x + 8, y: y + 15, 'font-size': 9.5, 'font-weight': 700,
          fill: c.purple, 'font-family': MONO }, g);
        t.textContent = `sst · keys ${range(tbl.entries)} · ${tbl.entries.length} entries`;
        tbl.entries.slice(0, 6).forEach((e, j) => {
          const et = K.el('text', { x: x + 8 + (j % 3) * 72, y: y + 32 + Math.floor(j / 3) * 14,
            'font-size': 8.5, fill: e.kind === 'del' ? c.red : c.purple, 'font-family': MONO }, g);
          et.textContent = e.kind === 'del' ? `${e.key}=⊥·${e.seq}` : `${e.key}=v${e.seq}`;
        });
      });
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      stat('seq', st.seq);
      stat('mem', `${st.mem.length}/${MEMCAP}`);
      stat('tables', st.l0.length + st.l1.length);
      stat('dropped', st.dropped);
    }

    // ---- helpers for animation ----------------------------------------------------------
    async function fly(x1, y1, x2, y2, zone, label) {
      const g = K.el('g', {}, anim);
      K.el('rect', { x: -34, y: -11, width: 68, height: 22, rx: 4, fill: K.grad(uid, zone),
        stroke: c[zone], 'stroke-width': 1.4, filter: K.glow(uid) }, g);
      const t = K.el('text', { x: 0, y: 4, 'text-anchor': 'middle', 'font-size': 9.5,
        'font-weight': 700, fill: c[zone], 'font-family': MONO }, g);
      t.textContent = label;
      g.setAttribute('transform', `translate(${x1} ${y1})`);
      const p = { x: x1, y: y1 };
      await animate(p, { x: x2, y: y2, duration: dur(430), ease: 'outQuad',
        onUpdate: () => g.setAttribute('transform', `translate(${p.x} ${p.y})`) });
      g.remove();
    }
    async function pulse(x, y, r, zone) {
      const dot = K.el('circle', { cx: x, cy: y, r: 3, fill: 'none', stroke: c[zone],
        'stroke-width': 2, opacity: 0.9 }, anim);
      const p = { r: 3, o: 0.9 };
      await animate(p, { r, o: 0, duration: dur(420), ease: 'outQuad',
        onUpdate: () => { dot.setAttribute('r', p.r); dot.setAttribute('opacity', p.o); } });
      dot.remove();
    }

    // ---- actions ------------------------------------------------------------------------
    async function put(forcedKey, kind) {
      if (st.busy) return; st.busy = true; setLock(true);
      const k = forcedKey || KEYS[Math.floor(st.rng() * KEYS.length)];
      st.seq += 1;
      const e = { key: k, seq: st.seq, kind: kind || 'set' };
      // WAL first — the append that makes the buffered write durable.
      st.wal.push(e);
      await fly(SEP + 60, 20, WAL.x + WAL.w - 30, WAL.y + 32, 'amber', k);
      // then the sorted insert into the memtable (an existing version of k is superseded in place
      // in the buffer — memory is the one place that IS mutable)
      st.mem = st.mem.filter((m) => m.key !== k);
      st.mem.push(e); st.mem.sort((a, b) => (a.key < b.key ? -1 : 1));
      drawScene(); render();
      if (e.kind === 'del') {
        K.addLog(logBody, `⊘ delete(${k}) wrote a tombstone at seq ${st.seq} — it appends a marker rather than removing the value`, 'warn');
      } else {
        K.addLog(logBody, `＋ put(${k})=v${st.seq} — appended to the WAL, then sorted into the memtable`, 'ok');
      }
      await K.delay(dur(220));
      st.busy = false; setLock(false);
      if (st.mem.length >= MEMCAP) {
        K.addLog(logBody, `memtable is full (${MEMCAP}/${MEMCAP}) — flushing`, 'hl');
        await flush();
      }
    }

    async function flush() {
      if (st.busy || !st.mem.length) return; st.busy = true; setLock(true);
      if (st.l0.length >= L0CAP) {
        st.busy = false; setLock(false);
        K.addLog(logBody, `L0 is full — compact first`, 'warn');
        await compact(); await flush(); return;
      }
      const entries = st.mem.slice();
      await fly(MEM.x + MEM.w / 2, MEM.y + MEM.h / 2, L0.x + 85 + st.l0.length * 158, L0.y + 60,
        'blue', `sst ${range(entries)}`);
      st.l0.unshift({ entries }); st.l0 = st.l0.slice(0, L0CAP);
      st.mem = []; st.wal = [];
      drawScene(); render();
      K.addLog(logBody, `⇥ flushed ${entries.length} entries as one immutable L0 SSTable — one sequential write; `
        + `its WAL entries are no longer needed`, 'ok');
      await K.delay(dur(220));
      st.busy = false; setLock(false);
    }

    async function compact() {
      if (st.busy) return;
      if (st.l0.length < 1) { K.addLog(logBody, '✂ nothing to compact — L0 is empty', 'warn'); return; }
      st.busy = true; setLock(true);
      // glow the inputs
      svg.querySelectorAll('[data-l0],[data-l1]').forEach((g) => g.setAttribute('filter', K.glow(uid)));
      await K.delay(dur(380));
      const all = [...st.l0.flatMap((t) => t.entries), ...st.l1.flatMap((t) => t.entries)];
      all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : b.seq - a.seq));
      const kept = [], droppedNow = [];
      const seen = new Set();
      for (const e of all) {
        if (seen.has(e.key)) { droppedNow.push(e); continue; }   // superseded — unreachable now
        seen.add(e.key);
        // L1 is the bottom here: a newest-version tombstone means the key can leave entirely
        if (e.kind === 'del') droppedNow.push(e);
        else kept.push(e);
      }
      // superseded versions fall out of the picture
      droppedNow.slice(0, 5).forEach((e, i) => {
        const t = K.el('text', { x: L1.x + 30 + i * 92, y: L1.y + L1.h + 4, 'font-size': 9,
          fill: c.red, 'font-family': MONO, opacity: 0.95 }, anim);
        t.textContent = e.kind === 'del' ? `dropped ${e.key}=⊥` : `dropped ${e.key}=v${e.seq}`;
        const p = { y: L1.y + L1.h + 4, o: 0.95 };
        animate(p, { y: Hh - 4, o: 0, duration: dur(900), ease: 'inQuad',
          onUpdate: () => { t.setAttribute('y', p.y); t.setAttribute('opacity', p.o); },
          onComplete: () => t.remove() });
      });
      st.dropped += droppedNow.length;
      // split into ≤2 non-overlapping L1 tables
      st.l1 = [];
      if (kept.length) {
        const half = Math.ceil(kept.length / 2);
        st.l1.push({ entries: kept.slice(0, half) });
        if (kept.length > half) st.l1.push({ entries: kept.slice(half) });
      }
      st.l0 = [];
      await K.delay(dur(460));
      drawScene(); render();
      K.addLog(logBody, `✂ compaction merged everything into L1: kept ${kept.length}, dropped ${droppedNow.length} `
        + `superseded versions — the step that makes them unreachable`, 'err');
      await K.delay(dur(220));
      st.busy = false; setLock(false);
    }

    async function get(forcedKey) {
      if (st.busy) return; st.busy = true; setLock(true);
      const pool = anyKeys();
      const k = forcedKey || (pool.length ? pool[Math.floor(st.rng() * pool.length)]
                                          : KEYS[Math.floor(st.rng() * KEYS.length)]);
      let checked = 0, found = null;
      // 1 — memtable
      await pulse(MEM.x + MEM.w / 2, MEM.y + MEM.h / 2, 26, 'green'); checked++;
      const m = st.mem.find((e) => e.key === k);
      if (m) found = m;
      // 2 — L0 newest-first, bloom filters skipping certain misses
      if (!found) {
        for (let i = 0; i < st.l0.length; i++) {
          const x = L0.x + 85 + i * 158, y = L0.y + 60;
          if (!hasKey(st.l0[i].entries, k)) {
            const b = K.el('text', { x: x - 60, y: y - 42, 'font-size': 8.5, fill: c.gray,
              'font-family': MONO }, anim);
            b.textContent = 'bloom: no';
            setTimeout(() => b.remove(), dur(900));
            continue;                      // never read from disk at all
          }
          await pulse(x, y, 30, 'blue'); checked++;
          const hit = st.l0[i].entries.find((e) => e.key === k);
          if (hit) { found = hit; break; }
        }
      }
      // 3 — L1, located by binary search on the non-overlapping ranges
      if (!found) {
        for (let i = 0; i < st.l1.length; i++) {
          if (!hasKey(st.l1[i].entries, k)) continue;
          await pulse(L1.x + 125 + i * 240, L1.y + 54, 34, 'purple'); checked++;
          found = st.l1[i].entries.find((e) => e.key === k);
          break;
        }
      }
      if (!found) {
        K.addLog(logBody, `? get(${k}) → not found, after consulting ${checked} component${checked === 1 ? '' : 's'}`, 'warn');
      } else if (found.kind === 'del') {
        K.addLog(logBody, `? get(${k}) → absent: the newest version is a tombstone — even though an older `
          + `value may still be sitting in L1`, 'warn');
      } else {
        K.addLog(logBody, `? get(${k}) → v${found.seq} — first version found wins, walk stops `
          + `(${checked} component${checked === 1 ? '' : 's'} consulted)`, 'ok');
      }
      await K.delay(dur(220));
      st.busy = false; setLock(false);
    }

    async function del() {
      const pool = liveKeys();
      if (!pool.length) { K.addLog(logBody, '⊘ nothing live to delete — put something first', 'warn'); return; }
      await put(pool[Math.floor(st.rng() * pool.length)], 'del');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        const r = st.rng();
        if (r < 0.55) await put();
        else if (r < 0.75) await get();
        else if (r < 0.85) await del();
        else if (st.l0.length >= 2) await compact();
        else await put();
        if (!st.playing) break;
        await K.delay(dur(520));
      }
    }
    function pause() { st.playing = false; pp(); }

    function reset() {
      const sp = st.speed;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 11;
      st = fresh(seed);
      st.speed = sp;
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset to seed ${seed} — this seed replays the same keys in the same order`, 'hl');
    }

    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-put', '.t-get', '.t-del', '.t-flush', '.t-compact', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-put').onclick = () => put();
      root.querySelector('.t-get').onclick = () => get();
      root.querySelector('.t-del').onclick = del;
      root.querySelector('.t-flush').onclick = flush;
      root.querySelector('.t-compact').onclick = compact;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-seed').onchange = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value) || 1; };
    }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.SKVLsmBasics = { init };
})();
