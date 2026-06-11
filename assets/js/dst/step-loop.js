/**
 * DST Step-Loop (re-skinned via dst-kit) — the single-threaded step that makes the
 * framework deterministic. One Step, in order, on ONE driver thread:
 *   (1) the network ticks and delivers due messages into hosts;
 *   (2) the driver visits EVERY host in fixed IndexMap order and runs rt.tick(tick) — one host
 *       at a time, never concurrently. That strict sequentiality is the whole "why deterministic";
 *   (3) elapsed += tick.
 * Contrast: a naïve per-link FIFO drains a VecDeque; ours pops a BinaryHeap ordered by
 * (deliver_at, seq), so equal-deadline packets keep deterministic FIFO order.
 * Exposes window.DSTStepLoop.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('step-loop: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('step-loop: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 300, HOSTS = 3, TICK = 10;
  // Three phases of one Step — the loud takeaway lives in this strip.
  const PHASES = [
    { t: '① deliver mail', zone: 'blue' },
    { t: '② visit each host in order', zone: 'green' },
    { t: '③ advance time', zone: 'amber' },
  ];
  const PILL = { y: 16, h: 26, gap: 10, x0: 18, ws: [148, 244, 158] };
  const pillX = (i) => PILL.x0 + PILL.ws.slice(0, i).reduce((a, w) => a + w + PILL.gap, 0);
  const NET = { x: 18, y: 56, w: 502, h: 70, rowH: 22, max: 4 };
  const DRV = { x: 540, y: 56, w: 222, h: 70 };
  const HOST = { y: 166, w: 168, h: 110, gap: 24, x0: 18 };
  const hx = (i) => HOST.x0 + i * (HOST.w + HOST.gap);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      seed: 42, rng: K.rng(42), elapsed: 0, step: 0, seq: 0,
      hosts: Array.from({ length: HOSTS }, () => ({ inbox: 0, visits: 0 })),
      net: [], playing: false, busy: false, speed: 1,
    };
    let svg, content, anim, logBody, c;
    // Stable ordering: a FIFO queue kept deterministic by (deliverAt, seq).
    const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);
    const dur = (ms) => ms / st.speed;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸ Pause</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span><input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'One thread visits each host in the same order, every run',
        sub: 'one driver · one host at a time · fixed order',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'step', label: 'step' }, { id: 'now', label: 'sim time' }, { id: 'order', label: 'visit order' }],
        cap: 'A single driver thread does three things per step: deliver due mail, then walk the hosts '
          + 'one at a time in the same fixed order (h0 → h1 → h2), then move the clock. No host ever runs '
          + 'concurrently — that fixed order is the whole reason the run is reproducible.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render(); setPhase(-1);
      stat('order', 'h0→h1→h2');
      K.addLog(logBody, '🌱 ready — one driver thread, visiting h0 → h1 → h2 in fixed order', 'hl');
    }

    function id(k, i) { return `${uid}-${k}-${i}`; }
    function E(k, i) { return svg.querySelector('#' + CSS.escape(id(k, i))); }
    function slotX(i) { return NET.x + 12 + i * 120; }

    function drawScene() {
      content.innerHTML = '';

      // PHASE STRIP — the three things one Step does, in order. Lights up as it runs.
      PHASES.forEach((p, i) => {
        const x = pillX(i), w = PILL.ws[i];
        K.el('rect', { id: id('pill', i), x, y: PILL.y, width: w, height: PILL.h, rx: 8,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: id('pilltext', i), x: x + w / 2, y: PILL.y + PILL.h / 2 + 4, 'text-anchor': 'middle',
          fill: c.muted, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = p.t;
        if (i < PHASES.length - 1) K.el('text', { x: x + w + PILL.gap / 2, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 12 }, content).textContent = '→';
      });

      // NETWORK box (blue) — holds queued, in-flight messages waiting for ① deliver.
      K.el('rect', { id: uid + '-netbox', x: NET.x, y: NET.y, width: NET.w, height: NET.h, rx: 10,
        fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: NET.x + 16, cy: NET.y + 18, r: 4.5, fill: c.blue }, content);
      K.el('text', { x: NET.x + 28, y: NET.y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'mail in flight';
      K.el('text', { x: NET.x + NET.w - 12, y: NET.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = 'network · ordered by (deliver_at, seq)';

      // DRIVER THREAD (green = driver/SUT). ONE thread; cursor sweeps hosts in order.
      K.el('rect', { id: uid + '-drv', x: DRV.x, y: DRV.y, width: DRV.w, height: DRV.h, rx: 10,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: DRV.x + 16, cy: DRV.y + 18, r: 4.5, fill: c.green, filter: K.glow(uid) }, content);
      K.el('text', { x: DRV.x + 28, y: DRV.y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'driver';
      K.el('text', { x: DRV.x + DRV.w - 12, y: DRV.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
        .textContent = 'the only thread';
      K.el('text', { id: uid + '-drvlbl', x: DRV.x + 28, y: DRV.y + 48, fill: c.green, 'font-size': 14,
        'font-weight': 700, filter: K.glow(uid) }, content).textContent = 'idle';

      // HOST boxes (purple = runtime/node), in fixed IndexMap order h0..hN, numbered 1·2·3.
      for (let i = 0; i < HOSTS; i++) {
        const x = hx(i);
        K.el('rect', { id: id('box', i), x, y: HOST.y, width: HOST.w, height: HOST.h, rx: 10,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
        // visit-order badge — makes the FIXED order impossible to miss
        K.el('circle', { id: id('ord', i), cx: x + 18, cy: HOST.y + 20, r: 11, fill: 'none',
          stroke: c.muted, 'stroke-width': 1.6 }, content);
        K.el('text', { id: id('ordn', i), x: x + 18, y: HOST.y + 24, 'text-anchor': 'middle', fill: c.muted,
          'font-size': 12, 'font-weight': 700 }, content).textContent = i + 1;
        K.el('text', { x: x + 36, y: HOST.y + 24, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'h' + i;
        K.el('text', { x: x + HOST.w - 12, y: HOST.y + 24, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
          .textContent = 'IndexMap[' + i + ']';
        K.el('text', { x: x + 14, y: HOST.y + 56, fill: c.muted, 'font-size': 10 }, content).textContent = 'mail received';
        K.el('text', { id: id('inb', i), x: x + 14, y: HOST.y + 84, fill: c.purple, 'font-size': 26,
          'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0';
        K.el('text', { id: id('ran', i), x: x + HOST.w - 12, y: HOST.y + 88, 'text-anchor': 'end',
          fill: c.muted, 'font-size': 9.5 }, content).textContent = 'waiting';
      }
    }

    // Light the active phase pill; -1 = all dim.
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
      stat('step', st.step); stat('now', st.elapsed + ' ms');
      for (let i = 0; i < HOSTS; i++) E('inb', i).textContent = st.hosts[i].inbox;
      // Re-draw the network queue rows in a known sub-group.
      let g = svg.querySelector('#' + CSS.escape(uid + '-queue')); if (g) g.remove();
      g = K.el('g', { id: uid + '-queue' }, content);
      const sorted = [...st.net].sort(cmp);
      if (!sorted.length) {
        K.el('text', { x: NET.x + 14, y: NET.y + 50, fill: c.muted, 'font-size': 10, 'font-style': 'italic' }, g).textContent = '(no mail in flight)';
      }
      sorted.slice(0, NET.max).forEach((p, idx) => {
        const x = slotX(idx), due = p.deliverAt <= st.elapsed;
        K.el('rect', { x, y: NET.y + 36, width: 112, height: NET.rowH, rx: 5, fill: K.grad(uid, due ? 'amber' : 'blue'),
          stroke: due ? c.amber : c.blue, 'stroke-width': due ? 2 : 1 }, g);
        K.el('text', { x: x + 7, y: NET.y + 51, fill: c.text, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, g)
          .textContent = `s${p.seq} h${p.from}→h${p.to}`;
        K.el('text', { x: x + 105, y: NET.y + 51, 'text-anchor': 'end', fill: due ? c.amber : c.muted,
          'font-size': 8, 'font-weight': due ? 700 : 400 }, g).textContent = due ? 'due' : '@' + p.deliverAt;
      });
      if (sorted.length > NET.max) K.el('text', { x: slotX(NET.max), y: NET.y + 51, fill: c.muted, 'font-size': 9 }, g).textContent = `+${sorted.length - NET.max}`;
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    async function stepOnce() {
      if (st.busy) return; st.busy = true; setLock(true);
      const now = st.elapsed;
      st.step++; render();
      for (let i = 0; i < HOSTS; i++) { E('ran', i).textContent = 'waiting'; E('ran', i).setAttribute('fill', c.muted); }
      K.addLog(logBody, `── step ${st.step} · sim time ${now} ms ──`, 'hl');

      // ① DELIVER MAIL — every message with deliver_at ≤ now flies from the network into its host.
      setPhase(0);
      driverSay('delivering mail', c.blue);
      const due = [...st.net].filter((q) => q.deliverAt <= now).sort(cmp);
      if (!due.length) K.addLog(logBody, '① deliver — no mail due yet', null);
      else flash(svg.querySelector('#' + CSS.escape(uid + '-netbox')), c.blue);
      for (const p of due) {
        await fly(slotX(0) + 8, NET.y + 36 + NET.rowH / 2, hx(p.to) + HOST.w / 2, HOST.y, c.blue);
        st.net = st.net.filter((q) => q.seq !== p.seq); st.hosts[p.to].inbox++;
        flash(E('box', p.to), c.blue); E('inb', p.to).textContent = st.hosts[p.to].inbox;
        K.addLog(logBody, `① deliver s${p.seq} → h${p.to}`, 'ok'); render();
      }

      // ② VISIT EACH HOST IN ORDER — driver walks h0 → h1 → h2, one at a time, never concurrently.
      setPhase(1);
      for (let i = 0; i < HOSTS; i++) {
        await moveDriver(i);
        await sweep(i);
        st.hosts[i].visits++;
        E('ran', i).textContent = '✓ visited'; E('ran', i).setAttribute('fill', c.green);
        K.addLog(logBody, `② visit h${i} (IndexMap[${i}]) → rt.tick(${TICK}ms)`, null);
        // a host may emit a message back onto the network (deterministic via the seeded rng)
        if (st.rng() < 0.45) {
          let to = Math.floor(st.rng() * (HOSTS - 1)); if (to >= i) to++;
          const pkt = { seq: ++st.seq, from: i, to, deliverAt: now + TICK + 20 + Math.floor(st.rng() * 90) };
          st.net.push(pkt); K.addLog(logBody, `   h${i} sends s${pkt.seq} (h${i}→h${to}) @${pkt.deliverAt}`, 'hl'); render();
          await fly(hx(i) + HOST.w / 2, HOST.y, slotX(0) + 8, NET.y + 36 + NET.rowH / 2, c.blue, 280);
        }
      }
      driverSay('idle', c.green);
      parkDriver();

      // ③ ADVANCE TIME — the single global clock moves forward by one tick.
      setPhase(2);
      st.elapsed = now + TICK;
      await countUpStat('now', now, st.elapsed);
      K.addLog(logBody, `③ advance → sim time ${st.elapsed} ms`, 'warn');
      render();
      setPhase(-1);
      st.busy = false; setLock(false);
    }

    function driverSay(msg, col) {
      const lbl = svg.querySelector('#' + CSS.escape(uid + '-drvlbl'));
      if (lbl) { lbl.textContent = msg; lbl.setAttribute('fill', col); }
    }

    async function fly(sx, sy, tx, ty, color, d) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: dur(d || 360), ease: 'inOutQuad' });
      await animate(dot, { r: [6, 12], opacity: [1, 0], duration: dur(150), ease: 'out(2)' });
      dot.remove();
    }
    async function moveDriver(i) {
      const cx = hx(i) + HOST.w / 2;
      const existing = svg.querySelector('#' + CSS.escape(uid + '-cursor'));
      const cur = existing ? parseFloat(existing.getAttribute('x2')) : DRV.x + 16;
      if (existing) existing.remove();
      // a glowing connector from the one driver thread down to the host it is currently running
      const line = K.el('line', { id: uid + '-cursor', x1: DRV.x + 16, y1: DRV.y + DRV.h, x2: cur, y2: HOST.y,
        stroke: c.green, 'stroke-width': 2.4, 'stroke-dasharray': '4 3', filter: K.glow(uid),
        'marker-end': K.arrow(uid, 'green') }, anim);
      const p = { x: cur };
      await animate(p, { x: cx, duration: dur(200), ease: 'inOutQuad', onUpdate: () => line.setAttribute('x2', p.x) });
      driverSay('running h' + i, c.green);
      // light this host's order badge to show "now visiting #N"
      const ord = E('ord', i), ordn = E('ordn', i);
      ord.setAttribute('stroke', c.green); ord.setAttribute('fill', K.grad(uid, 'green')); ord.setAttribute('filter', K.glow(uid));
      ordn.setAttribute('fill', c.green);
    }
    function parkDriver() {
      const cursor = svg.querySelector('#' + CSS.escape(uid + '-cursor')); if (cursor) cursor.remove();
      for (let i = 0; i < HOSTS; i++) {
        const ord = E('ord', i), ordn = E('ordn', i); if (!ord) continue;
        ord.setAttribute('stroke', c.muted); ord.setAttribute('fill', 'none'); ord.removeAttribute('filter');
        ordn.setAttribute('fill', c.muted);
      }
    }
    async function sweep(i) { const b = E('box', i); b.setAttribute('stroke', c.green); await animate(b, { opacity: [1, 0.6, 1], duration: dur(180), ease: 'inOut(2)' }); b.setAttribute('stroke', c.purple); }
    function flash(b, col) { if (!b) return; const orig = b.getAttribute('stroke'); b.setAttribute('stroke', col); animate(b, { opacity: [1, 0.45, 1], duration: dur(260), ease: 'inOut(2)', onComplete: () => b.setAttribute('stroke', orig) }); }
    function countUpStat(k, a, b) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (!e) return Promise.resolve();
      const p = { v: a };
      return animate(p, { v: b, duration: dur(220), ease: 'out(2)', onUpdate: () => e.textContent = Math.round(p.v) + ' ms', onComplete: () => e.textContent = b + ' ms' });
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 42; reset(); };
    }
    async function play() { if (st.playing) return; st.playing = true; pp(); while (st.playing) { await stepOnce(); if (!st.playing) break; await K.delay(dur(360)); } }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp(); st.elapsed = 0; st.step = 0; st.seq = 0; st.net = [];
      st.rng = K.rng(st.seed >>> 0); st.hosts = Array.from({ length: HOSTS }, () => ({ inbox: 0, visits: 0 }));
      st.busy = false; setLock(false); drawScene(); render(); setPhase(-1);
      stat('order', 'h0→h1→h2');
      seedTraffic();
      render();
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · same seed, same order, same run', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    // Seed the network with a couple of in-flight messages so step 1 has mail to deliver.
    function seedTraffic() {
      for (let k = 0; k < 2; k++) {
        const from = Math.floor(st.rng() * HOSTS); let to = Math.floor(st.rng() * (HOSTS - 1)); if (to >= from) to++;
        st.net.push({ seq: ++st.seq, from, to, deliverAt: Math.floor(st.rng() * 8) });
      }
    }
    seedTraffic();
    render();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTStepLoop = { init };
})();
