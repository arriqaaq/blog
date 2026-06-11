/**
 * DST Packet Admission (re-skinned via dst-kit) — "every send runs the same checklist; the seed
 * decides loss and latency."
 *
 * Between a node's send_to and the heap push, enqueue_packet runs a fixed-order checklist of gates:
 *   ① crashed endpoint? → ② one-way block? → ③ partitioned (UNLESS the link is held)? →
 *   ④ seeded loss coin-flip → ⑤ assign seeded latency (deliver_at) → ⑥ route: link held ? HELD-queue : SCHEDULED-heap.
 * A held link bypasses the partition DROP (gate ③) but still faces the loss coin-flip (④) and still
 * gets a deliver_at (⑤) — "held" is the final routing decision, not an early escape (backplane.rs:118-228;
 * the gate body runs 131-228, crashed→one-way→partition→loss→latency→route).
 * Every packet ends at exactly one terminal: DROPPED (gone), HELD (buffered), or SCHEDULED (in the heap).
 *
 * The whole point is determinism: gates ④ and ⑤ (loss + latency) are the only random draws, and they
 * come from the seeded K.rng(seed) stream — so the same seed sends the packet down the same path with
 * the same latency, every time. The widget proves it: a "send twice" verdict shows run A vs run B
 * landing on the identical terminal. Toggle the link's state to watch a different terminal light up.
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

  const W = 760, H = 432;

  // The fixed-order checklist. `step` is the plain 1..6 number shown to readers; `tag` is the
  // small secondary (jargon) label. `random` marks the two gates whose outcome the seed decides.
  const GATES = [
    { key: 'crashed',     step: 1, label: 'Is the receiver alive?',  tag: 'endpoint crashed?',          fate: 'drop'  },
    { key: 'oneway',      step: 2, label: 'Can it go this way?',     tag: 'one-way block n0→n1',        fate: 'drop'  },
    { key: 'partitioned', step: 3, label: 'Is the link cut?',       tag: 'partitioned · skipped if held', fate: 'drop' },
    { key: 'loss',        step: 4, label: 'Coin-flip: lost?',       tag: 'seeded loss draw',  fate: 'drop', random: true },
    { key: 'latency',     step: 5, label: 'How late?',              tag: 'seeded deliver_at', fate: 'pass', random: true },
    { key: 'route',       step: 6, label: 'Held or scheduled?',     tag: 'route by link state',        fate: 'route' },
  ];

  // Gate column geometry
  const GX = 196, GW = 322, GH = 44, GAP = 11, GTOP = 56;
  const gateY = (i) => GTOP + i * (GH + GAP);

  // Terminal column geometry (right of gates)
  const TX = 560, TW = 178, TH = 44;
  // Terminal mid-Y: DROPPED aligns with the loss gate; HELD/SCHEDULED split off the final route gate.
  const TERM_Y = { drop: gateY(3) + GH / 2, held: gateY(5) + GH / 2 - 34, sched: gateY(5) + GH / 2 + 34 };
  const TERM = {
    drop:  { label: 'DROPPED',   sub: 'gone forever', zone: 'red'   },
    held:  { label: 'HELD',      sub: 'buffered',     zone: 'amber' },
    sched: { label: 'SCHEDULED', sub: 'in the heap',  zone: 'green' },
  };

  function init(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const uid = containerId;

    const st = {
      seed: 42,
      rng: K.rng(42),
      toggles: { crashed: false, oneway: false, partitioned: false, hold: false, lossHigh: false },
      busy: false,
      lastTerm: null,   // terminal of the most recent single send (for the "same seed" proof)
    };

    let svg, content, anim, logBody, c;

    // ── controls HTML ─────────────────────────────────────────────────────────
    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--blue t-send">&#9654; Send packet n0→n1</button>
        <button class="dstk-btn dstk-btn--purple t-twice">&#9654;&#9654; Send twice (same seed)</button>
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
        title: 'Every send runs the same checklist',
        sub: 'six questions decide: drop it, hold it, or schedule it',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'verdict', label: 'this packet' },
          { id: 'draw',    label: 'loss draw' },
          { id: 'latency', label: 'latency' },
        ],
        cap: 'A packet drops down a fixed checklist; only the loss-flip and the latency are random — '
           + 'and both are drawn from the seed, so the same seed sends the packet to the same place every time.',
      });
      c = K.palette();
      svg     = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim    = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene();
      bind();
      syncToggleStyle();
      resetVerdict();
      K.addLog(logBody, '🌱 ready — seed ' + st.seed + ' · same seed ⇒ same fate', 'hl');
    }

    // ── scene (static decorations + gate boxes + terminals) ──────────────────
    function drawScene() {
      content.innerHTML = '';

      // Entry label above first gate
      K.el('text', {
        x: GX + GW / 2, y: 22, 'text-anchor': 'middle',
        fill: c.blue, 'font-size': 11, 'font-weight': 700,
      }, content).textContent = '▼ packet n0 → n1';
      K.el('text', {
        x: GX + GW / 2, y: 38, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 9.5, 'font-style': 'italic',
      }, content).textContent = 'enqueue_packet — checked top to bottom';

      // Vertical spine connecting gates
      for (let i = 0; i < GATES.length - 1; i++) {
        K.el('line', {
          x1: GX + GW / 2, y1: gateY(i) + GH,
          x2: GX + GW / 2, y2: gateY(i + 1),
          stroke: c.separator, 'stroke-width': 1.5,
          'marker-end': K.arrow(uid, 'blue'),
        }, content);
      }

      // Gate boxes — each carries a numbered pill (the plain step), the plain question, and a
      // small jargon tag. The numbered pill lights up as the packet reaches that step.
      GATES.forEach((g, i) => {
        const y = gateY(i);
        K.el('rect', {
          id: gid(g.key),
          x: GX, y, width: GW, height: GH, rx: 8,
          fill: 'none',
          stroke: c.separator, 'stroke-width': 1.4,
        }, content);
        // step number pill
        K.el('circle', {
          id: gid(g.key) + '-pill', cx: GX + 22, cy: y + GH / 2, r: 12,
          fill: 'none', stroke: c.separator, 'stroke-width': 1.6,
        }, content);
        K.el('text', {
          id: gid(g.key) + '-num', x: GX + 22, y: y + GH / 2 + 4.5, 'text-anchor': 'middle',
          fill: c.muted, 'font-size': 12, 'font-weight': 700,
        }, content).textContent = g.step;
        // plain question
        K.el('text', {
          x: GX + 44, y: y + GH / 2 - 1,
          fill: c.text, 'font-size': 12.5, 'font-weight': 700,
        }, content).textContent = g.label;
        // small jargon tag + a dice glyph for the two seeded gates
        K.el('text', {
          x: GX + 44, y: y + GH / 2 + 13,
          fill: c.muted, 'font-size': 9, 'font-family': "ui-monospace,'SF Mono',monospace",
        }, content).textContent = (g.random ? '🎲 ' : '') + g.tag;
      });

      // Branch lines from gate-exit to terminal: DROPPED off the loss gate (representative); the final
      // route gate splits into HELD (buffered) and SCHEDULED (heap).
      const branchSpecs = [
        { gateIdx: 3, termKey: 'drop',  zone: 'red'   },
        { gateIdx: 5, termKey: 'held',  zone: 'amber' },
        { gateIdx: 5, termKey: 'sched', zone: 'green' },
      ];
      branchSpecs.forEach(({ gateIdx, termKey, zone }) => {
        K.el('line', {
          x1: GX + GW, y1: gateY(gateIdx) + GH / 2, x2: TX, y2: TERM_Y[termKey],
          stroke: c[zone], 'stroke-width': 1.3, 'stroke-dasharray': '4 3',
          'marker-end': K.arrow(uid, zone),
        }, content);
      });

      // Terminal boxes — the three possible fates
      Object.keys(TERM).forEach((key) => drawTerminal(key));
    }

    function drawTerminal(key) {
      const t = TERM[key], y = TERM_Y[key] - TH / 2, zone = t.zone;
      K.el('rect', {
        id: tid(key),
        x: TX, y, width: TW, height: TH, rx: 8,
        fill: 'none',
        stroke: c[zone], 'stroke-width': 1.6, 'stroke-opacity': 0.45,
      }, content);
      K.el('text', {
        id: tid(key) + '-lbl',
        x: TX + 14, y: y + TH / 2 - 1,
        fill: c[zone], 'font-size': 13, 'font-weight': 800, 'fill-opacity': 0.5,
      }, content).textContent = t.label;
      K.el('text', {
        x: TX + 14, y: y + TH / 2 + 13,
        fill: c.muted, 'font-size': 9,
      }, content).textContent = t.sub;
    }

    const gid = (k) => `${uid}-g-${k}`;
    const tid = (k) => `${uid}-t-${k}`;
    const Gel = (k) => svg.querySelector('#' + CSS.escape(gid(k)));
    const Tel = (k) => svg.querySelector('#' + CSS.escape(tid(k)));
    const sub = (id) => svg.querySelector('#' + CSS.escape(id));

    // ── stat card updates ─────────────────────────────────────────────────────
    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // ── decision logic (pure, no side effects) ────────────────────────────────
    // Order is load-bearing and matches backplane.rs:131-228 — do not reorder.
    function decide() {
      const T = st.toggles;
      if (T.crashed)     return { stopAt: 0, fate: 'drop',  note: 'receiver n1 is crashed → DROPPED' };
      if (T.oneway)      return { stopAt: 1, fate: 'drop',  note: 'one-way block n0→n1 → DROPPED' };
      // partition drops only if the link is NOT held; a held link bypasses the partition drop
      // (backplane.rs:148-149 — `if !link_held && !can_send_undirected { drop }`).
      if (T.partitioned && !T.hold) return { stopAt: 2, fate: 'drop', note: 'link is cut (partitioned) → DROPPED' };
      // gate ④ — the seeded loss coin-flip (first random draw from the seed stream).
      const roll = st.rng();
      const p = T.lossHigh ? 0.8 : 0.1;
      if (roll < p) return { stopAt: 3, fate: 'drop', roll, p, note: `loss flip ${roll.toFixed(2)} < ${p.toFixed(2)} → DROPPED` };
      // gate ⑤ — seeded latency (second random draw), then ⑥ route by link state.
      const lat = 20 + Math.floor(st.rng() * 90);
      if (T.hold) return { stopAt: 5, fate: 'held',  roll, p, lat, note: `survived (${roll.toFixed(2)} ≥ ${p.toFixed(2)}); +${lat} ms; link held → HELD` };
      return { stopAt: 5, fate: 'sched', roll, p, lat, note: `survived (${roll.toFixed(2)} ≥ ${p.toFixed(2)}); +${lat} ms → SCHEDULED` };
    }

    // ── reset the big verdict banner + stats to a neutral pre-send state ───────
    function resetVerdict() {
      setVerdict('—', c.muted, 'press Send');
      stat('draw', '—'); stat('latency', '—');
      GATES.forEach((g) => litGate(g.key, false));
      Object.keys(TERM).forEach((k) => litTerm(k, false));
    }

    // ── single send: walk the lit checklist, then land loudly on a terminal ────
    async function send(opts) {
      opts = opts || {};
      if (st.busy && !opts.chained) return;

      const d = decide();
      st.lastTerm = d.fate;

      // reset all lights for this run
      GATES.forEach((g) => litGate(g.key, false));
      Object.keys(TERM).forEach((k) => litTerm(k, false));
      setVerdict('…', c.muted, 'running checklist');

      // particle starts above the first gate
      const startX = GX + GW / 2;
      const dot = K.el('circle', {
        cx: startX, cy: GTOP - 16, r: 7,
        fill: c.blue, filter: K.glow(uid),
      }, anim);

      // descend through each gate, lighting the numbered pill it reaches
      for (let i = 0; i <= d.stopAt; i++) {
        const gy = gateY(i) + GH / 2;
        await animate(dot, { cx: startX, cy: gy, duration: opts.fast ? 150 : 280, ease: 'inOut(2)' });
        litGate(GATES[i].key, true);
        // surface the two seeded draws on their own stat cards as the packet passes them
        if (GATES[i].key === 'loss'    && d.roll != null) stat('draw', d.roll.toFixed(2));
        if (GATES[i].key === 'latency' && d.lat  != null) stat('latency', '+' + d.lat + ' ms');
        await K.delay(opts.fast ? 30 : 55);
      }

      // recolor + branch out to the terminal that fired
      const t = TERM[d.fate], termColor = c[t.zone];
      dot.setAttribute('fill', termColor);
      await animate(dot, { cx: TX + TW / 2, cy: TERM_Y[d.fate], duration: opts.fast ? 200 : 360, ease: 'inOutQuad' });
      litTerm(d.fate, true);
      await animate(dot, { r: [7, 16], opacity: [1, 0], duration: 200, ease: 'out(2)' });
      dot.remove();

      // LOUD verdict banner — the single fact that must be impossible to miss
      const verb = d.fate === 'drop' ? '✗ DROPPED' : d.fate === 'held' ? '⏸ HELD' : '✓ SCHEDULED';
      setVerdict(verb, termColor, t.sub);

      const logCls = d.fate === 'drop' ? 'err' : d.fate === 'held' ? 'warn' : 'ok';
      K.addLog(logBody, '→ ' + d.note, logCls);
      return d;
    }

    // ── "send twice" — replays the SAME seed and shows A and B land identically ─
    async function sendTwice() {
      if (st.busy) return;
      st.busy = true; setBusy(true);

      // snapshot the rng so both runs draw the identical sequence from this seed
      st.rng = K.rng(st.seed >>> 0);
      K.addLog(logBody, '▶▶ same seed (' + st.seed + ') twice — run A then run B', 'hl');
      const a = await send({ chained: true, fast: true });
      const aVerb = labelOf(a.fate);
      await K.delay(280);

      st.rng = K.rng(st.seed >>> 0);   // rewind to the exact same seed stream
      const b = await send({ chained: true, fast: true });
      const bVerb = labelOf(b.fate);

      const same = a.fate === b.fate;
      const col = same ? c.green : c.red;
      setVerdict(same ? '✓ A = B' : '✗ A ≠ B', col,
        same ? aVerb + ' both times' : aVerb + ' vs ' + bVerb);
      K.addLog(logBody, same
        ? `same seed ⇒ same fate: ${aVerb} both runs`
        : `unexpected: ${aVerb} ≠ ${bVerb}`, same ? 'ok' : 'err');

      st.busy = false; setBusy(false);
    }
    const labelOf = (f) => TERM[f].label;

    // ── light helpers ──────────────────────────────────────────────────────────
    // A gate lights up (blue) when the packet reaches it.
    function litGate(key, on) {
      const box = Gel(key), pill = sub(gid(key) + '-pill'), num = sub(gid(key) + '-num');
      if (!box) return;
      box.setAttribute('stroke', on ? c.blue : c.separator);
      box.setAttribute('stroke-width', on ? 2 : 1.4);
      box.setAttribute('fill', on ? K.grad(uid, 'blue') : 'none');
      if (on) box.setAttribute('filter', K.glow(uid)); else box.removeAttribute('filter');
      if (pill) { pill.setAttribute('stroke', on ? c.blue : c.separator); pill.setAttribute('fill', on ? K.grad(uid, 'blue') : 'none'); }
      if (num) num.setAttribute('fill', on ? c.blue : c.muted);
    }
    // A terminal lights up (full color) when the packet lands there.
    function litTerm(key, on) {
      const t = TERM[key], box = Tel(key), lbl = sub(tid(key) + '-lbl');
      if (!box) return;
      box.setAttribute('stroke', c[t.zone]);
      box.setAttribute('stroke-width', on ? 2.6 : 1.6);
      box.setAttribute('stroke-opacity', on ? 1 : 0.45);
      box.setAttribute('fill', on ? K.grad(uid, t.zone) : 'none');
      if (on) box.setAttribute('filter', K.glow(uid)); else box.removeAttribute('filter');
      if (lbl) lbl.setAttribute('fill-opacity', on ? 1 : 0.5);
      if (on) animate(box, { opacity: [0.4, 1], duration: 300, ease: 'out(2)' });
    }

    // ── the loud verdict banner (a single big stat card) ───────────────────────
    function setVerdict(text, color, subText) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-verdict'));
      if (e) { e.textContent = text; e.style.color = color; e.style.fontSize = '.82rem'; }
      const card = e && e.parentElement;
      const lbl = card && card.querySelector('.dstk-stat-l');
      if (lbl) lbl.textContent = subText || 'this packet';
    }

    // ── bindings ──────────────────────────────────────────────────────────────
    function bind() {
      root.querySelector('.t-send').addEventListener('click', async () => {
        if (st.busy) return;
        st.busy = true; setBusy(true);
        await send();
        st.busy = false; setBusy(false);
      });
      root.querySelector('.t-twice').addEventListener('click', sendTwice);

      root.querySelectorAll('.t-tg').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (st.busy) return;
          const k = btn.getAttribute('data-tg');
          st.toggles[k] = !st.toggles[k];
          syncToggleStyle();
          resetVerdict();
        });
      });

      root.querySelector('.t-seed').addEventListener('change', (e) => {
        if (st.busy) return;
        st.seed = parseInt(e.target.value, 10) || 42;
        st.rng = K.rng(st.seed >>> 0);
        resetVerdict();
        K.addLog(logBody, '↺ re-seeded → ' + st.seed + ' — same seed ⇒ same fate', 'hl');
      });
    }

    // Toggle buttons: ghost when off, colored when on
    function syncToggleStyle() {
      root.querySelectorAll('.t-tg').forEach((btn) => {
        const k   = btn.getAttribute('data-tg');
        const on  = !!st.toggles[k];
        btn.setAttribute('aria-pressed', String(on));
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
      root.querySelector('.t-twice').disabled = b;
      root.querySelectorAll('.t-tg').forEach((x) => { x.disabled = b; });
      const seedEl = root.querySelector('.t-seed');
      if (seedEl) seedEl.disabled = b;
    }

    build();

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTPacketAdmission = { init };
})();
