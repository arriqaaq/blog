/**
 * DST Packet Admission (re-skinned via dst-kit) — the send→delivery decision gate, made kinetic.
 *
 * Between a node's send_to and the heap push, enqueue_packet runs a fixed-order gate:
 *   crashed endpoint? → one-way block? → link partitioned? → link held? → seeded loss coin-flip →
 *   assign seeded latency → push to the heap.
 * Each branch is a distinct fate: DROPPED (gone), HELD (buffered), or SCHEDULED (in the heap).
 * Toggle the link's state and re-fire the same packet to watch a different terminal light up; the
 * loss diamond shows the seeded RNG draw, so the same seed sends the packet down the same path.
 *
 * Exposes window.DSTPacketAdmission.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) {
    console.error('packet-admission: anime v4 required'); return;
  }
  if (!window.DSTKit) {
    console.error('packet-admission: dst-kit required'); return;
  }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 760, H = 430;

  const GATES = [
    { key: 'crashed',    label: 'endpoint crashed?',           fate: 'drop' },
    { key: 'oneway',     label: 'one-way block (from→to)?', fate: 'drop' },
    { key: 'hold',       label: 'link held?',                  fate: 'held' },
    { key: 'partitioned',label: 'link partitioned?',           fate: 'drop' },
    { key: 'loss',       label: 'seeded loss coin-flip?',      fate: 'drop' },
    { key: 'latency',    label: 'assign seeded latency → push', fate: 'sched' },
  ];

  // Gate column geometry
  const GX = 200, GW = 310, GH = 46, GAP = 14, GTOP = 42;
  const gateY = (i) => GTOP + i * (GH + GAP);

  // Terminal column geometry (right of gates)
  const TX = 548, TW = 184, TH = 42;

  function init(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const uid = containerId;

    const st = {
      seed: 42,
      rng: K.rng(42),
      toggles: { crashed: false, oneway: false, partitioned: false, hold: false, lossHigh: false },
      busy: false,
      sent: 0, dropped: 0, held: 0, scheduled: 0,
    };

    let svg, content, anim, logBody, c;

    build();

    // ── controls HTML ─────────────────────────────────────────────────────────
    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--blue t-send">&#9654; Send packet n0→n1</button>
      </div>
      <span class="dstk-tdiv"></span>
      <div class="dstk-tgroup">
        <span class="dstk-tlabel">link</span>
        <button class="dstk-btn dstk-btn--ghost t-tg" data-tg="partitioned" aria-pressed="false">partition</button>
        <button class="dstk-btn dstk-btn--ghost t-tg" data-tg="hold"        aria-pressed="false">hold</button>
        <button class="dstk-btn dstk-btn--ghost t-tg" data-tg="oneway"      aria-pressed="false">one-way</button>
        <button class="dstk-btn dstk-btn--ghost t-tg" data-tg="crashed"     aria-pressed="false">crash n1</button>
        <button class="dstk-btn dstk-btn--ghost t-tg" data-tg="lossHigh"    aria-pressed="false">loss 80%</button>
      </div>
      <span class="dstk-sp"></span>
      <div class="dstk-tgroup">
        <span class="dstk-tlabel">seed</span>
        <input type="number" class="t-seed" value="${st.seed}" min="0">
      </div>`;
    }

    // ── build (called on init and on theme change) ────────────────────────────
    function build() {
      root.innerHTML = K.container({
        title: 'Packet admission',
        sub: 'drop, hold, or schedule',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'sent',      label: 'sent' },
          { id: 'dropped',   label: 'dropped' },
          { id: 'held',      label: 'held' },
          { id: 'scheduled', label: 'scheduled' },
        ],
        cap: 'enqueue_packet evaluates gates top-to-bottom; same seed ⇒ same coin-flips.',
      });
      c = K.palette();
      svg    = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim    = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene();
      bind();
      syncToggleStyle();
      render();
    }

    // ── scene (static decorations + gate boxes + terminals) ──────────────────
    function drawScene() {
      content.innerHTML = '';

      // Title annotation
      K.el('text', {
        x: GX + GW / 2, y: 24, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 10.5, 'font-style': 'italic',
      }, content).textContent = 'enqueue_packet — evaluated top to bottom';

      // Vertical spine connecting gates
      for (let i = 0; i < GATES.length - 1; i++) {
        K.el('line', {
          x1: GX + GW / 2, y1: gateY(i) + GH,
          x2: GX + GW / 2, y2: gateY(i + 1),
          stroke: c.separator, 'stroke-width': 1.5,
          'marker-end': K.arrow(uid, 'blue'),
        }, content);
      }

      // Gate boxes (blue = network/packets)
      GATES.forEach((g, i) => {
        const y = gateY(i);
        K.el('rect', {
          id: gid(g.key),
          x: GX, y, width: GW, height: GH, rx: 8,
          fill: K.grad(uid, 'blue'),
          stroke: c.blue, 'stroke-width': 1.5,
        }, content);
        K.el('text', {
          x: GX + GW / 2, y: y + GH / 2 + 4,
          'text-anchor': 'middle',
          fill: c.text, 'font-size': 12.5, 'font-weight': 600,
        }, content).textContent = g.label;
      });

      // Horizontal branch lines from gate-exit to terminal
      // drop exits from gate 0/1/2/4 → top-right; we draw one representative per terminal
      const branchSpecs = [
        { gateIdx: 2, termKey: 'held', zone: 'amber' },
        { gateIdx: 3, termKey: 'drop', zone: 'red'   },
        { gateIdx: 5, termKey: 'sched', zone: 'green' },
      ];
      branchSpecs.forEach(({ gateIdx, termKey, zone }) => {
        const midY = gateY(gateIdx) + GH / 2;
        K.el('line', {
          x1: GX + GW, y1: midY, x2: TX, y2: midY,
          stroke: c[zone], 'stroke-width': 1.3, 'stroke-dasharray': '4 3',
          'marker-end': K.arrow(uid, zone),
        }, content);
      });

      // Terminal boxes
      drawTerminal('held',  gateY(2) + GH / 2 - TH / 2, 'HELD (buffered)',  'amber');
      drawTerminal('drop',  gateY(3) + GH / 2 - TH / 2, 'DROPPED',         'red');
      drawTerminal('sched', gateY(5) + GH / 2 - TH / 2, 'SCHEDULED (heap)', 'green');

      // Entry arrow above first gate
      K.el('text', {
        x: GX + GW / 2, y: GTOP - 4,
        'text-anchor': 'middle',
        fill: c.blue, 'font-size': 10, 'font-weight': 700,
      }, content).textContent = '▼ packet';
    }

    function drawTerminal(key, y, label, zone) {
      K.el('rect', {
        id: tid(key),
        x: TX, y, width: TW, height: TH, rx: 8,
        fill: K.grad(uid, zone),
        stroke: c[zone], 'stroke-width': 1.8,
      }, content);
      K.el('text', {
        x: TX + TW / 2, y: y + TH / 2 + 4,
        'text-anchor': 'middle',
        fill: c[zone], 'font-size': 12, 'font-weight': 700,
      }, content).textContent = label;
    }

    const gid = (k) => `${uid}-g-${k}`;
    const tid = (k) => `${uid}-t-${k}`;
    const Gel = (k) => svg.querySelector('#' + CSS.escape(gid(k)));
    const Tel = (k) => svg.querySelector('#' + CSS.escape(tid(k)));

    // ── stat card updates ─────────────────────────────────────────────────────
    function render() {
      stat('sent',      st.sent);
      stat('dropped',   st.dropped);
      stat('held',      st.held);
      stat('scheduled', st.scheduled);
    }
    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // ── decision logic (pure, no side effects) ────────────────────────────────
    function decide() {
      const T = st.toggles;
      if (T.crashed)     return { stopAt: 0, fate: 'drop',  note: 'endpoint n1 is crashed → dropped' };
      if (T.oneway)      return { stopAt: 1, fate: 'drop',  note: 'one-way block n0→n1 → dropped' };
      // held is evaluated before the partition-drop: a held link buffers even when partitioned
      // (backplane.rs:148-149 — `if !link_held && !can_send_undirected { drop }`).
      if (T.hold)        return { stopAt: 2, fate: 'held',  note: 'link held → buffered (deliver_at preserved)' };
      if (T.partitioned) return { stopAt: 3, fate: 'drop',  note: 'link partitioned → dropped (gone forever)' };
      const roll = st.rng();
      const p = T.lossHigh ? 0.8 : 0.1;
      if (roll < p) return { stopAt: 4, fate: 'drop', note: `loss coin-flip ${roll.toFixed(2)} < ${p} → dropped` };
      const lat = 20 + Math.floor(st.rng() * 90);
      return { stopAt: 5, fate: 'sched', note: `coin-flip ${roll.toFixed(2)} ≥ ${p}; latency ${lat} ms → heap` };
    }

    // ── send animation ────────────────────────────────────────────────────────
    async function send() {
      if (st.busy) return;
      st.busy = true; setBusy(true);

      const d = decide();
      st.sent++;

      // particle starts above first gate
      const startX = GX + GW / 2;
      const startY = GTOP - 12;
      const dot = K.el('circle', {
        cx: startX, cy: startY, r: 7,
        fill: c.blue, filter: K.glow(uid),
      }, anim);

      // descend through each gate, flashing each box
      for (let i = 0; i <= d.stopAt; i++) {
        const gy = gateY(i) + GH / 2;
        await animate(dot, { cx: startX, cy: gy, duration: 300, ease: 'inOut(2)' });
        const box = Gel(GATES[i].key);
        if (box) animate(box, { opacity: [1, 0.45, 1], duration: 240, ease: 'inOut(2)' });
        await K.delay(60);
      }

      // determine terminal target coordinates
      const termKey = d.fate;
      const termY = (termKey === 'drop' ? gateY(3) : termKey === 'held' ? gateY(2) : gateY(5)) + GH / 2;
      const termZone = termKey === 'drop' ? 'red' : termKey === 'held' ? 'amber' : 'green';
      const termColor = c[termZone];
      const termX = TX + TW / 2;

      // recolor particle to match fate
      dot.setAttribute('fill', termColor);

      // branch horizontally then arrive at terminal
      await animate(dot, { cx: termX, cy: termY, duration: 380, ease: 'inOutQuad' });

      // flash the terminal box
      const tbox = Tel(termKey);
      if (tbox) animate(tbox, { opacity: [1, 0.35, 1], duration: 320, ease: 'inOut(2)' });

      // burst and vanish
      await animate(dot, { r: [7, 14], opacity: [1, 0], duration: 200, ease: 'out(2)' });
      dot.remove();

      // update counters and log
      if (termKey === 'drop')  st.dropped++;
      if (termKey === 'held')  st.held++;
      if (termKey === 'sched') st.scheduled++;

      const logCls = termKey === 'drop' ? 'err' : termKey === 'held' ? 'warn' : 'ok';
      K.addLog(logBody, '→ ' + d.note, logCls);
      render();

      st.busy = false; setBusy(false);
    }

    // ── bindings ──────────────────────────────────────────────────────────────
    function bind() {
      root.querySelector('.t-send').addEventListener('click', send);

      root.querySelectorAll('.t-tg').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (st.busy) return;
          const k = btn.getAttribute('data-tg');
          st.toggles[k] = !st.toggles[k];
          syncToggleStyle();
        });
      });

      root.querySelector('.t-seed').addEventListener('change', (e) => {
        st.seed = parseInt(e.target.value, 10) || 42;
        st.rng = K.rng(st.seed >>> 0);
        K.addLog(logBody, '↺ re-seeded → ' + st.seed + ' — same seed ⇒ same coin-flips', 'hl');
      });
    }

    // Toggle buttons: ghost when off, colored (red/amber/green/pink) when on
    function syncToggleStyle() {
      root.querySelectorAll('.t-tg').forEach((btn) => {
        const k   = btn.getAttribute('data-tg');
        const on  = !!st.toggles[k];
        btn.setAttribute('aria-pressed', String(on));
        // remove all zone classes, then add the right one if on
        btn.classList.remove(
          'dstk-btn--red', 'dstk-btn--amber', 'dstk-btn--pink',
          'dstk-btn--blue', 'dstk-btn--purple', 'dstk-btn--green',
        );
        if (on) {
          const zoneMap = { partitioned: 'red', hold: 'amber', oneway: 'pink', crashed: 'red', lossHigh: 'amber' };
          btn.classList.add('dstk-btn--' + (zoneMap[k] || 'purple'));
          btn.classList.remove('dstk-btn--ghost');
        } else {
          btn.classList.add('dstk-btn--ghost');
        }
      });
    }

    function setBusy(b) {
      root.querySelector('.t-send').disabled = b;
      root.querySelectorAll('.t-tg').forEach((x) => { x.disabled = b; });
      const seedEl = root.querySelector('.t-seed');
      if (seedEl) seedEl.disabled = b;
    }

    K.addLog(logBody, 'ready — seed ' + st.seed + ' · same seed ⇒ same coin-flips', 'hl');

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTPacketAdmission = { init };
})();
