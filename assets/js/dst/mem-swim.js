/**
 * MEM SWIM (dst-kit) — probe, suspect, gossip: weakly consistent by design.
 *
 * SWIM's protocol period, animated: each tick one seeded prober pings one seeded target. If the
 * target is dead the ping times out, the prober asks three helpers to probe indirectly, and when
 * they fail too the target becomes SUSPECT — then DEAD after the suspicion timeout. Verdicts
 * spread infection-style, piggybacked on later pings.
 *
 * The two member lists on the right belong to n0 and n4. Watch them transiently DISAGREE —
 * one has heard the gossip, the other hasn't yet — and then converge. Nothing here is agreed,
 * ordered, or safe to compute a quorum from. It is a rumor mill with good statistics, and for
 * its job (a soft liveness view) that is exactly enough. Exposes window.MEMSwim.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-swim: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-swim: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 334, N = 8;
  const RING = { cx: 195, cy: 186, r: 104 };
  const STRIP = { x: 40, y: 40, cw: 40, ch: 18 };
  const PANELS = [{ who: 0, x: 420 }, { who: 4, x: 600 }];
  const PW = 158, PY = 46, ROWH = 24;
  const RANK = { up: 0, suspect: 1, dead: 2 };
  const SUSPECT_TIMEOUT = 3;
  const KHELPERS = 3;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 5 : seed, rng = K.rng(s);
      const shuffled = (self) => {
        const a = [...Array(N).keys()].filter((i) => i !== self);
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
      };
      return {
        seed: s, rng,
        tick: 0, alive: Array(N).fill(true),
        know: Array.from({ length: N }, () => Array(N).fill('up')),
        suspectAt: Array.from({ length: N }, () => Array(N).fill(-1)),
        // SWIM's real target selection: each node walks its OWN randomly-permuted list
        // round-robin, and re-shuffles when the pass completes (time-bounded completeness).
        lists: Array.from({ length: N }, (_, i) => shuffled(i)),
        cursors: Array(N).fill(0), rr: 0,
        msgs: 0, busy: false, playing: false, speed: 1,
      };
    };
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const pos = (i) => {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      return { x: RING.cx + RING.r * Math.cos(a), y: RING.cy + RING.r * Math.sin(a) };
    };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Protocol period</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--red t-crash">💥 crash a node</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'SWIM: probe, suspect, gossip', sub: 'weakly consistent by design',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'tick', label: 'period' }, { id: 'sus', label: 'suspects @ n0' }, { id: 'div', label: 'divergent rows' }, { id: 'msgs', label: 'msgs' }],
        cap: 'Each period the prober pings the NEXT entry in its own shuffled list (the strip, top-left) — '
           + 'round-robin, re-shuffled each pass, so no node can be unluckily skipped forever. On timeout: 3 '
           + 'indirect ping-reqs, then suspect → dead. Verdicts ride along on later pings. The two panels are '
           + 'n0’s and n4’s member lists — amber rows are where they currently disagree. They always converge; '
           + 'they are never “agreed”.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 press Play, crash a node, and watch the rumor spread node by node', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      K.el('text', { x: RING.cx, y: 24, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'the cluster (truth)';
      K.el('text', { id: `${uid}-striplabel`, x: STRIP.x, y: STRIP.y - 6, fill: c.muted, 'font-size': 8.5 }, content).textContent = 'probe list (round-robin over a shuffle):';
      K.el('g', { id: `${uid}-strip` }, content);
      for (let i = 0; i < N; i++) {
        const p = pos(i);
        K.el('circle', { id: `${uid}-n-${i}`, cx: p.x, cy: p.y, r: 16, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { id: `${uid}-nl-${i}`, x: p.x, y: p.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'n' + i;
      }
      PANELS.forEach((pn) => {
        K.el('rect', { x: pn.x, y: PY - 22, width: PW, height: N * ROWH + 34, rx: 10, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.4 }, content);
        K.el('text', { x: pn.x + PW / 2, y: PY - 6, 'text-anchor': 'middle', fill: c.blue, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = `n${pn.who}'s member list`;
        K.el('g', { id: `${uid}-panel-${pn.who}` }, content);
      });
      redrawCluster(); redrawPanels();
    }

    function redrawCluster() {
      for (let i = 0; i < N; i++) {
        const e = E('n-' + i), l = E('nl-' + i);
        e.setAttribute('stroke', st.alive[i] ? c.green : c.gray);
        e.setAttribute('fill', K.grad(uid, st.alive[i] ? 'green' : 'gray'));
        l.textContent = st.alive[i] ? 'n' + i : '✗';
      }
    }
    function redrawPanels() {
      PANELS.forEach((pn) => {
        const g = E('panel-' + pn.who); g.innerHTML = '';
        for (let i = 0; i < N; i++) {
          const s = st.know[pn.who][i];
          const col = s === 'dead' ? c.red : s === 'suspect' ? c.amber : c.green;
          const y = PY + 10 + i * ROWH;
          if (st.know[0][i] !== st.know[4][i])
            K.el('rect', { x: pn.x + 6, y: y - 8, width: PW - 12, height: 20, rx: 5, fill: 'none', stroke: c.amber, 'stroke-width': 1.3, 'stroke-dasharray': '3,2' }, g);
          K.el('circle', { cx: pn.x + 20, cy: y + 2, r: 5, fill: col }, g);
          K.el('text', { x: pn.x + 34, y: y + 6, fill: c.text, 'font-size': 10 }, g).textContent = 'n' + i;
          K.el('text', { x: pn.x + PW - 12, y: y + 6, 'text-anchor': 'end', fill: col, 'font-size': 9.5, 'font-weight': 700 }, g).textContent = s.toUpperCase();
        }
      });
    }

    function redrawStrip(prober) {
      const g = E('strip'); if (!g) return;
      g.innerHTML = '';
      const lbl = E('striplabel');
      if (lbl) lbl.textContent = `n${prober}'s probe list (round-robin over a shuffle):`;
      const cur = st.cursors[prober] - 1;
      st.lists[prober].forEach((id, i) => {
        const x = STRIP.x + i * (STRIP.cw + 3);
        const isNow = i === cur;
        K.el('rect', { x, y: STRIP.y, width: STRIP.cw, height: STRIP.ch, rx: 4,
          fill: isNow ? K.grad(uid, 'blue') : 'none',
          stroke: isNow ? c.blue : c.separator, 'stroke-width': isNow ? 1.8 : 1 }, g);
        K.el('text', { x: x + STRIP.cw / 2, y: STRIP.y + 13, 'text-anchor': 'middle',
          fill: isNow ? c.blue : c.muted, 'font-size': 9, 'font-weight': isNow ? 700 : 400,
          opacity: i < cur ? 0.45 : 1 }, g).textContent = 'n' + id;
      });
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 4, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 380), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }
    const pick = (list) => list[Math.floor(st.rng() * list.length)];

    function merge(a, b) { // piggyback: strongest verdict wins, both directions
      for (let i = 0; i < N; i++) {
        if (RANK[st.know[a][i]] > RANK[st.know[b][i]]) { st.know[b][i] = st.know[a][i]; st.suspectAt[b][i] = st.suspectAt[a][i]; }
        else if (RANK[st.know[b][i]] > RANK[st.know[a][i]]) { st.know[a][i] = st.know[b][i]; st.suspectAt[a][i] = st.suspectAt[b][i]; }
      }
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.tick++;
      // suspicion timeouts mature everywhere
      for (let o = 0; o < N; o++) for (let i = 0; i < N; i++)
        if (st.know[o][i] === 'suspect' && st.tick - st.suspectAt[o][i] >= SUSPECT_TIMEOUT) st.know[o][i] = 'dead';
      const ups = [...Array(N).keys()].filter((i) => st.alive[i]);
      if (!ups.length) { st.busy = false; setLock(false); return; }
      // rotate the featured prober through the alive nodes
      while (!st.alive[st.rr % N]) st.rr++;
      const prober = st.rr % N; st.rr++;
      // SWIM target selection: next entry in the prober's own shuffled list; skip known-dead;
      // when the pass completes, re-shuffle and start over.
      let target = null, guard = 0;
      while (target == null && guard++ < 2 * N) {
        if (st.cursors[prober] >= st.lists[prober].length) {
          const a = st.lists[prober];
          for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(st.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
          st.cursors[prober] = 0;
          K.addLog(logBody, `n${prober}: pass complete — probe list re-shuffled for the next round-robin sweep`, 'hl');
        }
        const cand = st.lists[prober][st.cursors[prober]++];
        if (st.know[prober][cand] !== 'dead') target = cand;
      }
      if (target == null) { st.busy = false; setLock(false); return; }
      redrawStrip(prober);
      const p1 = pos(prober), p2 = pos(target);
      await fly(p1.x, p1.y, p2.x, p2.y, c.blue); st.msgs++;
      if (st.alive[target]) {
        await fly(p2.x, p2.y, p1.x, p1.y, c.green, 380, 3); st.msgs++;
        if (st.know[prober][target] !== 'up') K.addLog(logBody, `n${prober} ← ack from n${target} — refuted, back to ALIVE`, 'ok');
        st.know[prober][target] = 'up';
        merge(prober, target); // piggybacked gossip
      } else {
        const xm = K.el('text', { x: p2.x, y: p2.y - 22, 'text-anchor': 'middle', fill: c.red, 'font-size': 11, 'font-weight': 700 }, anim);
        xm.textContent = '⏱ timeout';
        animate(xm, { opacity: [1, 0], duration: dur(900), ease: 'in(2)', onComplete: () => xm.remove() });
        const helpers = ups.filter((i) => i !== prober && i !== target);
        const h = [];
        while (h.length < Math.min(KHELPERS, helpers.length)) {
          const cand = pick(helpers);
          if (!h.includes(cand)) h.push(cand);
        }
        for (const hh of h) {
          const ph = pos(hh);
          await fly(p1.x, p1.y, ph.x, ph.y, c.amber, 300); st.msgs++;
          await fly(ph.x, ph.y, p2.x, p2.y, c.amber, 300); st.msgs++;
        }
        if (st.know[prober][target] === 'up') {
          st.know[prober][target] = 'suspect'; st.suspectAt[prober][target] = st.tick;
          K.addLog(logBody, `n${prober}: direct + indirect probes of n${target} failed → SUSPECT (dead in ${SUSPECT_TIMEOUT} periods)`, 'warn');
        }
      }
      redrawPanels(); render();
      st.busy = false; setLock(false);
    }

    function crash() {
      const pool = [...Array(N).keys()].filter((i) => st.alive[i] && i !== 0 && i !== 4);
      if (!pool.length) { K.addLog(logBody, 'nothing left to crash (n0/n4 host the panels)', 'warn'); return; }
      const i = pick(pool);
      st.alive[i] = false;
      redrawCluster();
      K.addLog(logBody, `💥 n${i} crashed — nobody knows yet; the next probes will find out`, 'err');
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('tick', st.tick);
      stat('sus', st.know[0].filter((s) => s === 'suspect').length);
      let d = 0; for (let i = 0; i < N; i++) if (st.know[0][i] !== st.know[4][i]) d++;
      stat('div', d); stat('msgs', st.msgs);
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(420)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 5); st.speed = sp;
      pp(); anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}, all eight alive, all lists agree`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-crash', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-crash').onclick = crash;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMSwim = { init };
})();
