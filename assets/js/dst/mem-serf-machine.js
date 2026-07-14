/**
 * MEM Serf Machine (dst-kit) — memberlist/Serf as one machine: three loops, three speeds.
 *
 * The SWIM paper describes one loop. memberlist implements three, each with its own cadence:
 *   • PROBE — every 1 s: SWIM's ping → 500 ms timeout → 3 indirect ping-reqs. Detection.
 *   • GOSSIP — every 200 ms: queued membership updates go to 3 random peers over UDP.
 *     Dissemination no longer waits for the slow probe cadence.
 *   • PUSH/PULL — every 30 s: one full state exchange with one random peer over TCP.
 *     Anti-entropy: catches anything gossip missed, and bootstraps joiners.
 * The suspicion timeout scales with cluster size — its floor is SuspicionMult(4) × log₁₀(N) × 1 s
 * (base-10 log, floored at one), and a lone suspicion opens SuspicionMaxTimeoutMult(6)× higher,
 * collapsing toward the floor as independent nodes confirm — so a rumor has time to reach
 * everyone before it hardens into a verdict. And Serf's layer on
 * top knows the difference between LEAVING and DYING: a graceful leave gossips a
 * Lamport-stamped intent first, so nobody wastes a suspicion on it.
 * Exposes window.MEMSerfMachine.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-serf-machine: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-serf-machine: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 360, N = 8;
  const RING = { cx: 185, cy: 190, r: 108 };
  const LOOPS = [
    { id: 'probe', zone: 'blue', y: 40, every: 5, label: 'PROBE — every 1 s', sub: 'ping → 500 ms timeout → 3 × ping-req' },
    { id: 'gossip', zone: 'green', y: 128, every: 1, label: 'GOSSIP — every 200 ms', sub: 'queued updates → 3 random peers (UDP)' },
    { id: 'pushpull', zone: 'amber', y: 216, every: 25, label: 'PUSH/PULL — every 30 s*', sub: 'full state ⇄ one peer (TCP) · *compressed here' },
  ];
  const LX = 392, LW = 364, LH = 76;
  const STEP_MS = 200; // one Step = one gossip interval = 200 ms of sim time

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({
      seed: seed == null ? 17 : seed, rng: K.rng(seed == null ? 17 : seed),
      step: 0, clusterN: 8, lamport: 11,
      state: Array(N).fill('alive'), // alive | suspect | dead | left
      probeIdx: 1, suspTimer: null, suspTarget: null,
      updates: [], // {label, zone, known:Set}
      udp: 0, tcp: 0, busy: false, playing: false, speed: 1,
    });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const pos = (i) => {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      return { x: RING.cx + RING.r * Math.cos(a), y: RING.cy + RING.r * Math.sin(a) };
    };
    // memberlist: floor = SuspicionMult(4) × log₁₀(N) × probe (base-10 log, floored at one);
    // a lone suspicion opens SuspicionMaxTimeoutMult(6)× higher and decays to the floor as
    // independent confirmations arrive (that decay is Lifeguard's dynamic timeout).
    const suspMinS = () => 4 * Math.max(1, Math.log10(st.clusterN)) * 1;
    const suspMaxS = () => 6 * suspMinS();
    const alive = () => [...Array(N).keys()].filter((i) => st.state[i] === 'alive');

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ 200 ms</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--red t-crash">💥 crash n5</button>
        <button class="dstk-btn dstk-btn--blue t-leave">👋 n6 leaves gracefully</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">cluster size</span>
          <select class="t-n"><option value="8" selected>8</option><option value="32">32</option>
          <option value="100">100</option><option value="1000">1000</option></select></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Serf: three loops, three speeds', sub: 'probe 1 s · gossip 200 ms · push/pull 30 s',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'time', label: 'sim time (s)' }, { id: 'udp', label: 'UDP msgs' }, { id: 'tcp', label: 'TCP syncs' }, { id: 'susp', label: 'suspicion timeout' }],
        cap: 'Each Step is 200 ms. The probe loop detects; the gossip loop spreads queued updates fast; the '
           + 'push/pull loop is the slow, reliable TCP safety net. Change the cluster-size dropdown and watch '
           + 'the suspicion timeout stretch with log₁₀(N) — a bigger cluster needs longer for a refutation to '
           + 'arrive. Crash n5 vs let n6 leave gracefully: only one of them ever gets suspected.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 press Play and just watch the three cadences — then crash n5', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      for (let i = 0; i < N; i++) {
        const p = pos(i);
        K.el('circle', { id: `${uid}-n-${i}`, cx: p.x, cy: p.y, r: 15, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { id: `${uid}-nl-${i}`, x: p.x, y: p.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'n' + i;
      }
      LOOPS.forEach((L) => {
        K.el('rect', { x: LX, y: L.y, width: LW, height: LH, rx: 10, fill: K.grad(uid, L.zone), stroke: c[L.zone], 'stroke-width': 1.6 }, content);
        K.el('text', { x: LX + 12, y: L.y + 20, fill: c[L.zone], 'font-size': 10.5, 'font-weight': 700 }, content).textContent = L.label;
        K.el('text', { x: LX + 12, y: L.y + 37, fill: c.muted, 'font-size': 8.5 }, content).textContent = L.sub;
        // cadence bar
        K.el('rect', { x: LX + 12, y: L.y + 50, width: LW - 120, height: 10, rx: 4, fill: 'none', stroke: c.separator, 'stroke-width': 1 }, content);
        K.el('rect', { id: `${uid}-bar-${L.id}`, x: LX + 13, y: L.y + 51, width: 0, height: 8, rx: 3, fill: c[L.zone], opacity: 0.8 }, content);
        K.el('text', { id: `${uid}-fire-${L.id}`, x: LX + LW - 14, y: L.y + 59, 'text-anchor': 'end', fill: c.muted, 'font-size': 8.5 }, content).textContent = '';
      });
      // gossip queue
      K.el('text', { x: LX, y: 316, fill: c.muted, 'font-size': 9, 'font-weight': 700 }, content).textContent = 'gossip queue:';
      K.el('g', { id: `${uid}-queue` }, content);
      // suspicion readout under the ring
      K.el('text', { id: `${uid}-susnote`, x: RING.cx, y: 336, 'text-anchor': 'middle', fill: c.amber, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = '';
      redrawNodes(); redrawQueue();
    }

    function redrawNodes() {
      for (let i = 0; i < N; i++) {
        const e = E('n-' + i), l = E('nl-' + i), s = st.state[i];
        const zone = s === 'alive' ? 'green' : s === 'suspect' ? 'amber' : 'gray';
        e.setAttribute('fill', K.grad(uid, zone));
        e.setAttribute('stroke', s === 'alive' ? c.green : s === 'suspect' ? c.amber : c.gray);
        l.textContent = s === 'dead' ? '✗' : s === 'left' ? '👋' : 'n' + i;
      }
      const note = E('susnote');
      if (st.suspTarget != null && st.state[st.suspTarget] === 'suspect')
        note.textContent = `n${st.suspTarget} suspected — lone timeout ${suspMaxS().toFixed(0)}s → ${suspMinS().toFixed(0)}s floor (compressed)`;
      else note.textContent = '';
    }
    function redrawQueue() {
      const g = E('queue'); g.innerHTML = '';
      st.updates.slice(-3).forEach((u, i) => {
        const x = LX + 82 + i * 96;
        K.el('rect', { x, y: 304, width: 88, height: 20, rx: 5, fill: K.grad(uid, u.zone), stroke: c[u.zone], 'stroke-width': 1.2 }, g);
        K.el('text', { x: x + 44, y: 318, 'text-anchor': 'middle', fill: c.text, 'font-size': 8.5 }, g).textContent = `${u.label} · ${u.known.size}/${alive().length}`;
      });
      if (!st.updates.length)
        K.el('text', { x: LX + 86, y: 318, fill: c.muted, 'font-size': 9 }, g).textContent = '(empty — nothing new to tell)';
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 3.5, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 360), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }
    const pick = (list) => list[Math.floor(st.rng() * list.length)];

    function enqueue(label, zone, origin) {
      st.updates.push({ label, zone, known: new Set([origin]) });
      redrawQueue();
    }

    function bars() {
      LOOPS.forEach((L) => {
        const frac = ((st.step % L.every) || 0) / L.every;
        const bar = E('bar-' + L.id);
        if (bar) bar.setAttribute('width', Math.max(0, frac * (LW - 122)));
      });
    }

    async function fireGossip() {
      if (!st.updates.length) return;
      const flights = [];
      const ups = alive();
      for (const u of st.updates) {
        const senders = ups.filter((i) => u.known.has(i));
        if (!senders.length) continue;
        const from = pick(senders);
        const targets = new Set();
        let guard = 0;
        while (targets.size < Math.min(3, ups.length - 1) && guard++ < 30) {
          const t = pick(ups);
          if (t !== from) targets.add(t);
        }
        for (const t of targets) {
          const a = pos(from), b = pos(t);
          flights.push(fly(a.x, a.y, b.x, b.y, c[u.zone]));
          u.known.add(t);
          st.udp++;
        }
      }
      const fired = E('fire-gossip'); if (fired) fired.textContent = '⚡ fired';
      await Promise.all(flights);
      st.updates = st.updates.filter((u) => {
        const done = alive().every((i) => u.known.has(i));
        if (done) K.addLog(logBody, `"${u.label}" has reached every live node — retired from the queue`, 'ok');
        return !done;
      });
      redrawQueue();
    }

    async function fireProbe() {
      const ups = alive();
      if (ups.length < 2) return;
      // round-robin prober; target = next non-left node it hasn't confirmed dead
      const prober = ups[st.step % ups.length];
      const candidates = [...Array(N).keys()].filter((i) => i !== prober && st.state[i] !== 'dead' && st.state[i] !== 'left');
      if (!candidates.length) return;
      const target = candidates[st.probeIdx++ % candidates.length];
      const a = pos(prober), b = pos(target);
      const fired = E('fire-probe'); if (fired) fired.textContent = '⚡ fired';
      await fly(a.x, a.y, b.x, b.y, c.blue);
      st.udp++;
      if (st.state[target] === 'alive') {
        await fly(b.x, b.y, a.x, a.y, c.green, 300, 3);
        st.udp++;
        return;
      }
      if (st.state[target] !== 'dead-hidden') return; // suspect: countdown already running
      // no ack — timeout, then 3 indirect ping-reqs, all silent
      const xm = K.el('text', { x: b.x, y: b.y - 24, 'text-anchor': 'middle', fill: c.red, 'font-size': 10, 'font-weight': 700 }, anim);
      xm.textContent = '⏱';
      animate(xm, { opacity: [1, 0], duration: dur(700), ease: 'in(2)', onComplete: () => xm.remove() });
      const helpers = ups.filter((i) => i !== prober).slice(0, 3);
      for (const h of helpers) {
        const hp = pos(h);
        await fly(a.x, a.y, hp.x, hp.y, c.amber, 240);
        await fly(hp.x, hp.y, b.x, b.y, c.amber, 240);
        st.udp += 2;
      }
      st.discovered = target;
    }

    async function firePushPull() {
      const ups = alive();
      if (ups.length < 2) return;
      const a = pick(ups);
      let b = pick(ups); let guard = 0;
      while (b === a && guard++ < 10) b = pick(ups);
      if (b === a) return;
      const pa = pos(a), pb = pos(b);
      const fired = E('fire-pushpull'); if (fired) fired.textContent = '⚡ fired';
      const l = K.el('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: c.amber, 'stroke-width': 5, opacity: 0, 'stroke-linecap': 'round' }, anim);
      await animate(l, { opacity: [0, 0.7], duration: dur(300), ease: 'out(2)' });
      st.tcp++;
      // anti-entropy: both ends learn every queued update the other knew
      let caught = 0;
      st.updates.forEach((u) => {
        if (u.known.has(a) && !u.known.has(b)) { u.known.add(b); caught++; }
        else if (u.known.has(b) && !u.known.has(a)) { u.known.add(a); caught++; }
      });
      await animate(l, { opacity: [0.7, 0], duration: dur(400), ease: 'in(2)', onComplete: () => l.remove() });
      K.addLog(logBody, `push/pull: n${a} ⇄ n${b} merged full state over TCP${caught ? ` — caught ${caught} missed update(s)` : ''}`, caught ? 'ok' : null);
      redrawQueue();
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.step++;
      bars();
      const jobs = [];
      if (st.step % LOOPS[1].every === 0) jobs.push(fireGossip());
      if (st.step % LOOPS[0].every === 0) jobs.push(fireProbe());
      if (st.step % LOOPS[2].every === 0) jobs.push(firePushPull());
      await Promise.all(jobs);
      // the probe loop just discovered a crashed node: mark it suspect once
      if (st.discovered != null) {
        const crashed = st.discovered; st.discovered = null;
        st.state[crashed] = 'suspect';
        st.suspTarget = crashed;
        st.suspTimer = Math.round(suspMinS() * 1000 / STEP_MS); // countdown compressed to the floor's length for legibility
        enqueue(`suspect n${crashed}`, 'amber', alive()[0]);
        K.addLog(logBody, `probe + 3 ping-reqs all failed → n${crashed} SUSPECT · a lone suspicion opens at ${suspMaxS().toFixed(0)}s (SuspicionMaxTimeoutMult×) and only falls to the ${suspMinS().toFixed(0)}s floor as independent nodes confirm — compressed here`, 'warn');
      }
      // suspicion countdown
      if (st.suspTarget != null && st.state[st.suspTarget] === 'suspect') {
        st.suspTimer--;
        if (st.suspTimer <= 0) {
          st.state[st.suspTarget] = 'dead';
          enqueue(`dead n${st.suspTarget}`, 'red', alive()[0]);
          K.addLog(logBody, `no refutation arrived → n${st.suspTarget} confirmed DEAD, gossiped to everyone`, 'err');
          st.suspTarget = null;
        }
      }
      redrawNodes(); render();
      st.busy = false; setLock(false);
    }

    function crash() {
      if (st.state[5] !== 'alive') { K.addLog(logBody, 'n5 is already gone', 'warn'); return; }
      st.state[5] = 'dead-hidden'; // truth: dead; protocol hasn't noticed yet
      redrawNodes();
      const e = E('n-5'), l = E('nl-5');
      e.setAttribute('stroke', c.gray); e.setAttribute('fill', K.grad(uid, 'gray')); l.textContent = '✗';
      K.addLog(logBody, '💥 n5 crashed — no goodbye. The probe loop will find out the hard way.', 'err');
    }
    function leave() {
      if (st.state[6] !== 'alive') { K.addLog(logBody, 'n6 is already gone', 'warn'); return; }
      st.lamport++;
      enqueue(`leave n6 LT=${st.lamport}`, 'blue', 6);
      st.state[6] = 'left';
      redrawNodes();
      K.addLog(logBody, `👋 n6 broadcast a leave INTENT (Lamport ${st.lamport}) before going — state: Left. No suspicion, no timeout, no false failure.`, 'ok');
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('time', (st.step * STEP_MS / 1000).toFixed(1));
      stat('udp', st.udp); stat('tcp', st.tcp);
      stat('susp', suspMaxS().toFixed(0) + '→' + suspMinS().toFixed(0) + ' s');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(300)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed, n = st.clusterN;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 17); st.speed = sp; st.clusterN = n;
      pp(); anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, `↺ reset — 8 nodes drawn (suspicion math uses N=${st.clusterN})`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-crash', '.t-leave', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-crash').onclick = crash;
      root.querySelector('.t-leave').onclick = leave;
      root.querySelector('.t-n').onchange = (e) => {
        st.clusterN = parseInt(e.target.value, 10);
        render();
        K.addLog(logBody, `cluster size ${st.clusterN} → lone-suspicion timeout ${suspMaxS().toFixed(0)}s, floor ${suspMinS().toFixed(0)}s ≈ 6 × (4 × log₁₀(${st.clusterN}) × 1s)`, 'hl');
      };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMSerfMachine = { init };
})();
