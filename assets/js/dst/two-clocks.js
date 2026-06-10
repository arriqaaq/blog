/**
 * DST Two Clocks (re-skinned via dst-kit) — private Tokio time vs shared TickContext::elapsed.
 *
 * The post's subtlest point: every node owns a PRIVATE tokio::time::Instant; the NETWORK runs on
 * a single SHARED sim clock, TickContext::elapsed. During ordinary ticks the two track together,
 * so it's easy to conflate them — but the network never reads a node's private clock. When a node
 * sends, the packet is stamped with the CURRENT ctx.elapsed and given deliver_at = elapsed +
 * latency, then pushed to a BinaryHeap ordered by (deliver_at, seq) (backplane.rs:28-34). A packet
 * sent mid-tick therefore carries the shared time and is delivered a later step.
 *
 * One Step (sim_tick = 10 ms) mirrors dst/src/sim/tick.rs exactly:
 *   (1) now = ctx.elapsed; deliver_due_packets(now): every heap packet with deliver_at <= now flies
 *       into the receiver's inbox          (tick.rs:36-38);
 *   (2) each node advances its PRIVATE Tokio clock by the tick (tick.rs:53 node loop);
 *   (3) a sending node stamps the packet with ctx.elapsed and pushes to the heap;
 *   (4) AFTER the node loop, ctx.elapsed += sim_tick   (tick.rs:69 — not per node).
 *
 * Exposes window.DSTTwoClocks.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('two-clocks: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('two-clocks: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 320, NODES = 3, TICK = 10;
  const CARD = { y: 24, h: 132, w: 232, gap: 22, x0: 28 };
  const SHARED = { x: 28, y: 256, w: 724, h: 46 };
  const cardX = (i) => CARD.x0 + i * (CARD.w + CARD.gap);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const mk = () => Array.from({ length: NODES }, () => ({ clock: 0 }));
    const st = { seed: 42, rng: K.rng(42), elapsed: 0, step: 0, seq: 0, nodes: mk(), heap: [], playing: false, busy: false, speed: 1 };
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    // BinaryHeap order: (deliver_at, seq) — equal deadlines keep deterministic FIFO (backplane.rs:28-34).
    const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Step (+${TICK}ms)</button>
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
        title: 'Two clocks: private Tokio vs shared sim', sub: 'the network never reads a node clock',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'step', label: 'step' }, { id: 'elapsed', label: 'ctx.elapsed' }, { id: 'flight', label: 'in-flight' }],
        cap: 'Node clocks are private (Tokio); the network runs on shared <code>TickContext::elapsed</code>.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 ready — private Tokio time is per-node; shared sim time stamps the network', 'hl');
    }

    function id(k, i) { return `${uid}-${k}-${i}`; }
    function E(k, i) { return svg.querySelector('#' + CSS.escape(id(k, i))); }
    function By(s) { return svg.querySelector('#' + CSS.escape(uid + s)); }

    function drawScene() {
      content.innerHTML = '';

      // node cards (purple = runtime/node) — each owns a PRIVATE tokio::time::Instant.
      for (let i = 0; i < NODES; i++) {
        const x = cardX(i);
        K.el('rect', { id: id('card', i), x, y: CARD.y, width: CARD.w, height: CARD.h, rx: 10,
          fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
        K.el('circle', { cx: x + 16, cy: CARD.y + 20, r: 4.5, fill: c.purple }, content);
        K.el('text', { x: x + 28, y: CARD.y + 24, fill: c.text, 'font-size': 14, 'font-weight': 700 }, content).textContent = 'n' + i;
        K.el('text', { x: x + CARD.w - 12, y: CARD.y + 24, 'text-anchor': 'end', fill: c.muted, 'font-size': 10, 'font-weight': 600 }, content)
          .textContent = 'private · Tokio';
        K.el('text', { x: x + 14, y: CARD.y + 50, fill: c.muted, 'font-size': 10 }, content).textContent = 'tokio::time::Instant';
        K.el('text', { id: id('clk', i), x: x + 14, y: CARD.y + 88, fill: c.purple, 'font-size': 26,
          'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';
        K.el('text', { id: id('inb', i), x: x + 14, y: CARD.y + 116, fill: c.muted, 'font-size': 10 }, content).textContent = 'inbox 0';
      }

      // SHARED sim clock bar (blue = network) — the single TickContext::elapsed the network uses.
      K.el('rect', { id: uid + '-sharedbox', x: SHARED.x, y: SHARED.y, width: SHARED.w, height: SHARED.h, rx: 9,
        fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
      K.el('circle', { cx: SHARED.x + 18, cy: SHARED.y + SHARED.h / 2, r: 5, fill: c.blue, filter: K.glow(uid) }, content);
      K.el('text', { x: SHARED.x + 32, y: SHARED.y + SHARED.h / 2 + 5, fill: c.text, 'font-size': 12, 'font-weight': 700 }, content)
        .textContent = 'shared · TickContext::elapsed';
      K.el('text', { id: uid + '-shared', x: SHARED.x + SHARED.w - 16, y: SHARED.y + SHARED.h / 2 + 8, 'text-anchor': 'end',
        fill: c.blue, 'font-size': 24, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums', filter: K.glow(uid) }, content).textContent = '0 ms';

      // in-flight heap label (amber = time/holds) — keyed by (deliver_at, seq).
      K.el('text', { x: SHARED.x, y: SHARED.y - 12, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'in-flight heap — BinaryHeap by (deliver_at, seq)';
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }

    function render() {
      stat('step', st.step); stat('elapsed', st.elapsed + ' ms'); stat('flight', st.heap.length);
      for (let i = 0; i < NODES; i++) { E('clk', i).textContent = st.nodes[i].clock + ' ms'; }
      By('-shared').textContent = st.elapsed + ' ms';
      renderHeap();
    }

    function renderHeap() {
      let g = By('-heap'); if (g) g.remove();
      g = K.el('g', { id: uid + '-heap' }, content);
      const sorted = [...st.heap].sort(cmp), max = 4, rowW = 168, gapW = 12;
      const x0 = SHARED.x + 280, y0 = SHARED.y - 30;
      if (!sorted.length) {
        K.el('text', { x: x0, y: y0 + 8, fill: c.muted, 'font-size': 10, 'font-style': 'italic' }, g).textContent = '(no packets in flight)';
        return;
      }
      sorted.slice(0, max).forEach((p, idx) => {
        const x = x0 + idx * (rowW + gapW), head = idx === 0;
        K.el('rect', { x, y: y0 - 13, width: rowW, height: 19, rx: 5, fill: K.grad(uid, 'amber'),
          stroke: head ? c.amber : c.blue, 'stroke-width': head ? 2 : 1 }, g);
        K.el('text', { x: x + 7, y: y0 + 1, fill: c.text, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, g)
          .textContent = `s${p.seq} n${p.from}→n${p.to} stamp ${p.stamp} dlv ${p.deliverAt}`;
      });
      if (sorted.length > max)
        K.el('text', { x: x0 + max * (rowW + gapW), y: y0 + 1, fill: c.muted, 'font-size': 9 }, g).textContent = `+${sorted.length - max}`;
    }

    // animated dot flight between two SVG points (network deliveries / sends).
    async function fly(sx, sy, tx, ty, color, d) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: dur(d || 360), ease: 'inOutQuad' });
      await animate(dot, { r: [6, 12], opacity: [1, 0], duration: dur(140), ease: 'out(2)' });
      dot.remove();
    }
    function countUp(t, a, b, color) {
      const p = { v: a };
      return animate(p, { v: b, duration: dur(220), ease: 'out(2)',
        onUpdate: () => { t.textContent = Math.round(p.v) + ' ms'; if (color) t.setAttribute('fill', color); },
        onComplete: () => { t.textContent = b + ' ms'; if (color) t.setAttribute('fill', color); } });
    }
    function flash(box, col) {
      if (!box) return; const orig = box.getAttribute('stroke'); box.setAttribute('stroke', col);
      animate(box, { opacity: [1, 0.45, 1], duration: dur(260), ease: 'inOut(2)', onComplete: () => box.setAttribute('stroke', orig) });
    }

    async function stepOnce() {
      if (st.busy) return; st.busy = true; setLock(true);
      const now = st.elapsed;             // (1) tick.rs:36 — capture shared time up front
      st.step++; render();
      K.addLog(logBody, `── step ${st.step} · ctx.elapsed ${now} ms ──`, 'hl');

      // (1) deliver_due_packets(now): any heap packet with deliver_at <= now flies into its inbox (tick.rs:38).
      const due = [...st.heap].filter((p) => p.deliverAt <= now).sort(cmp);
      if (due.length) flash(By('-sharedbox'), c.amber);
      for (const p of due) {
        await fly(SHARED.x + 320, SHARED.y, cardX(p.to) + CARD.w / 2, CARD.y + CARD.h, c.blue);
        st.heap = st.heap.filter((q) => q.seq !== p.seq); st.nodes[p.to].inbox = (st.nodes[p.to].inbox || 0) + 1;
        E('inb', p.to).textContent = 'inbox ' + st.nodes[p.to].inbox; flash(E('card', p.to), c.purple);
        K.addLog(logBody, `deliver s${p.seq} → n${p.to} (deliver_at ${p.deliverAt} ≤ elapsed ${now})`, 'ok'); render();
      }

      // (2) each node advances its PRIVATE Tokio clock by the tick — they track together on ordinary ticks (tick.rs:53).
      for (let i = 0; i < NODES; i++) {
        const from = st.nodes[i].clock; st.nodes[i].clock = from + TICK;
        flash(E('card', i), c.purple);
        await countUp(E('clk', i), from, st.nodes[i].clock, c.purple);

        // (3) a node may send: STAMP with shared ctx.elapsed (NOT its private clock); deliver_at = elapsed + latency.
        if (st.rng() < 0.5) {
          let to = Math.floor(st.rng() * (NODES - 1)); if (to >= i) to++;
          const latency = TICK + 10 + Math.floor(st.rng() * 90);   // seeded latency — deterministic via K.rng(seed)
          const pkt = { seq: ++st.seq, from: i, to, stamp: now, deliverAt: now + latency };
          st.heap.push(pkt); render();
          K.addLog(logBody, `n${i} send_to(n${to}): stamp = ctx.elapsed ${now} (not Tokio ${st.nodes[i].clock}); deliver_at ${pkt.deliverAt}`, 'warn');
          await fly(cardX(i) + CARD.w / 2, CARD.y + CARD.h, SHARED.x + 320, SHARED.y, c.amber, 300);
        }
      }

      // (4) AFTER the node loop, advance the single shared clock (tick.rs:69 — the += is not per node).
      st.elapsed = now + TICK;
      await countUp(By('-shared'), now, st.elapsed, c.blue); render();
      K.addLog(logBody, `ctx.elapsed += ${TICK}ms → ${st.elapsed} ms (after node loop)`, 'ok');
      st.busy = false; setLock(false);
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 0; reset(); };
    }

    async function play() { if (st.playing) return; st.playing = true; pp(); while (st.playing) { await stepOnce(); if (!st.playing) break; await K.delay(dur(420)); } }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      st.elapsed = 0; st.step = 0; st.seq = 0; st.nodes = mk(); st.heap = [];
      st.rng = K.rng(st.seed >>> 0); st.busy = false; setLock(false);
      drawScene(); seedHeap(); render();
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · a packet sent mid-tick carries ctx.elapsed, delivers a later step', 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    // seed the heap with a couple of in-flight packets so step 1 has something due to deliver.
    function seedHeap() {
      for (let k = 0; k < 2; k++) {
        const from = Math.floor(st.rng() * NODES); let to = Math.floor(st.rng() * (NODES - 1)); if (to >= from) to++;
        st.heap.push({ seq: ++st.seq, from, to, stamp: 0, deliverAt: Math.floor(st.rng() * 8) });
      }
    }

    seedHeap(); render();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTwoClocks = { init };
})();
