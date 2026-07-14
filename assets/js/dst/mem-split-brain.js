/**
 * MEM Split Brain (dst-kit) — two "majorities" that never meet.
 *
 * The post's point: quorum intersection is only meaningful relative to ONE agreed configuration.
 * Client 1 still believes the config is cfg₁ {A,B,C}; client 2 already sees cfg₂ {C,D,E}. Each
 * gathers a perfectly legal majority of ITS config — {A,B} and {D,E} — and the two sets share
 * zero voters, so x=1 and x=2 both "commit". That is split brain, and no amount of retrying
 * repairs it: it is a safety violation, finished the moment it happens.
 *
 * Toggle the agreement box ON and both clients are forced to read the same ordered config log
 * first. Now every quorum comes from cfg₂, any two majorities intersect, and the shared voter
 * orders the second write after the first. Exposes window.MEMSplitBrain.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-split-brain: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-split-brain: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 316;
  const NODES = ['A', 'B', 'C', 'D', 'E'];
  const NX = { A: 120, B: 255, C: 390, D: 525, E: 660 }, NY = 164, NR = 20;
  const CB1 = { x: 24, y: 24, w: 216, h: 70 };
  const CB2 = { x: 540, y: 24, w: 216, h: 70 };
  const STRIP = { x: 170, y: 258, w: 440, h: 42 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = () => ({ boxOn: false, writes: {}, values: {}, commits: 0, conflicts: 0, busy: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--blue t-w1">client 1: write x=1</button>
        <button class="dstk-btn dstk-btn--pink t-w2">client 2: write x=2</button>
        <button class="dstk-btn dstk-btn--purple t-both">⚡ run both</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-box">☐ agreement box: OFF</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Split brain from divergent configs', sub: 'intersection needs one agreed member set',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'commits', label: 'commits' }, { id: 'conflicts', label: 'forked histories' }, { id: 'shared', label: 'shared voters' }],
        cap: 'Without the agreement box, client 1 commits to {A,B} (a majority of stale cfg₁) and client 2 to {D,E} '
           + '(a majority of cfg₂) — zero overlap, two histories. With the box ON, both read the same config log first, '
           + 'so their quorums come from one set and must intersect.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 two clients, two ideas of the config. Run both writes and watch the quorums miss each other.', 'hl');
    }

    function clientCfg(n) {
      return st.boxOn
        ? 'reads the agreed log → cfg₂ {C,D,E}'
        : (n === 1 ? 'trusts its stale view: cfg₁ {A,B,C}' : 'sees the new view: cfg₂ {C,D,E}');
    }
    function quorumFor(n) {
      return st.boxOn ? (n === 1 ? ['C', 'D'] : ['D', 'E']) : (n === 1 ? ['A', 'B'] : ['D', 'E']);
    }

    function drawScene() {
      content.innerHTML = '';
      [[1, CB1, 'blue'], [2, CB2, 'pink']].forEach(([n, b, zone]) => {
        K.el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 10, fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.6 }, content);
        K.el('text', { x: b.x + 14, y: b.y + 22, fill: c.text, 'font-size': 12.5, 'font-weight': 700 }, content).textContent = 'client ' + n;
        K.el('text', { id: `${uid}-c${n}-status`, x: b.x + b.w - 12, y: b.y + 22, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'idle';
        K.el('text', { id: `${uid}-c${n}-sub`, x: b.x + 14, y: b.y + 44, fill: c.muted, 'font-size': 9.5 }, content).textContent = clientCfg(n);
        K.el('text', { x: b.x + 14, y: b.y + 60, fill: c[zone], 'font-size': 10, 'font-weight': 700 }, content).textContent = n === 1 ? 'wants to write x=1' : 'wants to write x=2';
      });
      // config brackets
      K.el('line', { x1: 92, y1: 134, x2: 418, y2: 134, stroke: c.blue, 'stroke-width': 1.2, 'stroke-dasharray': '4,4', opacity: 0.7 }, content);
      K.el('text', { x: 92, y: 128, fill: c.blue, 'font-size': 9.5, 'font-weight': 700, opacity: 0.85 }, content).textContent = 'cfg₁ {A,B,C} — the old config';
      K.el('line', { x1: 362, y1: 222, x2: 688, y2: 222, stroke: c.pink, 'stroke-width': 1.2, 'stroke-dasharray': '4,4', opacity: 0.7 }, content);
      K.el('text', { x: 688, y: 236, 'text-anchor': 'end', fill: c.pink, 'font-size': 9.5, 'font-weight': 700, opacity: 0.85 }, content).textContent = 'cfg₂ {C,D,E} — the new config';
      // nodes
      NODES.forEach((id) => {
        K.el('circle', { id: `${uid}-n-${id}`, cx: NX[id], cy: NY, r: NR, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
        K.el('text', { x: NX[id], y: NY + 4.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = id;
        const t = K.el('text', { id: `${uid}-v-${id}`, x: NX[id], y: NY + NR + 16, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10, 'font-variant-numeric': 'tabular-nums' }, content);
        t.textContent = st.values[id] || '·';
      });
      drawStrip();
    }

    function drawStrip() {
      const old = E('strip'); if (old) old.remove();
      const g = K.el('g', { id: `${uid}-strip` }, content);
      if (st.boxOn) {
        K.el('rect', { x: STRIP.x, y: STRIP.y, width: STRIP.w, height: STRIP.h, rx: 9, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.8, filter: K.glow(uid) }, g);
        K.el('text', { x: 390, y: STRIP.y + 17, 'text-anchor': 'middle', fill: c.purple, 'font-size': 10.5, 'font-weight': 700 }, g).textContent = 'AGREEMENT BOX — config log: cfg₁ {A,B,C} → cfg₂ {C,D,E}';
        K.el('text', { x: 390, y: STRIP.y + 32, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, g).textContent = 'every client reads the same ordered truth before computing a quorum';
      } else {
        K.el('rect', { x: STRIP.x, y: STRIP.y, width: STRIP.w, height: STRIP.h, rx: 9, fill: 'none', stroke: c.red, 'stroke-width': 1.4, 'stroke-dasharray': '6,5' }, g);
        K.el('text', { x: 390, y: STRIP.y + 17, 'text-anchor': 'middle', fill: c.red, 'font-size': 10.5, 'font-weight': 700 }, g).textContent = 'NO AGREEMENT BOX';
        K.el('text', { x: 390, y: STRIP.y + 32, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, g).textContent = 'each client trusts whatever view it happens to hold';
      }
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 5, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 450), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }
    function pulse(el, color) {
      if (!el) return;
      el.setAttribute('stroke', color);
      animate(el, { r: [NR, NR + 5, NR], duration: dur(420), ease: 'inOut(2)' });
    }
    function banner(msg, zone) {
      const old = anim.querySelector('#' + CSS.escape(uid + '-ban')); if (old) old.remove();
      const g = K.el('g', { id: `${uid}-ban`, opacity: 0 }, anim);
      K.el('rect', { x: 80, y: 100, width: 620, height: 30, rx: 8, fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.8, filter: K.glow(uid) }, g);
      K.el('text', { x: 390, y: 120, 'text-anchor': 'middle', fill: c[zone], 'font-size': 11.5, 'font-weight': 700 }, g).textContent = msg;
      animate(g, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
    }

    function setClientStatus(n, msg, color) {
      const e = E(`c${n}-status`); if (e) { e.textContent = msg; e.setAttribute('fill', color || c.muted); }
    }

    async function write(n) {
      if (st.busy) return;
      if (st.writes[n]) { K.addLog(logBody, `client ${n} already committed this round — Reset to rerun`, 'warn'); return; }
      st.busy = true; setLock(true);
      const col = n === 1 ? c.blue : c.pink;
      const cb = n === 1 ? CB1 : CB2;
      const sx = cb.x + cb.w / 2, sy = cb.y + cb.h;
      if (st.boxOn) {
        setClientStatus(n, 'reading config…', c.purple);
        await fly(sx, sy, STRIP.x + STRIP.w / 2, STRIP.y, c.purple, 420, 4);
        await fly(STRIP.x + STRIP.w / 2, STRIP.y, sx, sy, c.purple, 420, 4);
        K.addLog(logBody, `client ${n} reads the agreed log first → latest config is cfg₂ {C,D,E}`, 'hl');
        const sub = E(`c${n}-sub`); if (sub) sub.textContent = clientCfg(n);
      }
      const q = quorumFor(n);
      const val = n === 1 ? 'x=1' : 'x=2';
      setClientStatus(n, 'writing ' + val + '…', col);
      await Promise.all(q.map((id, i) => fly(sx, sy, NX[id], NY - NR - 4, col, 500 + i * 70)));
      q.forEach((id) => {
        pulse(E('n-' + id), col);
        const prev = st.values[id];
        st.values[id] = prev && prev !== val ? prev + ' ▸ ' + val : val;
        const t = E('v-' + id); if (t) { t.textContent = st.values[id]; t.setAttribute('fill', col); }
      });
      await Promise.all(q.map((id, i) => fly(NX[id], NY - NR - 4, sx, sy, col, 420 + i * 70, 3.5)));
      st.writes[n] = { q, val };
      st.commits++;
      setClientStatus(n, 'COMMITTED ' + val + ' ✓', col);
      K.addLog(logBody, `client ${n}: ${val} acked by {${q.join(',')}} — a majority of ${st.boxOn ? 'cfg₂' : (n === 1 ? 'cfg₁' : 'cfg₂')}`, 'ok');
      judge();
      render();
      st.busy = false; setLock(false);
    }

    function judge() {
      if (!st.writes[1] || !st.writes[2]) return;
      const shared = st.writes[1].q.filter((x) => st.writes[2].q.includes(x));
      if (shared.length === 0) {
        st.conflicts++;
        st.writes[1].q.concat(st.writes[2].q).forEach((id) => { const e = E('n-' + id); if (e) e.setAttribute('stroke', c.red); });
        banner('☠ SPLIT BRAIN — x=1 and x=2 both “committed”; the two quorums share zero voters', 'red');
        K.addLog(logBody, 'two disjoint majorities → two histories → linearizability is gone, permanently', 'err');
      } else {
        shared.forEach((id) => { const e = E('n-' + id); if (e) { e.setAttribute('stroke', c.green); e.setAttribute('filter', K.glow(uid)); } });
        banner(`✓ ONE HISTORY — the quorums intersect at {${shared.join(',')}}: the second write saw the first`, 'green');
        K.addLog(logBody, `node ${shared.join(',')} sits in both quorums → it orders x=2 after x=1 — no fork`, 'ok');
      }
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('commits', st.commits);
      stat('conflicts', st.conflicts);
      stat('shared', (st.writes[1] && st.writes[2])
        ? st.writes[1].q.filter((x) => st.writes[2].q.includes(x)).length : '—');
    }

    function toggleBox() {
      if (st.busy) return;
      const sp = st.speed, on = !st.boxOn;
      st = fresh(); st.speed = sp; st.boxOn = on;
      root.querySelector('.t-box').textContent = (on ? '☑' : '☐') + ' agreement box: ' + (on ? 'ON' : 'OFF');
      const ban = anim.querySelector('#' + CSS.escape(uid + '-ban')); if (ban) ban.remove();
      drawScene(); render();
      K.addLog(logBody, on
        ? '☑ agreement box ON — config changes now serialize through one ordered log'
        : '☐ agreement box OFF — clients act on whatever view they hold', 'hl');
    }

    function reset() {
      if (st.busy) return;
      const sp = st.speed, on = st.boxOn;
      st = fresh(); st.speed = sp; st.boxOn = on;
      anim.innerHTML = '';
      drawScene(); render();
      K.addLog(logBody, '↺ reset — same configs, fresh round', 'hl');
    }

    function setLock(b) { K.lock(root, ['.t-w1', '.t-w2', '.t-both', '.t-box', '.t-reset'], b); }

    function bind() {
      root.querySelector('.t-w1').onclick = () => write(1);
      root.querySelector('.t-w2').onclick = () => write(2);
      root.querySelector('.t-both').onclick = async () => { await write(1); await write(2); };
      root.querySelector('.t-box').onclick = toggleBox;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMSplitBrain = { init };
})();
