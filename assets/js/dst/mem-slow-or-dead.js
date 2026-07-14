/**
 * MEM Slow or Dead (dst-kit) — the one question a distributed system cannot answer.
 *
 * You are n0. You pinged n1 and the reply hasn't come. Two possible worlds: n1 is slow (the
 * reply is on its way, eventually), or n1 is dead (the reply will never come). Here is the
 * cruel part: FROM WHERE YOU SIT, BOTH WORLDS LOOK IDENTICAL — silence.
 *
 * Play the game: wait, or declare n1 dead. Declare too early and you execute a healthy node
 * (a false positive). Wait too long and you burn seconds a real failure should have cost you.
 * Then hand the decision to a timeout and auto-run ten rounds — and watch every timeout value
 * trade one error for the other. FLP is the formal version of this feeling: with even one
 * possible crash, no deterministic protocol can be both always-safe and always-live.
 * Timeouts don't solve the dilemma; they price it. Exposes window.MEMSlowOrDead.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-slow-or-dead: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-slow-or-dead: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 290;
  const ME = { x: 110, y: 120 };
  const VIEW = { x: 230, y: 60, w: 300, h: 130 };
  const WA = { x: 570, y: 46, w: 186, h: 86 };
  const WB = { x: 570, y: 148, w: 186, h: 86 };
  const MAXWAIT = 15;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({ seed: seed == null ? 6 : seed, rng: K.rng(seed == null ? 6 : seed),
      world: null, delay: 0, elapsed: 0, live: false, revealed: false,
      rounds: 0, falseAcc: 0, caught: 0, waited: 0, detectSum: 0, timeout: 5,
      busy: false, speed: 1 });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--blue t-ping">🏓 new round</button>
        <button class="dstk-btn dstk-btn--purple t-wait" disabled>⏳ wait +1 s</button>
        <button class="dstk-btn dstk-btn--red t-dead" disabled>⚰ declare dead</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">timeout</span>
          <select class="t-timeout">
            <option value="2">2 s</option><option value="3">3 s</option><option value="5" selected>5 s</option>
            <option value="8">8 s</option><option value="12">12 s</option></select>
          <button class="dstk-btn dstk-btn--amber t-auto">🤖 auto-run 10 rounds</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Telling slow from dead', sub: 'a slow node and a dead node present the same silence',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'rounds', label: 'rounds' }, { id: 'false', label: 'false accusations' }, { id: 'caught', label: 'deaths caught' }, { id: 'avg', label: 'avg detect (s)' }],
        cap: 'Both cases present identically: silence. Run a few rounds by hand, then auto-run with different '
           + 'timeouts: a short timeout accuses healthy-but-slow nodes; a long one delays detection of real '
           + 'failures. No value avoids both errors — a timeout only sets which error is favored.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 start a round — an adversary secretly picks a world; your view is identical either way', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // you
      K.el('circle', { cx: ME.x, cy: ME.y, r: 24, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2.4 }, content);
      K.el('text', { x: ME.x, y: ME.y + 5, 'text-anchor': 'middle', fill: c.text, 'font-size': 12, 'font-weight': 700 }, content).textContent = 'n0';
      K.el('text', { x: ME.x, y: ME.y + 44, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, content).textContent = 'you';
      // your view
      K.el('rect', { x: VIEW.x, y: VIEW.y, width: VIEW.w, height: VIEW.h, rx: 10, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.8 }, content);
      K.el('text', { x: VIEW.x + VIEW.w / 2, y: VIEW.y + 22, 'text-anchor': 'middle', fill: c.blue, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = 'WHAT YOU CAN SEE';
      K.el('text', { id: `${uid}-view1`, x: VIEW.x + VIEW.w / 2, y: VIEW.y + 58, 'text-anchor': 'middle', fill: c.text, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'no round yet';
      K.el('text', { id: `${uid}-view2`, x: VIEW.x + VIEW.w / 2, y: VIEW.y + 84, 'text-anchor': 'middle', fill: c.muted, 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
      K.el('text', { id: `${uid}-view3`, x: VIEW.x + VIEW.w / 2, y: VIEW.y + 110, 'text-anchor': 'middle', fill: c.amber, 'font-size': 10, 'font-weight': 700 }, content).textContent = '';
      // the two possible worlds
      K.el('text', { x: WA.x + WA.w / 2, y: 34, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'the two possible worlds';
      [[WA, 'A', 'wa'], [WB, 'B', 'wb']].forEach(([box, tag, id]) => {
        K.el('rect', { id: `${uid}-${id}-box`, x: box.x, y: box.y, width: box.w, height: box.h, rx: 9, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.4 }, content);
        K.el('text', { id: `${uid}-${id}-t`, x: box.x + box.w / 2, y: box.y + 24, 'text-anchor': 'middle', fill: c.text, 'font-size': 10.5, 'font-weight': 700 }, content).textContent = `world ${tag}: ?`;
        K.el('text', { id: `${uid}-${id}-s`, x: box.x + box.w / 2, y: box.y + 46, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9 }, content).textContent = tag === 'A' ? 'n1 is slow — a reply exists' : 'n1 crashed — no reply exists';
        K.el('text', { id: `${uid}-${id}-v`, x: box.x + box.w / 2, y: box.y + 68, 'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = '';
      });
    }

    function setView(l1, l2, l3, tone) {
      const v1 = E('view1'), v2 = E('view2'), v3 = E('view3');
      v1.textContent = l1; v2.textContent = l2 || ''; v3.textContent = l3 || '';
      v1.setAttribute('fill', tone === 'err' ? c.red : tone === 'ok' ? c.green : c.text);
    }

    function newRound() {
      if (st.busy || st.live) { if (st.live) K.addLog(logBody, 'finish the current round first (wait or declare)', 'warn'); return; }
      st.world = st.rng() < 0.5 ? 'slow' : 'dead';
      st.delay = 2 + Math.floor(st.rng() * 10); // slow world: reply arrives after 2..11 s
      st.elapsed = 0; st.live = true; st.revealed = false;
      ['wa', 'wb'].forEach((id) => {
        E(id + '-box').setAttribute('stroke', c.gray);
        E(id + '-t').textContent = `world ${id === 'wa' ? 'A' : 'B'}: ?`;
        E(id + '-v').textContent = 'possible';
        E(id + '-v').setAttribute('fill', c.muted);
      });
      setView('ping sent → …silence', 'elapsed: 0 s', 'slow? dead? your screen says the same thing');
      K.lock(root, ['.t-wait', '.t-dead'], false);
      K.addLog(logBody, '🏓 ping sent to n1 — the adversary has already picked the world', 'hl');
    }

    function reveal(correct, msg, tone) {
      st.revealed = true; st.live = false; st.rounds++;
      const trueId = st.world === 'slow' ? 'wa' : 'wb';
      const falseId = st.world === 'slow' ? 'wb' : 'wa';
      E(trueId + '-box').setAttribute('stroke', st.world === 'slow' ? c.green : c.red);
      E(trueId + '-t').textContent = `world ${trueId === 'wa' ? 'A' : 'B'}: REAL`;
      E(trueId + '-v').textContent = st.world === 'slow' ? `reply was ${st.delay}s out` : 'no reply, ever';
      E(trueId + '-v').setAttribute('fill', st.world === 'slow' ? c.green : c.red);
      E(falseId + '-v').textContent = 'was never real';
      K.lock(root, ['.t-wait', '.t-dead'], true);
      K.addLog(logBody, msg, tone);
      render();
    }

    function wait() {
      if (!st.live || st.busy) return;
      st.elapsed++;
      if (st.world === 'slow' && st.elapsed >= st.delay) {
        st.waited++; st.detectSum += 0;
        setView('🏓 reply arrived!', `n1 was alive all along — it took ${st.delay} s`, '', 'ok');
        reveal(true, `✅ patience paid: n1 answered after ${st.delay}s. But you only know that NOW.`, 'ok');
        return;
      }
      setView('…still silence', `elapsed: ${st.elapsed} s`,
        st.elapsed >= MAXWAIT ? 'you could wait forever — a crashed node never replies' : 'slow? dead? still identical');
      if (st.world === 'dead' && st.elapsed >= MAXWAIT)
        K.addLog(logBody, `⏳ ${st.elapsed}s of waiting. If n1 is dead, this continues forever — that is the liveness you're spending`, 'warn');
    }

    function declareDead() {
      if (!st.live || st.busy) return;
      if (st.world === 'dead') {
        st.caught++; st.detectSum += st.elapsed;
        setView('⚰ verdict: dead', `correct — detected in ${st.elapsed} s`, '', 'ok');
        reveal(true, `✅ n1 really was dead — caught it after ${st.elapsed}s of silence`, 'ok');
      } else {
        st.falseAcc++;
        setView('⚰ verdict: dead', `WRONG — n1 was alive; its reply was ${Math.max(0, st.delay - st.elapsed)} s away`, '', 'err');
        reveal(false, `☠ false accusation: you declared a living node dead after ${st.elapsed}s. Its reply was almost there.`, 'err');
      }
    }

    async function autoRun() {
      if (st.busy || st.live) return;
      st.busy = true; setLock(true);
      const T = st.timeout;
      let fa = 0, ok = 0, sum = 0;
      K.addLog(logBody, `🤖 running 10 rounds with a fixed ${T}s timeout…`, 'hl');
      for (let r = 0; r < 10; r++) {
        const world = st.rng() < 0.5 ? 'slow' : 'dead';
        const delay = 2 + Math.floor(st.rng() * 10);
        st.rounds++;
        if (world === 'slow') {
          if (delay <= T) { st.waited++; ok++; sum += delay; }
          else { st.falseAcc++; fa++; }
        } else { st.caught++; ok++; sum += T; st.detectSum += T; }
        setView(`auto round ${r + 1}/10`, `world: ${world} · ${world === 'slow' ? 'reply at ' + delay + 's' : 'no reply'} · timeout ${T}s`,
          world === 'slow' && delay > T ? '→ false accusation' : '→ correct');
        render();
        await K.delay(dur(220));
      }
      K.addLog(logBody, `timeout ${T}s → ${fa} false accusation${fa === 1 ? '' : 's'}, ${ok} correct, avg cost ${(sum / Math.max(1, ok)).toFixed(1)}s. Try a different timeout.`, fa > 2 ? 'warn' : 'ok');
      setView('auto-run done', `timeout ${T}s: ${fa} false accusations / 10 rounds`, 'shorter = more accusations · longer = slower detection');
      st.busy = false; setLock(false);
      render();
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('rounds', st.rounds); stat('false', st.falseAcc); stat('caught', st.caught);
      stat('avg', st.caught ? (st.detectSum / st.caught).toFixed(1) : '—');
    }

    function reset() {
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 6); st.speed = sp;
      anim.innerHTML = ''; drawScene(); render();
      K.lock(root, ['.t-wait', '.t-dead'], true);
      K.addLog(logBody, `↺ reset — seed ${st.seed}`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-ping', '.t-auto', '.t-reset'], b); }

    function bind() {
      root.querySelector('.t-ping').onclick = newRound;
      root.querySelector('.t-wait').onclick = wait;
      root.querySelector('.t-dead').onclick = declareDead;
      root.querySelector('.t-auto').onclick = autoRun;
      root.querySelector('.t-timeout').onchange = (e) => { st.timeout = parseInt(e.target.value, 10); };
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMSlowOrDead = { init };
})();
