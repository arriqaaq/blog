/**
 * RollingNetworkClog (re-skinned via dst-kit) — the FoundationDB swizzle-clog wave.
 * A ring of 5 nodes (purple) with links between neighbors. The wave HOLDs the chosen links
 * one-by-one in a seeded "clog" order (LinkState::Hold — parked packets buffer with glow, NOT
 * dropped), then RELEASEs them in a DIFFERENT seeded order so the jam clears asymmetrically
 * (LinkState::Healthy again — parked packets burst out). Same seed ⇒ same wave.
 *
 * Source: dst crate, src/patterns/swizzle_clog.rs. NotStarted shuffles the source nodes
 * (candidates.shuffle(rng.inner_mut()), L46), holds every resulting pair in array order during
 * Clogging (sim.hold, L79), then Unclogging RE-SHUFFLES that exact clogged list for the release
 * order (unclog_order = clogged.clone(), L84; unclog_order.shuffle(rng.inner_mut()), L85) and
 * sim.release()s in the new order (L104). Both shuffles draw from ONE seeded Prng, so the seed
 * pins down BOTH the clog sequence and the (different) release sequence. LinkState is
 * { Healthy, Hold, Partitioned } (src/topology/link.rs L19-22); Hold buffers packets in a
 * VecDeque (L21) and release() drains them back (L112-119) rather than dropping. This widget is a
 * SIMPLIFIED re-skin: it models a ring of N neighbour links and uses two fresh seeded shuffles of
 * [0..N] (one mulberry32 stream) for the clog and release orders — so the seed reproduces both
 * differing orders, the same way one Prng pins both orders in the real pattern.
 * Exposes window.DSTRollingClog.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('rolling-clog: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('rolling-clog: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 300;
  const N = 5;                       // ring of 5 nodes
  const CX = 168, CY = 168, R = 96;  // ring geometry (left side)
  const NR = 24;                     // node radius

  // node i sits at angle around the ring (start at top, go clockwise)
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const nx = (i) => CX + R * Math.cos(ang(i));
  const ny = (i) => CY + R * Math.sin(ang(i));
  // link l connects node l to node (l+1)%N
  const linkA = (l) => l;
  const linkB = (l) => (l + 1) % N;
  const linkLabel = (l) => `n${linkA(l)}–n${linkB(l)}`;
  // midpoint of a link, nudged outward so the buffer chip sits clear of the ring
  function linkMid(l) {
    const ax = nx(linkA(l)), ay = ny(linkA(l)), bx = nx(linkB(l)), by = ny(linkB(l));
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const ox = mx - CX, oy = my - CY; const len = Math.hypot(ox, oy) || 1;
    return { x: mx + (ox / len) * 20, y: my + (oy / len) * 20, mx, my };
  }

  // Fisher–Yates shuffle driven by a seeded mulberry32 — deterministic per seed.
  function shuffled(rng) {
    const a = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // ── order-strip geometry (right column: shows the two seeded sequences) ──
  const ORD = { x: 360, w: 400, cellW: 52, cellH: 30, gap: 8 };
  const cellX = (slot) => ORD.x + 86 + slot * (ORD.cellW + ORD.gap);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      seed: 7, speed: 1,
      clogOrder: [], releaseOrder: [],   // two different seeded permutations of links
      links: [],                          // per-link state: 'healthy' | 'hold'
      cursor: 0,                          // index into the combined clog→release script
      script: [],                         // [{op:'hold'|'release', link}]
      clogged: 0, released: 0,
      playing: false, busy: false,
    };
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play wave</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span><input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Links clog in one order and clear in another — same seed replays the exact wave',
        sub: 'a ring of 5 links · hold them, then release them',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'held', label: 'links held' }, { id: 'cleared', label: 'links cleared' }],
        cap: 'A link can be <em>held</em> (jammed — packets park, nothing dropped) or <em>clear</em>. '
          + 'The wave holds all 5 links in one seeded order, then clears them in a <em>different</em> seeded '
          + 'order — so the jam unwinds asymmetrically. Re-run with the same seed and you get the exact same wave.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      regen();
      drawScene(); bind(); render(); setPhase(-1);
      K.addLog(logBody, '🌱 ready — seed ' + st.seed + ' · Step to start the wave', 'hl');
    }

    // Build the deterministic two-phase script from the seed.
    // Both shuffles draw from ONE seeded stream (mirrors the real pattern: one Prng shuffles the
    // nodes that get clogged, then re-shuffles the clogged list to pick the release order).
    function regen() {
      const r = K.rng(st.seed >>> 0);
      st.clogOrder = shuffled(r);
      st.releaseOrder = shuffled(r);   // second draw from the same stream ⇒ different order
      st.script = st.clogOrder.map((l) => ({ op: 'hold', link: l }))
        .concat(st.releaseOrder.map((l) => ({ op: 'release', link: l })));
      st.links = Array.from({ length: N }, () => 'healthy');
      st.cursor = 0; st.clogged = 0; st.released = 0;
    }

    function id(k, i) { return `${uid}-${k}-${i}`; }
    function E(k, i) { return svg.querySelector('#' + CSS.escape(id(k, i))); }

    // ── phase strip: ① clog → ② release (lights up as the wave runs) ──
    const PHASES = [
      { t: '① clog: hold links', zone: 'amber' },
      { t: '② release: clear links', zone: 'green' },
    ];
    const PX = { x0: 20, y: 14, w: 168, h: 26, gap: 12 };
    const phaseX = (i) => PX.x0 + i * (PX.w + PX.gap);

    function drawScene() {
      content.innerHTML = '';

      // phase pills across the top
      PHASES.forEach((p, i) => {
        K.el('rect', { id: id('pill', i), x: phaseX(i), y: PX.y, width: PX.w, height: PX.h, rx: 7,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: id('pilltext', i), x: phaseX(i) + PX.w / 2, y: PX.y + PX.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = p.t;
        if (i < PHASES.length - 1) K.el('text', { x: phaseX(i) + PX.w + PX.gap / 2, y: PX.y + PX.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 12 }, content).textContent = '→';
      });

      // links first (under the nodes)
      for (let l = 0; l < N; l++) {
        const ax = nx(linkA(l)), ay = ny(linkA(l)), bx = nx(linkB(l)), by = ny(linkB(l));
        K.el('line', { id: id('link', l), x1: ax, y1: ay, x2: bx, y2: by,
          stroke: c.gray, 'stroke-width': 3, 'stroke-linecap': 'round' }, content);
        // buffer chip (parked packets) — hidden until the link is held
        const m = linkMid(l);
        const g = K.el('g', { id: id('buf', l), opacity: 0 }, content);
        K.el('rect', { x: m.x - 16, y: m.y - 10, width: 32, height: 20, rx: 6,
          fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.4 }, g);
        for (let p = 0; p < 3; p++) {
          K.el('circle', { id: id('park', l * 10 + p), cx: m.x - 8 + p * 8, cy: m.y, r: 3.2,
            fill: c.amber, filter: K.glow(uid) }, g);
        }
      }
      // nodes on top
      for (let i = 0; i < N; i++) {
        const x = nx(i), y = ny(i);
        K.el('circle', { id: id('node', i), cx: x, cy: y, r: NR,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 2 }, content);
        K.el('text', { x, y: y + 5, 'text-anchor': 'middle', fill: c.text,
          'font-size': 13, 'font-weight': 700 }, content).textContent = 'n' + i;
      }

      // ── the two seeded order-strips (the whole point: they DIFFER) ──
      drawOrderStrip(0, 'hold order', st.clogOrder, 'amber');
      drawOrderStrip(1, 'clear order', st.releaseOrder, 'green');

      // loud verdict banner under the strips (hidden until the wave completes)
      const vg = K.el('g', { id: id('verdict', 0), opacity: 0 }, content);
      K.el('rect', { id: id('vbox', 0), x: ORD.x, y: 224, width: ORD.w, height: 56, rx: 9,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, vg);
      K.el('text', { id: id('vtitle', 0), x: ORD.x + ORD.w / 2, y: 247, 'text-anchor': 'middle',
        fill: c.green, 'font-size': 13, 'font-weight': 700 }, vg).textContent = '';
      K.el('text', { id: id('vsub', 0), x: ORD.x + ORD.w / 2, y: 266, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 10 }, vg).textContent = '';
    }

    // one labelled row of cells; cells fill in (with the link name) in sequence order as the wave runs
    function drawOrderStrip(row, label, order, zone) {
      const y = 70 + row * (ORD.cellH + 26);
      const accent = c[zone];
      K.el('text', { x: ORD.x, y: y + ORD.cellH / 2 + 4, fill: accent, 'font-size': 11, 'font-weight': 700 }, content)
        .textContent = label;
      K.el('text', { x: ORD.x, y: y - 6, fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = row === 0 ? 'seeded sequence ①' : 'seeded sequence ②';
      for (let slot = 0; slot < N; slot++) {
        K.el('rect', { id: id('ocell-' + row, slot), x: cellX(slot), y, width: ORD.cellW, height: ORD.cellH, rx: 5,
          fill: c.separator, 'fill-opacity': 0.35, stroke: c.separator, 'stroke-width': 1 }, content);
        K.el('text', { id: id('otext-' + row, slot), x: cellX(slot) + ORD.cellW / 2, y: y + ORD.cellH / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 11, 'font-weight': 700,
          'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
      }
    }

    // fill the next empty slot of a strip with the link that just changed state
    function fillStrip(row, slot, link, zone) {
      const r = E('ocell-' + row, slot), t = E('otext-' + row, slot), accent = c[zone];
      r.setAttribute('fill', accent); r.setAttribute('fill-opacity', 0.18);
      r.setAttribute('stroke', accent); r.setAttribute('stroke-width', 1.6);
      t.setAttribute('fill', accent); t.textContent = linkLabel(link);
      animate(r, { opacity: [0.2, 1], duration: dur(160), ease: 'out(2)' });
    }

    function setPhase(k) {
      PHASES.forEach((p, i) => {
        const r = E('pill', i), t = E('pilltext', i); if (!r) return;
        const on = i === k;
        r.setAttribute('fill', on ? K.grad(uid, p.zone) : 'none');
        r.setAttribute('stroke', on ? c[p.zone] : c.separator);
        r.setAttribute('stroke-width', on ? 2.2 : 1.4);
        if (on) r.setAttribute('filter', K.glow(uid)); else r.removeAttribute('filter');
        t.setAttribute('fill', on ? c[p.zone] : c.muted);
      });
    }

    function render() {
      stat('held', st.clogged);
      stat('cleared', st.released);
      for (let l = 0; l < N; l++) {
        const ln = E('link', l), buf = E('buf', l);
        if (st.links[l] === 'hold') {
          ln.setAttribute('stroke', c.amber);
          ln.setAttribute('stroke-dasharray', '6 5');
          buf.setAttribute('opacity', '1');
        } else {
          ln.setAttribute('stroke', c.gray);
          ln.removeAttribute('stroke-dasharray');
          buf.setAttribute('opacity', '0');
        }
      }
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    // Advance one entry in the clog→release script.
    async function stepOnce() {
      if (st.busy) return false;
      if (st.cursor >= st.script.length) { showVerdict(); return false; }
      st.busy = true; setLock(true);
      const entry = st.script[st.cursor];
      // light the phase pill for what we're about to do
      setPhase(entry.op === 'hold' ? 0 : 1);
      st.cursor++;
      if (entry.op === 'hold') {
        await doHold(entry.link);
        fillStrip(0, st.clogged - 1, entry.link, 'amber');
      } else {
        await doRelease(entry.link);
        fillStrip(1, st.released - 1, entry.link, 'green');
      }
      render();
      if (st.cursor >= st.script.length) { setPhase(-1); showVerdict(); }
      st.busy = false; setLock(false);
      return st.cursor < st.script.length;
    }

    async function doHold(l) {
      st.links[l] = 'hold'; st.clogged++;
      const ln = E('link', l), buf = E('buf', l);
      ln.setAttribute('stroke', c.amber);
      ln.setAttribute('stroke-dasharray', '6 5');
      await animate(ln, { strokeWidth: [3, 6, 3.5], opacity: [1, 0.55, 1], duration: dur(260), ease: 'inOut(2)' });
      // parked packets pop into the buffer with glow
      buf.setAttribute('opacity', '1');
      animate(buf, { opacity: [0, 1], duration: dur(180), ease: 'out(2)' });
      for (let p = 0; p < 3; p++) {
        const dot = E('park', l * 10 + p);
        animate(dot, { r: [0, 3.2], duration: dur(220), delay: p * 60, ease: 'out(2)' });
      }
      K.addLog(logBody, `① hold ${linkLabel(l)} — jammed, packets park (not dropped)`, 'warn');
    }

    async function doRelease(l) {
      const ln = E('link', l), buf = E('buf', l), m = linkMid(l);
      // released link flashes green
      ln.setAttribute('stroke', c.green);
      ln.removeAttribute('stroke-dasharray');
      animate(ln, { strokeWidth: [3.5, 6, 3], opacity: [1, 0.6, 1], duration: dur(300), ease: 'out(2)' });
      // parked packets burst out toward both endpoints
      const burst = [];
      for (let p = 0; p < 3; p++) {
        const tgt = p % 2 === 0 ? linkA(l) : linkB(l);
        burst.push(fly(m.x - 8 + p * 8, m.y, nx(tgt), ny(tgt), c.green, p * 50));
      }
      animate(buf, { opacity: [1, 0], duration: dur(240), ease: 'out(2)' });
      await Promise.all(burst);
      st.links[l] = 'healthy'; st.released++;
      ln.setAttribute('stroke', c.gray);
      flashNode(linkA(l)); flashNode(linkB(l));
      K.addLog(logBody, `② clear ${linkLabel(l)} — jam drains, link healthy`, 'ok');
    }

    function showVerdict() {
      const g = E('verdict', 0); if (!g || +g.getAttribute('opacity') === 1) return;
      E('vtitle', 0).textContent = '✓ same seed → same hold order AND same clear order';
      E('vsub', 0).textContent = 'two different seeded sequences, one reproducible wave — Reset and re-run to replay it exactly';
      animate(g, { opacity: [0, 1], duration: dur(360), ease: 'out(2)' });
      K.addLog(logBody, '✓ wave complete — seed ' + st.seed + ' replays this exact hold+clear wave', 'ok');
    }

    async function fly(sx, sy, tx, ty, color, dl) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 4, fill: color, filter: K.glow(uid) }, anim);
      if (dl) await K.delay(dur(dl));
      await animate(dot, { cx: tx, cy: ty, duration: dur(300), ease: 'inOutQuad' });
      await animate(dot, { r: [4, 9], opacity: [1, 0], duration: dur(150), ease: 'out(2)' });
      dot.remove();
    }
    function flashNode(i) { const n = E('node', i); animate(n, { opacity: [1, 0.5, 1], duration: dur(260), ease: 'inOut(2)' }); }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 0; reset(); };
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        const more = await stepOnce();
        if (!more || !st.playing) break;
        await K.delay(dur(380));
      }
      st.playing = false; pp();
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      regen(); st.busy = false; setLock(false);
      drawScene(); render(); setPhase(-1);
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · same seed ⇒ same wave', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTRollingClog = { init };
})();
