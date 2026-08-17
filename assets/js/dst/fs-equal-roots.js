/**
 * FS Equal Roots (dst-kit) — the root digest names the STATE, not the story.
 *
 * The post's point: apply the same set of edits in two different orders and both runs end at the
 * SAME root digest — equal logical state ⟹ equal name, regardless of the route that produced it.
 * That is why "verify a restore" collapses to "recompute one hash". And the flip side: corrupt a
 * single bit and the root digest diverges loudly.
 * Exposes window.FSEqualRoots.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-equal-roots: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-equal-roots: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 252;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const PA = { x: 16, y: 30, w: 340, h: 204 };
  const PB = { x: 424, y: 30, w: 340, h: 204 };
  const PATHS = ['/a.txt', '/b/c.txt', '/d.txt', '/e.log'];
  // one shared edit set, applied to both runs — each run in its own seeded order
  const OPS = [
    { s: 'wr a.txt', label: 'write /a.txt ← "hello v2"', p: '/a.txt', f: (m) => { m['/a.txt'].c = 'hello v2'; } },
    { s: 'wr b/c', label: 'write /b/c.txt ← "notes"', p: '/b/c.txt', f: (m) => { m['/b/c.txt'].c = 'notes'; } },
    { s: 'chmod a', label: 'chmod /a.txt 755', p: '/a.txt', f: (m) => { m['/a.txt'].mode = 755; } },
    { s: 'rm d.txt', label: 'delete /d.txt', p: '/d.txt', f: (m) => { delete m['/d.txt']; } },
  ];
  const initFiles = () => ({
    '/a.txt': { c: 'hello v1', mode: 644 }, '/b/c.txt': { c: 'draft', mode: 644 },
    '/d.txt': { c: 'temp', mode: 644 }, '/e.log': { c: 'boot', mode: 644 },
  });

  // The root digest is a pure function of the logical state (stand-in for the Merkle root):
  // canonicalize (sorted paths, mode, content) → FNV-1a → 'a3f2…9c'. Equal state ⟹ equal string.
  function digest(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h >>>= 0;
    const x = h.toString(16).padStart(8, '0');
    return x.slice(0, 4) + '…' + x.slice(6, 8);
  }
  const rootOf = (m) => digest(Object.keys(m).sort().map((k) => k + '|' + m[k].mode + '|' + m[k].c).join(';'));

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 7 : seed;
      const rng = K.rng(s);
      const shuffle = () => {
        const a = [0, 1, 2, 3];
        for (let i = 3; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
        return a;
      };
      const oA = shuffle(); const oB = shuffle();
      if (oA.join() === oB.join()) { const t = oB[0]; oB[0] = oB[1]; oB[1] = t; }   // orders MUST differ
      return { seed: s, rng, A: { m: initFiles(), order: oA, corrupt: false, badPath: null },
        B: { m: initFiles(), order: oB, corrupt: false, badPath: null },
        stepN: 0, busy: false, playing: false, speed: 1 };
    };
    let st = fresh(7);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ step</button>
        <button class="dstk-btn dstk-btn--red t-flip">⚡ flip one bit</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="dstk-seed t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Two orders, one root digest', sub: 'equal state ⟹ equal name · verify a restore = recompute one hash',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'steps', label: 'steps' }, { id: 'equal', label: 'roots equal' }, { id: 'orders', label: 'orders differ' }],
        cap: 'The root names the state, not the story. Two histories that end in the same bytes end in the '
           + 'same digest — and one flipped bit is unmissable.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, `🌱 same 4 edits, different orders — A: ${st.A.order.map((i) => OPS[i].s).join(' → ')} · B: ${st.B.order.map((i) => OPS[i].s).join(' → ')}`, 'hl');
    }

    function drawPanel(P, run, tag) {
      const finished = st.stepN >= OPS.length;
      K.el('rect', { x: P.x, y: P.y, width: P.w, height: P.h, rx: 10, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.2 }, content);
      K.el('text', { x: P.x + 12, y: P.y + 17, fill: c.blue, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'run ' + tag;
      K.el('text', { x: P.x + P.w - 12, y: P.y + 17, 'text-anchor': 'end', fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = 'same 4 edits, its own order';
      // this run's order as chips: done → filled, next → amber, pending → ghost
      run.order.forEach((opIdx, k) => {
        const x = P.x + 12 + k * 78, y = P.y + 26;
        const done = k < st.stepN, cur = k === st.stepN && !finished;
        K.el('rect', { x, y, width: 70, height: 17, rx: 5, fill: done ? K.grad(uid, 'blue') : 'none',
          stroke: cur ? c.amber : done ? c.blue : c.gray, 'stroke-width': cur ? 1.8 : 1,
          'stroke-dasharray': done || cur ? '' : '3,2', opacity: done || cur ? 1 : 0.55 }, content);
        K.el('text', { x: x + 35, y: y + 12, 'text-anchor': 'middle', fill: done || cur ? c.text : c.muted, 'font-size': 8.5 }, content)
          .textContent = (k + 1) + '· ' + OPS[opIdx].s;
      });
      K.el('text', { x: P.x + 14, y: P.y + 58, fill: c.muted, 'font-size': 8.5 }, content).textContent = 'path · content · mode';
      PATHS.forEach((p, i) => {
        const y = P.y + 74 + i * 22;
        const f = run.m[p];
        const corrupted = run.corrupt && run.badPath === p;
        const g = K.el('g', { id: `${uid}-${tag}-row-${i}` }, content);
        K.el('text', { x: P.x + 14, y, fill: f ? c.text : c.gray, 'font-size': 9, 'font-weight': 700, 'font-family': MONO }, g).textContent = p;
        K.el('text', { x: P.x + 104, y, fill: corrupted ? c.red : f ? c.muted : c.gray, 'font-size': 9, 'font-family': MONO }, g)
          .textContent = f ? '"' + f.c.replace(/\u0001/g, '') + '"' + (corrupted ? ' ⚡ one bit differs' : '') : '∅ deleted';
        if (f) K.el('text', { x: P.x + P.w - 14, y, 'text-anchor': 'end', fill: c.muted, 'font-size': 9, 'font-family': MONO }, g)
          .textContent = 'mode ' + f.mode;
      });
      // root digest bar — gray/amber mid-run, green when finished-and-equal, red when corrupted
      const zone = run.corrupt ? 'red' : finished ? 'green' : 'amber';
      K.el('rect', { x: P.x + 10, y: P.y + P.h - 40, width: P.w - 20, height: 30, rx: 7, fill: K.grad(uid, zone),
        stroke: c[zone], 'stroke-width': 1.6, filter: zone !== 'amber' ? K.glow(uid) : '' }, content);
      K.el('text', { x: P.x + 20, y: P.y + P.h - 20, fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'root';
      K.el('text', { id: `${uid}-dg-${tag}`, x: P.x + P.w - 20, y: P.y + P.h - 19, 'text-anchor': 'end', fill: c[zone],
        'font-size': 12.5, 'font-weight': 700, 'font-family': MONO }, content).textContent = rootOf(run.m);
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      K.el('text', { x: 18, y: 16, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'One edit set, two orders. Watch the intermediate roots disagree — and the final roots collide.';
      drawPanel(PA, st.A, 'A');
      drawPanel(PB, st.B, 'B');
      const dA = rootOf(st.A.m), dB = rootOf(st.B.m), eq = dA === dB;
      const finished = st.stepN >= OPS.length;
      const strong = finished || st.B.corrupt;
      const col = st.B.corrupt ? c.red : finished && eq ? c.green : c.muted;
      const sign = K.el('text', { id: `${uid}-sign`, x: 390, y: PA.y + PA.h - 17, 'text-anchor': 'middle', fill: col,
        'font-size': 26, 'font-weight': 700, filter: strong ? K.glow(uid) : '' }, content);
      sign.textContent = eq ? '=' : '≠';
      K.el('text', { x: 390, y: PA.y + PA.h - 48, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = 'roots';
    }

    function pulse(elm) { if (elm) animate(elm, { opacity: [0.12, 1], duration: dur(560), ease: 'out(2)' }); }

    async function step() {
      if (st.busy) return;
      if (st.stepN >= OPS.length) { K.addLog(logBody, 'all 4 edits applied — try ⚡ flip one bit, or Reset', null); return; }
      st.busy = true; setLock(true);
      const ia = st.A.order[st.stepN], ib = st.B.order[st.stepN];
      OPS[ia].f(st.A.m); OPS[ib].f(st.B.m);
      st.stepN++;
      drawScene(); render();
      pulse(E('A-row-' + PATHS.indexOf(OPS[ia].p)));
      pulse(E('B-row-' + PATHS.indexOf(OPS[ib].p)));
      pulse(E('dg-A')); pulse(E('dg-B'));
      const dA = rootOf(st.A.m), dB = rootOf(st.B.m);
      if (st.stepN < OPS.length) {
        K.addLog(logBody, `step ${st.stepN}: A does "${OPS[ia].label}" · B does "${OPS[ib].label}" → roots `
          + (dA === dB ? 'agree (both applied the same SET so far)' : `differ (${dA} vs ${dB} — different stories so far)`),
          dA === dB ? 'ok' : null);
      } else {
        pulse(E('sign'));
        K.addLog(logBody, `✓ both runs finished: root ${dA} = ${dB} — same bytes, same name, no matter the order`, 'ok');
      }
      await K.delay(dur(380));
      st.busy = false; setLock(false);
    }

    async function flip() {
      if (st.busy) return;
      if (st.B.corrupt) { K.addLog(logBody, '⚡ already flipped — Reset to restore', 'warn'); return; }
      st.busy = true; setLock(true);
      const keys = Object.keys(st.B.m).sort();
      const k = keys[Math.floor(st.rng() * keys.length)];
      st.B.m[k].c += '\u0001';                                        // one flipped bit in run B's bytes
      st.B.corrupt = true; st.B.badPath = k;
      drawScene(); render();
      pulse(E('B-row-' + PATHS.indexOf(k))); pulse(E('dg-B')); pulse(E('sign'));
      K.addLog(logBody, `⚡ one bit flipped in ${k} (run B) → root ${rootOf(st.B.m)} ≠ ${rootOf(st.A.m)} — verification is one hash compare`, 'err');
      await K.delay(dur(380));
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      const eq = rootOf(st.A.m) === rootOf(st.B.m);
      stat('steps', st.stepN + '/' + OPS.length);
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-equal'));
      if (e) { e.textContent = eq ? 'YES' : 'NO'; e.style.color = eq ? '#16a34a' : '#dc2626'; }
      stat('orders', 'YES');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing && st.stepN < OPS.length) { await step(); await K.delay(dur(800)); }
      pause();
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      const sp = st.speed;
      st.playing = false;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 7); st.speed = sp;
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed} · A: ${st.A.order.map((i) => OPS[i].s).join(' → ')} · B: ${st.B.order.map((i) => OPS[i].s).join(' → ')}`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-flip', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-step').onclick = step;
      root.querySelector('.t-flip').onclick = flip;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSEqualRoots = { init };
})();
