/**
 * MEM Incarnation (dst-kit) — suspicion, refutation, and why only YOU can raise your number.
 *
 * SWIM's answer to "we suspect a node that's actually alive": give the accused a way to clear
 * its own name. Every member carries an incarnation number that ONLY IT may increment. The
 * override rules are the whole protocol:
 *   R1 — only n3 can raise n3's incarnation
 *   R2 — a higher incarnation always wins
 *   R3 — at EQUAL incarnation, Suspect beats Alive (else the stale "I'm fine" from before the
 *        suspicion would cancel it)
 *   R4 — Confirm(dead) overrides everything, at any incarnation. Terminal.
 * R3 is why refuting with the same number bounces off — try it. R4 is why a node declared dead
 * stays dead and must rejoin as a new identity. Exposes window.MEMIncarnation.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-incarnation: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-incarnation: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 330, N = 6, TARGET = 3;
  const RING = { cx: 175, cy: 168, r: 100 };
  const RULES = { x: 392, y: 34, w: 364, rh: 34 };
  const CARD = { x: 392, y: 196, w: 210, h: 96 };
  const TIMER = { x: 622, y: 196, w: 134, h: 96, ticks: 5 };
  const RULE_TEXT = [
    ['R1', 'only n3 may raise n3’s incarnation'],
    ['R2', 'higher incarnation always wins'],
    ['R3', 'equal incarnation: Suspect ⊳ Alive'],
    ['R4', 'Confirm(dead) beats everything — terminal'],
  ];

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = () => ({
      inc: 0, n3: 'alive', // truth about n3 (it is alive-but-slow until confirmed dead)
      beliefs: Array.from({ length: N }, () => ({ state: 'alive', inc: 0 })), // what each node believes about n3
      timer: 0, timerOn: false, busy: false, speed: 1,
    });
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
        <button class="dstk-btn dstk-btn--amber t-suspect">😷 suspect n3</button>
        <button class="dstk-btn dstk-btn--ghost t-badref">🙅 refute (same inc)</button>
        <button class="dstk-btn dstk-btn--green t-refute">📢 refute (inc+1)</button>
        <button class="dstk-btn dstk-btn--red t-timeout">⏲ let the timeout run</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Suspicion, refutation, incarnation', sub: 'only a node can raise its own incarnation number',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'inc', label: "n3's incarnation" }, { id: 'sus', label: 'nodes suspecting' }, { id: 'state', label: 'n3 status' }],
        cap: 'n3 is alive, just slow. Suspect it and the rumor spreads at incarnation 0. Refuting at the SAME '
           + 'number bounces off (R3 — at equal incarnation, Suspect wins). Refuting at inc+1 wins everywhere '
           + '(R2) — and only n3 itself is allowed to make that move (R1). Let the timeout fire instead and '
           + 'Confirm lands: terminal (R4), no incarnation can undo it. The tags under each node show its '
           + 'belief: A=alive, S=suspect, D=dead, @inc.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 press "suspect n3" — the rumor spreads even though n3 is perfectly alive', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      for (let i = 0; i < N; i++) {
        const p = pos(i);
        const isT = i === TARGET;
        K.el('circle', { id: `${uid}-n-${i}`, cx: p.x, cy: p.y, r: isT ? 19 : 15, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': isT ? 2.6 : 2 }, content);
        K.el('text', { x: p.x, y: p.y + 4, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'n' + i;
        K.el('text', { id: `${uid}-b-${i}`, x: p.x, y: p.y + (isT ? 34 : 30), 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
      }
      K.el('text', { x: RING.cx, y: 22, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'n3 is ALIVE — just slow to answer';
      // rules panel
      K.el('text', { x: RULES.x, y: RULES.y - 10, fill: c.muted, 'font-size': 10, 'font-weight': 700 }, content).textContent = 'the override rules (SWIM §4.2)';
      RULE_TEXT.forEach(([id, txt], i) => {
        const y = RULES.y + i * RULES.rh;
        K.el('rect', { id: `${uid}-rule-${id}`, x: RULES.x, y, width: RULES.w, height: RULES.rh - 8, rx: 6, fill: K.grad(uid, 'gray'), stroke: c.separator, 'stroke-width': 1.2 }, content);
        K.el('text', { x: RULES.x + 10, y: y + 17, fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = id;
        K.el('text', { x: RULES.x + 36, y: y + 17, fill: c.text, 'font-size': 9.5 }, content).textContent = txt;
      });
      // n3 status card
      K.el('rect', { id: `${uid}-cardbox`, x: CARD.x, y: CARD.y, width: CARD.w, height: CARD.h, rx: 10, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      K.el('text', { x: CARD.x + 14, y: CARD.y + 22, fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'n3, according to n3';
      K.el('text', { id: `${uid}-cardstate`, x: CARD.x + 14, y: CARD.y + 48, fill: c.green, 'font-size': 14, 'font-weight': 700 }, content).textContent = 'ALIVE';
      K.el('text', { id: `${uid}-cardinc`, x: CARD.x + 14, y: CARD.y + 76, fill: c.text, 'font-size': 11, 'font-variant-numeric': 'tabular-nums' }, content).textContent = 'incarnation = 0';
      // suspicion timer
      K.el('rect', { x: TIMER.x, y: TIMER.y, width: TIMER.w, height: TIMER.h, rx: 10, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.4 }, content);
      K.el('text', { x: TIMER.x + 12, y: TIMER.y + 22, fill: c.amber, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'suspicion timer';
      K.el('g', { id: `${uid}-timerg` }, content);
      K.el('text', { id: `${uid}-timertxt`, x: TIMER.x + 12, y: TIMER.y + 80, fill: c.muted, 'font-size': 8.5 }, content).textContent = 'not running';
      redrawBeliefs(); redrawTimer();
    }

    function redrawBeliefs() {
      for (let i = 0; i < N; i++) {
        const b = st.beliefs[i], t = E('b-' + i);
        if (!t) continue;
        if (i === TARGET) { t.textContent = ''; continue; }
        const tag = b.state === 'dead' ? 'D' : b.state === 'suspect' ? 'S' : 'A';
        t.textContent = `${tag}@${b.inc}`;
        t.setAttribute('fill', b.state === 'dead' ? c.red : b.state === 'suspect' ? c.amber : c.green);
      }
      const n3 = E('n-' + TARGET);
      if (n3) {
        const zone = st.n3 === 'dead' ? 'gray' : 'green';
        n3.setAttribute('fill', K.grad(uid, zone));
        n3.setAttribute('stroke', st.n3 === 'dead' ? c.gray : c.green);
      }
      const cs = E('cardstate'), ci = E('cardinc'), cb = E('cardbox');
      if (cs) {
        cs.textContent = st.n3 === 'dead' ? 'DEAD (confirmed)' : 'ALIVE';
        cs.setAttribute('fill', st.n3 === 'dead' ? c.red : c.green);
        cb.setAttribute('stroke', st.n3 === 'dead' ? c.red : c.green);
        cb.setAttribute('fill', K.grad(uid, st.n3 === 'dead' ? 'red' : 'green'));
        ci.textContent = 'incarnation = ' + st.inc;
      }
    }
    function redrawTimer() {
      const g = E('timerg'); if (!g) return;
      g.innerHTML = '';
      for (let i = 0; i < TIMER.ticks; i++) {
        const filled = st.timerOn && i < st.timer;
        K.el('rect', { x: TIMER.x + 12 + i * 22, y: TIMER.y + 38, width: 18, height: 16, rx: 3,
          fill: filled ? c.amber : 'none', stroke: filled ? c.amber : c.separator, 'stroke-width': 1.2, opacity: filled ? 0.9 : 1 }, g);
      }
      const t = E('timertxt');
      if (t) t.textContent = st.timerOn ? `${TIMER.ticks - st.timer} tick(s) until Confirm` : 'not running';
    }

    function highlightRule(id) {
      RULE_TEXT.forEach(([rid]) => {
        const r = E('rule-' + rid);
        if (!r) return;
        if (rid === id) {
          r.setAttribute('stroke', c.purple); r.setAttribute('stroke-width', 2); r.setAttribute('filter', K.glow(uid));
          animate(r, { opacity: [0.4, 1], duration: dur(350), ease: 'out(2)' });
        } else { r.setAttribute('stroke', c.separator); r.setAttribute('stroke-width', 1.2); r.removeAttribute('filter'); }
      });
    }

    function fly(x1, y1, x2, y2, color, ms, labelTxt) {
      const g = K.el('g', {}, anim);
      const p = K.el('circle', { cx: x1, cy: y1, r: 4.5, fill: color, filter: K.glow(uid) }, g);
      const t = K.el('text', { x: x1, y: y1 - 9, 'text-anchor': 'middle', fill: color, 'font-size': 8, 'font-weight': 700 }, g);
      t.textContent = labelTxt;
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 420), ease: 'inOut(2)',
        onUpdate: () => {
          const x = x1 + (x2 - x1) * o.t, y = y1 + (y2 - y1) * o.t;
          p.setAttribute('cx', x); p.setAttribute('cy', y);
          t.setAttribute('x', x); t.setAttribute('y', y - 9);
        },
        onComplete: () => g.remove() });
    }

    // spread a message around the ring, applying an override test per recipient
    async function spread(fromIdx, label, color, apply) {
      const order = [];
      for (let d = 1; d < N; d++) order.push((fromIdx + d) % N);
      let prev = fromIdx;
      for (const to of order) {
        if (to === TARGET) { prev = to; continue; }
        const a = pos(prev), b = pos(to);
        await fly(a.x, a.y, b.x, b.y, color, 380, label);
        apply(to);
        redrawBeliefs(); render();
        prev = to;
      }
    }

    async function suspect() {
      if (st.busy || st.n3 === 'dead') return;
      if (st.beliefs.some((b, i) => i !== TARGET && b.state === 'suspect')) { K.addLog(logBody, 'n3 is already under suspicion', 'warn'); return; }
      st.busy = true; setLock(true);
      const accuser = (TARGET + 2) % N;
      K.addLog(logBody, `n${accuser}'s probe of n3 timed out → gossips Suspect{n3, inc=${st.inc}}`, 'warn');
      highlightRule('R3');
      st.beliefs[accuser] = { state: 'suspect', inc: st.inc };
      redrawBeliefs();
      await spread(accuser, `S@${st.inc}`, c.amber, (i) => {
        const b = st.beliefs[i];
        if (b.inc <= st.inc && b.state !== 'dead') st.beliefs[i] = { state: 'suspect', inc: st.inc };
      });
      st.timerOn = true; st.timer = 0;
      redrawTimer();
      K.addLog(logBody, 'everyone applied R3: at equal incarnation, Suspect overrides Alive. Timer running.', 'hl');
      st.busy = false; setLock(false);
      render();
    }

    async function badRefute() {
      if (st.busy || st.n3 === 'dead') return;
      if (!st.beliefs.some((b, i) => i !== TARGET && b.state === 'suspect')) { K.addLog(logBody, 'nobody suspects n3 right now', 'warn'); return; }
      st.busy = true; setLock(true);
      highlightRule('R3');
      K.addLog(logBody, `n3 gossips Alive{n3, inc=${st.inc}} — the SAME incarnation as the suspicion…`, 'hl');
      await spread(TARGET, `A@${st.inc}`, c.gray, () => { /* R3: Suspect@i beats Alive@i — nothing changes */ });
      K.addLog(logBody, `☒ bounced everywhere: Suspect@${st.inc} ⊳ Alive@${st.inc} (R3). n3 must raise its number.`, 'err');
      st.busy = false; setLock(false);
    }

    async function refute() {
      if (st.busy) return;
      if (st.n3 === 'dead') {
        st.busy = true; setLock(true);
        highlightRule('R4');
        K.addLog(logBody, 'n3 tries Alive{inc=99}…', 'hl');
        await spread(TARGET, 'A@99', c.gray, () => { /* R4: Confirm is terminal */ });
        K.addLog(logBody, '☒ Confirm(dead) overrides everything (R4). n3 is gone; it must rejoin as a NEW member.', 'err');
        st.busy = false; setLock(false);
        return;
      }
      if (!st.beliefs.some((b, i) => i !== TARGET && b.state === 'suspect')) { K.addLog(logBody, 'nobody suspects n3 right now', 'warn'); return; }
      st.busy = true; setLock(true);
      highlightRule('R1');
      st.inc++;
      redrawBeliefs(); render();
      K.addLog(logBody, `R1: n3 increments its own incarnation → ${st.inc} (nobody else could have)`, 'ok');
      await K.delay(dur(400));
      highlightRule('R2');
      await spread(TARGET, `A@${st.inc}`, c.green, (i) => {
        if (st.beliefs[i].state !== 'dead') st.beliefs[i] = { state: 'alive', inc: st.inc };
      });
      st.timerOn = false; st.timer = 0;
      redrawTimer();
      K.addLog(logBody, `R2: Alive@${st.inc} beats Suspect@${st.inc - 1} everywhere — name cleared, timer cancelled`, 'ok');
      st.busy = false; setLock(false);
      render();
    }

    async function runTimeout() {
      if (st.busy || st.n3 === 'dead') return;
      if (!st.timerOn) { K.addLog(logBody, 'no suspicion is pending — suspect n3 first', 'warn'); return; }
      st.busy = true; setLock(true);
      while (st.timer < TIMER.ticks) {
        st.timer++;
        redrawTimer();
        await K.delay(dur(320));
      }
      st.timerOn = false;
      const judge = (TARGET + 2) % N;
      highlightRule('R4');
      K.addLog(logBody, `timeout expired with no refutation → n${judge} gossips Confirm{n3}`, 'err');
      st.n3 = 'dead';
      st.beliefs[judge] = { state: 'dead', inc: st.inc };
      redrawBeliefs();
      await spread(judge, 'D', c.red, (i) => { st.beliefs[i] = { state: 'dead', inc: st.inc }; });
      redrawTimer();
      K.addLog(logBody, 'R4: Confirm lands everywhere. Terminal — try refuting now.', 'err');
      st.busy = false; setLock(false);
      render();
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('inc', st.inc);
      stat('sus', st.beliefs.filter((b, i) => i !== TARGET && b.state === 'suspect').length);
      stat('state', st.n3 === 'dead' ? 'DEAD' : 'alive');
    }

    function reset() {
      if (st.busy) return;
      const sp = st.speed;
      st = fresh(); st.speed = sp;
      anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, '↺ reset — n3 alive, incarnation 0, no rumors', 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-suspect', '.t-badref', '.t-refute', '.t-timeout', '.t-reset'], b); }

    function bind() {
      root.querySelector('.t-suspect').onclick = suspect;
      root.querySelector('.t-badref').onclick = badRefute;
      root.querySelector('.t-refute').onclick = refute;
      root.querySelector('.t-timeout').onclick = runTimeout;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMIncarnation = { init };
})();
