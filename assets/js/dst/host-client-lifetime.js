/**
 * DST Host vs Client lifetime (re-skinned via dst-kit) — who ends the simulation?
 *
 * Two lanes show the lifetime contract of sim.host(...) vs sim.client(...). The HOST is built
 * from a factory and runs a future that never returns (futures::future::pending()), so it loops
 * forever — a small repeating pulse. Crashing it aborts the task and rebuilds the runtime
 * (core.rs:201-235, runtime.rs:156-179); bouncing re-invokes the host FACTORY, restarts the task
 * fresh, and accounts a 1 ms INIT_ALIGN warm-up before it resumes (runtime.rs:37 INIT_ALIGN = 1ms,
 * core.rs:55-59 account_init_align adds it to ctx.elapsed). A host stopping never ends the run.
 *
 * The CLIENT (registered first as node-0 so sequential IP assignment lines up) runs a future that
 * completes. When it resolves, step() returns all_clients_done and sim.run() returns — the WHOLE
 * SIM ENDS. Clients carry task_factory: None (runtime.rs:102), so bouncing one errors:
 * "cannot bounce a client (no task factory)".
 *
 * Exposes window.DSTHostClientLifetime.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('host-client-lifetime: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('host-client-lifetime: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 300;
  const LANE = { x: 28, w: W - 56, h: 96, gap: 18 };
  const HOST = { y: 70 };
  const CLIENT = { y: HOST.y + LANE.h + LANE.gap };
  const PULSE = { r: 7 };

  const SNIPPET = `sim.client("coordinator", async {        // node-0: registered first
    coordinator.run_until_quorum().await        // completes → sim.run() returns
});
sim.host("node-1", || async {                   // restartable factory
    futures::future::pending().await            // never returns: loops forever
});`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    // host: 'running' | 'crashed' ; client: 'running' | 'done'
    const st = { host: 'running', client: 'running', simRunning: true, busy: false, elapsed: 0, pulseAnim: null };
    let svg, content, anim, logBody, c;
    const id = (k) => `${uid}-${k}`;
    const E = (k) => svg.querySelector('#' + CSS.escape(id(k)));

    build();

    function controls() {
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">host</span>
        <button class="dstk-btn dstk-btn--red t-crash">⚡ crash</button>
        <button class="dstk-btn dstk-btn--ghost t-bounce">↻ bounce</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">client</span>
          <button class="dstk-btn dstk-btn--green t-complete">✓ complete client</button>
          <button class="dstk-btn dstk-btn--ghost t-cbounce">↻ bounce</button></div>
        <span class="dstk-sp"></span>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Host vs client lifetime', sub: 'who ends the simulation?',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'host', label: 'host' }, { id: 'client', label: 'client' }, { id: 'run', label: 'sim running?' }],
        cap: 'Hosts are crashable and run forever; the client’s completion ends the simulation.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render(); startPulse();
      K.addLog(logBody, '🌱 sim.run() looping — coordinator (node-0) + node-1 host', 'hl');
    }

    function lane(y, key, role, sig) {
      K.el('rect', { id: id(key + '-box'), x: LANE.x, y, width: LANE.w, height: LANE.h, rx: 10,
        fill: K.grad(uid, role === 'host' ? 'purple' : 'green'),
        stroke: role === 'host' ? c.purple : c.green, 'stroke-width': 1.6 }, content);
      K.el('text', { x: LANE.x + 16, y: y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content)
        .textContent = role === 'host' ? 'sim.host("node-1")' : 'sim.client("coordinator")';
      K.el('text', { id: id(key + '-state'), x: LANE.x + LANE.w - 14, y: y + 22, 'text-anchor': 'end',
        fill: c.green, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'running';
      K.el('text', { x: LANE.x + 16, y: y + 44, fill: c.muted, 'font-size': 10.5 }, content).textContent = sig;
      // the work indicator: a pulsing dot on a track
      K.el('line', { x1: LANE.x + 16, y1: y + 70, x2: LANE.x + LANE.w - 16, y2: y + 70,
        stroke: c.separator, 'stroke-width': 1.4, 'stroke-dasharray': '3,4' }, content);
      K.el('circle', { id: id(key + '-dot'), cx: LANE.x + 30, cy: y + 70, r: PULSE.r,
        fill: role === 'host' ? c.purple : c.green, filter: K.glow(uid) }, content);
      K.el('text', { id: id(key + '-hint'), x: LANE.x + 16, y: y + 90, fill: c.muted, 'font-size': 10 }, content)
        .textContent = '';
    }

    function drawScene() {
      content.innerHTML = '';
      lane(CLIENT.y, 'client', 'client', 'async { … } — completes → ends sim.run()');
      lane(HOST.y, 'host', 'host', '|| async { … futures::future::pending().await } — never returns');
    }

    // host loops forever: a dot pulses across its track and wraps. Only runs while host==running.
    function startPulse() {
      stopPulse();
      const dot = E('host-dot'); if (!dot) return;
      const x0 = LANE.x + 30, x1 = LANE.x + LANE.w - 30, y = HOST.y + 70;
      const proxy = { p: 0 };
      st.pulseAnim = animate(proxy, { p: 1, duration: 1400, ease: 'inOutSine', loop: true, alternate: true,
        onUpdate: () => { if (st.host !== 'running') return; dot.setAttribute('cx', x0 + (x1 - x0) * proxy.p); animate(dot, { opacity: [0.55, 1], duration: 0 }); } });
    }
    function stopPulse() { if (st.pulseAnim && st.pulseAnim.pause) st.pulseAnim.pause(); st.pulseAnim = null; }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function render() {
      stat('host', st.host);
      stat('client', st.client);
      stat('run', st.simRunning ? 'yes' : 'no');

      // host lane
      const hBox = E('host-box'), hState = E('host-state'), hDot = E('host-dot'), hHint = E('host-hint');
      if (st.host === 'crashed') {
        hState.textContent = 'crashed'; hState.setAttribute('fill', c.red);
        hBox.setAttribute('fill', K.grad(uid, 'red')); hBox.setAttribute('stroke', c.red); hBox.setAttribute('stroke-dasharray', '6,4');
        hDot.setAttribute('fill', c.muted); hDot.setAttribute('opacity', 0.35);
        hHint.textContent = 'task aborted, runtime rebuilt — but the sim keeps running; bounce to restart';
        hHint.setAttribute('fill', c.red);
      } else {
        hState.textContent = 'running'; hState.setAttribute('fill', c.green);
        hBox.setAttribute('fill', K.grad(uid, 'purple')); hBox.setAttribute('stroke', c.purple); hBox.setAttribute('stroke-dasharray', '0');
        hDot.setAttribute('fill', c.purple); hDot.setAttribute('opacity', 1);
        hHint.textContent = 'looping forever (pending) — a host stopping does NOT end the sim';
        hHint.setAttribute('fill', c.muted);
      }

      // client lane
      const cBox = E('client-box'), cState = E('client-state'), cDot = E('client-dot'), cHint = E('client-hint');
      if (st.client === 'done') {
        cState.textContent = 'resolved'; cState.setAttribute('fill', c.blue);
        cBox.setAttribute('fill', K.grad(uid, 'blue')); cBox.setAttribute('stroke', c.blue); cBox.setAttribute('stroke-dasharray', '0');
        cDot.setAttribute('cx', LANE.x + LANE.w - 30); cDot.setAttribute('fill', c.blue); cDot.setAttribute('opacity', 1);
        cHint.textContent = 'future resolved → step() returns all_clients_done → sim.run() returns';
        cHint.setAttribute('fill', c.blue);
      } else {
        cState.textContent = 'running'; cState.setAttribute('fill', c.green);
        cBox.setAttribute('fill', K.grad(uid, 'green')); cBox.setAttribute('stroke', c.green); cBox.setAttribute('stroke-dasharray', '0');
        cDot.setAttribute('cx', LANE.x + 30); cDot.setAttribute('fill', c.green); cDot.setAttribute('opacity', 1);
        cHint.textContent = 'driving toward completion — clients are NOT restartable (task_factory: None)';
        cHint.setAttribute('fill', c.muted);
      }

      // button availability
      root.querySelector('.t-crash').disabled = !st.simRunning || st.host === 'crashed';
      root.querySelector('.t-bounce').disabled = !st.simRunning || st.host !== 'crashed';
      root.querySelector('.t-complete').disabled = !st.simRunning || st.client === 'done';
      // client bounce is always offered (so users can try it) but it errors — see handler
      root.querySelector('.t-cbounce').disabled = !st.simRunning;
    }

    function flash(boxEl, col) {
      const old = boxEl.getAttribute('stroke'); boxEl.setAttribute('stroke', col);
      animate(boxEl, { opacity: [1, 0.5, 1], duration: 300, ease: 'inOut(2)', onComplete: () => boxEl.setAttribute('stroke', old) });
    }

    function endSim() {
      st.simRunning = false; stopPulse();
      // banner across the stage
      const bw = 360, bh = 30, bx = (W - bw) / 2, by = 30;
      const g = K.el('g', { id: id('banner') }, anim);
      K.el('rect', { x: bx, y: by, width: bw, height: bh, rx: 8, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, g);
      K.el('text', { x: W / 2, y: by + 20, 'text-anchor': 'middle', fill: c.blue, 'font-size': 12, 'font-weight': 700 }, g)
        .textContent = 'client future resolved → sim.run() returns';
      animate(g, { opacity: [0, 1], duration: 360, ease: 'out(2)' });
    }

    function bind() {
      root.querySelector('.t-crash').onclick = () => {
        if (st.busy || !st.simRunning || st.host === 'crashed') return;
        st.host = 'crashed';
        flash(E('host-box'), c.red);
        K.addLog(logBody, '⚡ crash(node-1) → task aborted, runtime rebuilt (core.rs:201, runtime.rs:156) — sim still running', 'err');
        render();
      };
      root.querySelector('.t-bounce').onclick = () => {
        if (st.busy || !st.simRunning || st.host !== 'crashed') return;
        st.busy = true; render();
        st.host = 'running';
        st.elapsed += 1; // INIT_ALIGN warm-up
        K.addLog(logBody, '↻ bounce(node-1) → factory re-invoked; fresh task runs 1ms INIT_ALIGN warm-up then resumes (runtime.rs:37, core.rs:55)', 'hl');
        const dot = E('host-dot'); dot.setAttribute('cx', LANE.x + 30);
        flash(E('host-box'), c.purple);
        render(); startPulse();
        st.busy = false; render();
      };
      root.querySelector('.t-complete').onclick = () => {
        if (st.busy || !st.simRunning || st.client === 'done') return;
        st.client = 'done';
        const dot = E('client-dot');
        animate(dot, { cx: LANE.x + LANE.w - 30, duration: 520, ease: 'inOutQuad', onComplete: () => {
          K.addLog(logBody, '✓ coordinator future resolved → sim.run() returns (the run ends here, not when hosts stop)', 'ok');
          flash(E('client-box'), c.blue);
          endSim(); render();
        } });
        render();
      };
      root.querySelector('.t-cbounce').onclick = () => {
        if (!st.simRunning) return;
        // clients carry task_factory: None → bounce errors (runtime.rs:102 / runtime.rs:177)
        flash(E('client-box'), c.red);
        K.addLog(logBody, '✗ bounce(coordinator) → Err: cannot bounce a client (no task factory) — clients are not restartable', 'err');
      };
      root.querySelector('.t-reset').onclick = reset;
    }

    function reset() {
      st.host = 'running'; st.client = 'running'; st.simRunning = true; st.busy = false; st.elapsed = 0;
      const banner = E('banner'); if (banner) banner.remove();
      anim.innerHTML = '';
      drawScene(); render(); startPulse();
      K.addLog(logBody, '↺ reset — sim.run() looping again', 'hl');
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTHostClientLifetime = { init };
})();
