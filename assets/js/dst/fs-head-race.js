/**
 * FS Head Race (dst-kit) — publication is an expected-head compare-and-swap.
 *
 * The post's point: publication is explicit and serialized. Every publication says "I expect the
 * branch head to be X; move it to my new commit". Exactly one racer wins per round; the others get
 * a TYPED HeadConflict error (never last-write-wins, never partial state), rebase onto the new
 * head, and retry. This mirrors the real test: 100 rounds × 4 racing writers ⇒ exactly 1 winner
 * and 3 typed conflicts per round, zero partial states. Exposes window.FSHeadRace.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-head-race: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-head-race: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 292;
  const WR = { x: 22, w: 96, h: 44 };
  const BUB = { x: 130, w: 178, h: 44 };
  const GATE = { x: 470 };
  const BR = { x: 596, y: 58, w: 162, h: 108 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    let st = null, svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const laneY = (i) => st.n === 2 ? 84 + i * 104 : 62 + i * 78;

    function setup(seed, n) {
      const keepSpeed = st ? st.speed : 1;
      st = { seed, n, rand: K.rng(seed), speed: keepSpeed, playing: false, busy: false,
        head: 4, round: 0, published: 0, conflicts: 0, queue: [], hist: [],
        writers: Array.from({ length: n }, () => ({ state: 'idle', expect: null, got: null, commit: null })) };
    }
    function shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(st.rand() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }

    build();

    function controls() {
      const spd = (v, l) => `<option value="${v}"${st.speed === v ? ' selected' : ''}>${l}</option>`;
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ step</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">writers</span>
          <select class="t-writers"><option value="3"${st.n === 3 ? ' selected' : ''}>3</option><option value="2"${st.n === 2 ? ' selected' : ''}>2</option></select></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed">${spd(0.5, '0.5×')}${spd(1, '1×')}${spd(2, '2×')}</select></div>`;
    }

    function build() {
      setup(st ? st.seed : 11, st ? st.n : 3);
      root.innerHTML = K.container({
        title: 'One head, many writers', sub: 'publication = expected-head compare-and-swap',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'published', label: 'published' }, { id: 'conflicts', label: 'conflicts' },
          { id: 'partial', label: 'partial states' }],
        cap: 'One head, many writers. Expected-head compare-and-swap picks exactly one winner per '
           + 'round; everyone else gets a typed conflict and retries — never a silent merge, never '
           + 'partial state.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 press step: writers read the head and stage commits, then race — exactly one CAS wins', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      K.el('text', { x: 18, y: 20, fill: c.muted, 'font-size': 10 }, content).textContent =
        'Every publication says: “I expect head = cX; move it to my new commit.” The CAS gate serializes them — one winner per round.';
      // CAS gate
      K.el('line', { id: `${uid}-gate`, x1: GATE.x, y1: 52, x2: GATE.x, y2: 252, stroke: c.gray,
        'stroke-width': 1.6, 'stroke-dasharray': '6 5' }, content);
      K.el('text', { x: GATE.x, y: 40, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5,
        'font-weight': 700 }, content).textContent = 'CAS gate';
      K.el('text', { x: GATE.x, y: 266, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5,
        'font-family': "ui-monospace,'SF Mono',monospace" }, content).textContent = 'expected == actual ?';
      // the branch: one mutable row
      K.el('rect', { id: `${uid}-brbox`, x: BR.x, y: BR.y, width: BR.w, height: BR.h, rx: 10,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.8 }, content);
      K.el('text', { x: BR.x + 14, y: BR.y + 22, fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, content)
        .textContent = 'branch (one row)';
      K.el('text', { id: `${uid}-head`, x: BR.x + 14, y: BR.y + 58, fill: c.purple, 'font-size': 17,
        'font-weight': 700, 'font-family': "ui-monospace,'SF Mono',monospace" }, content)
        .textContent = `main → c${st.head}`;
      K.el('text', { x: BR.x + 14, y: BR.y + 88, fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = 'moves only when the CAS passes';
      st.hist.slice(-4).forEach((h, i, arr) => {
        K.el('text', { x: BR.x + 4, y: BR.y + BR.h + 18 + i * 15, fill: i === arr.length - 1 ? c.text : c.muted,
          'font-size': 8.5 }, content).textContent = h;
      });
      // writers + their prepared-commit bubbles
      for (let i = 0; i < st.n; i++) {
        const y = laneY(i), w = st.writers[i];
        K.el('rect', { x: WR.x, y, width: WR.w, height: WR.h, rx: 8, fill: K.grad(uid, 'blue'),
          stroke: c.blue, 'stroke-width': 1.8 }, content);
        K.el('text', { x: WR.x + WR.w / 2, y: y + 19, 'text-anchor': 'middle', fill: c.text,
          'font-size': 11, 'font-weight': 700 }, content).textContent = 'w' + (i + 1);
        K.el('text', { x: WR.x + WR.w / 2, y: y + 33, 'text-anchor': 'middle', fill: c.muted,
          'font-size': 8.5 }, content).textContent = 'writer';
        drawBubble(i, y, w);
      }
    }
    function drawBubble(i, y, w) {
      const zone = { idle: 'gray', staged: 'amber', conflict: 'red', landed: 'green' }[w.state];
      const attrs = { x: BUB.x, y, width: BUB.w, height: BUB.h, rx: 8, stroke: c[zone], 'stroke-width': 1.6 };
      if (w.state === 'idle') { attrs.fill = 'none'; attrs['stroke-dasharray'] = '4 3'; attrs.opacity = 0.7; }
      else attrs.fill = K.grad(uid, zone);
      K.el('rect', attrs, content);
      const l1 = K.el('text', { x: BUB.x + 12, y: y + 18, fill: w.state === 'conflict' ? c.red : c.text,
        'font-size': 9, 'font-weight': 700 }, content);
      const l2 = K.el('text', { x: BUB.x + 12, y: y + 33, fill: c.muted, 'font-size': 8.5,
        'font-family': "ui-monospace,'SF Mono',monospace" }, content);
      if (w.state === 'idle') { l1.textContent = 'idle'; l2.textContent = 'stages a commit on next step'; }
      else if (w.state === 'staged') { l1.textContent = 'commit staged'; l2.textContent = `publish(expect: c${w.expect})`; }
      else if (w.state === 'conflict') { l1.textContent = 'HeadConflict — will rebase'; l2.textContent = `expected c${w.expect} · actual c${w.got}`; }
      else { l1.textContent = `✓ published c${w.commit}`; l1.setAttribute('fill', c.green); l2.textContent = 'won its round — landed'; }
    }

    async function flyPublish(wi, pass) {
      const w = st.writers[wi], yG = laneY(wi) + 11, bw = 118, bh = 22;
      const g = K.el('g', {}, anim);
      const rect = K.el('rect', { x: 0, y: 0, width: bw, height: bh, rx: 6, fill: K.grad(uid, 'amber'),
        stroke: c.amber, 'stroke-width': 1.6, filter: K.glow(uid) }, g);
      const txt = K.el('text', { x: bw / 2, y: 15, 'text-anchor': 'middle', fill: c.text,
        'font-size': 8.5, 'font-weight': 700 }, g);
      txt.textContent = `publish · expect c${w.expect}`;
      const x0 = BUB.x + BUB.w + 10, x1 = GATE.x - bw - 8;
      const p = { x: x0, y: yG };
      const move = () => g.setAttribute('transform', `translate(${p.x} ${p.y})`);
      move();
      await animate(p, { x: x1, duration: dur(520), ease: 'inOut(2)', onUpdate: move });
      // verdict at the gate
      const gate = svg.querySelector('#' + CSS.escape(`${uid}-gate`));
      if (gate) { gate.setAttribute('stroke', pass ? c.green : c.red); gate.setAttribute('stroke-width', 2.4); }
      const v = K.el('text', { x: GATE.x + 8, y: yG - 5, fill: pass ? c.green : c.red, 'font-size': 9,
        'font-weight': 700, filter: K.glow(uid) }, anim);
      v.textContent = pass ? `✓ c${w.expect} == c${st.head}` : `✗ expected c${w.expect}, actual c${st.head}`;
      animate(v, { opacity: [0, 1], duration: dur(160), ease: 'out(2)' });
      if (pass) {
        rect.setAttribute('fill', K.grad(uid, 'green')); rect.setAttribute('stroke', c.green);
        txt.textContent = `✓ head ← c${st.head + 1}`;
        await animate(p, { x: BR.x + (BR.w - bw) / 2, y: BR.y + 62, duration: dur(420), ease: 'inOut(2)', onUpdate: move });
        await animate(g, { opacity: [1, 0], duration: dur(240), ease: 'in(2)' });
      } else {
        rect.setAttribute('fill', K.grad(uid, 'red')); rect.setAttribute('stroke', c.red);
        txt.textContent = 'HeadConflict — bounced'; txt.setAttribute('fill', c.red);
        await animate(p, { x: x0, duration: dur(460), ease: 'out(2)', onUpdate: move });
      }
      g.remove();
      animate(v, { opacity: [1, 0], delay: dur(650), duration: dur(360), ease: 'in(2)', onComplete: () => v.remove() });
      if (gate) { gate.setAttribute('stroke', c.gray); gate.setAttribute('stroke-width', 1.6); }
    }

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      if (st.queue.length) {
        const wi = st.queue.shift(), w = st.writers[wi];
        const pass = w.expect === st.head;
        await flyPublish(wi, pass);
        if (pass) {
          st.head++; w.state = 'landed'; w.commit = st.head; st.published++;
          st.hist.push(`main → c${st.head}  (w${wi + 1} won)`);
          K.addLog(logBody, `w${wi + 1}: CAS passes (expected c${w.expect} == actual) → head moves: main → c${st.head}. This round is decided.`, 'ok');
        } else {
          w.state = 'conflict'; w.got = st.head; st.conflicts++;
          K.addLog(logBody, `w${wi + 1}: HeadConflict{ expected: c${w.expect}, actual: c${st.head} } — a typed error, not a silent merge; the commit is intact`, 'err');
        }
        drawScene();
        if (st.writers.every((x) => x.state === 'landed')) {
          K.addLog(logBody, `all ${st.n} writers landed, one per round — partial states: 0, always: the transaction is all-or-nothing`, 'ok');
          pulsePartial();
        }
      } else if (st.writers.some((w) => w.state === 'conflict')) {
        st.round++;
        const losers = st.writers.map((_, i) => i).filter((i) => st.writers[i].state === 'conflict');
        losers.forEach((i) => { const w = st.writers[i]; w.state = 'staged'; w.expect = st.head; w.got = null; });
        st.queue = shuffle(losers);
        drawScene();
        K.addLog(logBody, `round ${st.round}: losers rebase onto the new head — bubbles now say "expect c${st.head}", then retry`, 'hl');
      } else {
        st.round++;
        st.writers.forEach((w) => { w.state = 'staged'; w.expect = st.head; w.got = null; w.commit = null; });
        st.queue = shuffle(st.writers.map((_, i) => i));
        drawScene();
        K.addLog(logBody, `round ${st.round}: all writers read head c${st.head} and stage commits — each says "expect c${st.head}"`);
      }
      render();
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('published', st.published); stat('conflicts', st.conflicts);
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-partial'));
      if (e) { e.textContent = '0 🔒'; e.style.color = c.green; }
    }
    function pulsePartial() {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-partial'));
      if (e) animate(e, { opacity: [0.15, 1], duration: dur(700), ease: 'out(2)' });
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(620)); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      const seed = parseInt(root.querySelector('.t-seed').value, 10);
      const n = parseInt(root.querySelector('.t-writers').value, 10);
      st.playing = false;
      setup(Number.isFinite(seed) ? seed : 11, n === 2 ? 2 : 3);
      anim.innerHTML = ''; pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}, ${st.n} writers: the seed fixes the arrival order, so the same race replays exactly`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-reset', '.t-writers', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => step();
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-seed').onchange = reset;
      root.querySelector('.t-writers').onchange = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSHeadRace = { init };
})();
