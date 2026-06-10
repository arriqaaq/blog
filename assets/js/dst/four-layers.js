/**
 * DST Four Layers of Determinism — each tier intercepts one source of chaos.
 *
 * Non-determinism has four sources, each neutralized by one layer over a seeded Foundation:
 *   Foundation — seeded PRNG (ChaCha8, SHA-256 domain-separated)
 *   Layer 1    — single-threaded driver        (kills thread-scheduling nondeterminism)
 *   Layer 2    — paused virtual time            (kills wall-clock races)
 *   Layer 3    — seeded network                 (deterministic loss / latency / order)
 *   Layer 4    — OS-hook interception           (kills dependency back-channels to the real OS)
 * Fire a "gremlin" for a given source and watch the matching tier catch it. Disable a tier and the
 * gremlin slips through to the top — the run diverges. Teaches why every tier is load-bearing.
 *
 * Re-skinned with dst-kit (window.DSTKit). Exposes window.DSTFourLayers.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('four-layers: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('four-layers: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 740, H = 400;

  // tiers top→bottom in array order; index 0 = Layer 4 (OS, top), last = Foundation (bottom)
  const TIERS = [
    { key: 'os',    label: 'Layer 4 · OS-hook interception',    kills: "a dependency's direct syscall to the real OS",       zone: 'red' },
    { key: 'net',   label: 'Layer 3 · seeded network',           kills: 'nondeterministic packet loss / latency / order',     zone: 'blue' },
    { key: 'time',  label: 'Layer 2 · paused virtual time',      kills: 'wall-clock reads and timing races',                  zone: 'amber' },
    { key: 'sched', label: 'Layer 1 · single-threaded driver',   kills: 'OS thread-scheduling order',                        zone: 'purple' },
    { key: 'rng',   label: 'Foundation · seeded PRNG (ChaCha8)', kills: 'unseeded randomness; seed = SHA-256("dst_framework::Prng::v1"…)', zone: 'green', foundation: true },
  ];

  // Layout: five stacked boxes, banner at top of SVG content area
  const BANNER = { x: 40, y: 10, w: W - 80, h: 30 };
  const BOX = { x: 40, w: W - 80, h: 52, gap: 8, top: 54 };
  const tierY = (i) => BOX.top + i * (BOX.h + BOX.gap);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      enabled: { os: true, net: true, time: true, sched: true, rng: true },
      busy: false,
      caught: 0,
      leaked: 0,
    };
    let svg, content, anim, logBody, c;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <span class="dstk-tlabel">inject chaos</span>
        <button class="dstk-btn dstk-btn--green  inj-btn" data-src="rng">randomness</button>
        <button class="dstk-btn dstk-btn--purple inj-btn" data-src="sched">thread order</button>
        <button class="dstk-btn dstk-btn--amber  inj-btn" data-src="time">wall-clock</button>
        <button class="dstk-btn dstk-btn--blue   inj-btn" data-src="net">packet order</button>
        <button class="dstk-btn dstk-btn--red    inj-btn" data-src="os">dep syscall</button>
      </div>
      <span class="dstk-tdiv"></span>
      <span class="dstk-sp"></span>
      <button class="dstk-btn dstk-btn--ghost rst-btn">↺ Reset layers</button>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Four layers of determinism',
        sub: 'each tier catches one source of chaos',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'caught', label: 'caught' },
          { id: 'leaked', label: 'leaked' },
        ],
        cap: 'Click a tier box to toggle it on/off. A disabled tier lets its chaos leak to the top → run diverges.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene();
      bind();
      render();
      K.addLog(logBody, 'Click an inject button — the matching layer catches it. Disable a layer to see it leak.', 'hl');
    }

    // ── scene ──────────────────────────────────────────────────────────────
    function drawScene() {
      content.innerHTML = '';

      // "deterministic run" banner at top
      const bannerOk = !st.leaked || st.caught >= st.leaked;
      // We'll just set deterministic-ok by default; setTop() updates it after inject
      K.el('rect', { id: bid('banner'), x: BANNER.x, y: BANNER.y, width: BANNER.w, height: BANNER.h,
        rx: 7, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      K.el('text', { id: bid('banner-txt'), x: BANNER.x + BANNER.w / 2, y: BANNER.y + 20,
        'text-anchor': 'middle', fill: c.green, 'font-size': 13, 'font-weight': 700 }, content)
        .textContent = 'deterministic run — one seed ⇒ one universe';

      // connector arrow from each tier down to the next (except below foundation)
      for (let i = 0; i < TIERS.length - 1; i++) {
        const cx = BOX.x + BOX.w / 2;
        const y1 = tierY(i) + BOX.h;
        const y2 = tierY(i + 1);
        K.el('line', { x1: cx, y1, x2: cx, y2, stroke: c.separator, 'stroke-width': 1.4,
          'marker-end': K.arrow(uid, 'gray') }, content);
      }

      // tier boxes
      TIERS.forEach((t, i) => {
        const y = tierY(i);
        const on = t.foundation || st.enabled[t.key];
        const zone = t.zone;
        const strokeColor = c[zone];
        const dashArray = (!t.foundation && !on) ? '6,4' : '0';
        const g = K.el('g', { class: 'tier-g', 'data-key': t.key, style: 'cursor:pointer' }, content);

        K.el('rect', {
          id: bid('box-' + t.key),
          x: BOX.x, y, width: BOX.w, height: BOX.h, rx: 9,
          fill: K.grad(uid, zone),
          stroke: strokeColor,
          'stroke-width': 1.8,
          'stroke-dasharray': dashArray,
        }, g);

        // tier label
        K.el('text', { x: BOX.x + 16, y: y + 22, fill: c.text, 'font-size': 12.5, 'font-weight': 700 }, g)
          .textContent = t.label;

        // subtitle
        K.el('text', { x: BOX.x + 16, y: y + 40, fill: c.muted, 'font-size': 10.5 }, g)
          .textContent = (on ? 'catches: ' : 'DISABLED — leaks: ') + t.kills;

        // on/off badge
        const badgeColor = t.foundation ? c.green : (on ? c[zone] : c.red);
        K.el('text', { x: BOX.x + BOX.w - 14, y: y + 22, 'text-anchor': 'end',
          fill: badgeColor, 'font-size': 11, 'font-weight': 700, filter: t.foundation ? K.glow(uid) : '' }, g)
          .textContent = t.foundation ? 'seed' : (on ? 'on' : 'off');
      });
    }

    function bid(k) { return `${uid}-${k}`; }
    function E(k) { return svg.querySelector('#' + CSS.escape(bid(k))); }

    function render() {
      stat('caught', st.caught);
      stat('leaked', st.leaked);
    }
    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // ── gremlin animation ─────────────────────────────────────────────────
    async function inject(src) {
      if (st.busy) return;
      st.busy = true;
      setLock(true);

      const tierIdx = TIERS.findIndex((t) => t.key === src);
      const startX = BOX.x + BOX.w / 2;
      const startY = H - 20;

      // gremlin: pink glowing particle
      const grem = K.el('g', {}, anim);
      K.el('circle', { cx: 0, cy: 0, r: 10, fill: c.pink, filter: K.glow(uid) }, grem);
      K.el('text', { x: 0, y: 4, 'text-anchor': 'middle', fill: '#fff', 'font-size': 12, 'font-weight': 700 }, grem)
        .textContent = '✦';
      grem.setAttribute('transform', `translate(${startX},${startY})`);

      const caughtAt = st.enabled[src] ? tierIdx : -1;
      const targetY = caughtAt >= 0 ? tierY(caughtAt) + BOX.h / 2 : BANNER.y + BANNER.h / 2;

      // rise
      const proxy = { y: startY };
      await animate(proxy, {
        y: targetY,
        duration: 650,
        ease: 'inOut(2)',
        onUpdate: () => grem.setAttribute('transform', `translate(${startX},${proxy.y})`),
      });

      if (caughtAt >= 0) {
        // flash the catching box
        const box = E('box-' + src);
        if (box) animate(box, { opacity: [1, 0.45, 1], duration: 340, ease: 'inOut(2)' });
        // gremlin absorbed
        await animate(grem, { opacity: [1, 0], duration: 200, ease: 'out(2)' });
        grem.remove();
        st.caught++;
        setTop(true);
        K.addLog(logBody,
          srcLabel(src) + ' → caught by ' + TIERS[tierIdx].label.split('·')[0].trim() + '. Still deterministic.',
          'ok');
      } else {
        // leaked — pulse gremlin then explode
        const circ = grem.querySelector('circle');
        await animate(circ, { r: [10, 18], opacity: [1, 0], duration: 280, ease: 'out(2)' });
        grem.remove();
        st.leaked++;
        setTop(false);
        K.addLog(logBody, srcLabel(src) + ' leaked through the disabled layer → run DIVERGED.', 'err');
      }

      render();
      st.busy = false;
      setLock(false);
    }

    const srcLabel = (s) => ({
      rng:   'unseeded randomness',
      sched: 'thread-scheduling order',
      time:  'a wall-clock read',
      net:   'packet (re)ordering',
      os:    "a dependency's raw syscall",
    }[s]);

    function setTop(ok) {
      const banner = E('banner');
      const txt = E('banner-txt');
      if (!banner || !txt) return;
      if (ok) {
        banner.setAttribute('fill', K.grad(uid, 'green'));
        banner.setAttribute('stroke', c.green);
        txt.setAttribute('fill', c.green);
        txt.textContent = 'deterministic run — one seed ⇒ one universe';
      } else {
        banner.setAttribute('fill', K.grad(uid, 'red'));
        banner.setAttribute('stroke', c.red);
        txt.setAttribute('fill', c.red);
        txt.textContent = '✗ run diverged — a layer was missing';
      }
    }

    // ── bind ──────────────────────────────────────────────────────────────
    function bind() {
      root.querySelectorAll('.inj-btn').forEach((b) =>
        b.addEventListener('click', () => { if (!st.busy) inject(b.getAttribute('data-src')); }));

      root.querySelector('.rst-btn').addEventListener('click', () => {
        st.enabled = { os: true, net: true, time: true, sched: true, rng: true };
        st.caught = 0;
        st.leaked = 0;
        drawScene();
        render();
        setTop(true);
        K.addLog(logBody, '↺ all layers enabled — ready', 'hl');
      });

      svg.addEventListener('click', (e) => {
        const g = e.target.closest('.tier-g');
        if (!g || st.busy) return;
        const k = g.getAttribute('data-key');
        if (k === 'rng') {
          K.addLog(logBody, 'The seeded Foundation cannot be disabled — it is the seed itself.', 'hl');
          return;
        }
        st.enabled[k] = !st.enabled[k];
        drawScene();
        const tier = TIERS.find((t) => t.key === k);
        K.addLog(logBody,
          tier.label.split('·')[0].trim() + (st.enabled[k] ? ' enabled' : ' DISABLED — chaos will leak'),
          st.enabled[k] ? 'ok' : 'warn');
      });
    }

    function setLock(b) {
      root.querySelectorAll('.inj-btn').forEach((x) => { x.disabled = b; });
    }

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTFourLayers = { init };
})();
