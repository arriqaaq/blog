/**
 * DST Same-Seed Replay (re-skinned via dst-kit) — the seed contract, made visible.
 *
 * Two panels step in lockstep. Both fold every event (deliver / push) into a running hash, the
 * JS analogue of dst's running SHA-256 over History → RunSummary.history_hash (whose
 * Display shows the first 8 bytes = 16 hex chars). Same seed ⇒ identical RNG draws ⇒ identical
 * event order ⇒ identical hash (✅). Change the right seed ⇒ the traces diverge and the hashes
 * mismatch (✗). The repro line mirrors repro_command_line: DST_SEED=<n> cargo test <filter>.
 *
 * Exposes window.DSTSameSeedReplay.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) {
    console.error('DST Same-Seed Replay: anime v4 required'); return;
  }
  if (!window.DSTKit) { console.error('DST Same-Seed Replay: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  // --- layout constants ---
  const W = 780, H = 390, NODES = 3, TICK = 10;
  // Two panels side by side inside the SVG stage
  const PANEL = { w: 358, h: 258, y: 72, gap: 24 };
  const px = (side) => (side === 0 ? 10 : 10 + PANEL.w + PANEL.gap);
  // Node dot positions within a panel
  const ndx = (side, i) => px(side) + 42 + i * 76;
  const ndy = () => PANEL.y + 62;

  // --- two FNV-1a lanes → 16 hex chars ---
  function newHash() { return { a: 0x811c9dc5 >>> 0, b: 0x1000193 >>> 0 }; }
  function feedHash(hsh, str) {
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hsh.a = Math.imul(hsh.a ^ ch, 0x01000193) >>> 0;
      hsh.b = Math.imul(hsh.b ^ ((ch + i) & 0xff), 0x85ebca77) >>> 0;
    }
  }
  const hexHash = (hsh) =>
    (hsh.a >>> 0).toString(16).padStart(8, '0') + (hsh.b >>> 0).toString(16).padStart(8, '0');

  const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    const makePanel = (seed) => ({
      seed, rng: K.rng(seed >>> 0), now: 0, step: 0, seq: 0,
      nodes: Array.from({ length: NODES }, () => ({ clock: 0 })),
      heap: [], hash: newHash(), events: [],
    });

    const st = {
      panels: [makePanel(7), makePanel(7)],
      rightSeed: 7,
      playing: false, busy: false, speed: 1,
    };

    let svg, content, anim, logBody, c;

    build();

    // --- controls HTML ---
    function controls() {
      return `<div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--purple t-step">⏭ Step</button>
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺</button>
        </div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">speed</span>
          <select class="t-speed">
            <option value="0.5">0.5×</option>
            <option value="1" selected>1×</option>
            <option value="2">2×</option>
          </select>
        </div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">right seed</span>
          <input type="number" class="t-seed" value="${st.rightSeed}" min="0" step="1">
        </div>`;
    }

    // --- build: full re-render from scratch ---
    function build() {
      root.innerHTML = K.container({
        title: 'Same-seed replay',
        sub: 'one seed, one universe',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'step', label: 'step' },
          { id: 'hasha', label: 'hash A (short)' },
          { id: 'hashb', label: 'hash B (short)' },
        ],
        cap: K.highlightRust(
          'Builder::new()\n' +
          '    .rng_seed(7u64)                   // same seed ⇒ same universe\n' +
          '    .tick_duration(Duration::from_millis(10))\n' +
          '    .max_message_latency(Duration::from_millis(100))\n' +
          '    .build()?;\n' +
          '// RunSummary::history_hash — first 8 bytes displayed as 16 hex chars'
        ),
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene();
      bind();
      render();
    }

    // --- scene skeleton ---
    function drawScene() {
      content.innerHTML = '';
      anim.innerHTML = '';

      // Comparator banner background
      K.el('rect', { x: 8, y: 6, width: W - 16, height: 54, rx: 8,
        fill: K.grad(uid, 'green'), stroke: c.separator, 'stroke-width': 1 }, content);

      // Status text (updated by render())
      K.el('text', { id: uid + '-status', x: W / 2, y: 30, 'text-anchor': 'middle',
        'font-size': 15, 'font-weight': 700, fill: c.green }, content)
        .textContent = '✅ history_hash identical';
      K.el('text', { x: W / 2, y: 48, 'text-anchor': 'middle', 'font-size': 10, fill: c.muted }, content)
        .textContent = 'same seed ⇒ same draws ⇒ same event order ⇒ same hash';

      // Repro line at bottom of SVG
      K.el('text', { id: uid + '-repro', x: W / 2, y: H - 12, 'text-anchor': 'middle',
        'font-size': 10, fill: c.muted, 'font-family': 'ui-monospace,monospace' }, content)
        .textContent = 'DST_SEED=7 cargo test two_run_hash_equality_full_chaos -- --exact';

      // Draw both panels
      for (let s = 0; s < 2; s++) drawPanel(s);
    }

    function drawPanel(side) {
      const x = px(side);
      const p = st.panels[side];

      // Panel frame
      K.el('rect', { x, y: PANEL.y, width: PANEL.w, height: PANEL.h, rx: 10,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);

      // Panel header: seed label
      K.el('text', { id: eid('plabel', side), x: x + 14, y: PANEL.y + 22,
        fill: c.text, 'font-size': 12, 'font-weight': 700 }, content)
        .textContent = 'run · seed ' + p.seed;

      // Step counter (right-aligned)
      K.el('text', { id: eid('pstep', side), x: x + PANEL.w - 14, y: PANEL.y + 22,
        'text-anchor': 'end', fill: c.muted, 'font-size': 10 }, content)
        .textContent = 't=0 · step 0';

      // Node dots
      for (let i = 0; i < NODES; i++) {
        const cx = ndx(side, i), cy = ndy();
        K.el('circle', { id: eid('n' + i, side), cx, cy, r: 14,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 2 }, content);
        K.el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle',
          fill: c.text, 'font-size': 10, 'font-weight': 600 }, content)
          .textContent = 'n' + i;
      }

      // Connector lines between node dots (directional arrows)
      for (let i = 0; i < NODES - 1; i++) {
        K.el('line', {
          x1: ndx(side, i) + 14, y1: ndy(),
          x2: ndx(side, i + 1) - 14, y2: ndy(),
          stroke: c.purple, 'stroke-width': 1, opacity: 0.4,
          'marker-end': K.arrow(uid, 'purple'),
        }, content);
      }

      // Event stream label
      K.el('text', { x: x + 14, y: PANEL.y + 110, fill: c.muted, 'font-size': 9 }, content)
        .textContent = 'event stream →';

      // Event feed rows (4 rows)
      for (let r = 0; r < 4; r++) {
        K.el('text', { id: eid('ev' + r, side), x: x + 14, y: PANEL.y + 124 + r * 16,
          fill: c.text, 'font-size': 10, 'font-variant-numeric': 'tabular-nums' }, content)
          .textContent = '';
      }

      // Hash readout label
      K.el('text', { x: x + 14, y: PANEL.y + PANEL.h - 28, fill: c.muted, 'font-size': 9 }, content)
        .textContent = 'history_hash (first 8 bytes)';

      // Big hash value
      K.el('text', { id: eid('hash', side), x: x + PANEL.w - 14, y: PANEL.y + PANEL.h - 10,
        'text-anchor': 'end', fill: c.blue, 'font-size': 13, 'font-weight': 700,
        'font-family': 'ui-monospace,monospace', filter: K.glow(uid) }, content)
        .textContent = hexHash(p.hash);
    }

    // id helpers scoped to uid
    function eid(k, side) { return uid + '-' + k + '-' + side; }
    function E(k, side) { return svg.querySelector('#' + CSS.escape(eid(k, side))); }

    // --- render: sync all live elements to state ---
    function render() {
      const h0 = hexHash(st.panels[0].hash);
      const h1 = hexHash(st.panels[1].hash);
      const same = h0 === h1;

      // Comparator banner
      const statusEl = svg.querySelector('#' + CSS.escape(uid + '-status'));
      if (statusEl) {
        statusEl.textContent = same ? '✅ history_hash identical' : '✗ history_hash diverged';
        statusEl.setAttribute('fill', same ? c.green : c.red);
      }

      // Per-panel updates
      for (let s = 0; s < 2; s++) {
        const p = st.panels[s];
        const lbl = E('plabel', s); if (lbl) lbl.textContent = 'run · seed ' + p.seed;
        const ps = E('pstep', s); if (ps) ps.textContent = 't=' + p.now + ' · step ' + p.step;
        const hEl = E('hash', s);
        if (hEl) {
          hEl.textContent = s === 0 ? h0 : h1;
          hEl.setAttribute('fill', same ? c.blue : c.red);
        }
        const last = p.events.slice(-4);
        for (let r = 0; r < 4; r++) {
          const ev = E('ev' + r, s); if (ev) ev.textContent = last[r] || '';
        }
      }

      // Stat cards
      stat('step', st.panels[0].step);
      stat('hasha', h0.slice(0, 8));
      stat('hashb', h1.slice(0, 8));

      // Repro line
      const repro = svg.querySelector('#' + CSS.escape(uid + '-repro'));
      if (repro) {
        repro.textContent =
          'DST_SEED=' + st.panels[1].seed +
          ' cargo test two_run_hash_equality_full_chaos -- --exact';
      }
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // --- advance one tick for a panel ---
    function advance(p, side) {
      const now = p.now;
      // deliver due packets
      const due = p.heap.filter((q) => q.deliverAt <= now).sort(cmp);
      for (const q of due) {
        p.heap = p.heap.filter((r) => r.seq !== q.seq);
        const ev = 'deliver s' + q.seq + ' n' + q.from + '→n' + q.to;
        p.events.push(ev); feedHash(p.hash, ev + '|' + p.step);
        // flash destination node blue (deliver)
        flashNode(side, q.to, c.blue);
      }
      // tick each node + maybe send
      for (let i = 0; i < NODES; i++) {
        p.nodes[i].clock += TICK;
        if (p.rng() < 0.42) {
          let j = Math.floor(p.rng() * (NODES - 1)); if (j >= i) j++;
          const lat = 20 + Math.floor(p.rng() * 70);
          const pkt = { seq: ++p.seq, from: i, to: j, deliverAt: now + TICK + lat };
          p.heap.push(pkt);
          const ev = 'push s' + pkt.seq + ' n' + i + '→n' + j + ' @' + pkt.deliverAt;
          p.events.push(ev); feedHash(p.hash, ev + '|' + p.step);
          // flash source node green (send)
          flashNode(side, i, c.green);
        }
      }
      p.now = now + TICK; p.step++;
    }

    // Flash a node circle with a given color, then restore
    function flashNode(side, i, color) {
      const circle = E('n' + i, side); if (!circle) return;
      const origFill = circle.getAttribute('fill');
      circle.setAttribute('fill', color);
      circle.setAttribute('filter', K.glow(uid));
      animate(circle, {
        opacity: [1, 0.55, 1],
        duration: 320 / st.speed,
        ease: 'out(2)',
        onComplete: () => {
          circle.setAttribute('fill', origFill);
          circle.removeAttribute('filter');
        },
      });
    }

    // Animate a particle flying from (sx,sy) to (tx,ty)
    async function fly(sx, sy, tx, ty, color) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 5, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: 360 / st.speed, ease: 'inOutQuad' });
      await animate(dot, { r: [5, 10], opacity: [1, 0], duration: 150 / st.speed, ease: 'out(2)' });
      dot.remove();
    }

    // Step both panels in lockstep
    async function stepBoth() {
      if (st.busy) return;
      st.busy = true; setLock(true);

      const h0before = hexHash(st.panels[0].hash);

      // Animate a particle across each panel to signal activity
      const p0x = px(0) + PANEL.w / 2, p1x = px(1) + PANEL.w / 2;
      const midY = PANEL.y + PANEL.h / 2;
      fly(p0x - 60, midY, p0x + 60, midY, c.purple);
      fly(p1x - 60, midY, p1x + 60, midY, c.purple);
      await K.delay(180 / st.speed);

      advance(st.panels[0], 0);
      advance(st.panels[1], 1);
      render();

      const h0after = hexHash(st.panels[0].hash);
      const h1after = hexHash(st.panels[1].hash);
      const same = h0after === h1after;

      if (same) {
        K.addLog(logBody, 'step ' + st.panels[0].step + ': hashes match — ' + h0after.slice(0, 8), 'ok');
      } else {
        K.addLog(logBody, 'step ' + st.panels[0].step + ': DIVERGED — A:' + h0after.slice(0, 8) + ' B:' + h1after.slice(0, 8), 'err');
      }

      await K.delay(120 / st.speed);
      st.busy = false; setLock(false);
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepBoth(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
      root.querySelector('.t-seed').onchange = (e) => {
        const v = parseInt(e.target.value, 10);
        st.rightSeed = Number.isFinite(v) ? v : 42;
        reset();
      };
    }

    async function play() {
      if (st.playing) return;
      st.playing = true; pp();
      while (st.playing) {
        await stepBoth();
        if (!st.playing) break;
        await K.delay(200 / st.speed);
      }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      st.panels = [makePanel(7), makePanel(st.rightSeed)];
      st.busy = false; setLock(false);
      drawScene(); render();
      const seedMsg = st.rightSeed === 7
        ? '↺ reset — both seeds 7 · same seed ⇒ same run'
        : '↺ reset — seeds 7 vs ' + st.rightSeed + ' · watch them diverge';
      K.addLog(logBody, seedMsg, 'hl');
    }
    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    K.addLog(logBody, 'ready — seed 7 vs 7 · same seed ⇒ same universe', 'hl');

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTSameSeedReplay = { init };
})();
