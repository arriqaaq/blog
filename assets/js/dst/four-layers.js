/**
 * DST Four Layers of Determinism — each tier intercepts one source of chaos.
 *
 * Non-determinism has four sources, each neutralized by one layer over a seeded Foundation
 * (crate "dst"; file:line refs below verified against src/):
 *   Foundation — seeded PRNG (ChaCha8, SHA-256 domain-separated)   src/prng.rs:8-15
 *                (seed = SHA-256(b"dst_framework::Prng::v1" ++ seed.to_le_bytes()) → ChaCha8Rng)
 *   Layer 1    — single-threaded driver        (kills thread-scheduling nondeterminism)
 *                src/runtime.rs:40 new_current_thread() + src/sim/tick.rs serial node loop
 *   Layer 2    — paused virtual time            (kills wall-clock races)
 *                src/runtime.rs:41 enable_time().start_paused(true)
 *   Layer 3    — seeded network                 (deterministic loss / latency / order)
 *                src/sim/backplane.rs:65 Prng::from_seed(config.rng_seed); :159 loss; :196 latency
 *   Layer 4    — OS-hook interception           (kills dependency back-channels to the real OS)
 *                src/os_hooks/{clock.rs,rand.rs} intercept clock + RNG syscalls
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

  const W = 760, H = 408;

  // Tiers top→bottom in array order; index 0 = OS hook (top), last = seeded Foundation (bottom).
  // `plain` is the everyday name shown big; `tag` is the textbook term, demoted to a small label.
  const TIERS = [
    { key: 'os',    plain: 'Block the back door to the OS',  tag: 'OS-hook interception',  catches: "a dependency's raw syscall",          zone: 'red' },
    { key: 'net',   plain: 'Replay the network from a seed', tag: 'seeded network',        catches: 'packet loss / latency / reordering',  zone: 'blue' },
    { key: 'time',  plain: 'Freeze the clock',               tag: 'paused virtual time',   catches: 'a real wall-clock read',              zone: 'amber' },
    { key: 'sched', plain: 'Run everything on one thread',   tag: 'single-threaded driver', catches: 'OS thread-scheduling order',         zone: 'purple' },
    { key: 'rng',   plain: 'One seed feeds all randomness',  tag: 'seeded PRNG · ChaCha8', catches: 'unseeded randomness; seed = SHA-256("dst_framework::Prng::v1"…)', zone: 'green', foundation: true },
  ];
  // Map: which gremlin button targets which tier.
  const GREMLINS = [
    { src: 'rng',   plain: 'random number', zone: 'green' },
    { src: 'sched', plain: 'thread race',   zone: 'purple' },
    { src: 'time',  plain: 'clock read',    zone: 'amber' },
    { src: 'net',   plain: 'packet shuffle', zone: 'blue' },
    { src: 'os',    plain: 'OS entropy',    zone: 'red' },
  ];

  const BANNER = { x: 36, y: 8, w: W - 72, h: 34 };
  const BOX = { x: 36, w: W - 72, h: 50, gap: 9, top: 56 };
  const tierY = (i) => BOX.top + i * (BOX.h + BOX.gap);
  const LANE_X = W - 150;      // x of the rising-gremlin lane (right of the labels)

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
      const btns = GREMLINS.map((g) =>
        `<button class="dstk-btn dstk-btn--${g.zone} inj-btn" data-src="${g.src}">↑ ${g.plain}</button>`).join('');
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">fire chaos</span>${btns}</div>
        <span class="dstk-sp"></span>
        <button class="dstk-btn dstk-btn--ghost rst-btn">↺ Reset</button>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Each layer strangles one kind of chaos',
        sub: 'fire a gremlin · watch its layer catch it · turn the layer off and it leaks',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'verdict', label: 'last shot' },
          { id: 'caught', label: 'caught' },
          { id: 'leaked', label: 'leaked' },
        ],
        cap: 'Five layers, each catching one source of nondeterminism. Fire a gremlin and its matching '
           + 'layer catches it — the run stays deterministic. Click a layer to switch it OFF, fire the '
           + 'same gremlin, and watch the chaos leak all the way to the top.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene();
      bind();
      render();
      setTop(true);
      K.addLog(logBody, '🌱 fire a gremlin (bottom buttons) — the matching layer catches it. Click a layer to turn it OFF.', 'hl');
    }

    // ── scene ──────────────────────────────────────────────────────────────
    function drawScene() {
      content.innerHTML = '';

      // top verdict banner
      K.el('rect', { id: bid('banner'), x: BANNER.x, y: BANNER.y, width: BANNER.w, height: BANNER.h,
        rx: 8, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      K.el('text', { id: bid('banner-txt'), x: BANNER.x + BANNER.w / 2, y: BANNER.y + 22,
        'text-anchor': 'middle', fill: c.green, 'font-size': 13.5, 'font-weight': 700 }, content)
        .textContent = 'deterministic run — one seed ⇒ one universe';

      // tier boxes
      TIERS.forEach((t, i) => {
        const y = tierY(i);
        const on = t.foundation || st.enabled[t.key];
        const zone = t.zone;
        const g = K.el('g', { class: t.foundation ? 'tier-g found' : 'tier-g', 'data-key': t.key,
          style: t.foundation ? 'cursor:default' : 'cursor:pointer' }, content);

        K.el('rect', {
          id: bid('box-' + t.key),
          x: BOX.x, y, width: BOX.w, height: BOX.h, rx: 9,
          fill: on ? K.grad(uid, zone) : 'none',
          stroke: c[zone],
          'stroke-width': 1.8,
          'stroke-dasharray': (!t.foundation && !on) ? '6,5' : '0',
          'stroke-opacity': on ? 1 : 0.55,
        }, g);

        // big plain-language name
        K.el('text', { id: bid('plain-' + t.key), x: BOX.x + 16, y: y + 22,
          fill: on ? c.text : c.muted, 'font-size': 13, 'font-weight': 700 }, g)
          .textContent = t.plain;

        // small textbook tag + what it catches, on one line
        K.el('text', { id: bid('sub-' + t.key), x: BOX.x + 16, y: y + 39,
          fill: c.muted, 'font-size': 9.5 }, g)
          .textContent = t.tag + '  ·  ' + (on ? 'catches ' : 'OFF → leaks ') + t.catches;

        // on/off pill (right side)
        const px = BOX.x + BOX.w - 52, py = y + 12, pw = 38, ph = 18;
        const pillOn = t.foundation || on;
        K.el('rect', { id: bid('pill-' + t.key), x: px, y: py, width: pw, height: ph, rx: 9,
          fill: pillOn ? c[zone] : 'none', 'fill-opacity': pillOn ? 0.18 : 0,
          stroke: pillOn ? c[zone] : c.red, 'stroke-width': 1.4 }, g);
        K.el('text', { id: bid('pilltxt-' + t.key), x: px + pw / 2, y: py + 13, 'text-anchor': 'middle',
          fill: t.foundation ? c.green : (on ? c[zone] : c.red), 'font-size': 9.5, 'font-weight': 700 }, g)
          .textContent = t.foundation ? 'seed' : (on ? 'ON' : 'OFF');
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
    function setVerdict(text, zone) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-verdict'));
      if (e) { e.textContent = text; e.style.color = c[zone] || c.text; }
    }

    // ── gremlin animation ─────────────────────────────────────────────────
    async function inject(src) {
      if (st.busy) return;
      st.busy = true;
      setLock(true);

      const tierIdx = TIERS.findIndex((t) => t.key === src);
      const tier = TIERS[tierIdx];
      const grem = GREMLINS.find((g) => g.src === src);
      const startY = H - 18;

      // The gremlin is a LABELLED pill so you can read what chaos is flying up.
      const label = grem.plain;
      const pw = 24 + label.length * 6.4, ph = 22;
      const g = K.el('g', {}, anim);
      const pill = K.el('rect', { x: -pw / 2, y: -ph / 2, width: pw, height: ph, rx: 11,
        fill: c[grem.zone], filter: K.glow(uid) }, g);
      K.el('text', { x: 0, y: 4, 'text-anchor': 'middle', fill: '#fff', 'font-size': 11,
        'font-weight': 700 }, g).textContent = '✦ ' + label;
      g.setAttribute('transform', `translate(${LANE_X},${startY})`);

      const caughtAt = st.enabled[src] ? tierIdx : -1;
      const targetY = caughtAt >= 0 ? tierY(caughtAt) + BOX.h / 2 : BANNER.y + BANNER.h / 2;

      K.addLog(logBody, '↑ fired ' + label + ' chaos…', 'hl');

      // rise — it passes through every disabled (dashed) layer it reaches.
      const proxy = { y: startY };
      await animate(proxy, {
        y: targetY,
        duration: 720,
        ease: 'inOut(2)',
        onUpdate: () => g.setAttribute('transform', `translate(${LANE_X},${proxy.y})`),
      });

      if (caughtAt >= 0) {
        // the catching layer flashes and "swallows" the gremlin.
        flashBox(src, c[tier.zone]);
        await animate(g, { opacity: [1, 0], scale: [1, 0.4], duration: 240, ease: 'out(2)' });
        g.remove();
        st.caught++;
        setTop(true);
        setVerdict('CAUGHT', tier.zone);
        bannerPulse(c.green);
        K.addLog(logBody, '✓ CAUGHT by “' + tier.plain + '” (' + tier.tag + '). Still deterministic.', 'ok');
      } else {
        // leaked — it reaches the top banner and the run diverges.
        pill.setAttribute('fill', c.red);
        await animate(g, { opacity: [1, 0.2, 1, 0], duration: 420, ease: 'inOut(2)' });
        g.remove();
        st.leaked++;
        setTop(false);
        setVerdict('LEAKED', 'red');
        bannerPulse(c.red);
        K.addLog(logBody, '✗ LEAKED — “' + tier.plain + '” is OFF, so ' + label + ' chaos reached the top. Run DIVERGED.', 'err');
      }

      render();
      st.busy = false;
      setLock(false);
    }

    function flashBox(key, col) {
      const box = E('box-' + key);
      if (box) animate(box, { opacity: [1, 0.4, 1], 'stroke-width': [1.8, 3.4, 1.8], duration: 360, ease: 'inOut(2)' });
    }
    function bannerPulse(col) {
      const banner = E('banner');
      if (banner) animate(banner, { opacity: [1, 0.5, 1], duration: 300, ease: 'inOut(2)' });
    }

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
        txt.textContent = '✗ run DIVERGED — a layer was switched off';
      }
    }

    // toggle a layer on/off and repaint just that box.
    function toggle(key) {
      const t = TIERS.find((x) => x.key === key);
      if (!t || t.foundation) {
        K.addLog(logBody, 'The seeded Foundation cannot be switched off — it is the seed itself.', 'hl');
        return;
      }
      st.enabled[key] = !st.enabled[key];
      const on = st.enabled[key];
      const box = E('box-' + key), plain = E('plain-' + key), sub = E('sub-' + key),
        pill = E('pill-' + key), pilltxt = E('pilltxt-' + key);
      box.setAttribute('fill', on ? K.grad(uid, t.zone) : 'none');
      box.setAttribute('stroke-dasharray', on ? '0' : '6,5');
      box.setAttribute('stroke-opacity', on ? 1 : 0.55);
      plain.setAttribute('fill', on ? c.text : c.muted);
      sub.textContent = t.tag + '  ·  ' + (on ? 'catches ' : 'OFF → leaks ') + t.catches;
      pill.setAttribute('fill', on ? c[t.zone] : 'none');
      pill.setAttribute('fill-opacity', on ? 0.18 : 0);
      pill.setAttribute('stroke', on ? c[t.zone] : c.red);
      pilltxt.setAttribute('fill', on ? c[t.zone] : c.red);
      pilltxt.textContent = on ? 'ON' : 'OFF';
      animate(box, { opacity: [0.4, 1], duration: 220, ease: 'out(2)' });
      K.addLog(logBody,
        '“' + t.plain + '” ' + (on ? 'switched ON' : 'switched OFF — its chaos will leak now'),
        on ? 'ok' : 'warn');
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
        setVerdict('—', 'muted');
        K.addLog(logBody, '↺ all layers back ON — fire a gremlin to watch one catch it.', 'hl');
      });

      svg.addEventListener('click', (e) => {
        const g = e.target.closest('.tier-g');
        if (!g || st.busy) return;
        toggle(g.getAttribute('data-key'));
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
