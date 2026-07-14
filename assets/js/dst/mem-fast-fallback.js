/**
 * MEM Fast Fallback (dst-kit) — the one move every protocol makes after FLP.
 *
 * FLP says you cannot be always-safe AND always-live in an asynchronous world. The universal
 * answer: keep safety unconditionally, and split progress into a FAST PATH for when everyone
 * already agrees (decide in one hop) and a FALLBACK for when they don't (pay for a coordinated
 * two-phase round). Rapid's ¾ vote, Matchmaker's 1-RTT matchmaking, superquorum commits — all
 * the same shape.
 *
 * Here four proposers propose a config change to four acceptors. Identical proposals → ≥¾ of
 * acceptors accept the same value → decided, one round-trip. Inject conflict and the vote
 * splits → a coordinator falls back to prepare/accept — slower, chattier, but still exactly one
 * decision. Safety never degraded; only latency did. Exposes window.MEMFastFallback.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-fast-fallback: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-fast-fallback: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 280;
  const PX = 100, AX = 390, YS = [70, 122, 174, 226];
  const COORD = { x: AX, y: 26 };
  const DEC = { x: 590, y: 100, w: 166, h: 84 };
  const V1 = { name: 'cfg₆', zone: 'green' }, V2 = { name: 'cfg₆*', zone: 'pink' };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({ seed: seed == null ? 21 : seed, rng: K.rng(seed == null ? 21 : seed),
      conflict: false, fast: 0, fallbacks: 0, msgs: 0, busy: false, playing: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Propose a change</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-conf">☐ inject conflict</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Fast path and fallback', sub: 'one round when nodes agree; a coordinated round when they don’t',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'fast', label: 'fast decides' }, { id: 'fb', label: 'fallbacks' }, { id: 'rt', label: 'round-trips (last)' }, { id: 'msgs', label: 'msgs' }],
        cap: 'Identical proposals: ≥¾ of acceptors hold the same value → decided in one round-trip. Conflicting '
           + 'proposals: the vote splits, a coordinator runs prepare/accept — three round-trips, one decision. '
           + 'In both cases exactly one value wins. The bad period costs latency, never correctness.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 propose with no conflict first — then flip conflict on and compare the cost', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      K.el('text', { x: PX, y: 40, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'proposers';
      K.el('text', { x: AX, y: 40, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'acceptors';
      YS.forEach((y, i) => {
        K.el('circle', { id: `${uid}-p-${i}`, cx: PX, cy: y, r: 13, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 2 }, content);
        K.el('text', { x: PX, y: y + 3.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'P' + (i + 1);
        K.el('text', { id: `${uid}-pv-${i}`, x: PX - 24, y: y + 3.5, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content).textContent = '';
        K.el('circle', { id: `${uid}-a-${i}`, cx: AX, cy: y, r: 15, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 2 }, content);
        K.el('text', { x: AX, y: y + 3.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'a' + (i + 1);
        K.el('text', { id: `${uid}-av-${i}`, x: AX + 26, y: y + 3.5, fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = '·';
      });
      // coordinator (hidden until fallback)
      const g = K.el('g', { id: `${uid}-coord`, opacity: 0 }, content);
      K.el('circle', { cx: COORD.x, cy: COORD.y, r: 13, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 2 }, g);
      K.el('text', { x: COORD.x, y: COORD.y + 3.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 8.5, 'font-weight': 700 }, g).textContent = 'co';
      K.el('text', { x: COORD.x + 22, y: COORD.y + 3.5, fill: c.amber, 'font-size': 8.5, 'font-weight': 700 }, g).textContent = 'coordinator (fallback only)';
      // decision box
      K.el('rect', { id: `${uid}-dbox`, x: DEC.x, y: DEC.y, width: DEC.w, height: DEC.h, rx: 10, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.6 }, content);
      K.el('text', { x: DEC.x + DEC.w / 2, y: DEC.y + 24, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'DECISION';
      K.el('text', { id: `${uid}-dval`, x: DEC.x + DEC.w / 2, y: DEC.y + 50, 'text-anchor': 'middle', fill: c.text, 'font-size': 15, 'font-weight': 700 }, content).textContent = '—';
      K.el('text', { id: `${uid}-dsub`, x: DEC.x + DEC.w / 2, y: DEC.y + 70, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, content).textContent = '';
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 4.5, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 450), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }
    const setAcceptor = (i, v) => {
      const a = E('a-' + i), t = E('av-' + i);
      if (v) {
        a.setAttribute('stroke', c[v.zone]); a.setAttribute('fill', K.grad(uid, v.zone));
        t.textContent = v.name; t.setAttribute('fill', c[v.zone]);
      } else {
        a.setAttribute('stroke', c.gray); a.setAttribute('fill', K.grad(uid, 'gray'));
        t.textContent = '·'; t.setAttribute('fill', c.muted);
      }
    };

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      // clear previous instance
      YS.forEach((_, i) => setAcceptor(i, null));
      E('dval').textContent = '—'; E('dval').setAttribute('fill', c.text);
      E('dsub').textContent = '';
      E('dbox').setAttribute('stroke', c.gray);
      const vals = YS.map((_, i) => (st.conflict && i >= 2) ? V2 : V1);
      vals.forEach((v, i) => { const e = E('pv-' + i); e.textContent = v.name; e.setAttribute('fill', c[v.zone]); });
      // each proposer sends to every acceptor; per-acceptor winner = earliest seeded arrival
      const arrivals = YS.map(() => YS.map(() => 380 + st.rng() * 260)); // [acceptor][proposer] → ms
      // Injected conflict: force a clean 2–2 acceptor split (proposer a arrives first at acceptor a).
      // Proposers 0,1 hold V1 and 2,3 hold V2, so top = 2 < the ¾ quorum → the coordinated fallback always runs.
      if (st.conflict) for (let a = 0; a < 4; a++) arrivals[a][a] = 180 + st.rng() * 80;
      const flights = [];
      for (let p = 0; p < 4; p++) for (let a = 0; a < 4; a++)
        flights.push(fly(PX + 13, YS[p], AX - 15, YS[a], c[vals[p].zone], arrivals[a][p], 3.5));
      st.msgs += 16;
      await Promise.all(flights);
      const accepted = arrivals.map((row) => vals[row.indexOf(Math.min.apply(null, row))]);
      accepted.forEach((v, i) => setAcceptor(i, v));
      const count1 = accepted.filter((v) => v === V1).length;
      const winner = count1 > accepted.length - count1 ? V1 : V2;
      const top = Math.max(count1, accepted.length - count1);
      if (top >= 3) {
        st.fast++;
        await decide(winner, '1 round-trip · fast path');
        stat('rt', 1);
        K.addLog(logBody, `≥¾ of acceptors hold ${winner.name} → decided on the fast path`, 'ok');
      } else {
        st.fallbacks++;
        K.addLog(logBody, `split vote (${count1}×${V1.name} / ${4 - count1}×${V2.name}) — no ¾ quorum, falling back`, 'warn');
        const co = E('coord');
        await animate(co, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
        // phase 1: prepare + learn
        await Promise.all(YS.map((y, i) => fly(COORD.x, COORD.y + 13, AX, y - 15, c.amber, 420)));
        await Promise.all(YS.map((y, i) => fly(AX, y - 15, COORD.x, COORD.y + 13, c[accepted[i].zone], 420, 3.5)));
        st.msgs += 8;
        K.addLog(logBody, `phase 1: coordinator learns what was accepted — picks ${winner.name}`, 'hl');
        // phase 2: accept the chosen value everywhere
        await Promise.all(YS.map((y) => fly(COORD.x, COORD.y + 13, AX, y - 15, c[winner.zone], 420)));
        st.msgs += 4;
        YS.forEach((_, i) => setAcceptor(i, winner));
        await decide(winner, '3 round-trips · fallback');
        stat('rt', 3);
        animate(co, { opacity: [1, 0], delay: dur(500), duration: dur(400), ease: 'in(2)' });
        K.addLog(logBody, `still exactly one decision: ${winner.name} — the bad period cost latency, not safety`, 'ok');
      }
      render();
      st.busy = false; setLock(false);
    }

    async function decide(v, sub) {
      await fly(AX + 15, YS[1] + 26, DEC.x, DEC.y + DEC.h / 2, c[v.zone], 450, 6);
      E('dbox').setAttribute('stroke', c[v.zone]);
      E('dval').textContent = v.name + ' ✓'; E('dval').setAttribute('fill', c[v.zone]);
      E('dsub').textContent = sub;
      animate(E('dbox'), { opacity: [0.4, 1], duration: dur(400), ease: 'out(2)' });
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('fast', st.fast); stat('fb', st.fallbacks); stat('msgs', st.msgs); }

    function toggleConflict() {
      if (st.busy) return;
      st.conflict = !st.conflict;
      root.querySelector('.t-conf').textContent = (st.conflict ? '☑' : '☐') + ' inject conflict';
      K.addLog(logBody, st.conflict
        ? '☑ proposers will now disagree — watch the fallback pay for coordination'
        : '☐ proposals identical again — back to the one-hop fast path', 'hl');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(700)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed, cf = st.conflict;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 21); st.speed = sp; st.conflict = cf;
      pp(); anim.innerHTML = ''; drawScene(); render(); stat('rt', '—');
      K.addLog(logBody, `↺ reset — seed ${st.seed}`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-conf', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-conf').onclick = toggleConflict;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMFastFallback = { init };
})();
