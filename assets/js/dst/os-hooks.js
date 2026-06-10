/**
 * DST OS-Hook Interposition — one syscall, two destinations, chosen by a gate.
 *
 * dst exports #[no_mangle] clock_gettime / getrandom that shadow libc at link time.
 * They return SIMULATED values only while USE_SIM_CLOCKS>0 AND the call originates inside an
 * actively-ticking node (in_node_context()); otherwise they delegate to the real symbol via
 * dlsym(RTLD_NEXT). Flip the gate and watch the same getrandom()/clock_gettime() call route to
 * the seeded StdRng / sim clock (deterministic, replayable) or out to /dev/urandom / the real
 * clock (nondeterministic).
 *
 * Re-skinned via dst-kit. Exposes window.DSTOsHooks.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('os-hooks: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('os-hooks: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  // Layout constants
  const W = 780, H = 300;
  // SUT box (left) — purple
  const SUT  = { x: 22,  y: 100, w: 160, h: 100 };
  // Gate diamond centre
  const GATE = { cx: 360, cy: 150, r: 58 };
  // Destination boxes (right)
  const SIM  = { x: 562, y: 54,  w: 196, h: 84 };
  const REAL = { x: 562, y: 162, w: 196, h: 84 };

  const bytesFrom = (rng, n) => Array.from({ length: n },
    () => Math.floor(rng() * 256).toString(16).padStart(2, '0')).join(' ');

  // Rust snippet for the clock_gettime shadow
  const RUST_SNIPPET = `#[no_mangle]
pub unsafe extern "C" fn clock_gettime(
    clk_id: libc::clockid_t,
    tp: *mut libc::timespec,
) -> libc::c_int {
    if USE_SIM_CLOCKS && in_node_context() {
        // deterministic: return the node's paused sim elapsed
        let elapsed = ClockGuard::sim_elapsed_ns();
        (*tp).tv_sec  = (elapsed / 1_000_000_000) as i64;
        (*tp).tv_nsec = (elapsed % 1_000_000_000) as i64;
        return 0;
    }
    // outside a ticking node — fall through to the real libc
    let real_fn: unsafe extern "C" fn(libc::clockid_t, *mut libc::timespec) -> libc::c_int =
        std::mem::transmute(dlsym(RTLD_NEXT, b"clock_gettime\\0".as_ptr() as _));
    real_fn(clk_id, tp)
}`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { gateOn: true, seed: 42, simElapsed: 1230, busy: false };
    let svg, content, anim, logBody, c;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--purple t-rand">getrandom()</button>
          <button class="dstk-btn dstk-btn--blue t-clock">clock_gettime()</button>
        </div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn t-gate dstk-btn--green">gate ON</button>
        </div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--amber t-replay">replay (same seed)</button>
        </div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">seed</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0">
        </div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'OS-hook interposition',
        sub: 'one syscall, two destinations',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'calls',   label: 'calls'   },
          { id: 'dest',    label: 'last dest'},
          { id: 'elapsed', label: 'sim ns'  },
        ],
        log: true,
        cap: 'The #[no_mangle] shadow intercepts every call; USE_SIM_CLOCKS && in_node_context() decides the route.',
      });
      c = K.palette();
      svg     = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim    = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
    }

    function drawScene() {
      content.innerHTML = '';

      // ── connector wires ──────────────────────────────────────────
      // SUT → gate
      K.el('line', {
        x1: SUT.x + SUT.w, y1: SUT.y + SUT.h / 2,
        x2: GATE.cx - GATE.r, y2: GATE.cy,
        stroke: c.separator, 'stroke-width': 2,
        'marker-end': K.arrow(uid, 'purple'),
      }, content);
      // gate → SIM (upper-right)
      const gmx = GATE.cx + GATE.r * Math.cos(-Math.PI / 4);
      const gmy = GATE.cy + GATE.r * Math.sin(-Math.PI / 4);
      K.el('line', {
        x1: gmx, y1: gmy,
        x2: SIM.x, y2: SIM.y + SIM.h / 2,
        stroke: c.green, 'stroke-width': 1.8,
        'stroke-dasharray': '5,4',
        'marker-end': K.arrow(uid, 'green'),
      }, content);
      // gate → REAL (lower-right)
      const grx = GATE.cx + GATE.r * Math.cos(Math.PI / 4);
      const gry = GATE.cy + GATE.r * Math.sin(Math.PI / 4);
      K.el('line', {
        x1: grx, y1: gry,
        x2: REAL.x, y2: REAL.y + REAL.h / 2,
        stroke: c.red, 'stroke-width': 1.8,
        'stroke-dasharray': '5,4',
        'marker-end': K.arrow(uid, 'red'),
      }, content);

      // ── SUT box (purple) ─────────────────────────────────────────
      K.el('rect', {
        x: SUT.x, y: SUT.y, width: SUT.w, height: SUT.h, rx: 10,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.8,
      }, content);
      K.el('text', {
        x: SUT.x + SUT.w / 2, y: SUT.y + 22,
        'text-anchor': 'middle', fill: c.purple, 'font-size': 12, 'font-weight': 700,
      }, content).textContent = 'your code / SUT';
      K.el('text', {
        x: SUT.x + SUT.w / 2, y: SUT.y + 42,
        'text-anchor': 'middle', fill: c.muted, 'font-size': 10,
      }, content).textContent = 'calls libc symbols';
      K.el('text', {
        x: SUT.x + SUT.w / 2, y: SUT.y + 57,
        'text-anchor': 'middle', fill: c.muted, 'font-size': 10,
      }, content).textContent = 'getrandom / clock_gettime';

      // ── gate diamond ─────────────────────────────────────────────
      const pts = `${GATE.cx},${GATE.cy - GATE.r} ${GATE.cx + GATE.r},${GATE.cy} ${GATE.cx},${GATE.cy + GATE.r} ${GATE.cx - GATE.r},${GATE.cy}`;
      K.el('polygon', {
        id: uid + '-gate-poly', points: pts, 'stroke-width': 2.2,
      }, content);
      K.el('text', {
        id: uid + '-gate-t1',
        x: GATE.cx, y: GATE.cy - 10,
        'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700,
      }, content).textContent = 'USE_SIM_CLOCKS>0';
      K.el('text', {
        id: uid + '-gate-t2',
        x: GATE.cx, y: GATE.cy + 4,
        'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700,
      }, content).textContent = '&&';
      K.el('text', {
        id: uid + '-gate-t3',
        x: GATE.cx, y: GATE.cy + 17,
        'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700,
      }, content).textContent = 'in_node_context()?';
      K.el('text', {
        x: GATE.cx, y: GATE.cy + GATE.r + 14,
        'text-anchor': 'middle', fill: c.muted, 'font-size': 9,
      }, content).textContent = '#[no_mangle] libc shadow';

      // ── SIM destination (green) ──────────────────────────────────
      K.el('rect', {
        x: SIM.x, y: SIM.y, width: SIM.w, height: SIM.h, rx: 10,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8,
      }, content);
      K.el('text', {
        x: SIM.x + SIM.w / 2, y: SIM.y + 22,
        'text-anchor': 'middle', fill: c.green, 'font-size': 11.5, 'font-weight': 700,
      }, content).textContent = 'seeded StdRng / sim clock';
      K.el('text', {
        x: SIM.x + SIM.w / 2, y: SIM.y + 38,
        'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5,
      }, content).textContent = 'deterministic · replayable';

      // ── REAL destination (red) ───────────────────────────────────
      K.el('rect', {
        x: REAL.x, y: REAL.y, width: REAL.w, height: REAL.h, rx: 10,
        fill: K.grad(uid, 'red'), stroke: c.red, 'stroke-width': 1.8,
      }, content);
      K.el('text', {
        x: REAL.x + REAL.w / 2, y: REAL.y + 22,
        'text-anchor': 'middle', fill: c.red, 'font-size': 11.5, 'font-weight': 700,
      }, content).textContent = '/dev/urandom / real clock';
      K.el('text', {
        x: REAL.x + REAL.w / 2, y: REAL.y + 38,
        'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5,
      }, content).textContent = 'via dlsym(RTLD_NEXT) · nondeterministic';

      // ── returned: readout ────────────────────────────────────────
      K.el('text', {
        x: SUT.x, y: H - 14,
        fill: c.muted, 'font-size': 10,
      }, content).textContent = 'returned:';
      K.el('text', {
        id: uid + '-ret',
        x: SUT.x + 62, y: H - 14,
        fill: c.text, 'font-size': 12, 'font-weight': 700,
        'font-family': 'ui-monospace,monospace',
        'font-variant-numeric': 'tabular-nums',
      }, content).textContent = '—';
    }

    function render() {
      const on = st.gateOn;
      // gate diamond colours
      const poly = svg.querySelector('#' + CSS.escape(uid + '-gate-poly'));
      if (poly) {
        poly.setAttribute('fill',   on ? K.grad(uid, 'green') : K.grad(uid, 'gray'));
        poly.setAttribute('stroke', on ? c.green : c.gray);
      }
      for (const tid of [uid + '-gate-t1', uid + '-gate-t2', uid + '-gate-t3']) {
        const t = svg.querySelector('#' + CSS.escape(tid));
        if (t) t.setAttribute('fill', on ? c.green : c.gray);
      }
      // gate button label + colour class
      const btn = root.querySelector('.t-gate');
      if (btn) {
        btn.textContent = on ? 'gate ON' : 'gate OFF';
        btn.className = 'dstk-btn t-gate ' + (on ? 'dstk-btn--green' : 'dstk-btn--ghost');
      }
    }

    function statSet(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    async function doCall(kind) {
      if (st.busy) return;
      st.busy = true;
      K.lock(root, ['.t-rand', '.t-clock', '.t-gate', '.t-replay', '.t-seed'], true);

      const on = st.gateOn;
      const target = on ? SIM : REAL;
      const zone   = on ? 'green' : 'red';

      // particle: SUT → gate
      const dot = K.el('circle', {
        cx: SUT.x + SUT.w, cy: SUT.y + SUT.h / 2,
        r: 7, fill: c.purple, filter: K.glow(uid),
      }, anim);
      await animate(dot, { cx: GATE.cx, cy: GATE.cy, duration: 380, ease: 'inOutQuad' });

      // recolour at the gate
      dot.setAttribute('fill', on ? c.green : c.red);

      // particle: gate → destination
      await animate(dot, {
        cx: target.x + target.w / 2, cy: target.y + target.h / 2,
        duration: 380, ease: 'inOutQuad',
      });
      await animate(dot, { r: [7, 14], opacity: [1, 0], duration: 180, ease: 'out(2)' });
      dot.remove();

      // compute return value
      let ret, msg, cls;
      const rng = K.rng(st.seed >>> 0);
      if (kind === 'rand') {
        if (on) {
          ret = bytesFrom(rng, 6);
          msg = `getrandom → seeded StdRng(${st.seed}): ${ret}`;
          cls = 'ok';
        } else {
          ret = bytesFrom(K.rng((Date.now() ^ Math.floor(performance.now())) >>> 0), 6) + ' (real)';
          msg = 'getrandom → /dev/urandom: nondeterministic bytes';
          cls = 'warn';
        }
      } else {
        if (on) {
          st.simElapsed += 10000000; // advance by 10 ms in ns
          ret = st.simElapsed + ' ns (sim)';
          msg = `clock_gettime → sim clock: ${st.simElapsed} ns`;
          cls = 'ok';
        } else {
          ret = Math.floor(performance.now() * 1e6) + ' ns (real)';
          msg = 'clock_gettime → real OS clock: nondeterministic';
          cls = 'warn';
        }
      }
      st.busy = false;
      K.lock(root, ['.t-rand', '.t-clock', '.t-gate', '.t-replay', '.t-seed'], false);

      // update return readout
      const retEl = svg.querySelector('#' + CSS.escape(uid + '-ret'));
      if (retEl) {
        retEl.textContent = ret;
        retEl.setAttribute('fill', on ? c.green : c.red);
      }

      // stats
      statSet('calls', (parseInt(root.querySelector('#' + CSS.escape(uid + '-stat-calls')).textContent, 10) || 0) + 1);
      statSet('dest', on ? 'sim' : 'real');
      statSet('elapsed', on ? st.simElapsed : '—');

      K.addLog(logBody, msg, cls);
    }

    async function doReplay() {
      if (st.busy) return;
      const rngA = K.rng(st.seed >>> 0);
      const rngB = K.rng(st.seed >>> 0);
      const a = bytesFrom(rngA, 6);
      const b = bytesFrom(rngB, 6);
      K.addLog(logBody, `replay seed ${st.seed} run A: ${a}`, 'ok');
      await K.delay(60);
      K.addLog(logBody, `replay seed ${st.seed} run B: ${b}  → ${a === b ? 'identical' : 'DIFFER'}`, a === b ? 'hl' : 'err');
      const retEl = svg.querySelector('#' + CSS.escape(uid + '-ret'));
      if (retEl) { retEl.textContent = a; retEl.setAttribute('fill', c.green); }
    }

    function bind() {
      root.querySelector('.t-rand').onclick  = () => doCall('rand');
      root.querySelector('.t-clock').onclick = () => doCall('clock');
      root.querySelector('.t-gate').onclick  = () => {
        if (st.busy) return;
        st.gateOn = !st.gateOn;
        K.addLog(logBody,
          st.gateOn
            ? 'gate ON — in_node_context() true → simulated values'
            : 'gate OFF — outside sim context → dlsym(RTLD_NEXT)',
          st.gateOn ? 'ok' : 'warn');
        render();
      };
      root.querySelector('.t-replay').onclick = doReplay;
      root.querySelector('.t-seed').onchange  = (e) => { st.seed = parseInt(e.target.value, 10) || 42; };
    }

    K.addLog(logBody, 'gate ON — calls return simulated, replayable values', 'hl');
    render();

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });

    // inject the syntax-highlighted Rust snippet below the widget
    const snippet = document.getElementById(uid + '-snippet');
    if (snippet) snippet.innerHTML = K.highlightRust(RUST_SNIPPET);
  }

  window.DSTOsHooks = { init };
})();
