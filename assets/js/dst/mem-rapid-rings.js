/**
 * MEM Rapid Rings (dst-kit) — K observers, high/low watermarks, one clean cut.
 *
 * Rapid's pipeline, animated. Every node is watched by K=3 observers — its predecessors on
 * three pseudo-random rings (an expander overlay). A node is only suspected when MULTIPLE
 * independent observers report it (defeats one flaky link), and the cut detector aggregates
 * alerts against low/high watermarks so that several simultaneous failures land as ONE batched
 * multi-process cut proposal instead of a dribble of single removals. A leaderless ¾ fast vote
 * ratifies the cut into the next configuration when >¾ of the members can vote; otherwise (e.g.
 * when >¼ crash at once, so too few remain to vote) it falls back to classical Paxos.
 *
 * Contrast with single-observer mode: every first alert instantly becomes its own view change —
 * three failures, three reconfigurations, three downstream rebalances.
 * Exposes window.MEMRapidRings.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-rapid-rings: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-rapid-rings: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 350, N = 10, KOBS = 3, LOW = 1, HIGH = 2;
  const RING = { cx: 195, cy: 180, r: 122 };
  const RZONES = ['green', 'blue', 'pink'];
  const TAL = { x: 420, y: 66, w: 250, rh: 40 };
  const CFG = { x: 420, y: 250, w: 336, h: 46 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const mkPerms = (rng) => {
      const perms = [];
      for (let k = 0; k < KOBS; k++) {
        const a = [...Array(N).keys()];
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        perms.push(a);
      }
      return perms;
    };
    const fresh = (seed) => {
      const s = seed == null ? 14 : seed, rng = K.rng(s);
      return { seed: s, rng, perms: mkPerms(rng), tick: 0, alive: Array(N).fill(true),
        failed: [], grey: null, greyNoted: false, reported: new Set(), counts: {},
        single: false, cfgV: 5, viewChanges: 0, alerts: 0, cutDone: false, removedSingle: new Set(),
        busy: false, playing: false, speed: 1 };
    };
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const pos = (i) => {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      return { x: RING.cx + RING.r * Math.cos(a), y: RING.cy + RING.r * Math.sin(a) };
    };
    const observerOf = (node, ring) => {
      const p = st.perms[ring], idx = p.indexOf(node);
      return p[(idx - 1 + N) % N];
    };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Tick</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--red t-fail">💥 fail 3 nodes</button>
        <button class="dstk-btn dstk-btn--amber t-grey">🌫 grey fault</button>
        <button class="dstk-btn dstk-btn--ghost t-mode">mode: multi-observer</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Rapid: K observers and a batched cut', sub: 'multi-observer, multi-process, then a ¾ vote',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'alerts', label: 'alerts' }, { id: 'vc', label: 'view changes' }, { id: 'cfg', label: 'config' }],
        cap: 'Each node is observed by its predecessor on K=3 seeded rings (drawn small here; the paper’s '
           + 'deployment uses {K,H,L} = {10,9,3}). Alerts tally against watermarks: below L nothing; between L and H '
           + 'the suspect is “unstable” and the proposal waits; at H it joins the cut. All suspects crossing H land '
           + 'as ONE batched proposal — ratified by a leaderless ¾ fast vote when >¾ of the members can vote, else a '
           + 'classical-Paxos fallback (fail 3 of 10 → only 7 can vote → fallback; one grey node → 9 can → fast). '
           + 'Single-observer mode: three failures, three separate view changes.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 fail 3 nodes, then Play — the cut detector batches them into one view change', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // the K rings as translucent closed paths through permuted node order
      st.perms.forEach((p, k) => {
        const d = p.map((n, i) => {
          const q = pos(n); return (i === 0 ? 'M' : 'L') + q.x.toFixed(1) + ',' + q.y.toFixed(1);
        }).join(' ') + ' Z';
        K.el('path', { d, fill: 'none', stroke: c[RZONES[k]], 'stroke-width': 1.2, opacity: 0.22 }, content);
      });
      for (let i = 0; i < N; i++) {
        const p = pos(i);
        K.el('circle', { id: `${uid}-n-${i}`, cx: p.x, cy: p.y, r: 15, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { id: `${uid}-nl-${i}`, x: p.x, y: p.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'n' + i;
      }
      K.el('text', { x: RING.cx, y: 26, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'K=3 rings — each node watched by 3 observers';
      // tally panel
      K.el('text', { x: TAL.x, y: 40, fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'cut detection — alerts vs watermarks';
      K.el('text', { x: TAL.x + 148, y: 56, fill: c.amber, 'font-size': 8 }, content).textContent = 'L=1';
      K.el('text', { x: TAL.x + 238, y: 56, fill: c.green, 'font-size': 8 }, content).textContent = 'H=3';
      K.el('g', { id: `${uid}-tally` }, content);
      // config chip
      K.el('rect', { id: `${uid}-cfgbox`, x: CFG.x, y: CFG.y, width: CFG.w, height: CFG.h, rx: 9, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.8 }, content);
      K.el('text', { id: `${uid}-cfgtxt`, x: CFG.x + CFG.w / 2, y: CFG.y + 20, 'text-anchor': 'middle', fill: c.purple, 'font-size': 11, 'font-weight': 700 }, content).textContent = `configuration C${st.cfgV}`;
      K.el('text', { id: `${uid}-cfgsub`, x: CFG.x + CFG.w / 2, y: CFG.y + 37, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, content).textContent = `${st.alive.filter(Boolean).length} members · agreed by consensus`;
      redrawCluster(); redrawTally();
    }

    function redrawCluster() {
      for (let i = 0; i < N; i++) {
        const e = E('n-' + i), l = E('nl-' + i);
        if (!st.alive[i] || st.removedSingle.has(i)) {
          e.setAttribute('stroke', st.grey === i ? c.amber : c.gray);
          e.setAttribute('fill', K.grad(uid, st.grey === i ? 'amber' : 'gray'));
          l.textContent = st.grey === i ? '½' : '✗';
        } else {
          e.setAttribute('stroke', c.green); e.setAttribute('fill', K.grad(uid, 'green')); l.textContent = 'n' + i;
        }
      }
    }
    function redrawTally() {
      const g = E('tally'); g.innerHTML = '';
      const suspects = st.failed;
      suspects.forEach((n, i) => {
        const y = TAL.y + i * TAL.rh;
        K.el('text', { x: TAL.x, y: y + 15, fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, g).textContent = 'n' + n + (st.grey === n ? ' (grey)' : '');
        for (let b = 0; b < KOBS; b++) {
          const got = (st.counts[n] || 0) > b;
          K.el('rect', { x: TAL.x + 60 + b * 90, y, width: 82, height: 20, rx: 5,
            fill: got ? (b + 1 >= HIGH ? c.green : c.amber) : 'none',
            stroke: got ? 'none' : c.separator, 'stroke-width': 1.2, opacity: got ? 0.85 : 1 }, g);
        }
        const cnt = st.counts[n] || 0;
        const zone = cnt >= HIGH ? 'in the cut' : cnt >= LOW ? 'unstable' : '';
        K.el('text', { x: TAL.x + 60 + KOBS * 90 + 6, y: y + 15, fill: cnt >= HIGH ? c.green : c.amber, 'font-size': 8.5, 'font-weight': 700 }, g).textContent = zone;
      });
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 4, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 420), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }
    const pick = (list) => list[Math.floor(st.rng() * list.length)];

    function fail3() {
      if (st.busy || st.failed.length) { K.addLog(logBody, 'a round is in progress — Reset first', 'warn'); return; }
      const pool = [...Array(N).keys()].filter((i) => st.alive[i]);
      for (let k = 0; k < 3; k++) {
        const i = pick(pool.filter((x) => !st.failed.includes(x)));
        st.failed.push(i); st.alive[i] = false;
      }
      redrawCluster(); redrawTally();
      K.addLog(logBody, `💥 crashed n${st.failed.join(', n')} — observers on each ring will notice`, 'err');
    }
    function greyFault() {
      if (st.busy || st.failed.length) { K.addLog(logBody, 'a round is in progress — Reset first', 'warn'); return; }
      const pool = [...Array(N).keys()].filter((i) => st.alive[i]);
      const i = pick(pool);
      st.failed.push(i); st.alive[i] = false; st.grey = i;
      redrawCluster(); redrawTally();
      K.addLog(logBody, `🌫 n${i} has a one-way link failure — one of its 3 observers still hears from it`, 'warn');
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.tick++;
      const flights = [];
      for (const f of st.failed) {
        if (st.removedSingle.has(f)) continue;
        for (let k = 0; k < KOBS; k++) {
          const key = k + ':' + f;
          if (st.reported.has(key)) continue;
          if (st.grey === f && k === 0) continue; // the one-way link: ring-0 observer still hears heartbeats
          if (st.rng() < 0.55) {
            st.reported.add(key);
            st.counts[f] = (st.counts[f] || 0) + 1;
            st.alerts++;
            const o = pos(observerOf(f, k));
            flights.push(fly(o.x, o.y, TAL.x + 60 + (st.counts[f] - 1) * 90 + 40, TAL.y + st.failed.indexOf(f) * TAL.rh + 10, c[RZONES[k]], 550));
            if (st.single && !st.removedSingle.has(f)) {
              st.removedSingle.add(f);
              st.cfgV++; st.viewChanges++;
              K.addLog(logBody, `single-observer: first alert on n${f} → immediate view change → C${st.cfgV} (+1 rebalance)`, 'warn');
            }
          }
        }
      }
      await Promise.all(flights);
      // Grey (one-way) fault: one observer still hears heartbeats, so only the grey node's other
      // observers alert. With H < K that is still enough to cross H on its own — Rapid has no
      // second-hand channel; the cut proposal simply waits while the node sits in the unstable band.
      if (!st.single && st.grey != null && !st.greyNoted && (st.counts[st.grey] || 0) === LOW) {
        st.greyNoted = true;
        K.addLog(logBody, `n${st.grey} sits in the unstable band [L,H) — the cut proposal waits until it resolves`, 'warn');
      }
      redrawTally(); redrawCluster();
      // batched cut: every suspect at H, none dangling in [L,H)
      if (!st.single && !st.cutDone && st.failed.length &&
          st.failed.every((f) => (st.counts[f] || 0) >= HIGH)) {
        st.cutDone = true;
        K.addLog(logBody, `cut proposal: REMOVE {n${st.failed.join(', n')}} — one batch, almost everywhere agreed`, 'hl');
        // Consensus on the cut. The vote runs over the CURRENT config (N members — the suspects
        // are still members until the view change removes them), but only live nodes can vote.
        // Fast Paxos decides in one round only with a quorum strictly larger than ¾ of the set;
        // otherwise (too few voters, or divergent proposals) it falls back to classical Paxos.
        const voters = [...Array(N).keys()].filter((i) => st.alive[i]);
        const fastQuorum = Math.floor(3 * N / 4) + 1; // smallest integer > ¾·N
        const fast = voters.length >= fastQuorum;
        await Promise.all(voters.map((v) => {
          const p = pos(v);
          const e = E('n-' + v);
          animate(e, { r: [15, 19, 15], duration: dur(400), ease: 'inOut(2)' });
          return fly(p.x, p.y, CFG.x + CFG.w / 2, CFG.y, fast ? c.purple : c.amber, 600, 3.5);
        }));
        st.cfgV++; st.viewChanges++;
        E('cfgtxt').textContent = `configuration C${st.cfgV}`;
        E('cfgsub').textContent = `${voters.length} members · ${st.failed.length} removed in ONE view change`;
        animate(E('cfgbox'), { opacity: [0.35, 1], duration: dur(500), ease: 'out(2)' });
        K.addLog(logBody, fast
          ? `¾ fast vote passed (${voters.length} of ${N} ≥ ${fastQuorum}) → C${st.cfgV}: ${st.failed.length} removed in one view change (1 rebalance)`
          : `fast quorum unreachable (${voters.length} of ${N} < ¾) — classical Paxos fallback decides the cut → C${st.cfgV}: ${st.failed.length} removed in one view change (1 rebalance)`, 'ok');
      }
      render();
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('alerts', st.alerts); stat('vc', st.viewChanges); stat('cfg', 'C' + st.cfgV); }

    function toggleMode() {
      if (st.busy) return;
      const sp = st.speed, sd = st.seed, single = !st.single;
      st = fresh(sd); st.speed = sp; st.single = single;
      root.querySelector('.t-mode').textContent = 'mode: ' + (single ? 'single-observer' : 'multi-observer');
      anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, single
        ? 'single-observer mode — every first alert is its own verdict (and its own rebalance)'
        : 'multi-observer mode — verdicts need K independent reports, cuts are batched', 'hl');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(520)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed, single = st.single;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 14); st.speed = sp; st.single = single;
      pp(); anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}, C5, ten healthy nodes on three fresh rings`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-fail', '.t-grey', '.t-mode', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-fail').onclick = fail3;
      root.querySelector('.t-grey').onclick = greyFault;
      root.querySelector('.t-mode').onclick = toggleMode;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMRapidRings = { init };
})();
