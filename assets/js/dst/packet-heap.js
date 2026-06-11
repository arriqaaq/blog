/**
 * DST In-Flight Packet Heap (re-skinned via dst-kit) — earliest-deadline-first delivery.
 *
 * The network backplane is a BinaryHeap<Reverse<ScheduledPacket>> ordered by (deliver_at, seq):
 * the earliest deadline is always delivered first, and a monotonically increasing seq breaks ties
 * so equal-deadline packets keep deterministic FIFO order. Send injects a packet with a seeded
 * latency; "Send 2 @ same tick" shows the seq tie-break; Step advances now and pops everything
 * due — earliest first — and flies a particle to the target node.
 *
 * The takeaway made loud: the queue order is a pure function of the seed. "Run twice" replays the
 * same seeded sends + steps and checks that the delivery ORDER matches byte-for-byte (a real NIC
 * could not promise this). Verified against dst/src/sim/backplane.rs: ScheduledPacket { deliver_at,
 * seq }, Ord = deliver_at.then_with(seq); deliver_due_packets(now) pops while peek().deliver_at<=now.
 *
 * Exposes window.DSTPacketHeap.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('packet-heap: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('packet-heap: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 300, TICK = 10, NODES = 3;
  // node dots down the left edge — the delivery targets
  const NODE = { x: 60, r: 17, ys: [70, 150, 230] };
  // the queue (min-heap), small + followable, in the middle/right
  const HEAP = { x: 308, y: 86, w: 300, rowH: 34, max: 5 };
  // phase pills along the top
  const PHASES = [
    { t: '① pick earliest', zone: 'amber' },
    { t: '② deliver to node', zone: 'green' },
  ];
  const PILL = { y: 14, h: 26, w: 168, gap: 12, x0: 308 };
  const pillX = (i) => PILL.x0 + i * (PILL.w + PILL.gap);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = {
      seed: 42, rng: K.rng(42), now: 0, seq: 0,
      heap: [], busy: false, playing: false, speed: 1,
      // recorded delivery order of the current run, + the order of the previous run for the verdict
      order: [], prevOrder: null, verdict: null,
    };
    let svg, content, anim, logBody, c;
    const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);
    const dur = (ms) => ms / st.speed;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <span class="dstk-tlabel">add</span>
        <button class="dstk-btn dstk-btn--blue t-send">&#43; Send packet</button>
        <button class="dstk-btn dstk-btn--blue t-tie">Send 2 at once</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">&#9197; Step +${TICK}ms</button>
        <button class="dstk-btn dstk-btn--green t-play">&#9654; Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>&#9208;</button>
        <button class="dstk-btn dstk-btn--amber t-twice">&#8634; Run twice</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5&#215;</option><option value="1" selected>1&#215;</option><option value="2">2&#215;</option></select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Same seed, same delivery order — every time',
        sub: 'instead of a real network, packets wait in a queue sorted by delivery time',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [
          { id: 'now', label: 'sim time' },
          { id: 'inflight', label: 'waiting' },
          { id: 'order', label: 'delivered' },
        ],
        cap: 'There is no real network here: every packet waits in one queue sorted by its delivery '
           + 'time (ties broken by send order). Step always delivers the top one first. Because each '
           + 'packet&rsquo;s delay comes from the seed, the same seed replays the exact same order.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render(); setPhase(-1);
      K.addLog(logBody, '🌱 queue empty — Send a packet, then Step to deliver it (seed ' + st.seed + ')', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';

      // --- phase pills: what one Step does ---
      PHASES.forEach((p, i) => {
        K.el('rect', { id: pid('pill', i), x: pillX(i), y: PILL.y, width: PILL.w, height: PILL.h, rx: 8,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.4 }, content);
        K.el('text', { id: pid('pilltext', i), x: pillX(i) + PILL.w / 2, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = p.t;
        if (i < PHASES.length - 1) K.el('text', { x: pillX(i) + PILL.w + PILL.gap / 2, y: PILL.y + PILL.h / 2 + 4,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 12 }, content).textContent = '→';
      });

      // --- driver clock (amber) at top-left ---
      K.el('rect', { x: 18, y: 14, width: 116, height: 50, rx: 8,
        fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.5 }, content);
      K.el('text', { x: 76, y: 31, 'text-anchor': 'middle', fill: c.muted,
        'font-size': 8.5, 'font-weight': 600, 'letter-spacing': '0.05em' }, content).textContent = 'SIM CLOCK';
      K.el('text', { id: uid + '-now-lbl', x: 76, y: 53, 'text-anchor': 'middle', fill: c.amber,
        'font-size': 19, 'font-weight': 700, 'font-variant-numeric': 'tabular-nums',
        filter: K.glow(uid) }, content).textContent = 'now 0';

      // --- node dots down the left edge (delivery targets) ---
      K.el('text', { x: NODE.x, y: NODE.ys[0] - 30, 'text-anchor': 'middle', fill: c.purple,
        'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'nodes';
      for (let i = 0; i < NODES; i++) {
        const cy = NODE.ys[i];
        K.el('circle', { cx: NODE.x, cy, r: NODE.r + 4, fill: K.grad(uid, 'purple'), opacity: 0.5 }, content);
        K.el('circle', { id: nid(i), cx: NODE.x, cy, r: NODE.r, fill: K.grad(uid, 'purple'),
          stroke: c.purple, 'stroke-width': 2 }, content);
        K.el('text', { x: NODE.x, y: cy + 4, 'text-anchor': 'middle', fill: c.text,
          'font-size': 11, 'font-weight': 700 }, content).textContent = 'n' + i;
      }

      // --- queue header (plain words; the type name is a small secondary tag) ---
      K.el('text', { x: HEAP.x, y: HEAP.y - 22, fill: c.text, 'font-size': 12, 'font-weight': 700 }, content)
        .textContent = 'the queue — sorted by delivery time, earliest on top';
      K.el('text', { x: HEAP.x, y: HEAP.y - 8, fill: c.muted, 'font-size': 8.5,
        'font-family': "ui-monospace,'SF Mono',monospace" }, content)
        .textContent = 'min-heap · key = (deliver_at, seq) · seq breaks ties';

      // "delivered next →" pointer at the head of the queue
      K.el('text', { id: uid + '-headlbl', x: HEAP.x + HEAP.w + 10, y: slotY(0) + 18, fill: c.amber,
        'font-size': 10, 'font-weight': 700 }, content).textContent = '';

      // verdict banner slot (hidden until "Run twice")
      K.el('rect', { id: uid + '-vbox', x: HEAP.x, y: Hh - 38, width: HEAP.w, height: 26, rx: 7,
        fill: 'none', stroke: 'none', opacity: 0 }, content);
      K.el('text', { id: uid + '-vtext', x: HEAP.x + HEAP.w / 2, y: Hh - 20, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 12.5, 'font-weight': 700, opacity: 0 }, content).textContent = '';
    }

    function pid(k, i) { return `${uid}-${k}-${i}`; }
    function PE(k, i) { return svg.querySelector('#' + CSS.escape(pid(k, i))); }
    function nid(i) { return `${uid}-node-${i}`; }
    function slotY(i) { return HEAP.y + 14 + i * HEAP.rowH; }

    function setPhase(k) {
      PHASES.forEach((p, i) => {
        const r = PE('pill', i), t = PE('pilltext', i); if (!r) return;
        const on = i === k;
        r.setAttribute('fill', on ? K.grad(uid, p.zone) : 'none');
        r.setAttribute('stroke', on ? c[p.zone] : c.separator);
        r.setAttribute('stroke-width', on ? 2.2 : 1.4);
        if (on) r.setAttribute('filter', K.glow(uid)); else r.removeAttribute('filter');
        t.setAttribute('fill', on ? c[p.zone] : c.muted);
      });
    }

    function render() {
      stat('now', st.now + ' ms');
      stat('inflight', st.heap.length);
      stat('order', st.order.length);

      const nowLbl = svg.querySelector('#' + CSS.escape(uid + '-now-lbl'));
      if (nowLbl) nowLbl.textContent = 'now ' + st.now;

      const headLbl = svg.querySelector('#' + CSS.escape(uid + '-headlbl'));

      let hg = svg.querySelector('#' + CSS.escape(uid + '-heap'));
      if (hg) hg.remove();
      hg = K.el('g', { id: uid + '-heap' }, content);

      const sorted = [...st.heap].sort(cmp);
      if (!sorted.length) {
        if (headLbl) headLbl.textContent = '';
        K.el('text', { x: HEAP.x + 8, y: slotY(0) + 16, fill: c.muted,
          'font-size': 10, 'font-style': 'italic' }, hg).textContent = '(queue empty — no packets waiting)';
        return;
      }
      if (headLbl) headLbl.textContent = '◀ delivered next';

      sorted.slice(0, HEAP.max).forEach((p, idx) => {
        const y = slotY(idx), top = idx === 0, due = p.deliverAt <= st.now;
        // the head is the one Step delivers next: amber, glowing, thick stroke
        const rowAttrs = { x: HEAP.x, y, width: HEAP.w, height: HEAP.rowH - 6, rx: 6,
          fill: K.grad(uid, top ? 'amber' : 'blue'),
          stroke: top ? c.amber : c.blue, 'stroke-width': top ? 2.4 : 1 };
        if (top) rowAttrs.filter = K.glow(uid);
        K.el('rect', rowAttrs, hg);
        K.el('text', { x: HEAP.x + 10, y: y + 18, fill: c.text,
          'font-size': 11, 'font-variant-numeric': 'tabular-nums' }, hg)
          .textContent = `n${p.from}→n${p.to}`;
        K.el('text', { x: HEAP.x + 86, y: y + 18, fill: c.muted, 'font-size': 9.5,
          'font-variant-numeric': 'tabular-nums', 'font-family': "ui-monospace,'SF Mono',monospace" }, hg)
          .textContent = `seq ${p.seq}`;
        // delivery time + how far away it is from now (never leaves a "due" row lingering: Step pops it)
        K.el('text', { x: HEAP.x + HEAP.w - 10, y: y + 18, 'text-anchor': 'end',
          fill: due ? c.green : c.text, 'font-size': 10.5, 'font-weight': due ? 700 : 400,
          'font-variant-numeric': 'tabular-nums' }, hg)
          .textContent = due ? `due @${p.deliverAt}` : `@${p.deliverAt}ms (+${p.deliverAt - st.now})`;
      });
      if (sorted.length > HEAP.max) {
        K.el('text', { x: HEAP.x, y: slotY(HEAP.max) + 12, fill: c.muted, 'font-size': 9 }, hg)
          .textContent = `+${sorted.length - HEAP.max} more waiting…`;
      }
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    function hideVerdict() {
      const box = svg.querySelector('#' + CSS.escape(uid + '-vbox'));
      const txt = svg.querySelector('#' + CSS.escape(uid + '-vtext'));
      if (box) { box.setAttribute('opacity', 0); box.setAttribute('stroke', 'none'); box.setAttribute('fill', 'none'); }
      if (txt) { txt.setAttribute('opacity', 0); txt.textContent = ''; }
    }
    function showVerdict(same, label) {
      const box = svg.querySelector('#' + CSS.escape(uid + '-vbox'));
      const txt = svg.querySelector('#' + CSS.escape(uid + '-vtext'));
      const col = same ? c.green : c.red;
      if (box) {
        box.setAttribute('fill', K.grad(uid, same ? 'green' : 'red'));
        box.setAttribute('stroke', col); box.setAttribute('stroke-width', 1.6);
        animate(box, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
      }
      if (txt) {
        txt.setAttribute('fill', col); txt.textContent = label;
        animate(txt, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
      }
    }

    // --- packet insertion with fly animation ---
    function pushPacket(from, to, lat) {
      const pkt = { seq: st.seq++, from, to, deliverAt: st.now + lat };
      st.heap.push(pkt);
      K.addLog(logBody, `send n${from}→n${to} · arrives @${pkt.deliverAt}ms (seq ${pkt.seq})`, 'hl');
      render();
      const dot = K.el('circle', { cx: NODE.x, cy: NODE.ys[from], r: 6,
        fill: c.blue, filter: K.glow(uid) }, anim);
      animate(dot, { cx: HEAP.x + 14, cy: slotY(0) + 11, duration: dur(340), ease: 'inOutQuad',
        onComplete: () => dot.remove() });
      return pkt;
    }

    async function send() {
      if (st.busy) return; st.busy = true; setLock(true);
      hideVerdict();
      // seeded latency ⇒ deterministic order: all randomness flows from st.rng (mulberry32 on the seed)
      const from = Math.floor(st.rng() * NODES);
      let to = Math.floor(st.rng() * (NODES - 1)); if (to >= from) to++;
      pushPacket(from, to, 20 + Math.floor(st.rng() * 90));
      await K.delay(dur(240)); st.busy = false; setLock(false);
    }

    async function sendTie() {
      if (st.busy) return; st.busy = true; setLock(true);
      hideVerdict();
      const lat = 30 + Math.floor(st.rng() * 60);
      const a = pushPacket(0, 1, lat);
      const b = pushPacket(0, 2, lat);
      K.addLog(logBody,
        `tie! both arrive @${a.deliverAt}ms — lower seq wins: seq ${a.seq} before seq ${b.seq}`, 'warn');
      await K.delay(dur(300)); st.busy = false; setLock(false);
    }

    async function stepOnce() {
      if (st.busy) return; st.busy = true; setLock(true);
      hideVerdict();
      st.now += TICK; render();
      K.addLog(logBody, `── Step → now ${st.now} ms ──`, 'hl');

      // deliver_due_packets(now): pop everything due, earliest first (top of the queue)
      let delivered = 0;
      while (true) {
        const sorted = [...st.heap].sort(cmp);
        const head = sorted[0];
        if (!head || head.deliverAt > st.now) break;

        // ① pick earliest — the head is already highlighted; pulse a scan bar over it
        setPhase(0);
        const bar = K.el('rect', { x: HEAP.x - 4, y: slotY(0) - 4, width: HEAP.w + 8,
          height: HEAP.rowH, rx: 7, fill: 'none', stroke: c.amber, 'stroke-width': 2.5, opacity: 0 }, anim);
        await animate(bar, { opacity: [0, 1, 0], duration: dur(300), ease: 'inOut(2)' });
        bar.remove();

        // ② deliver to node — fly a particle from the queue head to its target node
        setPhase(1);
        const dot = K.el('circle', { cx: HEAP.x + 14, cy: slotY(0) + 11, r: 7,
          fill: c.green, filter: K.glow(uid) }, anim);
        st.heap = st.heap.filter((q) => q.seq !== head.seq);
        st.order.push(head.seq);
        const nodeEl = svg.querySelector('#' + CSS.escape(nid(head.to)));
        if (nodeEl) flash(nodeEl);
        await animate(dot, { cx: NODE.x, cy: NODE.ys[head.to], duration: dur(420), ease: 'inOutQuad' });
        await animate(dot, { r: [7, 14], opacity: [1, 0], duration: dur(150), ease: 'out(2)',
          onComplete: () => dot.remove() });
        K.addLog(logBody, `deliver seq ${head.seq} → n${head.to} (it was the earliest)`, 'ok');
        delivered++;
        render();
      }
      setPhase(-1);
      if (!delivered) K.addLog(logBody, 'nothing due yet — Step again to advance the clock', '');
      await K.delay(dur(100)); st.busy = false; setLock(false);
    }

    // Run the SAME seeded scenario twice and check the delivery ORDER matches — the loud takeaway.
    async function runTwice() {
      if (st.busy) return; st.busy = true; setLock(true);
      hideVerdict();
      K.addLog(logBody, '↻ Run twice — replaying the same seed; orders must match', 'hl');

      const order1 = await scriptedRun();
      st.prevOrder = order1;
      await K.delay(dur(260));
      const order2 = await scriptedRun();

      const same = order1.length === order2.length && order1.every((v, i) => v === order2[i]);
      st.verdict = same;
      const seqStr = order2.join(' → ');
      if (same) {
        showVerdict(true, `✓ SAME ORDER  ${seqStr}`);
        K.addLog(logBody, `✓ both runs delivered in the same order: ${seqStr}`, 'ok');
        K.addLog(logBody, 'same seed ⇒ same delays ⇒ same order. A real NIC can&rsquo;t promise this.', 'ok');
      } else {
        showVerdict(false, `✗ ORDER DIFFERED`);
        K.addLog(logBody, `✗ orders differed: ${order1.join(' ')} vs ${order2.join(' ')}`, 'err');
      }
      st.busy = false; setLock(false);
    }

    // One deterministic scenario: reset to the seed, send a few packets, step until the queue drains.
    // Returns the recorded delivery order (list of seq numbers).
    async function scriptedRun() {
      st.now = 0; st.seq = 0; st.heap = []; st.order = []; st.rng = K.rng(st.seed >>> 0);
      render(); setPhase(-1);
      await K.delay(dur(120));

      // a fixed handful of seeded sends, including a deliberate same-tick tie
      for (let k = 0; k < 4; k++) {
        const from = Math.floor(st.rng() * NODES);
        let to = Math.floor(st.rng() * (NODES - 1)); if (to >= from) to++;
        pushPacket(from, to, 20 + Math.floor(st.rng() * 80));
        await K.delay(dur(140));
      }
      // step the clock forward until everything has been delivered
      let guard = 0;
      while (st.heap.length && guard++ < 40) {
        st.now += TICK; render();
        const sorted = [...st.heap].sort(cmp);
        const head = sorted[0];
        if (head && head.deliverAt <= st.now) {
          st.heap = st.heap.filter((q) => q.seq !== head.seq);
          st.order.push(head.seq);
          const nodeEl = svg.querySelector('#' + CSS.escape(nid(head.to)));
          if (nodeEl) flash(nodeEl);
          render();
          await K.delay(dur(150));
        }
      }
      render();
      return [...st.order];
    }

    function flash(nodeEl) {
      animate(nodeEl, { opacity: [1, 0.3, 1], duration: dur(300), ease: 'inOut(2)' });
    }

    function bind() {
      root.querySelector('.t-send').onclick = send;
      root.querySelector('.t-tie').onclick = sendTie;
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepOnce(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-twice').onclick = runTwice;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 42; reset(); };
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        if (st.heap.length < 3 && st.rng() < 0.8) await send();
        await stepOnce();
        if (!st.playing) break;
        await K.delay(dur(280));
      }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      st.now = 0; st.seq = 0; st.heap = []; st.order = []; st.prevOrder = null; st.verdict = null;
      st.rng = K.rng(st.seed >>> 0); st.busy = false;
      setLock(false); drawScene(); render(); setPhase(-1);
      K.addLog(logBody, '↺ reset — seed ' + st.seed + ' · same seed ⇒ same delivery order', 'hl');
    }
    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-send', '.t-tie', '.t-step', '.t-twice', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTPacketHeap = { init };
})();
