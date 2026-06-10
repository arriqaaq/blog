/**
 * RollingNetworkClog (re-skinned via dst-kit) — the FoundationDB swizzle-clog wave.
 * A ring of 5 nodes (purple) with links between neighbors. The wave HOLDs the chosen links
 * one-by-one in a seeded "clog" order (LinkState::Hold — parked packets buffer with glow, NOT
 * dropped), then RELEASEs them in a DIFFERENT seeded order so the jam clears asymmetrically
 * (LinkState::Healthy again — parked packets burst out). Same seed ⇒ same wave.
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
  const CX = 250, CY = 150, R = 108; // ring geometry
  const NR = 26;                     // node radius

  // node i sits at angle around the ring (start at top, go clockwise)
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const nx = (i) => CX + R * Math.cos(ang(i));
  const ny = (i) => CY + R * Math.sin(ang(i));
  // link l connects node l to node (l+1)%N
  const linkA = (l) => l;
  const linkB = (l) => (l + 1) % N;
  // midpoint of a link, nudged outward so the buffer chip sits clear of the ring
  function linkMid(l) {
    const ax = nx(linkA(l)), ay = ny(linkA(l)), bx = nx(linkB(l)), by = ny(linkB(l));
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const ox = mx - CX, oy = my - CY; const len = Math.hypot(ox, oy) || 1;
    return { x: mx + (ox / len) * 22, y: my + (oy / len) * 22, mx, my };
  }

  // Fisher–Yates shuffle driven by a seeded mulberry32 — deterministic per seed.
  function shuffled(rng) {
    const a = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

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

    build();

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
        title: 'RollingNetworkClog', sub: 'the swizzle-clog wave clears out of order',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'clogged', label: 'clogged' }, { id: 'released', label: 'released' }],
        cap: 'A swizzle-clog <em>holds</em> links (not drops) in one seeded order, then releases them in a ' +
          'different one — so the jam clears asymmetrically. The interesting bugs live in recovery from ' +
          'partial connectivity, not in the failure itself.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      regen();
      drawScene(); bind(); render();
    }

    // Build the deterministic two-phase script from the seed.
    function regen() {
      const r1 = K.rng(st.seed >>> 0);
      const r2 = K.rng((st.seed >>> 0) ^ 0x9e3779b9);   // distinct stream ⇒ different order
      st.clogOrder = shuffled(r1);
      st.releaseOrder = shuffled(r2);
      st.script = st.clogOrder.map((l) => ({ op: 'hold', link: l }))
        .concat(st.releaseOrder.map((l) => ({ op: 'release', link: l })));
      st.links = Array.from({ length: N }, () => 'healthy');
      st.cursor = 0; st.clogged = 0; st.released = 0;
    }

    function id(k, i) { return `${uid}-${k}-${i}`; }
    function E(k, i) { return svg.querySelector('#' + CSS.escape(id(k, i))); }

    function drawScene() {
      content.innerHTML = '';
      // links first (under the nodes)
      for (let l = 0; l < N; l++) {
        const ax = nx(linkA(l)), ay = ny(linkA(l)), bx = nx(linkB(l)), by = ny(linkB(l));
        K.el('line', { id: id('link', l), x1: ax, y1: ay, x2: bx, y2: by,
          stroke: c.gray, 'stroke-width': 3, 'stroke-linecap': 'round',
          'marker-end': K.arrow(uid, 'gray') }, content);
        // buffer chip (parked packets) — hidden until the link is held
        const m = linkMid(l);
        const g = K.el('g', { id: id('buf', l), opacity: 0 }, content);
        K.el('rect', { x: m.x - 17, y: m.y - 11, width: 34, height: 22, rx: 6,
          fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.4 }, g);
        for (let p = 0; p < 3; p++) {
          K.el('circle', { id: id('park', l * 10 + p), cx: m.x - 9 + p * 9, cy: m.y, r: 3.4,
            fill: c.amber, filter: K.glow(uid) }, g);
        }
      }
      // nodes on top
      for (let i = 0; i < N; i++) {
        const x = nx(i), y = ny(i);
        K.el('circle', { id: id('node', i), cx: x, cy: y, r: NR,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 2 }, content);
        K.el('text', { x, y: y + 5, 'text-anchor': 'middle', fill: c.text,
          'font-size': 14, 'font-weight': 700 }, content).textContent = 'n' + i;
      }
      // legend panel on the right
      const lx = 470, ly = 40;
      K.el('text', { x: lx, y: ly, fill: c.muted, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'LinkState';
      const leg = [['Healthy', c.gray], ['Hold (clogged)', c.amber], ['Released', c.green]];
      leg.forEach((row, i) => {
        const ry = ly + 20 + i * 22;
        K.el('line', { x1: lx, y1: ry, x2: lx + 26, y2: ry, stroke: row[1], 'stroke-width': 3, 'stroke-linecap': 'round' }, content);
        K.el('text', { x: lx + 34, y: ry + 4, fill: c.text, 'font-size': 11 }, content).textContent = row[0];
      });
      // teaching code snippet (real dst idioms)
      const codeHTML = K.highlightRust(
        'enum LinkState { Healthy, Hold, Partitioned }\n' +
        '// swizzle: hold links in one order ...\n' +
        'for l in clog_order { net.set(l, LinkState::Hold); }\n' +
        '// ... release them in a different one\n' +
        'for l in release_order { net.set(l, LinkState::Healthy); }');
      const fo = K.el('foreignObject', { x: 462, y: 122, width: 304, height: 150 }, content);
      const div = document.createElement('div'); div.innerHTML = codeHTML; fo.appendChild(div);
    }

    function render() {
      stat('clogged', st.clogged);
      stat('released', st.released);
      for (let l = 0; l < N; l++) {
        const ln = E('link', l), buf = E('buf', l);
        if (st.links[l] === 'hold') {
          ln.setAttribute('stroke', c.amber);
          ln.setAttribute('stroke-dasharray', '6 5');
          ln.setAttribute('marker-end', K.arrow(uid, 'amber'));
          buf.setAttribute('opacity', '1');
        } else {
          ln.setAttribute('stroke', c.gray);
          ln.removeAttribute('stroke-dasharray');
          ln.setAttribute('marker-end', K.arrow(uid, 'gray'));
          buf.setAttribute('opacity', '0');
        }
      }
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    // Advance one entry in the clog→release script.
    async function stepOnce() {
      if (st.busy) return false;
      if (st.cursor >= st.script.length) {
        K.addLog(logBody, '✓ wave complete — ring fully recovered', 'ok');
        return false;
      }
      st.busy = true; setLock(true);
      const { op, link } = st.script[st.cursor++];
      if (op === 'hold') await doHold(link);
      else await doRelease(link);
      render();
      st.busy = false; setLock(false);
      return true;
    }

    async function doHold(l) {
      st.links[l] = 'hold'; st.clogged++;
      const ln = E('link', l), buf = E('buf', l);
      ln.setAttribute('stroke', c.amber);
      ln.setAttribute('stroke-dasharray', '6 5');
      ln.setAttribute('marker-end', K.arrow(uid, 'amber'));
      await animate(ln, { strokeWidth: [3, 6, 3.5], opacity: [1, 0.55, 1], duration: dur(260), ease: 'inOut(2)' });
      // parked packets pop into the buffer with glow
      buf.setAttribute('opacity', '1');
      animate(buf, { opacity: [0, 1], duration: dur(180), ease: 'out(2)' });
      for (let p = 0; p < 3; p++) {
        const dot = E('park', l * 10 + p);
        animate(dot, { r: [0, 3.4], duration: dur(220), delay: p * 60, ease: 'out(2)' });
      }
      K.addLog(logBody, `HOLD link n${linkA(l)}↔n${linkB(l)} — packets parked (not dropped)`, 'warn');
    }

    async function doRelease(l) {
      const ln = E('link', l), buf = E('buf', l), m = linkMid(l);
      // released link flashes green
      ln.setAttribute('stroke', c.green);
      ln.removeAttribute('stroke-dasharray');
      ln.setAttribute('marker-end', K.arrow(uid, 'green'));
      animate(ln, { strokeWidth: [3.5, 6, 3], opacity: [1, 0.6, 1], duration: dur(300), ease: 'out(2)' });
      // parked packets burst out toward both endpoints
      const burst = [];
      for (let p = 0; p < 3; p++) {
        const tgt = p % 2 === 0 ? linkA(l) : linkB(l);
        burst.push(fly(m.x - 9 + p * 9, m.y, nx(tgt), ny(tgt), c.green, p * 50));
      }
      animate(buf, { opacity: [1, 0], duration: dur(240), ease: 'out(2)' });
      await Promise.all(burst);
      st.links[l] = 'healthy'; st.released++;
      ln.setAttribute('stroke', c.gray);
      ln.setAttribute('marker-end', K.arrow(uid, 'gray'));
      flashNode(linkA(l)); flashNode(linkB(l));
      K.addLog(logBody, `RELEASE link n${linkA(l)}↔n${linkB(l)} — jam drains`, 'ok');
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
      drawScene(); render();
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · same seed ⇒ same wave', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    K.addLog(logBody, '🌱 ready — seed ' + st.seed + ' · same seed ⇒ same wave', 'hl');
    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTRollingClog = { init };
})();
