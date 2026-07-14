/**
 * MEM Safety Liveness (dst-kit) — a point of no return vs a promise about forever.
 *
 * Two kinds of promise, watched live on one timeline:
 *   • SAFETY — "nothing bad ever happens" (here: never two leaders at once). If it breaks, it
 *     breaks at a specific moment, and NOTHING that happens afterwards can un-break it. The
 *     red ✗ pins itself to the timeline and stays there forever.
 *   • LIVENESS — "something good eventually happens" (here: every request eventually gets a
 *     reply). No finite amount of watching can ever prove it broken, because the good thing
 *     might still be coming. You can only judge it by ending the run — declaring "nothing
 *     more will ever happen".
 * This asymmetry is why protocols guard safety unconditionally and treat liveness as the thing
 * you buy back when the network calms down. Exposes window.MEMSafetyLiveness.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-safety-liveness: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-safety-liveness: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 300;
  const TL = { x: 40, y: 150, w: 700, max: 16 };
  const SAF = { x: 40, y: 30, w: 340, h: 84 };
  const LIV = { x: 400, y: 30, w: 340, h: 84 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = () => ({ t: 0, events: [], safetyBrokenAt: null, leaders: 1,
      pending: [], answered: 0, ended: false, busy: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const tx = (t) => TL.x + 20 + (t % TL.max) * ((TL.w - 40) / TL.max);

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-tick">⏭ time passes</button>
        <button class="dstk-btn dstk-btn--blue t-req">📨 send request</button>
        <button class="dstk-btn dstk-btn--green t-ans">✅ answer oldest</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--red t-second">👑 elect a 2nd leader</button>
        <button class="dstk-btn dstk-btn--amber t-end">🏁 end the run</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Safety and liveness, on a timeline', sub: 'violated at a moment versus judged over an unbounded run',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 't', label: 'time' }, { id: 'pending', label: 'pending requests' }, { id: 'safety', label: 'safety' }],
        cap: 'Break safety and the ✗ pins to that exact moment — keep clicking, nothing repairs it. Hold a request '
           + 'and liveness just says "…might still happen", forever — the only way to violate it is to end the run '
           + 'with the request still waiting. Violated-at-a-point vs violated-only-by-forever: that is the whole '
           + 'distinction, and every protocol in this post is built around it.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 send a request and never answer it — then try to catch liveness "violated". You can\'t… until you end the run.', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // monitors
      K.el('rect', { id: `${uid}-safbox`, x: SAF.x, y: SAF.y, width: SAF.w, height: SAF.h, rx: 10, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.8 }, content);
      K.el('text', { x: SAF.x + 14, y: SAF.y + 22, fill: c.text, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'SAFETY monitor';
      K.el('text', { x: SAF.x + 14, y: SAF.y + 40, fill: c.muted, 'font-size': 9 }, content).textContent = '"there are never two leaders at once"';
      K.el('text', { id: `${uid}-safv`, x: SAF.x + 14, y: SAF.y + 66, fill: c.green, 'font-size': 12, 'font-weight': 700 }, content).textContent = '✓ holding — nothing bad so far';
      K.el('rect', { id: `${uid}-livbox`, x: LIV.x, y: LIV.y, width: LIV.w, height: LIV.h, rx: 10, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.8 }, content);
      K.el('text', { x: LIV.x + 14, y: LIV.y + 22, fill: c.text, 'font-size': 11, 'font-weight': 700 }, content).textContent = 'LIVENESS monitor';
      K.el('text', { x: LIV.x + 14, y: LIV.y + 40, fill: c.muted, 'font-size': 9 }, content).textContent = '"every request eventually gets a reply"';
      K.el('text', { id: `${uid}-livv`, x: LIV.x + 14, y: LIV.y + 66, fill: c.blue, 'font-size': 12, 'font-weight': 700 }, content).textContent = '… nothing to wait for yet';
      // timeline
      K.el('line', { x1: TL.x, y1: TL.y, x2: TL.x + TL.w, y2: TL.y, stroke: c.muted, 'stroke-width': 1.6, opacity: 0.5 }, content);
      K.el('text', { x: TL.x, y: TL.y + 24, fill: c.muted, 'font-size': 9 }, content).textContent = 'the run (every event lands here, in order)';
      K.el('g', { id: `${uid}-events` }, content);
      K.el('g', { id: `${uid}-pins` }, content);
      // pending strip
      K.el('text', { x: TL.x, y: 216, fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'requests still waiting:';
      K.el('g', { id: `${uid}-pendg` }, content);
      K.el('text', { id: `${uid}-endnote`, x: W / 2, y: 268, 'text-anchor': 'middle', fill: c.amber, 'font-size': 11, 'font-weight': 700 }, content).textContent = '';
    }

    function addEvent(label, zone) {
      st.t++;
      st.events.push({ t: st.t, label, zone });
      const g = E('events');
      const x = tx(st.t);
      if (st.t > TL.max) { g.innerHTML = ''; st.events.filter((e) => e.t > st.t - TL.max).forEach((e) => drawEvent(g, e)); }
      else drawEvent(g, { t: st.t, label, zone });
      render();
    }
    function drawEvent(g, e) {
      const x = tx(e.t);
      K.el('circle', { cx: x, cy: TL.y, r: 5, fill: c[e.zone] }, g);
      K.el('text', { x, y: TL.y - 12, 'text-anchor': 'middle', fill: c[e.zone], 'font-size': 8 }, g).textContent = e.label;
    }

    function redrawPending() {
      const g = E('pendg'); g.innerHTML = '';
      st.pending.forEach((p, i) => {
        const x = TL.x + 130 + i * 150;
        K.el('rect', { x, y: 224, width: 138, height: 24, rx: 6, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.4 }, g);
        K.el('text', { x: x + 69, y: 240, 'text-anchor': 'middle', fill: c.text, 'font-size': 9 }, g)
          .textContent = `req#${p.id} — since t=${p.t} · might still…`;
      });
      if (!st.pending.length)
        K.el('text', { x: TL.x + 140, y: 240, fill: c.muted, 'font-size': 9.5 }, g).textContent = '(none — everyone got an answer)';
    }

    function updateMonitors() {
      const sv = E('safv');
      if (st.safetyBrokenAt != null) {
        sv.textContent = `✗ VIOLATED at t=${st.safetyBrokenAt} — forever`;
        sv.setAttribute('fill', c.red);
        E('safbox').setAttribute('stroke', c.red);
        E('safbox').setAttribute('fill', K.grad(uid, 'red'));
      } else {
        sv.textContent = '✓ holding — nothing bad so far';
        sv.setAttribute('fill', c.green);
      }
      const lv = E('livv');
      if (st.ended) {
        if (st.pending.length) {
          lv.textContent = `✗ violated — ${st.pending.length} request(s) never answered`;
          lv.setAttribute('fill', c.red);
          E('livbox').setAttribute('stroke', c.red);
        } else {
          lv.textContent = '✓ satisfied — every request was answered';
          lv.setAttribute('fill', c.green);
          E('livbox').setAttribute('stroke', c.green);
        }
      } else if (st.pending.length) {
        lv.textContent = `… ${st.pending.length} waiting — the reply might still come`;
        lv.setAttribute('fill', c.amber);
      } else {
        lv.textContent = st.answered ? '✓ all answered so far — still watching' : '… nothing to wait for yet';
        lv.setAttribute('fill', c.blue);
      }
    }

    const guardEnded = () => {
      if (st.ended) { K.addLog(logBody, 'the run has ended — nothing more will ever happen. Reset to start a new one.', 'warn'); return true; }
      return false;
    };

    function tick() { if (guardEnded()) return; addEvent('t' + st.t, 'gray'); updateMonitors(); }
    function sendReq() {
      if (guardEnded()) return;
      const id = st.pending.length + st.answered + 1;
      st.pending.push({ id, t: st.t + 1 });
      addEvent('req' + id, 'blue');
      redrawPending(); updateMonitors();
      K.addLog(logBody, `📨 request #${id} sent — liveness now owes it an eventual reply`, 'hl');
    }
    function answer() {
      if (guardEnded()) return;
      if (!st.pending.length) { K.addLog(logBody, 'nothing is waiting', 'warn'); return; }
      const p = st.pending.shift();
      st.answered++;
      addEvent('ans' + p.id, 'green');
      redrawPending(); updateMonitors();
      K.addLog(logBody, `✅ request #${p.id} answered after ${st.t - p.t} step(s) — "eventually" arrived`, 'ok');
    }
    function secondLeader() {
      if (guardEnded()) return;
      if (st.safetyBrokenAt != null) { K.addLog(logBody, 'safety is already broken — and no event can repair it. That is the point.', 'err'); return; }
      st.leaders = 2;
      addEvent('👑👑', 'red');
      st.safetyBrokenAt = st.t;
      const pins = E('pins');
      const x = tx(st.t);
      K.el('text', { x, y: TL.y - 26, 'text-anchor': 'middle', fill: c.red, 'font-size': 16, 'font-weight': 700 }, pins).textContent = '✗';
      K.el('line', { x1: x, y1: TL.y - 20, x2: x, y2: TL.y + 12, stroke: c.red, 'stroke-width': 1.4, 'stroke-dasharray': '3,3' }, pins);
      updateMonitors();
      K.addLog(logBody, `☠ two leaders at t=${st.safetyBrokenAt}. A finite prefix of the run is now bad — no future can fix it.`, 'err');
    }
    function endRun() {
      if (guardEnded()) return;
      st.ended = true;
      E('endnote').textContent = `🏁 run ended at t=${st.t} — "nothing more will ever happen" — NOW liveness can be judged`;
      updateMonitors();
      K.addLog(logBody, st.pending.length
        ? `🏁 ended with ${st.pending.length} request(s) still waiting → on this run-extended-by-silence, liveness fails`
        : '🏁 ended clean — every request got its reply; both promises kept', st.pending.length ? 'err' : 'ok');
      render();
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('t', st.t); stat('pending', st.pending.length);
      const s = root.querySelector('#' + CSS.escape(uid + '-stat-safety'));
      if (s) { s.textContent = st.safetyBrokenAt != null ? '✗' : '✓'; s.style.color = st.safetyBrokenAt != null ? '#f87171' : '#4ade80'; }
    }

    function reset() {
      const sp = st.speed;
      st = fresh(); st.speed = sp;
      anim.innerHTML = ''; drawScene(); render(); redrawPending(); updateMonitors();
      K.addLog(logBody, '↺ reset — fresh run, one leader, no debts', 'hl');
    }

    function bind() {
      root.querySelector('.t-tick').onclick = tick;
      root.querySelector('.t-req').onclick = sendReq;
      root.querySelector('.t-ans').onclick = answer;
      root.querySelector('.t-second').onclick = secondLeader;
      root.querySelector('.t-end').onclick = endRun;
      root.querySelector('.t-reset').onclick = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMSafetyLiveness = { init };
})();
