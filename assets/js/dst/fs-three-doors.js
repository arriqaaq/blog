/**
 * FS Three Doors (dst-kit) — one semantic kernel, three surfaces.
 *
 * The same 5-op workload enters through three doors: the SDK (one commit per call), MCP
 * (one commit per tool call — seeded grouping), and a POSIX mount (the WHOLE session stays
 * staged; close()/fsync never invent a commit — one commit only when the session is
 * explicitly published). The surfaces disagree on commit COUNT by design (5 vs 2–3 vs 1)
 * and agree byte-for-byte on the state: at the end all three lanes flow through the same
 * kernel and fill in the SAME root digest, joined by a glowing `=` chain.
 * Exposes window.FSThreeDoors.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-three-doors: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-three-doors: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 244;
  const OPS = ['write /a.md', 'mkdir /src', 'write /src/main.rs', 'kv set theme', 'rename /a.md → /b.md'];
  const LANES = [
    { name: 'SDK', sub: '1 commit per call', y: 88 },
    { name: 'MCP', sub: '1 commit per tool call', y: 148 },
    { name: 'mount', sub: 'stage all · publish once', y: 208 },
  ];
  const TX = (i) => 138 + i * 76;
  const PUBX = 512;
  const KERNEL = { x: 560, y: 64, w: 58, h: 168 };
  const DIG = { x: 646, w: 120, h: 26 };
  const OPCHIP = { y: 12, h: 18, w: 124, x: (i) => 108 + i * 130 };
  const MONO = "ui-monospace,'SF Mono',monospace";

  // Seeded plan: how MCP groups the 5 ops into 2–3 tool calls, and the shared root digest.
  function genPlan(rng) {
    const g = rng() < 0.5 ? 2 : 3;
    const cuts = [];
    while (cuts.length < g - 1) { const v = 1 + Math.floor(rng() * 4); if (!cuts.includes(v)) cuts.push(v); }
    cuts.sort((a, b) => a - b);
    const hex = '0123456789abcdef'; let d = '';
    for (let i = 0; i < 8; i++) d += hex[Math.floor(rng() * 16)];
    return { ends: cuts.concat([OPS.length]), digest: d };
  }

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 21 : seed, plan = genPlan(K.rng(s));
      return { seed: s, ends: plan.ends, digest: plan.digest, op: 0, phase: 'ops',
        sdk: 0, mcp: 0, mnt: 0, eq: false, marks: [], mountNoted: false,
        busy: false, playing: false, speed: 1 };
    };
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const R = (k) => root.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ step</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Three doors, one kernel', sub: 'SDK · MCP · POSIX mount — same state, same root digest',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'sdk', label: 'SDK commits' }, { id: 'mcp', label: 'MCP commits' },
          { id: 'mnt', label: 'mount commits' }, { id: 'eq', label: 'roots equal' }],
        cap: 'Three doors, one kernel. The surfaces disagree on how many commits a session is — by design — '
           + 'and agree byte-for-byte on the state: same root digest, all three.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 press ⏭ step or ▶ Play — the same 5 ops enter through three different doors', 'hl');
    }

    function door(x, y) {
      K.el('rect', { x, y: y - 11, width: 13, height: 22, rx: 2, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.3 }, content);
      K.el('circle', { cx: x + 9.5, cy: y, r: 1.4, fill: c.blue }, content);
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      // workload strip
      K.el('text', { x: 16, y: OPCHIP.y + 13, fill: c.muted, 'font-size': 8.5, 'font-weight': 700, 'letter-spacing': '.05em' }, content).textContent = 'WORKLOAD';
      OPS.forEach((op, i) => {
        K.el('rect', { id: `${uid}-op-${i}`, x: OPCHIP.x(i), y: OPCHIP.y, width: OPCHIP.w, height: OPCHIP.h, rx: 5, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1, opacity: 0.7 }, content);
        K.el('text', { id: `${uid}-opl-${i}`, x: OPCHIP.x(i) + OPCHIP.w / 2, y: OPCHIP.y + 12.5, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = op;
      });
      // lanes: door → track → kernel → digest box
      LANES.forEach((L, i) => {
        door(16, L.y);
        K.el('text', { x: 36, y: L.y - 2, fill: c.text, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = L.name;
        K.el('text', { x: 36, y: L.y + 11, fill: c.muted, 'font-size': 8.5 }, content).textContent = L.sub;
        K.el('line', { x1: 112, y1: L.y, x2: KERNEL.x, y2: L.y, stroke: c.gray, 'stroke-width': 1, opacity: 0.35 }, content);
        K.el('line', { x1: KERNEL.x + KERNEL.w, y1: L.y, x2: DIG.x, y2: L.y, stroke: c.gray, 'stroke-width': 1, opacity: 0.35 }, content);
        K.el('rect', { id: `${uid}-dig-${i}`, x: DIG.x, y: L.y - 13, width: DIG.w, height: DIG.h, rx: 6, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.2 }, content);
        K.el('text', { id: `${uid}-digt-${i}`, x: DIG.x + DIG.w / 2, y: L.y + 3.5, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-family': MONO }, content).textContent = '— — — —';
      });
      K.el('text', { x: DIG.x + DIG.w / 2, y: 56, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5, 'font-weight': 700, 'letter-spacing': '.05em' }, content).textContent = 'ROOT DIGEST';
      for (let i = 0; i < 2; i++)
        K.el('text', { id: `${uid}-eq-${i}`, x: DIG.x + DIG.w / 2, y: (LANES[i].y + LANES[i + 1].y) / 2 + 5, 'text-anchor': 'middle', fill: c.muted, 'font-size': 15, 'font-weight': 700, opacity: 0.45 }, content).textContent = '=';
      // shared kernel block
      K.el('rect', { id: `${uid}-kern`, x: KERNEL.x, y: KERNEL.y, width: KERNEL.w, height: KERNEL.h, rx: 10, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6 }, content);
      K.el('text', { x: KERNEL.x + KERNEL.w / 2, y: KERNEL.y + KERNEL.h / 2, 'text-anchor': 'middle', fill: c.text, 'font-size': 11, 'font-weight': 700, transform: `rotate(-90 ${KERNEL.x + KERNEL.w / 2} ${KERNEL.y + KERNEL.h / 2})` }, content).textContent = 'semantic kernel';
      K.el('g', { id: `${uid}-marks` }, content);
      // re-apply persisted state (theme rebuilds keep progress)
      st.marks.forEach((m) => drawMark(m, false));
      for (let i = 0; i < st.op; i++) opChip(i, 'done');
      if (st.eq) fillDigests(false);
    }

    // lane marks: purple dot = a commit; amber diamond = staged; small gray dot = op inside an open tool call
    function drawMark(m, pop) {
      const g = E('marks'), y = LANES[m.lane].y;
      let e;
      if (m.kind === 'commit') {
        e = K.el('circle', { cx: m.x, cy: y, r: 5.5, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6, filter: K.glow(uid) }, g);
        if (m.label) K.el('text', { x: m.x, y: y - 10, 'text-anchor': 'middle', fill: c.purple, 'font-size': 8.5, 'font-weight': 700 }, g).textContent = m.label;
      } else if (m.kind === 'stage') {
        e = K.el('rect', { x: m.x - 4, y: y - 4, width: 8, height: 8, rx: 1.5, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.3, transform: `rotate(45 ${m.x} ${y})` }, g);
      } else {
        e = K.el('circle', { cx: m.x, cy: y, r: 2.6, fill: c.gray, opacity: 0.75 }, g);
      }
      if (pop) animate(e, { opacity: [0, 1], duration: dur(240), ease: 'out(2)' });
    }
    function addMark(m) { st.marks.push(m); drawMark(m, true); }

    function opChip(i, s) {
      const r = E('op-' + i), l = E('opl-' + i); if (!r) return;
      if (s === 'current') {
        r.setAttribute('stroke', c.amber); r.setAttribute('stroke-width', 1.8); r.setAttribute('fill', K.grad(uid, 'amber')); r.setAttribute('opacity', 1);
        l.setAttribute('fill', c.text);
      } else {
        r.setAttribute('stroke', c.blue); r.setAttribute('stroke-width', 1); r.setAttribute('fill', K.grad(uid, 'blue')); r.setAttribute('opacity', 0.9);
        l.setAttribute('fill', c.muted);
      }
    }

    function fillDigests(animated) {
      for (let i = 0; i < 3; i++) {
        const b = E('dig-' + i), t = E('digt-' + i);
        b.setAttribute('fill', K.grad(uid, 'green')); b.setAttribute('stroke', c.green); b.setAttribute('stroke-width', 1.8);
        t.textContent = '⌗ ' + st.digest; t.setAttribute('fill', c.green); t.setAttribute('font-weight', 700);
        if (animated) animate(b, { opacity: [0.3, 1], duration: dur(280), ease: 'out(2)' });
      }
      for (let i = 0; i < 2; i++) {
        const e = E('eq-' + i);
        e.setAttribute('fill', c.green); e.setAttribute('opacity', 1); e.setAttribute('filter', K.glow(uid));
      }
    }

    async function step() {
      if (st.busy || st.phase === 'done') return; st.busy = true; setLock(true);
      if (st.phase === 'ops') {
        const k = st.op, x = TX(k);
        if (k > 0) opChip(k - 1, 'done');
        opChip(k, 'current');
        addMark({ lane: 0, x, kind: 'commit' }); st.sdk++;                       // SDK: commit per call
        const gi = st.ends.findIndex((e) => k < e);                              // MCP: commit per tool call
        if (k === st.ends[gi] - 1) {
          addMark({ lane: 1, x, kind: 'commit', label: 't' + (gi + 1) }); st.mcp++;
          const sz = st.ends[gi] - (gi ? st.ends[gi - 1] : 0);
          K.addLog(logBody, `MCP: tool call t${gi + 1} done → ONE commit (${sz} op${sz > 1 ? 's' : ''} inside)`, 'ok');
        } else addMark({ lane: 1, x, kind: 'op' });
        addMark({ lane: 2, x, kind: 'stage' });                                  // mount: stage only
        if (!st.mountNoted) { st.mountNoted = true; K.addLog(logBody, 'mount: staged — close()/fsync never invent a commit', 'warn'); }
        K.addLog(logBody, `op ${k + 1}/${OPS.length}: ${OPS[k]}`);
        st.op++;
        if (st.op === OPS.length) st.phase = 'publish';
      } else if (st.phase === 'publish') {
        opChip(OPS.length - 1, 'done');
        const p = { t: 0 }, y = LANES[2].y;
        const dot = K.el('circle', { cx: 112, cy: y, r: 5, fill: c.amber, filter: K.glow(uid) }, anim);
        await animate(p, { t: 1, duration: dur(520), ease: 'inOut(2)', onUpdate: () => dot.setAttribute('cx', 112 + (PUBX - 112) * p.t) });
        dot.remove();
        addMark({ lane: 2, x: PUBX, kind: 'commit', label: 'publish' });
        st.mnt = 1; st.phase = 'digest';
        K.addLog(logBody, `mount: publish session → ONE commit for all ${OPS.length} staged ops`, 'ok');
      } else if (st.phase === 'digest') {
        await Promise.all(LANES.map((L) => (async () => {                        // lanes drain into the kernel
          const d = K.el('circle', { cx: 470, cy: L.y, r: 4, fill: c.amber, filter: K.glow(uid) }, anim);
          const p = { t: 0 };
          await animate(p, { t: 1, duration: dur(420), ease: 'in(2)', onUpdate: () => d.setAttribute('cx', 470 + (KERNEL.x + KERNEL.w / 2 - 470) * p.t) });
          d.remove();
        })()));
        animate(E('kern'), { opacity: [1, 0.45, 1], duration: dur(420), ease: 'inOut(2)' });
        await K.delay(dur(300));
        for (let i = 0; i < 3; i++) {                                            // digests fill, one by one, identical
          const b = E('dig-' + i), t = E('digt-' + i);
          b.setAttribute('fill', K.grad(uid, 'green')); b.setAttribute('stroke', c.green); b.setAttribute('stroke-width', 1.8);
          t.textContent = '⌗ ' + st.digest; t.setAttribute('fill', c.green); t.setAttribute('font-weight', 700);
          animate(b, { opacity: [0.3, 1], duration: dur(280), ease: 'out(2)' });
          await K.delay(dur(240));
        }
        for (let i = 0; i < 2; i++) {
          const e = E('eq-' + i);
          e.setAttribute('fill', c.green); e.setAttribute('opacity', 1); e.setAttribute('filter', K.glow(uid));
        }
        st.eq = true; st.phase = 'done';
        K.addLog(logBody, `roots converge: ${st.sdk} vs ${st.mcp} vs ${st.mnt} commits — all three digests = ${st.digest}`, 'ok');
      }
      render();
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = R('stat-' + k); if (e) e.textContent = v; }
    function render() {
      stat('sdk', st.sdk); stat('mcp', st.mcp); stat('mnt', st.mnt);
      stat('eq', st.eq ? 'YES' : '—');
      const e = R('stat-eq'); if (e) e.style.color = st.eq ? c.green : '';
    }

    async function play() {
      if (st.playing || st.phase === 'done') return; st.playing = true; pp();
      const my = st;
      while (st === my && my.playing && my.phase !== 'done') { await step(); await K.delay(dur(640)); }
      if (st === my) { my.playing = false; pp(); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 21); st.speed = sp;
      pp(); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}: MCP regroups its tool calls, digest reshuffles`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-reset'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSThreeDoors = { init };
})();
