/**
 * SKV Per-Layer Caps (dst-kit) — why each layer's iterators are capped BEFORE the k-way merge.
 *
 * The post's point: a snapshot on a forked branch is a stack of layers, each carrying its own
 * visibility cap = min(snapshot seq, every fork anchor on the path to that ancestor). surrealkv wraps
 * every one of a layer's iterators in a SeqCappedIterator *before* they enter the merge, and the
 * comment in src/snapshot.rs says why: "per-layer fork caps cannot be expressed by the merged stream's
 * global snapshot filter." This widget runs the same three-layer merge both ways. With one global
 * filter, rows are emitted that no reader was ever allowed to see — and every one of them is
 * well formed, correctly ordered, and below the snapshot's own sequence. They are wrong only because
 * of WHICH LAYER supplied them, which is exactly the information the merged stream has already thrown
 * away. Exposes window.SKVPerLayerCaps.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-per-layer-caps: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-per-layer-caps: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 322;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const LY = [56, 128, 200], LH = 60;
  const COL = { src: 18, srcW: 258, gate: 286, gateW: 52, fun: 348, funW: 50, gf: 408, gfW: 50, out: 468, outW: 294 };
  const NAMES = ['own', 'parent', 'grandparent'];
  const ZONES = ['green', 'blue', 'gray'];
  const CAPS = [31, 19, 11];
  const MAXOUT = 7;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    // ---- deterministic scene ------------------------------------------------------------
    // The seed varies which user keys each layer holds and the sequence stamped on each row —
    // and therefore how many rows land in the LEAK WINDOW (caps[layer] < seq <= caps[0]), the
    // rows a global filter would wrongly pass. Generation then FORCES at least two into that
    // window, because a seed with no leak would make this widget argue for the bug.
    function fresh(seed) {
      const rng = K.rng(seed);
      const keys = ['user:1', 'user:2', 'user:3', 'user:4', 'user:5', 'user:6'];
      const layers = [[], [], []];
      for (let li = 0; li < 3; li++) {
        for (const key of keys) {
          if (rng() < 0.55) {
            const hi = li === 0 ? CAPS[0] : CAPS[0];       // any layer may hold a high sequence
            const seq = 2 + Math.floor(rng() * (hi - 1));
            layers[li].push({ key, seq, layer: li });
          }
        }
      }
      // force the interesting case: ≥2 ancestor rows strictly inside the leak window
      const inWindow = (r) => r.layer > 0 && r.seq > CAPS[r.layer] && r.seq <= CAPS[0];
      let leaks = layers.flat().filter(inWindow).length;
      for (let li = 1; li < 3 && leaks < 2; li++) {
        const cands = layers[li].filter((r) => !inWindow(r));
        for (const r of cands) {
          if (leaks >= 2) break;
          r.seq = CAPS[li] + 1 + Math.floor(rng() * Math.max(1, CAPS[0] - CAPS[li] - 1));
          if (inWindow(r)) leaks++;
        }
        if (!layers[li].length) {
          layers[li].push({ key: keys[li], seq: CAPS[li] + 3, layer: li });
          leaks++;
        }
      }
      // internal order: user key ASCENDING, then sequence DESCENDING within a key
      for (const l of layers) l.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : b.seq - a.seq));
      return { seed, rng, layers, cursors: [0, 0, 0], out: [], mode: 'per-layer',
               capped: 0, leaked: 0, busy: false, playing: false, speed: 1 };
    }
    let st = fresh(7);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    // ---- the merge ----------------------------------------------------------------------
    function head(li) { return st.layers[li][st.cursors[li]] || null; }
    function pickBest() {
      let best = -1;
      for (let li = 0; li < 3; li++) {
        const h = head(li); if (!h) continue;
        const b = best < 0 ? null : head(best);
        if (!b || h.key < b.key || (h.key === b.key && h.seq > b.seq)) best = li;
      }
      return best;
    }
    function exhausted() { return pickBest() < 0; }

    // One pop of the real k-way merge. Returns a description of what happened.
    function pop() {
      while (true) {
        const li = pickBest();
        if (li < 0) return null;
        const row = st.layers[li][st.cursors[li]];
        st.cursors[li]++;
        const overLayerCap = row.seq > CAPS[li];
        if (st.mode === 'per-layer') {
          if (overLayerCap) { st.capped++; return { row, li, dropped: true }; }
          return { row, li, dropped: false, leaked: false };
        }
        // one global filter on the merged stream: it only knows the snapshot's own sequence
        if (row.seq > CAPS[0]) { st.capped++; return { row, li, dropped: true }; }
        const leaked = overLayerCap;
        if (leaked) st.leaked++;
        return { row, li, dropped: false, leaked };
      }
    }

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      const other = st.mode === 'per-layer' ? '⇄ Switch to one global filter' : '⇄ Switch back to per-layer caps';
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step merge</button>
        <button class="dstk-btn dstk-btn--amber t-mode">${other}</button></div>
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
        title: 'Where the cap is applied', sub: 'per layer before the merge, or once on the merged stream',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'emitted', label: 'emitted' }, { id: 'capped', label: 'capped out' },
                { id: 'leaked', label: 'leaked' }, { id: 'mode', label: 'mode' }],
        cap: 'Step the merge with per-layer caps, then switch to one global filter and step again. The leaked rows '
           + "are not malformed, misordered, or above the snapshot's own sequence — they are wrong purely because of "
           + 'which layer supplied them, and by the time the streams interleave that fact is gone.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 step to the end with per-layer caps, then flip the mode and step again', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function drawScene() {
      content.innerHTML = '';
      const intro = K.el('text', { x: 18, y: 18, 'font-size': 10.5, fill: c.muted }, content);
      intro.textContent = 'Three layers of one read stack. Within a key, versions arrive sequence-DESCENDING.';
      const mode = K.el('text', { x: 18, y: 40, 'font-size': 10.5, 'font-weight': 700,
        fill: st.mode === 'per-layer' ? c.green : c.red }, content);
      mode.textContent = st.mode === 'per-layer'
        ? 'as built — every layer gated at its own cap, upstream of the merge'
        : 'one global filter — a single ≤ 31 test on the merged stream';

      // source layers
      for (let li = 0; li < 3; li++) {
        const y = LY[li], zone = ZONES[li];
        K.el('rect', { x: COL.src, y, width: COL.srcW, height: LH, rx: 7, fill: 'none',
          stroke: c.separator, 'stroke-width': 1 }, content);
        K.el('rect', { x: COL.src + 6, y: y + 7, width: 74, height: 22, rx: 4, fill: K.grad(uid, zone),
          stroke: c[zone], 'stroke-width': 1.3 }, content);
        const cl = K.el('text', { x: COL.src + 12, y: y + 22, 'font-size': 9.5, 'font-weight': 700,
          fill: c[zone], 'font-family': MONO }, content);
        cl.textContent = `cap ${CAPS[li]}`;
        const nl = K.el('text', { x: COL.src + 12, y: y + 46, 'font-size': 9, fill: c[zone], opacity: 0.85 }, content);
        nl.textContent = NAMES[li];
        // pending entries
        const pending = st.layers[li].slice(st.cursors[li]);
        let x = COL.src + 88;
        for (let i = 0; i < Math.min(2, pending.length); i++) {
          const r = pending[i];
          const over = r.seq > CAPS[li];
          K.el('rect', { x, y: y + 12, width: 78, height: 34, rx: 5, fill: K.grad(uid, zone),
            stroke: over ? c.red : c[zone], 'stroke-width': over ? 1.7 : 1.2 }, content);
          const t = K.el('text', { x: x + 39, y: y + 26, 'text-anchor': 'middle', 'font-size': 9.5,
            'font-weight': 700, fill: over ? c.red : c[zone], 'font-family': MONO }, content);
          t.textContent = r.key;
          const s = K.el('text', { x: x + 39, y: y + 39, 'text-anchor': 'middle', 'font-size': 9,
            fill: over ? c.red : c[zone], opacity: 0.85, 'font-family': MONO }, content);
          s.textContent = 's' + r.seq;
          x += 84;
        }
        if (pending.length > 2) {
          const t = K.el('text', { x: x + 4, y: y + 34, 'font-size': 9, fill: c.muted }, content);
          t.textContent = `+${pending.length - 2}`;
        }
        if (!pending.length) {
          const t = K.el('text', { x: COL.src + 96, y: y + 34, 'font-size': 9.5, fill: c.muted }, content);
          t.textContent = 'exhausted';
        }

        // per-layer gate
        const gateOn = st.mode === 'per-layer';
        K.el('rect', { x: COL.gate, y: y + 18, width: COL.gateW, height: 24, rx: 5,
          fill: gateOn ? K.grad(uid, 'purple') : 'none', stroke: gateOn ? c.purple : c.muted,
          'stroke-width': gateOn ? 1.6 : 1, 'stroke-dasharray': gateOn ? '' : '4 3' }, content);
        const gt = K.el('text', { x: COL.gate + COL.gateW / 2, y: y + 34, 'text-anchor': 'middle',
          'font-size': 9.5, 'font-weight': 700, fill: gateOn ? c.purple : c.muted, 'font-family': MONO }, content);
        gt.textContent = gateOn ? `≤ ${CAPS[li]}` : 'pass';
      }

      // funnel
      K.el('rect', { x: COL.fun, y: LY[0], width: COL.funW, height: LY[2] + LH - LY[0], rx: 7,
        fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.4 }, content);
      for (const [t, dy] of [['k-way', -8], ['merge', 6]]) {
        const e = K.el('text', { x: COL.fun + COL.funW / 2, y: (LY[0] + LY[2] + LH) / 2 + dy,
          'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: c.gray }, content);
        e.textContent = t;
      }

      // the single global filter, only in the wrong mode
      if (st.mode === 'global') {
        const my = (LY[0] + LY[2] + LH) / 2 - 14;
        K.el('rect', { x: COL.gf, y: my, width: COL.gfW, height: 28, rx: 5, fill: K.grad(uid, 'purple'),
          stroke: c.purple, 'stroke-width': 1.6 }, content);
        const t = K.el('text', { x: COL.gf + COL.gfW / 2, y: my + 18, 'text-anchor': 'middle',
          'font-size': 10, 'font-weight': 700, fill: c.purple, 'font-family': MONO }, content);
        t.textContent = `≤ ${CAPS[0]}`;
      }

      // emitted stream
      K.el('rect', { x: COL.out, y: LY[0] - 4, width: COL.outW, height: LY[2] + LH - LY[0] + 8, rx: 7,
        fill: 'none', stroke: c.separator, 'stroke-width': 1 }, content);
      const ol = K.el('text', { x: COL.out + 8, y: LY[0] - 10, 'font-size': 9.5, fill: c.muted }, content);
      ol.textContent = 'emitted to the reader';
      let oy = LY[0] + 4;
      for (const e of st.out.slice(-MAXOUT)) {
        const bad = e.leaked;
        K.el('rect', { x: COL.out + 8, y: oy, width: COL.outW - 16, height: 24, rx: 4,
          fill: bad ? K.grad(uid, 'red') : K.grad(uid, ZONES[e.li]),
          stroke: bad ? c.red : c[ZONES[e.li]], 'stroke-width': bad ? 2 : 1.1 }, content);
        const t = K.el('text', { x: COL.out + 16, y: oy + 16, 'font-size': 9.5,
          fill: bad ? c.red : c[ZONES[e.li]], 'font-family': MONO }, content);
        t.textContent = `${e.row.key} · s${e.row.seq} · ${NAMES[e.li]}`;
        if (bad) {
          const w = K.el('text', { x: COL.out + COL.outW - 16, y: oy + 16, 'text-anchor': 'end',
            'font-size': 8.5, fill: c.red }, content);
          w.textContent = 'never visible here';
        }
        oy += 27;
      }

      // verdict
      const vy = LY[2] + LH + 14;
      const bad = st.leaked > 0;
      K.el('rect', { x: 18, y: vy, width: 744, height: 26, rx: 6,
        fill: bad ? K.grad(uid, 'red') : K.grad(uid, 'green'), stroke: bad ? c.red : c.green,
        'stroke-width': 1.4 }, content);
      const vt = K.el('text', { x: 28, y: vy + 17, 'font-size': 10, 'font-weight': 600,
        fill: bad ? c.red : c.green }, content);
      vt.textContent = bad
        ? `${st.leaked} of ${st.out.length} emitted rows were never visible to this reader — and every one of them is a real, correctly ordered row`
        : `${st.out.length} rows emitted, ${st.capped} capped out at their own layer — nothing this reader could not see`;

      const foot = K.el('text', { x: 18, y: Hh - 8, 'font-size': 9.5, fill: c.muted }, content);
      foot.textContent = 'A capped iterator walks a key’s above-cap versions down to its visible one. A filter placed after the merge has already let another layer’s row win the key.';
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      stat('emitted', st.out.length);
      stat('capped', st.capped);
      stat('leaked', st.leaked);
      stat('mode', st.mode === 'per-layer' ? 'per layer' : 'global');
    }

    // ---- actions ------------------------------------------------------------------------
    async function step() {
      if (st.busy) return;
      if (exhausted()) {
        K.addLog(logBody, '⏹ every layer is exhausted — flip the mode, or reset with a new seed', 'warn');
        return;
      }
      st.busy = true; setLock(true);
      const r = pop();
      if (r) {
        if (r.dropped) {
          K.addLog(logBody, `⏭ ${r.row.key} · s${r.row.seq} came off the ${NAMES[r.li]} layer, whose cap is `
            + `${CAPS[r.li]} — dropped before it reached the funnel`, 'ok');
        } else {
          st.out.push(r);
          if (r.leaked) {
            K.addLog(logBody, `⇄ ${r.row.key} · s${r.row.seq} passed: s${r.row.seq} ≤ ${CAPS[0]}, the snapshot's own `
              + `sequence — but the ${NAMES[r.li]} layer's cap is ${CAPS[r.li]}, and the merged stream no longer `
              + `knows which layer it came from`, 'err');
          } else {
            K.addLog(logBody, `⏭ ${r.row.key} · s${r.row.seq} emitted from the ${NAMES[r.li]} layer — `
              + `s${r.row.seq} ≤ ${CAPS[r.li]}, so this reader is allowed to see it`, 'ok');
          }
        }
      }
      drawScene(); render();
      await K.delay(dur(340));
      st.busy = false; setLock(false);
    }

    function switchMode() {
      st.mode = st.mode === 'per-layer' ? 'global' : 'per-layer';
      st.cursors = [0, 0, 0]; st.out = []; st.capped = 0; st.leaked = 0;
      root.querySelector('.t-mode').textContent = st.mode === 'per-layer'
        ? '⇄ Switch to one global filter' : '⇄ Switch back to per-layer caps';
      drawScene(); render();
      K.addLog(logBody, st.mode === 'global'
        ? '⇄ one global filter on the merged stream — the same three layers, replayed. Step to the end.'
        : '⇄ back to per-layer caps, applied before the merge — replayed from the start.', 'hl');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing && !exhausted()) { await step(); if (!st.playing) break; await K.delay(dur(420)); }
      st.playing = false; pp();
    }
    function pause() { st.playing = false; pp(); }

    function reset() {
      const sp = st.speed, mode = st.mode;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 7;
      st = fresh(seed);
      st.speed = sp; st.mode = mode;
      root.querySelector('.t-mode').textContent = st.mode === 'per-layer'
        ? '⇄ Switch to one global filter' : '⇄ Switch back to per-layer caps';
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset to seed ${seed} — same keys, same sequences, same leak window`, 'hl');
    }

    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-mode', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-step').onclick = step;
      root.querySelector('.t-mode').onclick = switchMode;
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

  window.SKVPerLayerCaps = { init };
})();
