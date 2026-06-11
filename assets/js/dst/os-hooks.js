/**
 * DST OS-Hook Interposition — the same syscall goes to the sim inside a node, or to the real OS outside.
 *
 * dst exports #[no_mangle] clock_gettime / getrandom that shadow libc at link time, but they gate
 * DIFFERENTLY. clock_gettime returns SIMULATED time only while USE_SIM_CLOCKS>0 AND the call is inside
 * an actively-ticking node (in_node_context()); otherwise it delegates to the real symbol via
 * dlsym(RTLD_NEXT) (clock.rs:114-117,104-105). getrandom serves seeded StdRng bytes whenever a seeded
 * RNG is installed (RNG_CELL is Some) — it does NOT consult in_node_context() — and otherwise reads
 * /dev/urandom DIRECTLY, with no dlsym (rand.rs:18-46). Flip the gate and watch the same call route to
 * the seeded source (deterministic, replayable) or out to the real OS source (nondeterministic).
 *
 * Re-skinned via dst-kit. Exposes window.DSTOsHooks.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('os-hooks: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('os-hooks: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 250;
  // caller box (left) — the same syscall always starts here
  const SUT  = { x: 22,  y: 92,  w: 168, h: 66 };
  // the gate where the routing decision happens
  const GATE = { cx: 360, cy: 125, r: 56 };
  // two destinations (right): the sim (top, green) and the real OS (bottom, red)
  const SIM  = { x: 560, y: 56,  w: 198, h: 70 };
  const REAL = { x: 560, y: 158, w: 198, h: 70 };

  // Two syscalls the SUT might make. Each gates DIFFERENTLY (clock.rs:139-144 vs rand.rs:36-46), so
  // each carries its own gate framing: the deterministic-source question + the on/off words + the
  // exact source-code condition (mono). clock_gettime asks in_node_context(); getrandom does NOT —
  // it asks whether a seeded RNG is installed (RNG_CELL is Some). 'in' = the deterministic branch.
  const CALLS = {
    clock: { call: 'clock_gettime()', plain: 'what time is it?',     zone: 'blue',
      gTop: 'are we',  gIn: 'inside', gOut: 'outside', gBot: 'a node?',
      cond: 'in_node_context()', ctxIn: 'inside a node', ctxOut: 'outside a node' },
    rand:  { call: 'getrandom()',     plain: 'give me random bytes', zone: 'pink',
      gTop: 'seeded RNG', gIn: 'installed', gOut: 'absent', gBot: 'for the run?',
      cond: 'RNG_CELL.is_some()', ctxIn: 'seeded RNG set', ctxOut: 'no seeded RNG' },
  };

  // SIMULATION randomness comes from a seeded mulberry32 (K.rng) → deterministic, replayable.
  const seededBytes = (rng, n) => Array.from({ length: n },
    () => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join(' ');
  // The "real OS" branch is DELIBERATELY nondeterministic — it uses the non-seeded JS clock/random
  // so two reads differ, exactly like /dev/urandom. (This is the one allowed use of unseeded randomness.)
  const realBytes = (n) => Array.from({ length: n },
    () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(' ');

  const RUST_SNIPPET = `#[no_mangle]                               // shadows libc at link time
pub unsafe extern "C" fn clock_gettime(id, tp) -> c_int {
    if USE_SIM_CLOCKS && in_node_context() {
        return write_sim_elapsed(tp);          // inside a node → seeded sim time
    }
    let real = dlsym(RTLD_NEXT, "clock_gettime");
    real(id, tp)                               // outside a node → the real OS clock
}`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    // inside === call is inside a ticking node (the gate's condition is met)
    const st = { inside: true, seed: 42, kind: 'clock', simElapsed: 1230, calls: 0, busy: false };
    let svg, content, anim, logBody, c;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">syscall</span>
          <button class="dstk-btn dstk-btn--blue t-clock">clock_gettime()</button>
          <button class="dstk-btn dstk-btn--pink t-rand">getrandom()</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">context</span>
          <button class="dstk-btn t-ctx dstk-btn--green">inside a node</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--amber t-replay">replay seed</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'The same syscall goes to the sim inside a node — or to the real OS outside',
        sub: 'clock_gettime / getrandom, routed by where the call is made',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'verdict', label: 'last route' },
          { id: 'source',  label: 'value from' },
          { id: 'calls',   label: 'calls made' },
        ],
        log: true,
        cap: 'One #[no_mangle] shadow intercepts the call. Inside a ticking node it returns a seeded, '
           + 'replayable value (the sim). Outside, it falls through to the real OS — nondeterministic. '
           + 'Pick a syscall and flip "caller is" to watch the same call take a different road.',
      });
      c = K.palette();
      svg     = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim    = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      // Rust snippet right under the toolbar (paused-clock idiom)
      const code = document.createElement('div');
      code.innerHTML = K.highlightRust(RUST_SNIPPET);
      root.querySelector('.dstk-toolbar').insertAdjacentElement('afterend', code.firstChild);
      drawScene(); bind(); render();
      statSet('verdict', '—'); statSet('source', '—'); statSet('calls', '0');
      K.addLog(logBody, `🌱 ${CALLS[st.kind].ctxIn} → the same call returns seeded, replayable values`, 'hl');
    }

    function drawScene() {
      content.innerHTML = '';

      // ── routes: caller → gate, gate → sim, gate → real ──────────────
      K.el('line', { id: uid + '-wire-in', x1: SUT.x + SUT.w, y1: SUT.y + SUT.h / 2,
        x2: GATE.cx - GATE.r, y2: GATE.cy, stroke: c.muted, 'stroke-width': 2.2,
        'marker-end': K.arrow(uid, 'gray') }, content);
      const gux = GATE.cx + GATE.r * Math.cos(-Math.PI / 4), guy = GATE.cy + GATE.r * Math.sin(-Math.PI / 4);
      K.el('line', { id: uid + '-wire-sim', x1: gux, y1: guy, x2: SIM.x, y2: SIM.y + SIM.h / 2,
        stroke: c.separator, 'stroke-width': 2, 'stroke-dasharray': '6,5',
        'marker-end': K.arrow(uid, 'green') }, content);
      const glx = GATE.cx + GATE.r * Math.cos(Math.PI / 4), gly = GATE.cy + GATE.r * Math.sin(Math.PI / 4);
      K.el('line', { id: uid + '-wire-real', x1: glx, y1: gly, x2: REAL.x, y2: REAL.y + REAL.h / 2,
        stroke: c.separator, 'stroke-width': 2, 'stroke-dasharray': '6,5',
        'marker-end': K.arrow(uid, 'red') }, content);

      // ── caller box (the SUT) ────────────────────────────────────────
      K.el('rect', { x: SUT.x, y: SUT.y, width: SUT.w, height: SUT.h, rx: 10,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.8 }, content);
      K.el('text', { x: SUT.x + SUT.w / 2, y: SUT.y + 24, 'text-anchor': 'middle',
        fill: c.purple, 'font-size': 12, 'font-weight': 700 }, content).textContent = 'your code';
      K.el('text', { id: uid + '-callname', x: SUT.x + SUT.w / 2, y: SUT.y + 46, 'text-anchor': 'middle',
        fill: c.text, 'font-size': 12.5, 'font-weight': 700,
        'font-family': 'ui-monospace,monospace' }, content).textContent = CALLS[st.kind].call;

      // ── gate diamond: plain question, with a small "inside?" tag ────
      const pts = `${GATE.cx},${GATE.cy - GATE.r} ${GATE.cx + GATE.r},${GATE.cy} ${GATE.cx},${GATE.cy + GATE.r} ${GATE.cx - GATE.r},${GATE.cy}`;
      K.el('polygon', { id: uid + '-gate', points: pts, 'stroke-width': 2.4 }, content);
      K.el('text', { id: uid + '-gate-top', x: GATE.cx, y: GATE.cy - 16, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 10 }, content).textContent = CALLS[st.kind].gTop;
      K.el('text', { id: uid + '-gate-q', x: GATE.cx, y: GATE.cy + 1, 'text-anchor': 'middle',
        'font-size': 14, 'font-weight': 700 }, content).textContent = CALLS[st.kind].gIn;
      K.el('text', { id: uid + '-gate-bot', x: GATE.cx, y: GATE.cy + 18, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 10 }, content).textContent = CALLS[st.kind].gBot;
      K.el('text', { id: uid + '-gate-cond', x: GATE.cx, y: GATE.cy + GATE.r + 15, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 8.5, 'font-family': 'ui-monospace,monospace' }, content)
        .textContent = 'in_node_context()';
      // yes/no edge labels
      K.el('text', { x: gux + 14, y: guy - 6, 'text-anchor': 'middle',
        fill: c.green, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'yes';
      K.el('text', { x: glx + 12, y: gly + 14, 'text-anchor': 'middle',
        fill: c.red, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'no';

      // ── SIM destination (green, top) ────────────────────────────────
      K.el('rect', { id: uid + '-sim-box', x: SIM.x, y: SIM.y, width: SIM.w, height: SIM.h, rx: 10,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      K.el('text', { x: SIM.x + SIM.w / 2, y: SIM.y + 24, 'text-anchor': 'middle',
        fill: c.green, 'font-size': 12.5, 'font-weight': 700 }, content).textContent = 'the simulator';
      K.el('text', { id: uid + '-sim-mech', x: SIM.x + SIM.w / 2, y: SIM.y + 44, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 9.5 }, content).textContent = 'seeded · deterministic · replayable';

      // ── REAL destination (red, bottom) ──────────────────────────────
      K.el('rect', { id: uid + '-real-box', x: REAL.x, y: REAL.y, width: REAL.w, height: REAL.h, rx: 10,
        fill: K.grad(uid, 'red'), stroke: c.red, 'stroke-width': 1.8 }, content);
      K.el('text', { x: REAL.x + REAL.w / 2, y: REAL.y + 24, 'text-anchor': 'middle',
        fill: c.red, 'font-size': 12.5, 'font-weight': 700 }, content).textContent = 'the real OS';
      K.el('text', { id: uid + '-real-mech', x: REAL.x + REAL.w / 2, y: REAL.y + 44, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 9.5 }, content).textContent = 'real clock · nondeterministic';

      // ── loud verdict banner + the returned value ────────────────────
      K.el('rect', { id: uid + '-vbox', x: SUT.x, y: H - 46, width: W - 44, height: 34, rx: 8,
        fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
      K.el('text', { id: uid + '-vlabel', x: SUT.x + 12, y: H - 25, fill: c.muted,
        'font-size': 12, 'font-weight': 700 }, content).textContent = 'press a syscall to see where it goes';
      K.el('text', { id: uid + '-vval', x: W - 56, y: H - 25, 'text-anchor': 'end',
        fill: c.muted, 'font-size': 11.5, 'font-weight': 700,
        'font-family': 'ui-monospace,monospace', 'font-variant-numeric': 'tabular-nums' }, content)
        .textContent = '';
    }

    function statSet(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // Paint the static scene to reflect inside/outside + which syscall is selected.
    function render() {
      const inside = st.inside;
      const meta = CALLS[st.kind];
      // gate fill + framing words (each syscall gates on a DIFFERENT condition — see CALLS)
      const gate = E('gate');
      if (gate) {
        gate.setAttribute('fill', inside ? K.grad(uid, 'green') : K.grad(uid, 'red'));
        gate.setAttribute('stroke', inside ? c.green : c.red);
      }
      const gtop = E('gate-top'); if (gtop) gtop.textContent = meta.gTop;
      const gbot = E('gate-bot'); if (gbot) gbot.textContent = meta.gBot;
      const gq = E('gate-q'); if (gq) { gq.textContent = inside ? meta.gIn : meta.gOut; gq.setAttribute('fill', inside ? c.green : c.red); }

      // dim the road NOT taken; light the chosen one
      const wSim = E('wire-sim'), wReal = E('wire-real');
      if (wSim)  { wSim.setAttribute('stroke',  inside ? c.green : c.separator); wSim.setAttribute('stroke-width', inside ? 2.4 : 1.4); }
      if (wReal) { wReal.setAttribute('stroke', inside ? c.separator : c.red);   wReal.setAttribute('stroke-width', inside ? 1.4 : 2.4); }
      const simBox = E('sim-box'), realBox = E('real-box');
      if (simBox)  simBox.setAttribute('opacity',  inside ? 1 : 0.4);
      if (realBox) realBox.setAttribute('opacity', inside ? 0.4 : 1);

      // selected syscall name in the caller box + exact gate condition + real mechanism (per call)
      const cn = E('callname'); if (cn) cn.textContent = meta.call;
      const cond = E('gate-cond');
      if (cond) cond.textContent = meta.cond;
      const sm = E('sim-mech');
      if (sm) sm.textContent = st.kind === 'rand' ? 'seeded StdRng · replayable' : 'paused sim clock · replayable';
      const rm = E('real-mech');
      if (rm) rm.textContent = st.kind === 'rand' ? '/dev/urandom · nondeterministic' : 'dlsym(RTLD_NEXT) · nondeterministic';

      // context toggle button — wording matches the selected syscall's actual gate
      const btn = root.querySelector('.t-ctx');
      if (btn) {
        btn.textContent = inside ? meta.ctxIn : meta.ctxOut;
        btn.className = 'dstk-btn t-ctx ' + (inside ? 'dstk-btn--green' : 'dstk-btn--red');
      }
      // highlight the active syscall button
      const cb = root.querySelector('.t-clock'), rb = root.querySelector('.t-rand');
      if (cb) cb.style.opacity = st.kind === 'clock' ? '1' : '0.55';
      if (rb) rb.style.opacity = st.kind === 'rand' ? '1' : '0.55';
    }

    // The loud takeaway: a banner that lights up green (sim) or red (real OS).
    function showVerdict(inside, valueText) {
      const vbox = E('vbox'), vl = E('vlabel'), vv = E('vval');
      const col = inside ? c.green : c.red;
      if (vbox) {
        vbox.setAttribute('fill', inside ? K.grad(uid, 'green') : K.grad(uid, 'red'));
        vbox.setAttribute('stroke', col); vbox.setAttribute('stroke-width', 2.2);
        vbox.setAttribute('filter', K.glow(uid));
        animate(vbox, { opacity: [0.35, 1], duration: 220, ease: 'out(2)' });
      }
      if (vl) {
        vl.textContent = inside
          ? '✓ went to the SIMULATOR — seeded, replayable'
          : '✗ fell through to the REAL OS — nondeterministic';
        vl.setAttribute('fill', col);
      }
      if (vv) { vv.textContent = valueText; vv.setAttribute('fill', col); }
    }

    async function doCall() {
      if (st.busy) return;
      st.busy = true;
      K.lock(root, ['.t-clock', '.t-rand', '.t-ctx', '.t-replay', '.t-seed'], true);

      const inside = st.inside;
      const target = inside ? SIM : REAL;

      // particle: caller → gate
      const dot = K.el('circle', { cx: SUT.x + SUT.w, cy: SUT.y + SUT.h / 2,
        r: 7, fill: c.purple, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: GATE.cx, cy: GATE.cy, duration: 360, ease: 'inOutQuad' });
      // recolour at the gate to match the road it now takes
      dot.setAttribute('fill', inside ? c.green : c.red);
      // particle: gate → chosen destination
      await animate(dot, { cx: target.x + target.w / 2, cy: target.y + target.h / 2,
        duration: 360, ease: 'inOutQuad' });
      await animate(dot, { r: [7, 14], opacity: [1, 0], duration: 160, ease: 'out(2)' });
      dot.remove();

      // compute the returned value (seeded inside; deliberately unseeded outside)
      let value, msg, cls;
      if (st.kind === 'rand') {
        if (inside) {
          value = seededBytes(K.rng(st.seed >>> 0), 5);
          msg = `getrandom() · seeded RNG set → StdRng(${st.seed}): ${value}`; cls = 'ok';
        } else {
          value = realBytes(5);
          msg = `getrandom() · no seeded RNG → /dev/urandom: ${value}`; cls = 'warn';
        }
      } else {
        if (inside) {
          st.simElapsed += 10000000; // +10 ms of sim time, in ns
          value = st.simElapsed + ' ns';
          msg = `clock_gettime() inside node → sim clock: ${value}`; cls = 'ok';
        } else {
          value = Math.floor(performance.now() * 1e6) + ' ns';
          msg = `clock_gettime() outside → real OS clock: ${value}`; cls = 'warn';
        }
      }

      st.calls++;
      statSet('verdict', inside ? '→ sim' : '→ real OS');
      statSet('source', inside ? 'seeded' : 'real OS');
      statSet('calls', st.calls);
      showVerdict(inside, value);
      K.addLog(logBody, msg, cls);

      st.busy = false;
      K.lock(root, ['.t-clock', '.t-rand', '.t-ctx', '.t-replay', '.t-seed'], false);
    }

    // Prove the sim branch is replayable: same seed twice → identical bytes (only meaningful inside a node).
    async function doReplay() {
      if (st.busy) return;
      const a = seededBytes(K.rng(st.seed >>> 0), 5);
      const b = seededBytes(K.rng(st.seed >>> 0), 5);
      K.addLog(logBody, `replay seed ${st.seed} · run A: ${a}`, 'ok');
      await K.delay(80);
      const same = a === b;
      K.addLog(logBody, `replay seed ${st.seed} · run B: ${b} → ${same ? 'IDENTICAL' : 'DIFFER'}`, same ? 'hl' : 'err');
      showVerdict(true, a);
      statSet('verdict', '→ sim'); statSet('source', 'seeded');
    }

    function bind() {
      root.querySelector('.t-clock').onclick = () => { if (st.busy) return; st.kind = 'clock'; render(); doCall(); };
      root.querySelector('.t-rand').onclick  = () => { if (st.busy) return; st.kind = 'rand';  render(); doCall(); };
      root.querySelector('.t-ctx').onclick   = () => {
        if (st.busy) return;
        st.inside = !st.inside;
        K.addLog(logBody, st.inside
          ? `${CALLS[st.kind].ctxIn} → the same call now returns seeded, replayable values`
          : `${CALLS[st.kind].ctxOut} → the same call now falls through to the real OS`, st.inside ? 'ok' : 'warn');
        render();
      };
      root.querySelector('.t-replay').onclick = doReplay;
      root.querySelector('.t-seed').onchange  = (e) => {
        st.seed = parseInt(e.target.value, 10) || 42;
        K.addLog(logBody, '🌱 seed → ' + st.seed + ' · the sim branch reproduces this exactly', 'hl');
      };
    }

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTOsHooks = { init };
})();
