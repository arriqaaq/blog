/**
 * DST clock_gettime recursion (re-skinned via dst-kit) — the bug that forced our own framework.
 *
 * Our test hook intercepts clock_gettime so paused sim time is what the runtime sees. The buggy
 * guard asked "are we inside the sim?" via sim_elapsed(), which itself reads the host
 * timer → tokio Instant::now() → std Instant::now() → clock_gettime → our hook → … unbounded
 * recursion that blows the stack the moment a crash/bounce probes the clock. The one-line fix swaps
 * the guard to tokio::runtime::Handle::try_current().is_ok(): a TLS-only check that never reads a
 * clock, so the hook returns paused sim time immediately and the stack stays shallow.
 *
 * Exposes window.DSTClockRecursion.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('clock-recursion: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('clock-recursion: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 360;
  const FR = { x: 360, w: 392, h: 36, gap: 8, y0: 30 };  // call-stack frames (right column)
  const MAXFR = 7;                                        // frames visible before the marker
  // The recursion cycle: clock_gettime → sim_elapsed → try_current_host → timer → tokio → std → back
  const CYCLE = [
    { fn: 'clock_gettime (our hook)', zone: 'amber' },
    { fn: 'sim_elapsed()', zone: 'purple' },
    { fn: 'World::try_current_host()', zone: 'purple' },
    { fn: 'host.timer.sim_elapsed()', zone: 'blue' },
    { fn: 'tokio Instant::now()', zone: 'blue' },
    { fn: 'std Instant::now()', zone: 'gray' },
  ];

  const SNIP_BUG = `fn clock_gettime(..) -> i64 {
    // "are we inside the sim?" — but this READS the clock
    if sim_elapsed().is_some() {   // ← recurses
        return sim_now();
    }
    real_clock_gettime(..)
}`;
  const SNIP_FIX = `fn clock_gettime(..) -> i64 {
    // TLS-only: no clock read, no recursion
    if Handle::try_current().is_ok() {      // ← safe
        return sim_now();
    }
    real_clock_gettime(..)
}`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { seed: 7, fixed: false, depth: 0, frames: [], crashed: false, playing: false, busy: false, speed: 1 };
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const idf = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(idf(k, i)));
    const frY = (i) => FR.y0 + i * (FR.h + FR.gap);

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--red t-crash">⚡ Trigger crash()</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">guard</span>
          <button class="dstk-btn dstk-btn--amber t-bug">Buggy</button>
          <button class="dstk-btn dstk-btn--ghost t-fix">Fixed</button></div>
        <span class="dstk-sp"></span>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'The clock_gettime recursion', sub: 'the bug that forced our own framework',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'depth', label: 'stack depth' }, { id: 'mode', label: 'guard' }],
        cap: K.highlightRust(st.fixed ? SNIP_FIX : SNIP_BUG),
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, st.fixed
        ? '🌱 Fixed guard — Handle::try_current() reads TLS only, never the clock'
        : '🌱 Buggy guard — sim_elapsed() reads the clock to ask if we should read the clock', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // left column: the trigger / explanation
      const lx = 24;
      K.el('text', { x: lx, y: 26, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'crash(n2) probes the clock';
      const lines = st.fixed
        ? ['runtime tears down a host;', 'the hook fires while sim is paused.', '',
           'Handle::try_current() only touches', 'thread-local runtime context —', 'no clock, no descent.',
           '', 'Hook returns paused sim time at once.', 'Stack stays one frame deep. ✓']
        : ['runtime tears down a host;', 'the hook fires while sim is paused.', '',
           'The guard calls sim_elapsed() to', 'decide — but that reads the host', 'timer → tokio → std → clock_gettime',
           '→ our hook → the guard again …', '', 'Each turn pushes the same frames.'];
      lines.forEach((t, i) => {
        K.el('text', { x: lx, y: 52 + i * 18, fill: i >= 3 ? c.text : c.muted, 'font-size': 11 }, content).textContent = t;
      });
      K.el('text', { x: FR.x, y: 18, fill: c.text, 'font-size': 12, 'font-weight': 700 }, content).textContent = 'call stack (grows downward)';
      // marker slot (overflow vs clean return) drawn by render()
      K.el('g', { id: uid + '-stackg' }, content);
      K.el('g', { id: uid + '-mark' }, content);
    }

    function pushFrame(i) {
      const cyc = CYCLE[i % CYCLE.length];
      const turn = Math.floor(i / CYCLE.length);
      st.frames.push({ fn: cyc.fn, zone: cyc.zone, turn });
      st.depth = st.frames.length;
      const stackg = svg.querySelector('#' + CSS.escape(uid + '-stackg'));
      const idx = st.frames.length - 1, y = frY(idx);
      const g = K.el('g', { id: idf('fr', idx), opacity: 0 }, stackg);
      K.el('rect', { x: FR.x, y, width: FR.w, height: FR.h, rx: 6, fill: K.grad(uid, cyc.zone),
        stroke: c[cyc.zone], 'stroke-width': 1.6 }, g);
      K.el('text', { x: FR.x + 12, y: y + 16, fill: c.text, 'font-size': 11.5, 'font-weight': 600 }, g).textContent = cyc.fn;
      const tag = turn > 0 ? `recursion turn ${turn + 1} — same frames again` : 'first descent';
      K.el('text', { x: FR.x + 12, y: y + 30, fill: c.muted, 'font-size': 9 }, g).textContent = tag;
      return animate(g, { opacity: [0, 1], translateX: [16, 0], duration: dur(160), ease: 'out(2)' });
    }

    function render() {
      stat('depth', st.depth + (st.crashed && !st.fixed ? ' ↯' : ''));
      stat('mode', st.fixed ? 'Fixed' : 'Buggy');
      root.querySelector('.t-bug').className = 'dstk-btn t-bug ' + (st.fixed ? 'dstk-btn--ghost' : 'dstk-btn--amber');
      root.querySelector('.t-fix').className = 'dstk-btn t-fix ' + (st.fixed ? 'dstk-btn--green' : 'dstk-btn--ghost');
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function clearStack() {
      st.frames = []; st.depth = 0; st.crashed = false;
      const sg = svg.querySelector('#' + CSS.escape(uid + '-stackg'));
      const mg = svg.querySelector('#' + CSS.escape(uid + '-mark'));
      if (sg) sg.innerHTML = ''; if (mg) mg.innerHTML = '';
    }

    function drawMarker(kind) {
      const mg = svg.querySelector('#' + CSS.escape(uid + '-mark')); if (!mg) return;
      mg.innerHTML = '';
      const y = frY(Math.min(st.frames.length, MAXFR + 1));
      const color = kind === 'crash' ? c.red : c.green;
      const box = K.el('rect', { x: FR.x, y, width: FR.w, height: FR.h, rx: 6, fill: K.grad(uid, kind === 'crash' ? 'red' : 'green'),
        stroke: color, 'stroke-width': 2, 'stroke-dasharray': kind === 'crash' ? '6,4' : '0', opacity: 0, filter: K.glow(uid) }, mg);
      K.el('text', { x: FR.x + 12, y: y + 22, fill: color, 'font-size': 12, 'font-weight': 700 }, mg).textContent =
        kind === 'crash' ? 'SIGTRAP — stack overflow' : 'returns sim_now() — clean';
      animate(box, { opacity: [0, 1], duration: dur(220), ease: 'out(2)' });
    }

    // BUGGY: keep pushing the same 6-frame cycle until we top out → overflow.
    async function crashBuggy() {
      const r = K.rng(st.seed);
      K.addLog(logBody, 'crash(n2): hook fires; guard calls sim_elapsed() to decide…', 'warn');
      let i = 0;
      while (st.frames.length < MAXFR) {
        await pushFrame(i);
        const cyc = CYCLE[i % CYCLE.length];
        if (cyc.fn.indexOf('clock_gettime') === 0 && i > 0) {
          K.addLog(logBody, `↩ back in our hook (turn ${Math.floor(i / CYCLE.length) + 1}) — and it asks again`, 'err');
        }
        i++;
        await K.delay(dur(120 + r() * 60));
        if (st.busy === false) return; // reset interrupted
      }
      st.crashed = true; render();
      drawMarker('crash');
      K.addLog(logBody, '💥 SIGTRAP: guard ⇒ clock read ⇒ guard … unbounded. This forced our own framework.', 'err');
    }

    // FIXED: the guard is a TLS check, so the hook returns immediately — depth 1, clean return.
    async function crashFixed() {
      K.addLog(logBody, 'crash(n2): hook fires; guard = Handle::try_current().is_ok() (TLS only)', 'warn');
      await pushFrame(0); // only our hook frame
      await K.delay(dur(220));
      if (st.busy === false) return;
      st.crashed = true; render();
      drawMarker('ok');
      K.addLog(logBody, '✓ TLS says "inside sim" → returns paused sim time. No clock read, stack depth 1.', 'ok');
    }

    async function trigger() {
      if (st.busy) return;
      st.busy = true; setLock(true); clearStack(); render();
      if (st.fixed) await crashFixed(); else await crashBuggy();
      st.busy = false; setLock(false);
    }

    function setMode(fixed) {
      if (st.busy || st.fixed === fixed) { if (st.fixed === fixed) render(); return; }
      st.fixed = fixed; clearStack();
      // rebuild to swap the code snippet caption, then re-render state
      build();
      K.addLog(logBody, fixed
        ? 'guard → Handle::try_current().is_ok(): the one-line fix that broke the cycle'
        : 'guard → sim_elapsed().is_some(): reads the clock to decide whether to read the clock', 'hl');
    }

    function bind() {
      root.querySelector('.t-crash').onclick = trigger;
      root.querySelector('.t-bug').onclick = () => setMode(false);
      root.querySelector('.t-fix').onclick = () => setMode(true);
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
    }

    function reset() {
      st.busy = false; clearStack(); render();
      K.addLog(logBody, '↺ reset — ' + (st.fixed ? 'Fixed guard' : 'Buggy guard') + ', stack empty', 'hl');
      setLock(false);
    }
    function setLock(b) { K.lock(root, ['.t-crash', '.t-bug', '.t-fix', '.t-reset'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTClockRecursion = { init };
})();
