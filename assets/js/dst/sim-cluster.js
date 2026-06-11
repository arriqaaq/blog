/**
 * DST Sim-Cluster (re-skinned via dst-kit) — "Real run vs simulated run — which one can you replay?"
 *
 * The entire distributed system lives inside ONE OS process: three nodes, a network
 * backplane, a single driver/clock, and a seed→RNG, all enclosed in one rounded process
 * boundary. The widget runs the SAME workload TWICE (run A, then run B) and compares the
 * resulting run fingerprint:
 *   • REAL mode    — packets arrive at jittery wall-clock times, the delivery order shuffles
 *                    every run, so run A and run B land on DIFFERENT fingerprints. Modelled with
 *                    the non-seeded JS random API (Math.random) because real runs are *meant* to
 *                    be irreproducible.
 *   • SIMULATED mode — the single driver steps everything from the sim clock and the seeded RNG,
 *                    so run A and run B replay the identical event order and the SAME fingerprint.
 *
 * Source fidelity (dst crate):
 *   • single process — runtime.rs builds new_current_thread() + a LocalSet and spawn_local()s every
 *     node onto it; sim/tick.rs::tick_step steps each node and advances one sim clock per tick.
 *   • seed → PRNG — src/prng.rs seeds ChaCha8Rng from SHA-256(seed); same seed ⇒ same stream
 *     (tests deterministic_from_seed / different_seeds_diverge). The on-screen label reads
 *     "ChaCha8 (seeded)" to match; the widget's own K.rng(seed) is a JS stand-in (mulberry32),
 *     used only to drive this demo deterministically — it is NOT the framework PRNG.
 *   • fingerprint — sim/history.rs folds each event into a Sha256 hasher; RunSummary prints the
 *     first 8 hex chars (hex(&history_hash[..8])), which is why the readout here is 8 hex chars.
 *
 * Loud verdict carries the lesson: SAME ⇒ "you can replay it", DIFFERENT ⇒ "gone forever".
 * Exposes window.DSTSimCluster.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('sim-cluster: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('sim-cluster: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 318, NODES = 3, TICK = 10, MAXSTEP = 5;

  // phase strip — three plain steps the driver repeats each delivery
  const PHASES = [
    { t: '① deliver packet', zone: 'blue' },
    { t: '② advance clock', zone: 'green' },
    { t: '③ fold into fingerprint', zone: 'purple' },
  ];
  const PILL = { y: 16, h: 26, gap: 10, x0: 18 };
  const PILLW = [128, 122, 188];
  const pillX = (i) => PILL.x0 + PILLW.slice(0, i).reduce((a, w) => a + w + PILL.gap, 0);

  // process boundary encloses everything below the phase strip
  const PROC = { x: 16, y: 50, w: W - 32, h: 178, rx: 16 };
  const NODE = { y: 86, w: 150, h: 64, gap: 22, x0: 40 };
  const nx = (i) => NODE.x0 + i * (NODE.w + NODE.gap);
  const NET = { x: 40, y: 162, w: 3 * NODE.w + 2 * NODE.gap, h: 30 };
  const DRV = { x: 40, y: 200, w: 286, h: 22 };
  const RNGB = { x: 346, y: 200, w: 394, h: 22 };

  // verdict panel below the process
  const VP = { x: 16, y: 240, w: W - 32, h: 62 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { sim: true, seed: 1337, step: 0, elapsed: 0, nodes: [0, 0, 0],
      runA: null, runB: null, which: 0, playing: false, busy: false };
    let svg, content, anim, logBody, c;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--blue t-run">▶ Run it twice</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">mode</span>
          <button class="dstk-btn dstk-btn--amber t-mode"></button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span><input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Real run vs simulated run — which one can you replay?',
        sub: 'one process: nodes · network · driver/clock · seeded RNG',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'mode', label: 'mode' }, { id: 'fpA', label: 'run A fingerprint' }, { id: 'fpB', label: 'run B fingerprint' }],
        cap: 'The whole distributed system runs inside one process. We run the same workload twice: '
           + 'in REAL mode wall-clock jitter makes every run’s fingerprint differ; in SIMULATED mode the '
           + 'same seed replays the identical run — same fingerprint, every time.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render(); setPhase(-1);
      K.addLog(logBody, '🌱 ready — press “Run it twice” to compare run A vs run B', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';

      // phase strip
      PHASES.forEach((p, i) => {
        K.el('rect', { id: id('pill', i), x: pillX(i), y: PILL.y, width: PILLW[i], height: PILL.h, rx: 8,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: id('pilltext', i), x: pillX(i) + PILLW[i] / 2, y: PILL.y + PILL.h / 2 + 4, 'text-anchor': 'middle',
          fill: c.muted, 'font-size': 11, 'font-weight': 700 }, content).textContent = p.t;
        if (i < PHASES.length - 1) K.el('text', { x: pillX(i) + PILLW[i] + PILL.gap / 2, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 11 }, content).textContent = '→';
      });

      // the single OS process boundary enclosing everything
      K.el('rect', { id: id('proc', 0), x: PROC.x, y: PROC.y, width: PROC.w, height: PROC.h, rx: PROC.rx,
        fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 2, 'stroke-dasharray': '7,5' }, content);
      K.el('text', { x: PROC.x + 14, y: PROC.y + 17, fill: c.muted, 'font-size': 10.5, 'font-weight': 700 }, content)
        .textContent = 'one OS process — the entire distributed system lives in here';

      // three node boxes
      for (let i = 0; i < NODES; i++) {
        const x = nx(i);
        K.el('rect', { id: id('box', i), x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 9,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: NODE.y + 18, r: 4.5, fill: c.purple }, content);
        K.el('text', { x: x + 28, y: NODE.y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'n' + i;
        K.el('text', { x: x + NODE.w - 12, y: NODE.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
          .textContent = i === 0 ? 'client' : 'host';
        K.el('text', { x: x + 14, y: NODE.y + 42, fill: c.muted, 'font-size': 9 }, content).textContent = 'inbox';
        K.el('text', { id: id('inb', i), x: x + NODE.w - 12, y: NODE.y + 50, 'text-anchor': 'end', fill: c.purple, 'font-size': 22, 'font-weight': 700,
          'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0';
      }

      // network backplane
      K.el('rect', { x: NET.x, y: NET.y, width: NET.w, height: NET.h, rx: 8,
        fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
      K.el('text', { x: NET.x + 12, y: NET.y + 19, fill: c.blue, 'font-size': 10.5, 'font-weight': 700 }, content)
        .textContent = 'network';
      K.el('text', { id: id('nethint', 0), x: NET.x + NET.w - 12, y: NET.y + 19, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5 }, content)
        .textContent = '';

      // single driver / clock box (one slim row)
      K.el('rect', { id: id('drv', 0), x: DRV.x, y: DRV.y, width: DRV.w, height: DRV.h, rx: 6,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, content);
      K.el('text', { x: DRV.x + 10, y: DRV.y + 15, fill: c.green, 'font-size': 9.5, 'font-weight': 700 }, content)
        .textContent = 'driver/clock';
      K.el('text', { id: id('clk', 0), x: DRV.x + DRV.w - 10, y: DRV.y + 15, 'text-anchor': 'end', fill: c.text, 'font-size': 10.5, 'font-weight': 600,
        'font-variant-numeric': 'tabular-nums' }, content).textContent = 't = 0 ms';

      // seed → RNG box (one slim row)
      K.el('rect', { id: id('rngbox', 0), x: RNGB.x, y: RNGB.y, width: RNGB.w, height: RNGB.h, rx: 6,
        fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6 }, content);
      K.el('text', { x: RNGB.x + 10, y: RNGB.y + 15, fill: c.amber, 'font-size': 9.5, 'font-weight': 700 }, content)
        .textContent = 'randomness';
      K.el('text', { id: id('rng', 0), x: RNGB.x + RNGB.w - 10, y: RNGB.y + 15, 'text-anchor': 'end', fill: c.text, 'font-size': 10.5, 'font-weight': 600,
        'font-variant-numeric': 'tabular-nums' }, content).textContent = '';

      // verdict panel
      K.el('rect', { id: id('vpanel', 0), x: VP.x, y: VP.y, width: VP.w, height: VP.h, rx: 10,
        fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
      K.el('text', { id: id('vbig', 0), x: VP.x + 18, y: VP.y + 30, fill: c.muted, 'font-size': 20, 'font-weight': 800 }, content)
        .textContent = 'run it twice →';
      K.el('text', { id: id('vsub', 0), x: VP.x + 18, y: VP.y + 49, fill: c.muted, 'font-size': 11 }, content)
        .textContent = 'we’ll run the same workload twice and compare the fingerprints';
      // compact A/B fingerprint readout on the right of the verdict panel
      K.el('text', { x: VP.x + VP.w - 14, y: VP.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5 }, content).textContent = 'A';
      K.el('text', { id: id('vfpA', 0), x: VP.x + VP.w - 30, y: VP.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 12, 'font-weight': 700,
        'font-variant-numeric': 'tabular-nums', 'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = '········';
      K.el('text', { x: VP.x + VP.w - 14, y: VP.y + 44, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5 }, content).textContent = 'B';
      K.el('text', { id: id('vfpB', 0), x: VP.x + VP.w - 30, y: VP.y + 44, 'text-anchor': 'end', fill: c.muted, 'font-size': 12, 'font-weight': 700,
        'font-variant-numeric': 'tabular-nums', 'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = '········';
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

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function render() {
      stat('mode', st.sim ? 'SIMULATED' : 'REAL');
      stat('fpA', st.runA || '········');
      stat('fpB', st.runB || '········');
      E('clk', 0).textContent = st.sim ? 't = ' + st.elapsed + ' ms (sim)' : '≈ ' + st.elapsed + ' ms (wall)';
      E('rng', 0).textContent = st.sim ? 'seed ' + st.seed + ' → ChaCha8 (seeded)' : 'OS entropy → nondeterministic';
      // driver + RNG go red in real mode (time and randomness are no longer controlled)
      const drvCol = st.sim ? 'green' : 'red', rngCol = st.sim ? 'amber' : 'red';
      const drv = E('drv', 0); drv.setAttribute('fill', K.grad(uid, drvCol)); drv.setAttribute('stroke', c[drvCol]);
      const rb = E('rngbox', 0); rb.setAttribute('fill', K.grad(uid, rngCol)); rb.setAttribute('stroke', c[rngCol]);
      E('nethint', 0).textContent = st.sim ? 'driver-ordered' : 'jittery arrival';
      E('nethint', 0).setAttribute('fill', st.sim ? c.green : c.red);
      const mb = root.querySelector('.t-mode');
      mb.textContent = st.sim ? '◉ Simulated' : '◯ Real';
      mb.className = 'dstk-btn t-mode ' + (st.sim ? 'dstk-btn--green' : 'dstk-btn--red');
    }

    // Run ONE pass of the workload, producing a fingerprint. `pick` is the randomness source:
    //   sim  → a FRESH seeded K.rng(seed) (same seed ⇒ same sequence ⇒ same run);
    //   real → the non-seeded JS random API, used deliberately so each run diverges.
    async function runPass(label) {
      const sim = st.sim;
      const pick = sim ? K.rng(st.seed >>> 0) : Math.random;
      st.elapsed = 0; st.nodes = [0, 0, 0];
      for (let i = 0; i < NODES; i++) E('inb', i).textContent = '0';
      let h = 0x811c9dc5 >>> 0; // fingerprint accumulator (FNV-ish)
      K.addLog(logBody, `── run ${label} · ${sim ? 'seed ' + st.seed : 'wall clock'} ──`, 'hl');

      for (let s = 0; s < MAXSTEP; s++) {
        // ① deliver: who-talks-to-whom order from the chosen randomness source
        setPhase(0);
        const order = [0, 1, 2];
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(pick() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
        const to = order[0], from = (to + 1) % NODES;
        const netY = NET.y + NET.h / 2;
        await fly(nx(from) + NODE.w / 2, NODE.y + NODE.h, nx(from) + NODE.w / 2, netY, sim ? c.green : c.red, 150);
        await fly(nx(from) + NODE.w / 2, netY, nx(to) + NODE.w / 2, netY, sim ? c.green : c.red, 230);
        await fly(nx(to) + NODE.w / 2, netY, nx(to) + NODE.w / 2, NODE.y + NODE.h, sim ? c.green : c.red, 150);
        st.nodes[to]++; flash(E('box', to)); E('inb', to).textContent = st.nodes[to];

        // ② advance clock: exact tick in sim, jittery wall-clock in real
        setPhase(1);
        if (sim) st.elapsed += TICK;
        else st.elapsed += TICK + Math.floor(Math.random() * 40 - 12); // non-seeded jitter on purpose
        E('clk', 0).textContent = sim ? 't = ' + st.elapsed + ' ms (sim)' : '≈ ' + st.elapsed + ' ms (wall)';
        await K.delay(110);

        // ③ fold this event (from, to, time) into the run fingerprint
        setPhase(2);
        h = mix(h, from); h = mix(h, to); h = mix(h, st.elapsed | 0);
        K.addLog(logBody, `run ${label} · step ${s + 1}: n${from}→n${to} @${st.elapsed}ms` + (sim ? '' : ' (jitter)'), sim ? 'ok' : 'warn');
        await K.delay(90);
      }
      setPhase(-1);
      return ('0000000' + (h >>> 0).toString(16)).slice(-8);
    }

    // deterministic 32-bit mixer — fingerprint is a pure function of the event sequence
    function mix(h, x) { h = (h ^ (x >>> 0)) >>> 0; h = Math.imul(h, 0x01000193) >>> 0; return h; }

    async function runTwice() {
      if (st.busy) return;
      st.busy = true; setLock(true);
      // reset readouts
      st.runA = null; st.runB = null; st.step = 0;
      E('vfpA', 0).textContent = '········'; E('vfpB', 0).textContent = '········';
      E('vfpA', 0).setAttribute('fill', c.muted); E('vfpB', 0).setAttribute('fill', c.muted);
      E('vbig', 0).textContent = 'running A…'; E('vbig', 0).setAttribute('fill', c.muted);
      E('vsub', 0).textContent = 'first pass through the workload';
      render();

      st.runA = await runPass('A');
      stat('fpA', st.runA); E('vfpA', 0).textContent = st.runA; E('vfpA', 0).setAttribute('fill', c.text);
      E('vbig', 0).textContent = 'running B…'; E('vsub', 0).textContent = 'same workload, second pass';
      await K.delay(260);

      st.runB = await runPass('B');
      stat('fpB', st.runB); E('vfpB', 0).textContent = st.runB; E('vfpB', 0).setAttribute('fill', c.text);

      verdict();
      st.busy = false; setLock(false);
    }

    // The loud takeaway: do the two fingerprints match?
    function verdict() {
      const same = st.runA === st.runB;
      const col = same ? c.green : c.red;
      const big = E('vbig', 0), sub = E('vsub', 0), panel = E('vpanel', 0);
      big.setAttribute('fill', col); sub.setAttribute('fill', col); panel.setAttribute('stroke', col); panel.setAttribute('stroke-width', 2);
      panel.setAttribute('fill', K.grad(uid, same ? 'green' : 'red'));
      E('vfpA', 0).setAttribute('fill', col); E('vfpB', 0).setAttribute('fill', col);
      if (same) {
        big.textContent = '✓ SAME fingerprint';
        sub.textContent = 'same seed replayed the identical run — you can replay this bug any time';
      } else {
        big.textContent = '✗ DIFFERENT fingerprint';
        sub.textContent = 'wall-clock jitter shuffled the run — this exact run is gone forever';
      }
      animate(panel, { opacity: [0.4, 1], duration: 320, ease: 'out(2)' });
      K.addLog(logBody, same ? `verdict: A = B (${st.runA}) — reproducible` : `verdict: A (${st.runA}) ≠ B (${st.runB}) — lost`, same ? 'ok' : 'err');
    }

    async function fly(sx, sy, tx, ty, color, d) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: d || 230, ease: 'inOutQuad' });
      dot.remove();
    }
    function flash(b) { const old = b.getAttribute('stroke'); b.setAttribute('stroke', c.amber); animate(b, { opacity: [1, 0.45, 1], duration: 220, ease: 'inOut(2)', onComplete: () => b.setAttribute('stroke', old) }); }

    function bind() {
      root.querySelector('.t-run').onclick = () => { if (!st.busy) runTwice(); };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-mode').onclick = () => { if (st.busy) return; st.sim = !st.sim; reset(); };
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 0; reset(); };
    }

    function reset() {
      if (st.busy) return;
      st.step = 0; st.elapsed = 0; st.nodes = [0, 0, 0]; st.runA = null; st.runB = null;
      setLock(false); drawScene(); render(); setPhase(-1);
      K.addLog(logBody, st.sim ? '↺ reset — SIMULATED · same seed ⇒ same fingerprint, every run'
        : '↺ reset — REAL · each run diverges (wall-clock jitter)', st.sim ? 'hl' : 'warn');
    }
    function setLock(b) { K.lock(root, ['.t-run', '.t-reset', '.t-mode', '.t-seed'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTSimCluster = { init };
})();
