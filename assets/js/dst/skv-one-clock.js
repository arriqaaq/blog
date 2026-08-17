/**
 * SKV One Clock (dst-kit) — a branch is a ceiling on one shared sequence counter.
 *
 * The post's point: there is ONE global sequence counter for the whole store. Every commit on every
 * branch draws the next number from it, so branches have no clock of their own and no head in the git
 * sense (BranchInfo::last_write_seq is documented as "the newest sequence this branch wrote ITSELF —
 * not a per-branch head, which a single global commit clock does not have"). A branch's view is
 * therefore a CAP on that one number: min(snapshot seq, every fork anchor on the path to an ancestor),
 * narrowed nearest-first down the parent chain (src/snapshot.rs). Two consequences are visible here:
 * no two commits anywhere share a position on the axis, and every branch's own commits land to the
 * right of its own anchor — which is why copy-on-write shadowing needs no bookkeeping at all.
 * Exposes window.SKVOneClock.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-one-clock: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-one-clock: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 330;
  const RAIL = { x: 24, y: 28, w: 732, h: 26 };
  const LANE = { x: 24, w: 732, h: 44, y0: 88, gap: 56, plate: 96 };
  const VIS = 28;                       // sequences visible at once
  const MONO = "ui-monospace,'SF Mono',monospace";
  const ZONES = ['green', 'blue', 'amber', 'pink'];
  const MAXB = 4;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    function fresh(seed) {
      const rng = K.rng(seed);
      const st = { seed, rng, seq: 0, reader: 0, busy: false, playing: false, speed: 1,
                   branches: [{ name: 'main', parent: null, anchor: null, writes: [] }] };
      // Seed the store with a few commits on main. The gaps are deliberate: they stand for other
      // writers drawing from the same counter, which is the whole point of the axis.
      const n = 4 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        st.seq += 1 + (rng() < 0.4 ? 1 + Math.floor(rng() * 2) : 0);
        st.branches[0].writes.push(st.seq);
      }
      return st;
    }
    let st = fresh(7);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    // ---- geometry -----------------------------------------------------------------------
    const lo = () => Math.max(0, st.seq - VIS);
    const X = (s) => RAIL.x + 16 + ((s - lo()) / VIS) * (RAIL.w - 40);
    const laneY = (i) => LANE.y0 + i * LANE.gap;

    // ---- the cap rule -------------------------------------------------------------------
    // Walk the reader's parent chain nearest-first, narrowing monotonically. Returns a map of
    // branch index -> the cap through which THIS reader sees that branch. Branches not on the
    // chain are not visible to the reader at all.
    function capsFor(readerIdx) {
      const caps = new Map();
      let cap = st.seq;
      let i = readerIdx;
      caps.set(i, cap);
      while (st.branches[i].parent != null) {
        cap = Math.min(cap, st.branches[i].anchor);
        i = st.branches[i].parent;
        caps.set(i, cap);
      }
      return caps;
    }
    function chainOf(idx) {
      const out = [idx];
      let i = idx;
      while (st.branches[i].parent != null) { i = st.branches[i].parent; out.push(i); }
      return out;
    }

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      const opts = st.branches.map((b, i) =>
        `<option value="${i}"${i === st.reader ? ' selected' : ''}>${b.name}</option>`).join('');
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-commit">＋ Commit</button>
        <button class="dstk-btn dstk-btn--blue t-fork">⑂ Fork at head</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">reading as</span>
          <select class="t-reader">${opts}</select></div>
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
        title: 'One clock, many branches', sub: 'every commit draws the next number from the same counter',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'seq', label: 'global seq' }, { id: 'branches', label: 'branches' },
                { id: 'cap', label: "this reader's cap" }, { id: 'depth', label: 'chain depth' }],
        cap: "A commit's position on the rail IS its global sequence — no two commits anywhere share one. "
           + 'Switch reader and watch the cap narrow: min(visible head, every anchor on the path). Notice that '
           + "every branch's own commits sit to the RIGHT of its own anchor, which is why a child's write always "
           + 'outranks anything it inherited without a flag or a shadow table.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 fork twice, commit on main, then read as the deepest branch', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function drawScene() {
      content.innerHTML = '';
      const intro = K.el('text', { x: 18, y: 18, 'font-size': 10.5, fill: c.muted }, content);
      intro.textContent = 'Every dot’s horizontal position is its global sequence. Two branches never share one.';

      // the one clock — the accent
      K.el('rect', { x: RAIL.x, y: RAIL.y, width: RAIL.w, height: RAIL.h, rx: 7,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.7 }, content);
      const rl = K.el('text', { x: RAIL.x + 10, y: RAIL.y + 17, 'font-size': 10.5,
        'font-weight': 700, fill: c.purple, 'font-family': MONO }, content);
      rl.textContent = 'global commit sequence';
      const step = VIS > 20 ? 4 : 2;
      for (let s = Math.ceil(lo() / step) * step; s <= st.seq + 2; s += step) {
        if (s <= 0) continue;
        const x = X(s);
        if (x < RAIL.x + 150 || x > RAIL.x + RAIL.w) continue;
        K.el('line', { x1: x, y1: RAIL.y, x2: x, y2: RAIL.y + RAIL.h, stroke: c.purple,
          'stroke-width': 0.9, opacity: 0.4 }, content);
        const t = K.el('text', { x: x + 4, y: RAIL.y + 17, 'font-size': 9.5, fill: c.purple,
          opacity: 0.85, 'font-family': MONO }, content);
        t.textContent = s;
      }
      if (lo() > 0) {
        const t = K.el('text', { x: RAIL.x + 2, y: RAIL.y + RAIL.h + 14, 'font-size': 9, fill: c.muted }, content);
        t.textContent = `⋯ ${lo()} older`;
      }

      const caps = capsFor(st.reader);
      const chain = chainOf(st.reader);

      // lanes
      st.branches.forEach((b, i) => {
        const y = laneY(i);
        const zone = ZONES[i % ZONES.length];
        const onChain = caps.has(i);
        const g = K.el('g', { opacity: onChain ? 1 : 0.32 }, content);
        K.el('rect', { x: LANE.x, y, width: LANE.w, height: LANE.h, rx: 7,
          fill: 'none', stroke: c.separator, 'stroke-width': 1 }, g);
        // name plate
        K.el('rect', { x: LANE.x + 6, y: y + 7, width: LANE.plate - 12, height: LANE.h - 14, rx: 5,
          fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.3 }, g);
        const nm = K.el('text', { x: LANE.x + 14, y: y + 21, 'font-size': 10.5, 'font-weight': 700,
          fill: c[zone], 'font-family': MONO }, g);
        nm.textContent = b.name;
        const sub = K.el('text', { x: LANE.x + 14, y: y + 33, 'font-size': 8.5, fill: c[zone], opacity: 0.8 }, g);
        sub.textContent = b.anchor == null ? 'root · no anchor' : `anchor ${b.anchor}`;

        // the region of this lane that is invisible to the current reader
        if (onChain && i !== st.reader) {
          const cx = X(caps.get(i));
          if (cx < LANE.x + LANE.w) {
            const x0 = Math.max(cx, LANE.x + LANE.plate);
            K.el('rect', { x: x0, y: y + 2, width: LANE.x + LANE.w - x0 - 2, height: LANE.h - 4, rx: 4,
              fill: c.stage, opacity: 0.62, stroke: c.red, 'stroke-width': 1, 'stroke-dasharray': '4 3' }, g);
            const t = K.el('text', { x: x0 + 6, y: y + 16, 'font-size': 8.5, fill: c.red, opacity: 0.95 }, g);
            t.textContent = 'invisible to this reader, permanently';
          }
        }

        // commit dots
        for (const s of b.writes) {
          const x = X(s);
          if (x < LANE.x + LANE.plate - 4) continue;
          const hidden = onChain && i !== st.reader && s > caps.get(i);
          const dot = K.el('circle', { cx: x, cy: y + 20, r: 8.5, fill: K.grad(uid, zone),
            stroke: c[zone], 'stroke-width': 1.6, opacity: hidden ? 0.34 : 1 }, g);
          if (hidden) dot.setAttribute('stroke-dasharray', '3 2');
          const t = K.el('text', { x, y: y + 38, 'text-anchor': 'middle', 'font-size': 8.5,
            fill: c.muted, opacity: hidden ? 0.5 : 0.9, 'font-family': MONO }, g);
          t.textContent = s;
        }

        // this branch's own anchor
        if (b.anchor != null) {
          const ax = X(b.anchor);
          if (ax > LANE.x + LANE.plate) {
            K.el('line', { x1: ax, y1: y - 6, x2: ax, y2: y + LANE.h + 4, stroke: c.text,
              'stroke-width': 2 }, g);
          }
        }
      });

      // the reader's cap line
      const capSeq = caps.get(st.reader);
      const cx = X(capSeq);
      K.el('line', { x1: cx, y1: RAIL.y, x2: cx, y2: laneY(st.branches.length - 1) + LANE.h + 8,
        stroke: c.text, 'stroke-width': 2.2, 'stroke-dasharray': '6 4' }, content);
      const capY = laneY(st.branches.length - 1) + LANE.h + 10;
      K.el('rect', { x: cx - 40, y: capY, width: 80, height: 17, rx: 4, fill: K.grad(uid, 'purple'),
        stroke: c.purple, 'stroke-width': 1.2 }, content);
      const ct = K.el('text', { x: cx, y: capY + 12, 'text-anchor': 'middle', 'font-size': 10,
        'font-weight': 700, fill: c.purple, 'font-family': MONO }, content);
      ct.textContent = `cap ${capSeq}`;

      // the min() expression, spelled out
      const terms = ['visible ' + st.seq].concat(
        chain.slice(0, -1).map((i) => `anchor ${st.branches[i].anchor}`));
      const expr = K.el('text', { x: 18, y: Hh - 8, 'font-size': 9.5, fill: c.muted, 'font-family': MONO }, content);
      expr.textContent = `cap = min(${terms.join(', ')}) = ${capSeq}`;
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      const caps = capsFor(st.reader);
      stat('seq', st.seq);
      stat('branches', st.branches.length);
      stat('cap', caps.get(st.reader));
      stat('depth', chainOf(st.reader).length);
    }
    function refreshReaderOptions() {
      const sel = root.querySelector('.t-reader');
      sel.innerHTML = st.branches.map((b, i) =>
        `<option value="${i}"${i === st.reader ? ' selected' : ''}>${b.name}</option>`).join('');
    }

    // ---- actions ------------------------------------------------------------------------
    async function commit(onIdx) {
      if (st.busy) return; st.busy = true; setLock(true);
      const i = onIdx != null ? onIdx : Math.floor(st.rng() * st.branches.length);
      // Always exactly one: there is one counter, and every commit draws the next number from it.
      st.seq += 1;
      st.branches[i].writes.push(st.seq);
      if (st.branches[i].writes.length > 9) st.branches[i].writes.shift();
      drawScene(); render();
      K.addLog(logBody, `＋ ${st.branches[i].name} committed at sequence ${st.seq} — the number came from the `
        + `store's one counter, not from ${st.branches[i].name}'s own`, 'ok');
      await K.delay(dur(340));
      st.busy = false; setLock(false);
    }

    async function fork(fromIdx) {
      if (st.busy) return;
      if (st.branches.length >= MAXB) {
        K.addLog(logBody, '⑂ four lanes is all this stage fits — reset to start over', 'warn'); return;
      }
      st.busy = true; setLock(true);
      const from = fromIdx != null ? fromIdx : Math.floor(st.rng() * st.branches.length);
      const name = ['main', 'feature', 'sandbox', 'audit'][st.branches.length] || 'b' + st.branches.length;
      st.branches.push({ name, parent: from, anchor: st.seq, writes: [] });
      refreshReaderOptions();
      drawScene(); render();
      K.addLog(logBody, `⑂ ${name} forked from ${st.branches[from].name} at anchor ${st.seq} — nothing was copied; `
        + `${name} simply may never read ${st.branches[from].name} above ${st.seq}`, 'ok');
      await K.delay(dur(340));
      st.busy = false; setLock(false);
    }

    function setReader(i) {
      st.reader = i;
      const caps = capsFor(i);
      const chain = chainOf(i);
      const terms = ['visible ' + st.seq].concat(
        chain.slice(0, -1).map((j) => `anchor ${st.branches[j].anchor}`));
      drawScene(); render();
      K.addLog(logBody, `👁 reading as ${st.branches[i].name}: cap = min(${terms.join(', ')}) = ${caps.get(i)}`
        + ` — narrowed nearest-first down the chain`, 'hl');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        const r = st.rng();
        if (st.branches.length < MAXB && r < 0.26) await fork();
        else await commit();
        if (!st.playing) break;
        await K.delay(dur(620));
      }
    }
    function pause() { st.playing = false; pp(); }

    function reset() {
      const sp = st.speed;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 7;
      st = fresh(seed);
      st.speed = sp;
      refreshReaderOptions();
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset to seed ${seed} — same seed, same commits at the same sequences`, 'hl');
    }

    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-commit', '.t-fork', '.t-reader', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-commit').onclick = () => commit(st.reader);
      root.querySelector('.t-fork').onclick = () => fork(st.reader);
      root.querySelector('.t-reader').onchange = (e) => setReader(parseInt(e.target.value, 10) || 0);
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

  window.SKVOneClock = { init };
})();
