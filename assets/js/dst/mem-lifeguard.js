/**
 * MEM Lifeguard (dst-kit) — when the detector itself is the slow party.
 *
 * The Lifeguard paper's diagnosis: many of SWIM's false positives originate at the node doing
 * the detecting — its local failure-detector module is slowed by CPU contention, network delay,
 * or loss, so *its* probes look like *other nodes'* failures. Lifeguard extends SWIM with local
 * health awareness, in three mechanisms:
 *   • LHA-Probe — a Local Health Multiplier (LHM), a saturating 0..8 counter. Paper events:
 *     failed probe +1; probe with missed nack +1; refuting a suspect message about SELF +1;
 *     successful probe −1. Probe interval and timeout stretch ×(LHM+1) — up to 9 s / 4.5 s —
 *     so a slow node stops mistaking late acks for dead peers. Nacks from ping-req helpers are
 *     the signal: a truly-down target still yields nacks; total silence points at the prober.
 *   • LHA-Suspicion — the suspicion timeout starts high and decays toward a minimum as
 *     INDEPENDENT confirmations arrive: max(Min, Max − (Max−Min)·log(C+1)/log(K+1)), K=3.
 *   • Buddy system — a probe to a suspected member carries the suspicion, so it can refute
 *     immediately instead of waiting to overhear gossip.
 * The paper's evaluation reports false-positive reductions in the 10–100× range (over 50× on average).
 * Exposes window.MEMLifeguard.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-lifeguard: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-lifeguard: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 350, N = 6;
  const RING = { cx: 165, cy: 180, r: 96 };
  const LHMP = { x: 372, y: 32, w: 384, h: 86 };
  const SUSP = { x: 372, y: 132, w: 384, h: 104 };
  const SMAX = 8, SMIN = 2, KCONF = 3;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({
      seed: seed == null ? 10 : seed, rng: K.rng(seed == null ? 10 : seed),
      cycle: 0, lhm: 0, lifeguard: true, buddy: true,
      degradedFor: 0, probeIdx: 0,
      dead: new Set(), // truth: crashed nodes
      falseAcc: 0, clean: 0,
      wrongSuspect: null, wrongTimer: 0, // a healthy peer I wrongly suspect
      susp: null, // { target, C, done } — a real suspicion with dynamic timeout
      busy: false, playing: false, speed: 1,
    });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const pos = (i) => {
      const a = (i / N) * Math.PI * 2 - Math.PI / 2;
      return { x: RING.cx + RING.r * Math.cos(a), y: RING.cy + RING.r * Math.sin(a) };
    };
    const timeoutMs = () => 500 * (st.lifeguard ? st.lhm + 1 : 1);
    const suspTimeout = (C) => Math.max(SMIN, SMAX - (SMAX - SMIN) * Math.log(C + 1) / Math.log(KCONF + 1));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Probe cycle</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--amber t-degrade">🐌 degrade me</button>
        <button class="dstk-btn dstk-btn--red t-crash">💥 crash n4</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--blue t-lg">☑ Lifeguard ON</button>
        <button class="dstk-btn dstk-btn--ghost t-buddy">☑ buddy ON</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Lifeguard: local health awareness', sub: 'self-health multiplier · dynamic suspicion · buddy notification',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'lhm', label: 'LHM' }, { id: 'to', label: 'my timeout' }, { id: 'false', label: 'false accusations' }, { id: 'clean', label: 'clean probes' }],
        cap: 'Degrade "me" with Lifeguard OFF: my own GC pauses turn healthy peers into "failures", one per probe. '
           + 'Turn Lifeguard ON, same degradation: reading my peers’ acks past my own deadline raises my LHM instead, '
           + 'my probe interval and timeout stretch ×(LHM+1), and the accusations stop. Crash n4 for a REAL failure: '
           + 'helpers’ nacks arrive — so it’s them, not me — and the suspicion timeout shrinks as independent '
           + 'confirmations land. (In the paper it’s the dynamic suspicion timeout — LHA-Suspicion, shown here on the '
           + 'crash — that cuts the most false positives: a lone suspicion sits on a long fuse and is usually refuted '
           + 'before it’s confirmed.)',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 turn Lifeguard OFF, degrade this node, press Play — count the false accusations. Then Reset and repeat with it ON.', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      for (let i = 0; i < N; i++) {
        const p = pos(i), me = i === 0;
        K.el('circle', { id: `${uid}-n-${i}`, cx: p.x, cy: p.y, r: me ? 20 : 15, fill: K.grad(uid, me ? 'blue' : 'green'), stroke: me ? c.blue : c.green, 'stroke-width': me ? 2.6 : 2 }, content);
        K.el('text', { x: p.x, y: p.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = me ? 'me' : 'n' + i;
        K.el('text', { id: `${uid}-tag-${i}`, x: p.x, y: p.y + (me ? 36 : 31), 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = '';
      }
      // LHM panel
      K.el('rect', { x: LHMP.x, y: LHMP.y, width: LHMP.w, height: LHMP.h, rx: 10, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
      K.el('text', { x: LHMP.x + 12, y: LHMP.y + 20, fill: c.blue, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'Local Health Multiplier (LHM)';
      K.el('text', { x: LHMP.x + LHMP.w - 12, y: LHMP.y + 20, 'text-anchor': 'end', fill: c.muted, 'font-size': 8 }, content).textContent = '+1 failed probe · missed nack · refuting suspicion about self · −1 clean probe';
      K.el('g', { id: `${uid}-lhmg` }, content);
      K.el('text', { id: `${uid}-lhmtxt`, x: LHMP.x + 12, y: LHMP.y + 74, fill: c.text, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
      // suspicion panel
      K.el('rect', { x: SUSP.x, y: SUSP.y, width: SUSP.w, height: SUSP.h, rx: 10, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6 }, content);
      K.el('text', { x: SUSP.x + 12, y: SUSP.y + 20, fill: c.amber, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'dynamic suspicion timeout';
      K.el('text', { x: SUSP.x + 12, y: SUSP.y + 36, fill: c.muted, 'font-size': 8 }, content).textContent = `max(Min, Max − (Max−Min) · log(C+1)/log(K+1)) · Max ${SMAX}s · Min ${SMIN}s · K=${KCONF}`;
      K.el('rect', { x: SUSP.x + 12, y: SUSP.y + 48, width: SUSP.w - 24, height: 14, rx: 5, fill: 'none', stroke: c.separator, 'stroke-width': 1.2 }, content);
      K.el('rect', { id: `${uid}-suspbar`, x: SUSP.x + 13, y: SUSP.y + 49, width: 0, height: 12, rx: 4, fill: c.amber, opacity: 0.85 }, content);
      K.el('text', { id: `${uid}-susptxt`, x: SUSP.x + 12, y: SUSP.y + 84, fill: c.text, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, content).textContent = 'no suspicion running';
      redrawLHM(); redrawNodes(); redrawSusp();
    }

    function redrawLHM() {
      const g = E('lhmg'); if (!g) return;
      g.innerHTML = '';
      for (let i = 0; i <= 8; i++) {
        const on = i <= st.lhm && (st.lhm > 0 || i === 0);
        const cur = i === st.lhm;
        K.el('rect', { x: LHMP.x + 12 + i * 40, y: LHMP.y + 30, width: 34, height: 20, rx: 5,
          fill: cur ? c.blue : i < st.lhm ? K.grad(uid, 'blue') : 'none',
          stroke: cur ? c.blue : c.separator, 'stroke-width': cur ? 2 : 1 }, g);
        K.el('text', { x: LHMP.x + 12 + i * 40 + 17, y: LHMP.y + 44, 'text-anchor': 'middle',
          fill: cur ? '#fff' : c.muted, 'font-size': 9.5, 'font-weight': cur ? 700 : 400 }, g).textContent = i;
      }
      const t = E('lhmtxt');
      if (t) t.textContent = st.lifeguard
        ? `probe timeout 500 ms × ${st.lhm + 1} = ${timeoutMs()} ms · interval 1 s × ${st.lhm + 1} = ${st.lhm + 1} s`
        : 'Lifeguard OFF — timeout pinned at 500 ms no matter how sick I am';
    }
    function redrawNodes() {
      for (let i = 0; i < N; i++) {
        const e = E('n-' + i), tag = E('tag-' + i);
        if (!e) continue;
        if (st.dead.has(i)) {
          e.setAttribute('stroke', c.gray); e.setAttribute('fill', K.grad(uid, 'gray'));
          tag.textContent = 'crashed'; tag.setAttribute('fill', c.gray);
        } else if (i === st.wrongSuspect) {
          e.setAttribute('stroke', c.amber);
          tag.textContent = 'suspected (wrongly!)'; tag.setAttribute('fill', c.amber);
        } else if (st.susp && st.susp.target === i && !st.susp.done) {
          e.setAttribute('stroke', c.amber); e.setAttribute('fill', K.grad(uid, 'amber'));
          tag.textContent = 'suspected'; tag.setAttribute('fill', c.amber);
        } else if (i === 0) {
          e.setAttribute('stroke', c.blue); e.setAttribute('fill', K.grad(uid, 'blue'));
          tag.textContent = st.degradedFor > 0 ? '🐌 GC pauses' : 'healthy';
          tag.setAttribute('fill', st.degradedFor > 0 ? c.amber : c.muted);
        } else {
          e.setAttribute('stroke', c.green); e.setAttribute('fill', K.grad(uid, 'green'));
          tag.textContent = '';
        }
      }
    }
    function redrawSusp() {
      const bar = E('suspbar'), txt = E('susptxt');
      if (!bar || !txt) return;
      if (!st.susp || st.susp.done) {
        bar.setAttribute('width', 0);
        txt.textContent = st.susp && st.susp.done ? `n${st.susp.target} confirmed dead ✓` : 'no suspicion running';
        return;
      }
      const t = suspTimeout(st.susp.C);
      bar.setAttribute('width', (t / SMAX) * (SUSP.w - 26));
      txt.textContent = `suspecting n${st.susp.target} · confirmations C=${st.susp.C} → timeout ${t.toFixed(1)} s (started at ${SMAX} s)`;
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 4, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 380), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.cycle++;
      if (st.degradedFor > 0) st.degradedFor--;
      // an active real suspicion collects one independent confirmation per cycle
      if (st.susp && !st.susp.done) {
        st.susp.C++;
        const t = suspTimeout(st.susp.C);
        K.addLog(logBody, `another node's probe of n${st.susp.target} failed too → C=${st.susp.C}, timeout now ${t.toFixed(1)}s`, 'hl');
        if (st.susp.C >= KCONF) {
          st.susp.done = true;
          K.addLog(logBody, `n${st.susp.target} confirmed DEAD — ${KCONF} independent confirmations collapsed the timeout to ${SMIN}s`, 'err');
        }
        redrawSusp(); redrawNodes();
      }
      // the wrongly-suspected peer refutes (buddy: immediately; otherwise it must overhear gossip)
      if (st.wrongSuspect != null) {
        st.wrongTimer--;
        if (st.wrongTimer <= 0) {
          K.addLog(logBody, `n${st.wrongSuspect} refutes with inc+1 (${st.buddy ? 'buddy told it directly' : 'it finally overheard the gossip'}) — churn, for nothing`, 'ok');
          K.addLog(logBody, `(and n${st.wrongSuspect}'s OWN LHM went +1 — the paper's "refuting a suspect message about self" event)`, 'hl');
          st.wrongSuspect = null;
          redrawNodes();
        }
      }
      // my probe cycle
      const peers = [1, 2, 3, 4, 5].filter((i) => !st.dead.has(i) || (st.susp && st.susp.target === i && !st.susp.done));
      const target = peers.length ? peers[st.probeIdx++ % peers.length] : null;
      if (target != null) {
        const me = pos(0), tp = pos(target);
        await fly(me.x, me.y, tp.x, tp.y, c.blue);
        if (st.dead.has(target)) {
          // REAL failure: no ack, but helpers' nacks come back — it's them, not me
          const helpers = [1, 2, 3, 4, 5].filter((i) => i !== target && !st.dead.has(i)).slice(0, 3);
          for (const h of helpers) {
            const hp = pos(h);
            await fly(me.x, me.y, hp.x, hp.y, c.amber, 240);
            await fly(hp.x, hp.y, tp.x, tp.y, c.amber, 240);
          }
          await Promise.all(helpers.map((h) => { const hp = pos(h); return fly(hp.x, hp.y, me.x, me.y, c.red, 300, 3); }));
          if (!st.susp || st.susp.target !== target) {
            st.susp = { target, C: 0, done: false };
            K.addLog(logBody, `no ack — but NACKS arrived: helpers can't reach n${target} either. It's the target, not me. Suspect (timeout ${SMAX}s).`, 'warn');
            if (st.buddy) K.addLog(logBody, `buddy system: my next probe of n${target} will carry "you are suspected" — if it were alive, it could refute at once`, 'hl');
          }
          redrawSusp(); redrawNodes();
        } else {
          // healthy peer; the question is whether *I* can process its ack in time
          const ackDelay = st.degradedFor > 0 ? 700 + st.rng() * 900 : 80 + st.rng() * 150;
          const to = timeoutMs();
          if (ackDelay <= to) {
            await fly(tp.x, tp.y, me.x, me.y, c.green, 320, 3);
            st.clean++;
            if (st.lifeguard && st.lhm > 0) { st.lhm--; redrawLHM(); }
          } else {
            const xm = K.el('text', { x: me.x, y: me.y - 30, 'text-anchor': 'middle', fill: c.red, 'font-size': 10, 'font-weight': 700 }, anim);
            xm.textContent = `⏱ ack at ${Math.round(ackDelay)}ms > ${to}ms`;
            animate(xm, { opacity: [1, 0], duration: dur(1100), ease: 'in(2)', onComplete: () => xm.remove() });
            if (st.lifeguard) {
              st.lhm = Math.min(8, st.lhm + 1);
              K.addLog(logBody, `ack came back past my own deadline — a failed probe (+1). My slow inbox, not their death. LHM → ${st.lhm}, my timeout is now ${timeoutMs()}ms`, 'warn');
              redrawLHM();
            } else if (st.wrongSuspect == null) {
              st.falseAcc++;
              st.wrongSuspect = target;
              st.wrongTimer = st.buddy ? 1 : 3;
              K.addLog(logBody, `☠ n${target} declared suspect — but n${target} is healthy. This node's GC pause produced a false accusation.`, 'err');
              redrawNodes();
            }
          }
        }
      }
      render();
      st.busy = false; setLock(false);
    }

    function degrade() {
      st.degradedFor = 5 + Math.floor(st.rng() * 4);
      redrawNodes();
      K.addLog(logBody, `🐌 I'm degraded for ~${st.degradedFor} cycles — my acks will be processed 700–1600 ms late`, 'warn');
    }
    function crash() {
      if (st.dead.has(4)) { K.addLog(logBody, 'n4 is already dead', 'warn'); return; }
      st.dead.add(4);
      redrawNodes();
      K.addLog(logBody, '💥 n4 crashed for real — compare how THIS gets detected vs the false alarms', 'err');
    }
    function toggleLG() {
      st.lifeguard = !st.lifeguard;
      root.querySelector('.t-lg').textContent = (st.lifeguard ? '☑' : '☐') + ' Lifeguard ' + (st.lifeguard ? 'ON' : 'OFF');
      root.querySelector('.t-lg').className = 'dstk-btn ' + (st.lifeguard ? 'dstk-btn--blue' : 'dstk-btn--ghost') + ' t-lg';
      if (!st.lifeguard) st.lhm = 0;
      redrawLHM(); render();
      K.addLog(logBody, st.lifeguard ? '☑ Lifeguard ON — a degraded node accounts for its own health first' : '☐ Lifeguard OFF — a late ack is read as a peer failure', 'hl');
    }
    function toggleBuddy() {
      st.buddy = !st.buddy;
      root.querySelector('.t-buddy').textContent = (st.buddy ? '☑' : '☐') + ' buddy ' + (st.buddy ? 'ON' : 'OFF');
      K.addLog(logBody, st.buddy
        ? '☑ buddy ON — a suspected node is told directly and can refute immediately'
        : '☐ buddy OFF — a suspected node only finds out if gossip happens to reach it', 'hl');
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('lhm', st.lifeguard ? st.lhm : '—');
      stat('to', timeoutMs() + ' ms');
      stat('false', st.falseAcc);
      stat('clean', st.clean);
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(380)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed, lg = st.lifeguard, bd = st.buddy;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 10); st.speed = sp; st.lifeguard = lg; st.buddy = bd;
      pp(); anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}, LHM 0, everyone healthy`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-degrade', '.t-crash', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-degrade').onclick = degrade;
      root.querySelector('.t-crash').onclick = crash;
      root.querySelector('.t-lg').onclick = toggleLG;
      root.querySelector('.t-buddy').onclick = toggleBuddy;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMLifeguard = { init };
})();
