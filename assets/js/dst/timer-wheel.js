/**
 * DST Tokio Hashed Timing Wheel (re-skinned via dst-kit) — coarse timers cascade, a paused clock leaps.
 *
 * Tokio's timer driver is a hierarchical hashed timing wheel: NUM_LEVELS=6 levels of LEVEL_MULT=64
 * slots each, the finest at 1 ms per slot (runtime/time/wheel/mod.rs:42; wheel/level.rs:38;
 * runtime/time/mod.rs:70-76) → it spans ~12 days. We can't draw 64 slots, so this is a REPRESENTATIVE
 * wheel of 3 levels drawn as horizontal rows, each LABELED with its real granularity:
 *   Level 0 = 1 ms/slot · Level 1 = 64 ms/slot · Level 2 ≈ 4.1 s/slot  (…6 levels total, to ~12 days)
 *
 * sleep(d) computes a deadline = Instant::now() + d and registers on first poll
 * (time/sleep.rs:123-129; time/entry.rs:608-610). The deadline picks a level by how far away it is.
 * "Advance" sweeps the Level-0 cursor; when Level 0 wraps, the next coarse timer CASCADES down into
 * finer slots before firing. "Auto-advance" is the paused path: when there's no runnable work the
 * driver jumps `now` straight to the next timer's deadline, then processes expired entries
 * (runtime/time/mod.rs:263-275) — so sleep(1h) completes in zero real time.
 *
 * Determinism: structure is fixed, no Math.random; any jitter would come from K.rng(seed).
 * Exposes window.DSTTimerWheel.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('timer-wheel: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('timer-wheel: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 320, SPEED = 1;
  // Representative geometry: 3 rows, ~10 slots each. Each level's real granularity (ms/slot).
  const SLOTS = 10;
  const LEVELS = [
    { gran: 1,    label: 'Level 0', sub: '1 ms / slot' },
    { gran: 64,   label: 'Level 1', sub: '64 ms / slot' },
    { gran: 4096, label: 'Level 2', sub: '≈ 4.1 s / slot' },
  ];
  const ROW = { x0: 96, y0: 70, h: 40, gap: 24, w: 600 };
  const slotW = ROW.w / SLOTS;
  const rowY = (lvl) => ROW.y0 + lvl * (ROW.h + ROW.gap);
  const slotX = (s) => ROW.x0 + s * slotW;

  const SNIPPET = `// tokio: 6 levels × 64 slots, level 0 = 1 ms/slot  → spans ~12 days
let deadline = Instant::now() + duration;   // sleep(d): time/sleep.rs:123
// paused + no runnable work: leap to the next timer, then fire it
//   self.park.park_timeout(0); clock.advance(next - now)  // mod.rs:263-275`;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    // a timer: { id, deadline, level, slot, fired, color }
    const fresh = () => ({ now: 0, cursor: 0, seq: 0, timers: [], fired: 0, busy: false });
    const st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / SPEED;
    const E = (sel) => svg.querySelector('#' + CSS.escape(uid + '-' + sel));

    build();

    function controls() {
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">register</span>
        <button class="dstk-btn dstk-btn--green t-s5">sleep(5 ms)</button>
        <button class="dstk-btn dstk-btn--blue t-s400">sleep(400 ms)</button>
        <button class="dstk-btn dstk-btn--purple t-s1h">sleep(1 h)</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--amber t-adv">▶ Advance</button>
          <button class="dstk-btn dstk-btn--ghost t-auto">⏩ Auto-advance</button></div>
        <span class="dstk-sp"></span>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Tokio hashed timing wheel', sub: 'coarse timers cascade down; a paused clock leaps idle gaps',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'now', label: 'now' }, { id: 'pending', label: 'pending' }, { id: 'fired', label: 'fired' }],
        cap: 'Six levels, 64 slots each; coarse timers cascade down, and a paused clock leaps over idle gaps.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 empty wheel — register a sleep; its deadline picks a level by distance', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      anim.innerHTML = '';
      LEVELS.forEach((L, lvl) => {
        const y = rowY(lvl);
        // level label + granularity
        K.el('text', { x: ROW.x0 - 12, y: y + 16, 'text-anchor': 'end', fill: c.text, 'font-size': 12, 'font-weight': 700 }, content).textContent = L.label;
        K.el('text', { x: ROW.x0 - 12, y: y + 32, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5 }, content).textContent = L.sub;
        for (let s = 0; s < SLOTS; s++) {
          K.el('rect', { x: slotX(s), y, width: slotW - 3, height: ROW.h, rx: 5,
            fill: K.grad(uid, lvl === 0 ? 'green' : lvl === 1 ? 'blue' : 'purple'),
            stroke: c.separator, 'stroke-width': 1 }, content);
        }
      });
      // the Level-0 cursor (sweeps slot to slot)
      K.el('rect', { id: uid + '-cursor', x: slotX(0), y: rowY(0) - 4, width: slotW - 3, height: ROW.h + 8, rx: 6,
        fill: 'none', stroke: c.amber, 'stroke-width': 2.5, filter: K.glow(uid) }, content);
      K.el('text', { id: uid + '-curlbl', x: slotX(0) + (slotW - 3) / 2, y: rowY(0) - 10, 'text-anchor': 'middle',
        fill: c.amber, 'font-size': 9.5, 'font-weight': 600 }, content).textContent = 'cursor';
      // footnote: the full wheel
      K.el('text', { x: ROW.x0, y: rowY(2) + ROW.h + 22, fill: c.muted, 'font-size': 10 }, content)
        .textContent = '…6 levels total, 64 slots each → spans ~12 days. Each level is 64× coarser than the one below.';
    }

    // --- placement: deadline → (level, slot) for the representative wheel ---
    // Level chosen by which granularity the (deadline-now) distance lands in; slot within row by gran.
    function place(delta) {
      for (let lvl = 0; lvl < LEVELS.length; lvl++) {
        const cap = LEVELS[lvl].gran * SLOTS;
        if (delta < cap || lvl === LEVELS.length - 1) {
          const slot = Math.min(SLOTS - 1, Math.max(0, Math.floor(delta / LEVELS[lvl].gran)));
          return { level: lvl, slot };
        }
      }
      return { level: LEVELS.length - 1, slot: SLOTS - 1 };
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function fmtMs(ms) {
      if (ms >= 3600000) return (ms / 3600000) + ' h';
      if (ms >= 1000) return (ms / 1000) + ' s';
      return ms + ' ms';
    }

    function render() {
      stat('now', fmtMs(st.now));
      stat('pending', st.timers.filter((t) => !t.fired).length);
      stat('fired', st.fired);
      // redraw tokens
      anim.innerHTML = '';
      st.timers.filter((t) => !t.fired).forEach((t) => drawToken(t));
      // cursor position (Level 0)
      const cx = slotX(st.cursor) + (slotW - 3) / 2;
      const cur = E('cursor'), lbl = E('curlbl');
      if (cur) cur.setAttribute('x', slotX(st.cursor));
      if (lbl) lbl.setAttribute('x', cx);
    }

    function tokenColor(lvl) { return lvl === 0 ? c.green : lvl === 1 ? c.blue : c.purple; }

    function drawToken(t) {
      const y = rowY(t.level), x = slotX(t.slot) + (slotW - 3) / 2;
      const g = K.el('g', { id: uid + '-tok-' + t.id, class: 'tok' }, anim);
      K.el('circle', { cx: x, cy: y + ROW.h / 2, r: 9, fill: tokenColor(t.level), filter: K.glow(uid) }, g);
      K.el('text', { x, y: y + ROW.h / 2 + 3.2, 'text-anchor': 'middle', fill: c.dark ? '#0b0e14' : '#fff',
        'font-size': 8.5, 'font-weight': 700 }, g).textContent = t.tag;
      return g;
    }

    // --- register a timer ---
    function add(delta, label) {
      if (st.busy) return;
      const deadline = st.now + delta;
      const p = place(delta);
      const id = ++st.seq;
      const t = { id, deadline, delta, level: p.level, slot: p.slot, fired: false, tag: 't' + id };
      st.timers.push(t);
      K.addLog(logBody,
        `sleep(${label}) → deadline = now+${fmtMs(delta)} = ${fmtMs(deadline)} → ${LEVELS[t.level].label}, slot ${t.slot}`,
        t.level === 0 ? 'ok' : 'hl');
      render();
      // pop-in
      const g = anim.querySelector('#' + CSS.escape(uid + '-tok-' + id));
      if (g) animate(g, { opacity: [0, 1], scale: [0.3, 1], duration: dur(220), ease: 'out(2)' });
    }

    // fire a single timer: flash a waker, remove it
    async function fire(t) {
      const g = anim.querySelector('#' + CSS.escape(uid + '-tok-' + t.id));
      K.addLog(logBody, `🔔 fire ${t.tag} — deadline ${fmtMs(t.deadline)} ≤ now ${fmtMs(st.now)} → waker.wake()`, 'warn');
      if (g) {
        const ring = K.el('circle', { cx: g.querySelector('circle').getAttribute('cx'),
          cy: g.querySelector('circle').getAttribute('cy'), r: 9, fill: 'none', stroke: c.amber, 'stroke-width': 2.5 }, anim);
        await animate(ring, { r: [9, 26], opacity: [0.9, 0], duration: dur(360), ease: 'out(2)' }).then;
        ring.remove();
      }
      t.fired = true; st.fired++;
    }

    // cascade: a coarse-level timer whose deadline is now near re-inserts into a finer level
    async function cascadeDown(t) {
      const fromLvl = t.level, fromSlot = t.slot;
      const delta = Math.max(0, t.deadline - st.now);
      const p = place(delta);
      if (p.level >= fromLvl) return false; // not yet due to descend
      t.level = p.level; t.slot = p.slot;
      K.addLog(logBody, `⤵ cascade ${t.tag}: ${LEVELS[fromLvl].label} → ${LEVELS[p.level].label}, slot ${p.slot} (re-hashed as it nears)`, 'hl');
      const g = anim.querySelector('#' + CSS.escape(uid + '-tok-' + t.id));
      if (g) {
        const x = slotX(p.slot) + (slotW - 3) / 2, y = rowY(p.level) + ROW.h / 2;
        const circle = g.querySelector('circle'), txt = g.querySelector('text');
        await Promise.all([
          animate(circle, { cx: x, cy: y, duration: dur(420), ease: 'inOut(3)' }).then,
          animate(txt, { x, y: y + 3.2, duration: dur(420), ease: 'inOut(3)' }).then,
        ]);
        circle.setAttribute('fill', tokenColor(p.level));
      }
      return true;
    }

    // sweep the Level-0 cursor by one slot; cascade coarse timers; fire expired ones
    async function advance() {
      if (st.busy) return;
      st.busy = true; setLock(true);
      const prev = st.cursor;
      st.cursor = (st.cursor + 1) % SLOTS;
      st.now += LEVELS[0].gran; // one Level-0 tick = 1 ms
      // animate cursor sweep
      const cur = E('cursor'), lbl = E('curlbl');
      const nx = slotX(st.cursor);
      animate(cur, { x: nx, duration: dur(180), ease: 'out(2)' });
      animate(lbl, { x: nx + (slotW - 3) / 2, duration: dur(180), ease: 'out(2)' });

      // when Level 0 wraps, coarse timers get a chance to cascade down
      if (st.cursor === 0 && prev === SLOTS - 1) {
        st.now += LEVELS[1].gran - LEVELS[0].gran; // wrap absorbs ~one Level-1 slot of time
        K.addLog(logBody, `↻ Level-0 wrapped → now ${fmtMs(st.now)}; coarse levels rotate, near timers cascade`, 'warn');
        for (const t of st.timers.filter((x) => !x.fired && x.level > 0)) await cascadeDown(t);
      }

      // fire anything whose deadline has arrived
      for (const t of st.timers.filter((x) => !x.fired && x.deadline <= st.now)) await fire(t);
      st.timers = st.timers.filter((t) => !t.fired);
      render();
      st.busy = false; setLock(false);
    }

    // paused auto-advance: leap `now` straight to the soonest deadline, then fire it (idle gap free)
    async function autoAdvance() {
      if (st.busy) return;
      const pending = st.timers.filter((t) => !t.fired);
      if (!pending.length) { K.addLog(logBody, 'auto-advance: no pending timers — nothing to leap to', 'warn'); return; }
      st.busy = true; setLock(true);
      const next = Math.min(...pending.map((t) => t.deadline));
      const gap = next - st.now;
      K.addLog(logBody, `⏩ no runnable work → leap now ${fmtMs(st.now)}→${fmtMs(next)} (idle gap ${fmtMs(gap)} skipped in 0 real time)`, 'warn');
      st.now = next;
      // cascade any coarse timer that is now due into Level 0 before it fires
      for (const t of pending.filter((t) => t.level > 0 && t.deadline <= next)) {
        t.level = 0; t.slot = 0;
        const g = anim.querySelector('#' + CSS.escape(uid + '-tok-' + t.id));
        if (g) {
          const x = slotX(0) + (slotW - 3) / 2, y = rowY(0) + ROW.h / 2;
          await Promise.all([
            animate(g.querySelector('circle'), { cx: x, cy: y, fill: tokenColor(0), duration: dur(360), ease: 'inOut(3)' }).then,
            animate(g.querySelector('text'), { x, y: y + 3.2, duration: dur(360), ease: 'inOut(3)' }).then,
          ]);
        }
      }
      // align Level-0 cursor onto the firing slot for visual honesty
      st.cursor = 0;
      const cur = E('cursor'), lbl = E('curlbl');
      animate(cur, { x: slotX(0), duration: dur(160), ease: 'out(2)' });
      animate(lbl, { x: slotX(0) + (slotW - 3) / 2, duration: dur(160), ease: 'out(2)' });
      for (const t of pending.filter((t) => t.deadline <= next)) await fire(t);
      st.timers = st.timers.filter((t) => !t.fired);
      render();
      st.busy = false; setLock(false);
    }

    function bind() {
      root.querySelector('.t-s5').onclick = () => add(5, '5 ms');
      root.querySelector('.t-s400').onclick = () => add(400, '400 ms');
      root.querySelector('.t-s1h').onclick = () => add(3600000, '1 h');
      root.querySelector('.t-adv').onclick = () => { if (!st.busy) advance(); };
      root.querySelector('.t-auto').onclick = () => { if (!st.busy) autoAdvance(); };
      root.querySelector('.t-reset').onclick = reset;
    }

    function reset() {
      Object.assign(st, fresh());
      drawScene(); render();
      K.addLog(logBody, '↺ reset — empty wheel, now = 0', 'hl');
    }

    function setLock(b) {
      K.lock(root, ['.t-s5', '.t-s400', '.t-s1h', '.t-adv', '.t-auto', '.t-reset'], b);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.DSTTimerWheel = { init };
})();
