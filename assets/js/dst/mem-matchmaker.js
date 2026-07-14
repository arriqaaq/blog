/**
 * MEM Matchmaker (dst-kit) — reconfigure the acceptor set without touching the command path.
 *
 * Matchmaker Paxos in one scene. Top lane: clients stream commands through the leader to the
 * current acceptor configuration — the CRITICAL PATH. Bottom lane: a separate tier of 2f+1
 * matchmakers stores a log of configurations indexed by round.
 *
 * Press Reconfigure: the leader registers the new configuration with the matchmakers in ONE
 * round-trip (learning all prior configs in the same reply), runs Phase 1 against the old
 * config to learn every chosen value, Phase 2 state transfer to the new — all OFF the command
 * path. The command stream never stops; the latency stat barely twitches (<2% in the paper).
 * Garbage-collect old rounds and the retired acceptors can be shut down. Note what this widget
 * does NOT contain: a failure detector, or an opinion about WHAT the new config should be —
 * Matchmaker is mechanism, not policy. Exposes window.MEMMatchmaker.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-matchmaker: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-matchmaker: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 350;
  const CLIENT = { x: 46, y: 88 };
  const LEADER = { x: 130, y: 58, w: 96, h: 60 };
  const ACOL = { x: 330, oldX: 470, ys: [48, 88, 128] };
  const MMS = [{ x: 150, y: 250 }, { x: 230, y: 250 }, { x: 310, y: 250 }];
  const LOG = { x: 420, y: 210, w: 336, rh: 26, max: 4 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({ seed: seed == null ? 8 : seed, rng: K.rng(seed == null ? 8 : seed),
      round: 0, nextA: 4, cfg: ['a1', 'a2', 'a3'], oldCfg: null,
      log: [{ round: 0, cfg: ['a1', 'a2', 'a3'], gc: false }],
      committed: 0, reconfigs: 0, lat: '1.00×', reconfiguring: false,
      busy: false, playing: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--green t-play">▶ Stream commands</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--purple t-step">⏭ One command</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--amber t-reconf">⇄ Reconfigure</button>
        <button class="dstk-btn dstk-btn--ghost t-gc">🗑 GC old rounds</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Matchmaker: reconfigure off the critical path', sub: 'new round, new acceptors — commands keep flowing',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'round', label: 'round' }, { id: 'committed', label: 'committed' }, { id: 'reconfigs', label: 'reconfigs' }, { id: 'lat', label: 'p50 latency' }],
        cap: 'Top lane is the command path; it never pauses. Reconfiguration happens underneath: one round-trip to '
           + 'the 2f+1 matchmakers registers config i+1 and returns every earlier config; Phase 1 drains the old '
           + 'acceptors, Phase 2 moves chosen values to the new. GC retires old rounds so their acceptors can be '
           + 'shut down. Deciding WHEN and TO WHAT to reconfigure is someone else’s job — mechanism, not policy.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 start the command stream, then Reconfigure mid-flight — watch the latency stat', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      K.el('text', { x: 24, y: 28, fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'command path (critical)';
      // client + leader
      K.el('text', { x: CLIENT.x, y: CLIENT.y - 18, 'text-anchor': 'middle', fill: c.blue, 'font-size': 16 }, content).textContent = '⌨';
      K.el('text', { x: CLIENT.x, y: CLIENT.y, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'clients';
      K.el('rect', { x: LEADER.x, y: LEADER.y, width: LEADER.w, height: LEADER.h, rx: 9, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      K.el('text', { x: LEADER.x + LEADER.w / 2, y: LEADER.y + 26, 'text-anchor': 'middle', fill: c.green, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'leader';
      K.el('text', { x: LEADER.x + LEADER.w / 2, y: LEADER.y + 44, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'Phase 2 to Ci';
      K.el('g', { id: `${uid}-acceptors` }, content);
      // matchmaker tier
      K.el('line', { x1: 24, y1: 178, x2: 756, y2: 178, stroke: c.separator, 'stroke-width': 1 }, content);
      K.el('text', { x: 24, y: 200, fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'matchmaker tier (2f+1) — off the critical path';
      MMS.forEach((m, i) => {
        K.el('circle', { id: `${uid}-mm-${i}`, cx: m.x, cy: m.y, r: 16, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 2 }, content);
        K.el('text', { x: m.x, y: m.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 9, 'font-weight': 700 }, content).textContent = 'm' + (i + 1);
      });
      K.el('text', { x: 230, y: 296, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'they store WHO the acceptors are per round — no commands, no data';
      // config log table
      K.el('text', { x: LOG.x, y: 200, fill: c.amber, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'the matchmakers’ config log';
      K.el('g', { id: `${uid}-log` }, content);
      redrawAcceptors(); redrawLog();
    }

    function redrawAcceptors() {
      const g = E('acceptors'); g.innerHTML = '';
      // old (fading) column
      if (st.oldCfg) {
        K.el('text', { x: ACOL.oldX, y: 30, 'text-anchor': 'middle', fill: c.gray, 'font-size': 9, 'font-weight': 700 }, g).textContent = `C${st.round - 1} (old)`;
        st.oldCfg.forEach((a, i) => {
          K.el('circle', { cx: ACOL.oldX, cy: ACOL.ys[i], r: 14, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.6, opacity: 0.45 }, g);
          K.el('text', { x: ACOL.oldX, y: ACOL.ys[i] + 4, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9, 'font-weight': 700, opacity: 0.6 }, g).textContent = a;
        });
      }
      K.el('text', { x: ACOL.x, y: 30, 'text-anchor': 'middle', fill: c.blue, 'font-size': 9, 'font-weight': 700 }, g).textContent = `C${st.round} (current)`;
      st.cfg.forEach((a, i) => {
        K.el('circle', { id: `${uid}-a-${i}`, cx: ACOL.x, cy: ACOL.ys[i], r: 14, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 2 }, g);
        K.el('text', { x: ACOL.x, y: ACOL.ys[i] + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 9, 'font-weight': 700 }, g).textContent = a;
      });
    }
    function redrawLog() {
      const g = E('log'); g.innerHTML = '';
      const recent = st.log.slice(-LOG.max);
      recent.forEach((row, i) => {
        const y = LOG.y + i * LOG.rh, last = row.round === st.round;
        K.el('rect', { x: LOG.x, y, width: LOG.w, height: LOG.rh - 4, rx: 5, fill: K.grad(uid, row.gc ? 'gray' : last ? 'amber' : 'gray'), stroke: row.gc ? c.separator : last ? c.amber : c.gray, 'stroke-width': last && !row.gc ? 1.8 : 1 }, g);
        const t = K.el('text', { x: LOG.x + 10, y: y + 15, fill: row.gc ? c.muted : c.text, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, g);
        t.textContent = `round ${row.round}  →  { ${row.cfg.join(', ')} }` + (row.gc ? '   · GC’d' : '');
        if (row.gc) t.setAttribute('text-decoration', 'line-through');
      });
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 4.5, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 420), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }

    async function command() {
      const jitter = st.rng() * 60;
      await fly(CLIENT.x + 10, CLIENT.y - 22, LEADER.x, LEADER.y + LEADER.h / 2, c.blue, 260 + jitter);
      await Promise.all(ACOL.ys.map((y) => fly(LEADER.x + LEADER.w, LEADER.y + LEADER.h / 2, ACOL.x - 14, y, c.green, 300 + jitter, 3.5)));
      await Promise.all(ACOL.ys.map((y) => fly(ACOL.x - 14, y, LEADER.x + LEADER.w, LEADER.y + LEADER.h / 2, c.green, 260 + jitter, 3)));
      st.committed++;
      render();
    }

    async function step() {
      if (st.busy) return; st.busy = true;
      await command();
      st.busy = false;
    }

    async function reconfigure() {
      if (st.reconfiguring) return;
      st.reconfiguring = true;
      root.querySelector('.t-reconf').disabled = true;
      const newCfg = [st.cfg[1], st.cfg[2], 'a' + st.nextA++];
      st.lat = '1.02×'; render();
      K.addLog(logBody, `⇄ reconfigure to { ${newCfg.join(', ')} } — matchmaking phase (one RTT, off the command path)`, 'hl');
      const lx = LEADER.x + LEADER.w / 2, ly = LEADER.y + LEADER.h;
      // one RTT to the matchmakers: register Ci+1, learn all prior configs
      await Promise.all(MMS.map((m) => fly(lx, ly, m.x, m.y - 16, c.amber, 480, 5)));
      MMS.forEach((_, i) => animate(E('mm-' + i), { r: [16, 20, 16], duration: dur(360), ease: 'inOut(2)' }));
      await Promise.all(MMS.map((m) => fly(m.x, m.y - 16, lx, ly, c.amber, 480, 4)));
      st.round++;
      st.log.push({ round: st.round, cfg: newCfg, gc: false });
      redrawLog();
      K.addLog(logBody, `matchmakers logged round ${st.round} and replied with every earlier config — leader knows all history`, 'ok');
      // Phase 1 against the OLD config (learn chosen values), Phase 2 to the NEW
      const oldCfg = st.cfg;
      await Promise.all(ACOL.ys.map((y) => fly(lx + 40, LEADER.y + LEADER.h / 2, ACOL.x - 14, y, c.purple, 420, 3.5)));
      await Promise.all(ACOL.ys.map((y) => fly(ACOL.x - 14, y, lx + 40, LEADER.y + LEADER.h / 2, c.purple, 420, 3)));
      K.addLog(logBody, 'Phase 1 on the old config: every chosen value learned — nothing can be lost in the move', 'hl');
      st.oldCfg = oldCfg; st.cfg = newCfg;
      redrawAcceptors();
      await Promise.all(ACOL.ys.map((y) => fly(lx + 40, LEADER.y + LEADER.h / 2, ACOL.x - 14, y, c.green, 420, 3.5)));
      st.reconfigs++;
      st.lat = '1.00×';
      render();
      K.addLog(logBody, `done: commands now target C${st.round} = { ${newCfg.join(', ')} }. The stream never stopped (<2% blip).`, 'ok');
      st.reconfiguring = false;
      root.querySelector('.t-reconf').disabled = false;
    }

    function gc() {
      const old = st.log.filter((r) => r.round < st.round && !r.gc);
      if (!old.length) { K.addLog(logBody, 'nothing to GC — only the current round is live', 'warn'); return; }
      old.forEach((r) => r.gc = true);
      st.oldCfg = null;
      redrawLog(); redrawAcceptors();
      K.addLog(logBody, `🗑 rounds ${old.map((r) => r.round).join(', ')} garbage-collected — their acceptors can be shut down safely`, 'ok');
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() { stat('round', st.round); stat('committed', st.committed); stat('reconfigs', st.reconfigs); stat('lat', st.lat); }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(260)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 8); st.speed = sp;
      pp(); anim.innerHTML = ''; drawScene(); render();
      root.querySelector('.t-reconf').disabled = false;
      K.addLog(logBody, `↺ reset — round 0, config { a1, a2, a3 }`, 'hl');
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reconf').onclick = reconfigure;
      root.querySelector('.t-gc').onclick = gc;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMMatchmaker = { init };
})();
