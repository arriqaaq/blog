/**
 * DST Turmoil Step-Loop (re-skinned via dst-kit) — the single-threaded step that makes
 * Turmoil (and our framework) deterministic. One Step, in order, on ONE driver thread:
 *   (1) the network ticks and delivers due messages into hosts;
 *   (2) the driver visits EVERY host in fixed IndexMap order and runs rt.tick(tick) — one host
 *       at a time, never concurrently. That strict sequentiality is the whole "why deterministic";
 *   (3) elapsed += tick.
 * Contrast: Turmoil drains a VecDeque per link; ours pops a BinaryHeap ordered by
 * (deliver_at, seq), so equal-deadline packets keep deterministic FIFO order.
 * Exposes window.DSTTurmoilStep.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('turmoil-step: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('turmoil-step: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 300, HOSTS = 3, TICK = 10;
  const NET = { x: 18, y: 24, w: 744, h: 78, rowH: 24, max: 5 };
  const HOST = { y: 158, w: 168, h: 110, gap: 24, x0: 18 };
  const DRV = { x: 612, y: 110, w: 150, h: 34 };
  const hx = (i) => HOST.x0 + i * (HOST.w + HOST.gap);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      seed: 42, rng: K.rng(42), elapsed: 0, step: 0, seq: 0,
      hosts: Array.from({ length: HOSTS }, () => ({ clock: 0, inbox: 0 })),
      net: [], playing: false, busy: false, speed: 1,
    };
    let svg, content, anim, logBody, c;
    // Turmoil-style ordering: a stable FIFO queue, ours kept deterministic by (deliverAt, seq).
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
        title: 'The single-threaded step loop', sub: 'one thread, one host at a time',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'step', label: 'step' }, { id: 'hosts', label: 'hosts' }],
        cap: 'Turmoil drains a <b>VecDeque</b> per link; ours pops a <b>BinaryHeap</b> ordered by ' +
          '<code>(deliver_at, seq)</code> — equal-deadline packets keep deterministic FIFO.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
    }

    function id(k, i) { return `${uid}-${k}-${i}`; }
    function E(k, i) { return svg.querySelector('#' + CSS.escape(id(k, i))); }
    function slotX(i) { return NET.x + 12 + i * 146; }

    function drawScene() {
      content.innerHTML = '';

      // NETWORK box (blue) — holds queued, in-flight messages.
      K.el('rect', { id: uid + '-netbox', x: NET.x, y: NET.y, width: NET.w, height: NET.h, rx: 10,
        fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: NET.x + 16, cy: NET.y + 18, r: 4.5, fill: c.blue }, content);
      K.el('text', { x: NET.x + 28, y: NET.y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'network';
      K.el('text', { x: NET.x + NET.w - 12, y: NET.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
        .textContent = 'queued · drained by (deliver_at, seq)';

      // DRIVER THREAD indicator (green = driver/SUT). One thread; cursor sweeps hosts in order.
      K.el('rect', { id: uid + '-drv', x: DRV.x, y: DRV.y, width: DRV.w, height: DRV.h, rx: 8,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: DRV.x + 14, cy: DRV.y + DRV.h / 2, r: 4.5, fill: c.green, filter: K.glow(uid) }, content);
      K.el('text', { id: uid + '-drvlbl', x: DRV.x + 26, y: DRV.y + DRV.h / 2 + 4, fill: c.text, 'font-size': 11, 'font-weight': 700 }, content)
        .textContent = 'driver thread';

      // HOST boxes (purple = runtime/node), in fixed IndexMap order h0..hN.
      for (let i = 0; i < HOSTS; i++) {
        const x = hx(i);
        K.el('rect', { id: id('box', i), x, y: HOST.y, width: HOST.w, height: HOST.h, rx: 10,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: HOST.y + 18, r: 4.5, fill: c.purple }, content);
        K.el('text', { x: x + 28, y: HOST.y + 22, fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'h' + i;
        K.el('text', { x: x + HOST.w - 12, y: HOST.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
          .textContent = 'IndexMap[' + i + ']';
        K.el('text', { x: x + 14, y: HOST.y + 50, fill: c.muted, 'font-size': 10 }, content).textContent = 'rt.tick(tick)';
        K.el('text', { id: id('clk', i), x: x + 14, y: HOST.y + 78, fill: c.purple, 'font-size': 22,
          'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
        K.el('text', { id: id('inb', i), x: x + 14, y: HOST.y + 98, fill: c.muted, 'font-size': 10 }, content).textContent = 'inbox 0';
      }
    }

    function render() {
      stat('step', st.step); stat('hosts', HOSTS);
      for (let i = 0; i < HOSTS; i++) { E('clk', i).textContent = st.hosts[i].clock + ' ms'; E('inb', i).textContent = 'inbox ' + st.hosts[i].inbox; }
      // Re-draw the network queue rows in a known sub-group.
      let g = svg.querySelector('#' + CSS.escape(uid + '-queue')); if (g) g.remove();
      g = K.el('g', { id: uid + '-queue' }, content);
      const sorted = [...st.net].sort(cmp);
      if (!sorted.length) {
        K.el('text', { x: NET.x + 14, y: NET.y + 52, fill: c.muted, 'font-size': 10, 'font-style': 'italic' }, g).textContent = '(no messages in flight)';
      }
      sorted.slice(0, NET.max).forEach((p, idx) => {
        const x = slotX(idx), head = idx === 0;
        K.el('rect', { x, y: NET.y + 38, width: 134, height: NET.rowH, rx: 5, fill: K.grad(uid, 'blue'),
          stroke: head ? c.amber : c.blue, 'stroke-width': head ? 2 : 1 }, g);
        K.el('text', { x: x + 8, y: NET.y + 54, fill: c.text, 'font-size': 10, 'font-variant-numeric': 'tabular-nums' }, g)
          .textContent = `s${p.seq} @${p.deliverAt} h${p.from}→h${p.to}`;
      });
      if (sorted.length > NET.max) K.el('text', { x: slotX(NET.max), y: NET.y + 54, fill: c.muted, 'font-size': 9 }, g).textContent = `+${sorted.length - NET.max} more`;
    }
    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    async function stepOnce() {
      if (st.busy) return; st.busy = true; setLock(true);
      const now = st.elapsed;
      st.step++; render();
      K.addLog(logBody, `── step ${st.step} · elapsed ${now} ms ──`, 'hl');

      // (1) network ticks: deliver due messages into hosts (blue particles, glow).
      const due = [...st.net].filter((q) => q.deliverAt <= now).sort(cmp);
      if (due.length) flash(svg.querySelector('#' + CSS.escape(uid + '-netbox')), c.blue);
      for (const p of due) {
        await fly(slotX(0) + 8, NET.y + 38 + NET.rowH / 2, hx(p.to) + HOST.w / 2, HOST.y, c.blue);
        st.net = st.net.filter((q) => q.seq !== p.seq); st.hosts[p.to].inbox++;
        flash(E('box', p.to), c.purple); K.addLog(logBody, `network: deliver s${p.seq} → h${p.to}`, 'ok'); render();
      }

      // (2) driver visits EACH host in fixed IndexMap order, one at a time → rt.tick(tick).
      for (let i = 0; i < HOSTS; i++) {
        await moveDriver(i);
        await sweep(i);
        const from = st.hosts[i].clock; st.hosts[i].clock = from + TICK;
        await countUp(E('clk', i), from, st.hosts[i].clock);
        K.addLog(logBody, `driver → h${i}: rt.tick(${TICK}ms)`, null);
        // a host may emit a message back onto the network
        if (st.rng() < 0.45) {
          let to = Math.floor(st.rng() * (HOSTS - 1)); if (to >= i) to++;
          const pkt = { seq: ++st.seq, from: i, to, deliverAt: now + TICK + 20 + Math.floor(st.rng() * 90) };
          st.net.push(pkt); K.addLog(logBody, `h${i} → send s${pkt.seq} (h${i}→h${to}) @${pkt.deliverAt}`, 'hl'); render();
          await fly(hx(i) + HOST.w / 2, HOST.y, slotX(0) + 8, NET.y + 38 + NET.rowH / 2, c.blue, 280);
        }
      }

      // (3) advance the single global clock.
      st.elapsed = now + TICK; render();
      K.addLog(logBody, `elapsed += ${TICK}ms → ${st.elapsed} ms`, 'ok');
      st.busy = false; setLock(false);
    }

    async function fly(sx, sy, tx, ty, color, d) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: dur(d || 360), ease: 'inOutQuad' });
      await animate(dot, { r: [6, 12], opacity: [1, 0], duration: dur(150), ease: 'out(2)' });
      dot.remove();
    }
    async function moveDriver(i) {
      const cx = hx(i) + HOST.w / 2;
      const cur = parseFloat(svg.querySelector('#' + CSS.escape(uid + '-cursor'))?.getAttribute('x1') || cx);
      const cursor = svg.querySelector('#' + CSS.escape(uid + '-cursor'));
      if (cursor) cursor.remove();
      // a glowing connector from the one driver thread down to the host it is currently running
      const line = K.el('line', { id: uid + '-cursor', x1: cur, y1: DRV.y + DRV.h, x2: cur, y2: HOST.y,
        stroke: c.green, 'stroke-width': 2, 'stroke-dasharray': '4 3', filter: K.glow(uid),
        'marker-end': K.arrow(uid, 'green') }, anim);
      const p = { x: cur };
      await animate(p, { x: cx, duration: dur(180), ease: 'inOutQuad', onUpdate: () => { line.setAttribute('x1', p.x); line.setAttribute('x2', p.x); } });
      const lbl = svg.querySelector('#' + CSS.escape(uid + '-drvlbl')); if (lbl) lbl.textContent = 'running h' + i;
    }
    async function sweep(i) { const b = E('box', i); b.setAttribute('stroke', c.green); await animate(b, { opacity: [1, 0.6, 1], duration: dur(180), ease: 'inOut(2)' }); b.setAttribute('stroke', c.purple); }
    function flash(b, col) { if (!b) return; const orig = b.getAttribute('stroke'); b.setAttribute('stroke', col); animate(b, { opacity: [1, 0.45, 1], duration: dur(260), ease: 'inOut(2)', onComplete: () => b.setAttribute('stroke', orig) }); }
    function countUp(t, a, b) { const p = { v: a }; return animate(p, { v: b, duration: dur(220), ease: 'out(2)', onUpdate: () => t.textContent = Math.round(p.v) + ' ms', onComplete: () => t.textContent = b + ' ms' }); }

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
      st.rng = K.rng(st.seed >>> 0); st.hosts = Array.from({ length: HOSTS }, () => ({ clock: 0, inbox: 0 }));
      st.busy = false; setLock(false); drawScene(); render();
      // seed the network with a couple of in-flight messages so step 1 has something to deliver
      for (let k = 0; k < 2; k++) {
        const from = Math.floor(st.rng() * HOSTS); let to = Math.floor(st.rng() * (HOSTS - 1)); if (to >= from) to++;
        st.net.push({ seq: ++st.seq, from, to, deliverAt: Math.floor(st.rng() * 8) });
      }
      render();
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · one thread ⇒ same seed, same run', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    // seed initial in-flight messages on first build too
    for (let k = 0; k < 2; k++) {
      const from = Math.floor(st.rng() * HOSTS); let to = Math.floor(st.rng() * (HOSTS - 1)); if (to >= from) to++;
      st.net.push({ seq: ++st.seq, from, to, deliverAt: Math.floor(st.rng() * 8) });
    }
    render();
    K.addLog(logBody, '🌱 ready — driver visits hosts in IndexMap order, one at a time', 'hl');

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTurmoilStep = { init };
})();
