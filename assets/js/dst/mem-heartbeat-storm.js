/**
 * MEM Heartbeat Storm (dst-kit) — the O(n²) baseline that gossip was invented to kill.
 *
 * The most obvious membership design: everyone heartbeats everyone, every round. It works
 * beautifully at 4 nodes — and buries the network at 20, because the bill is n·(n−1) messages
 * per round. Grow the cluster with the buttons and watch the counter go quadratic.
 *
 * Then flip to gossip: each node tells just 3 random peers per round. The bill drops to 3n —
 * linear — and yet a new piece of information (the glowing rumor) STILL reaches every node in
 * about log(n) rounds, because the number of nodes-in-the-know roughly multiplies each round.
 * Same information delivered, wildly different price. This trade is the foundation under
 * SWIM, memberlist, Serf, and every system in this post.
 * Exposes window.MEMHeartbeatStorm.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-heartbeat-storm: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-heartbeat-storm: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 330;
  const RING = { cx: 300, cy: 168, r: 122 };
  const FANOUT = 3;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({ seed: seed == null ? 12 : seed, rng: K.rng(seed == null ? 12 : seed),
      n: 6, mode: 'storm', round: 0, total: 0, infected: new Set([0]), converged: null,
      busy: false, playing: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const pos = (i) => {
      const a = (i / st.n) * Math.PI * 2 - Math.PI / 2;
      return { x: RING.cx + RING.r * Math.cos(a), y: RING.cy + RING.r * Math.sin(a) };
    };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ One round</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-less">− 2 nodes</button>
          <button class="dstk-btn dstk-btn--ghost t-more">+ 2 nodes</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--red t-storm">all-to-all</button>
          <button class="dstk-btn dstk-btn--ghost t-gossip">gossip ×3</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'All-to-all heartbeats vs gossip', sub: 'message cost per round as the cluster grows',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'n', label: 'nodes' }, { id: 'per', label: 'msgs / round' }, { id: 'total', label: 'msgs total' }, { id: 'conv', label: 'rounds to reach all' }],
        cap: 'All-to-all: n·(n−1) messages per round — 30 at 6 nodes, 380 at 20. Gossip: each node tells 3 random '
           + 'peers — 3n messages, linear — and the glowing rumor still reaches everyone in ≈log(n) rounds, because '
           + 'the informed set roughly multiplies each round. Grow the cluster and compare the two bills.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 run a few all-to-all rounds, add nodes, watch the bill — then switch to gossip', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      for (let i = 0; i < st.n; i++) {
        const p = pos(i);
        const inf = st.mode === 'gossip' && st.infected.has(i);
        K.el('circle', { id: `${uid}-n-${i}`, cx: p.x, cy: p.y, r: 13, fill: K.grad(uid, inf ? 'amber' : 'green'), stroke: inf ? c.amber : c.green, 'stroke-width': 2, filter: inf ? K.glow(uid) : 'none' }, content);
        K.el('text', { x: p.x, y: p.y + 3.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 8.5, 'font-weight': 700 }, content).textContent = 'n' + i;
      }
      // bill panel
      K.el('rect', { x: 560, y: 46, width: 196, height: 118, rx: 10, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
      K.el('text', { x: 658, y: 68, 'text-anchor': 'middle', fill: c.blue, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'the bill, per round';
      K.el('text', { id: `${uid}-bill1`, x: 576, y: 96, fill: c.text, 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
      K.el('text', { id: `${uid}-bill2`, x: 576, y: 120, fill: c.text, 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
      K.el('text', { id: `${uid}-bill3`, x: 576, y: 148, fill: c.muted, 'font-size': 9 }, content).textContent = '';
      // gossip legend
      K.el('text', { id: `${uid}-glegend`, x: 560, y: 196, fill: c.muted, 'font-size': 9 }, content).textContent = '';
      K.el('text', { id: `${uid}-glegend2`, x: 560, y: 212, fill: c.muted, 'font-size': 9 }, content).textContent = '';
      updateBill();
    }

    function updateBill() {
      const storm = st.n * (st.n - 1), gossip = FANOUT * st.n;
      E('bill1').textContent = `all-to-all: n(n−1) = ${storm}`;
      E('bill2').textContent = `gossip ×${FANOUT}: 3n = ${gossip}`;
      E('bill3').textContent = `at n=${st.n} that is ${(storm / gossip).toFixed(1)}× cheaper`;
      if (st.mode === 'gossip') {
        E('glegend').textContent = `🔶 = knows the rumor (${st.infected.size}/${st.n})`;
        E('glegend2').textContent = `expected spread: ≈log₂(${st.n}) ≈ ${Math.ceil(Math.log2(st.n))} rounds`;
      } else { E('glegend').textContent = ''; E('glegend2').textContent = ''; }
    }

    function flash(x1, y1, x2, y2, color, op) {
      const l = K.el('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 1.2, opacity: op || 0.5 }, anim);
      animate(l, { opacity: [op || 0.5, 0], duration: dur(560), ease: 'in(2)', onComplete: () => l.remove() });
    }
    function fly(x1, y1, x2, y2, color) {
      const p = K.el('circle', { cx: x1, cy: y1, r: 3.5, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(520), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.round++;
      if (st.mode === 'storm') {
        // every ordered pair; drawn as flashing edges (each edge carries 2 msgs)
        for (let i = 0; i < st.n; i++) for (let j = i + 1; j < st.n; j++) {
          const a = pos(i), b = pos(j);
          flash(a.x, a.y, b.x, b.y, c.red, 0.4);
        }
        st.total += st.n * (st.n - 1);
        if (st.n >= 16) K.addLog(logBody, `round ${st.round}: ${st.n * (st.n - 1)} heartbeats — the network is mostly heartbeats now`, 'err');
        else K.addLog(logBody, `round ${st.round}: every node pinged every other — ${st.n * (st.n - 1)} messages`, 'warn');
        await K.delay(dur(600));
      } else {
        const newly = new Set();
        const flights = [];
        for (let i = 0; i < st.n; i++) {
          const targets = new Set();
          // exclude self during selection so exactly FANOUT distinct peers are drawn (matches the 3n bill)
          while (targets.size < Math.min(FANOUT, st.n - 1)) {
            const t = Math.floor(st.rng() * st.n);
            if (t !== i) targets.add(t);
          }
          for (const t of targets) {
            const a = pos(i), b = pos(t);
            const carries = st.infected.has(i);
            flights.push(fly(a.x, a.y, b.x, b.y, carries ? c.amber : c.blue));
            if (carries && !st.infected.has(t)) newly.add(t);
          }
        }
        st.total += FANOUT * st.n;
        await Promise.all(flights);
        newly.forEach((t) => st.infected.add(t));
        drawScene();
        if (st.converged == null && st.infected.size === st.n) {
          st.converged = st.round;
          K.addLog(logBody, `📣 the rumor reached all ${st.n} nodes in ${st.round} round(s) — log₂(${st.n}) ≈ ${Math.ceil(Math.log2(st.n))}`, 'ok');
        } else if (st.converged == null) {
          K.addLog(logBody, `round ${st.round}: ${FANOUT * st.n} messages · rumor knows ${st.infected.size}/${st.n}`, 'hl');
        }
      }
      render();
      st.busy = false; setLock(false);
    }

    function resize(d) {
      if (st.busy) return;
      const n = Math.max(4, Math.min(20, st.n + d));
      if (n === st.n) return;
      st.n = n; st.infected = new Set([0]); st.converged = null; st.round = 0;
      anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, `cluster is now ${n} nodes — per-round bill: all-to-all ${n * (n - 1)} vs gossip ${FANOUT * n}`, 'hl');
    }

    function setMode(m) {
      if (st.busy) return;
      st.mode = m; st.round = 0; st.infected = new Set([0]); st.converged = null;
      root.querySelector('.t-storm').className = 'dstk-btn ' + (m === 'storm' ? 'dstk-btn--red' : 'dstk-btn--ghost') + ' t-storm';
      root.querySelector('.t-gossip').className = 'dstk-btn ' + (m === 'gossip' ? 'dstk-btn--amber' : 'dstk-btn--ghost') + ' t-gossip';
      anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, m === 'storm'
        ? 'all-to-all mode — thorough, immediate, quadratic'
        : 'gossip mode — n0 holds a fresh rumor (🔶); watch it spread at 3 messages per node per round', 'hl');
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('n', st.n);
      stat('per', st.mode === 'storm' ? st.n * (st.n - 1) : FANOUT * st.n);
      stat('total', st.total);
      stat('conv', st.converged == null ? (st.mode === 'gossip' ? '…' : '—') : st.converged);
      updateBill();
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(420)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed, n = st.n, m = st.mode;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 12); st.speed = sp; st.n = n; st.mode = m;
      pp(); anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}, ${st.n} nodes`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-less', '.t-more', '.t-storm', '.t-gossip', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-less').onclick = () => resize(-2);
      root.querySelector('.t-more').onclick = () => resize(2);
      root.querySelector('.t-storm').onclick = () => setMode('storm');
      root.querySelector('.t-gossip').onclick = () => setMode('gossip');
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMHeartbeatStorm = { init };
})();
