/**
 * DST TAPIR Commit (re-skinned via dst-kit) — optimistic concurrency over Inconsistent Replication.
 *
 * TAPIR has NO leader on the normal commit path: the CLIENT is the transaction coordinator. On
 * "Commit" the client fans a Prepare to ALL replicas (n=5, so f=2); each replies Ok or abstains,
 * and the coordinator times the two-phase quorum:
 *   • FAST path (1 round trip): a fast/super-quorum ⌈3f/2⌉+1 = 4 agreeing replies lets the client
 *     commit immediately — "decide in one round in the common case" (configuration.rs:54). The
 *     fast path returns the moment that quorum lands (client.rs:102-146); Prepare Ok ⇒ commit
 *     (transaction.rs:623-631).
 *   • SLOW path (2 round trips): if the fast quorum is missed but a simple majority (slow quorum
 *     f+1 = 3) replies, the client runs a second round, then commits.
 *   • STALL: if even the slow quorum is unreachable, no commit — wait for quorum.
 * "drop k replies" + a seed pick WHICH replicas are slow/disagree via K.rng(seed) (deterministic).
 * View changes use a deterministic merge leader view % N (configuration.rs:108-110) — only off the
 * normal path. Committed timestamps never regress: highest_committed_ts is a high-water mark
 * (store/mod.rs:122-125).
 *
 * Exposes window.DSTTapirCommit.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('tapir-commit: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('tapir-commit: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 320, N = 5, F = 2;          // n = 2f + 1
  const FAST_Q = Math.ceil((3 * F) / 2) + 1;       // ⌈3f/2⌉+1 = 4
  const SLOW_Q = F + 1;                            // f + 1 = 3
  // Client/coordinator box on the LEFT, replicas down the RIGHT.
  const CLIENT = { x: 36, y: 118, w: 156, h: 84 };
  const REP = { x: 560, w: 186, h: 38, y0: 30, gap: 12 };
  const repY = (i) => REP.y0 + i * (REP.h + REP.gap);
  const repCx = REP.x + 18;
  const clientCx = CLIENT.x + CLIENT.w, clientCy = CLIENT.y + CLIENT.h / 2;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const st = { seed: 7, drop: 1, busy: false, rng: K.rng(7), roundTrips: 0, reached: '—' };
    let svg, content, anim, logBody, c;
    const id = (k, i) => `${uid}-${k}-${i}`;
    const E = (k, i) => svg.querySelector('#' + CSS.escape(id(k, i)));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--green t-commit">▶ Commit</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">drop k replies</span>
          <input type="number" class="t-drop" value="${st.drop}" min="0" max="${N}"></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input type="number" class="t-seed" value="${st.seed}" min="0"></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'TAPIR commit — no leader on the normal path',
        sub: `client is the coordinator · n=${N}, f=${F} · fast quorum ⌈3f/2⌉+1=${FAST_Q}, slow quorum f+1=${SLOW_Q}`,
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [
          { id: 'reps', label: 'replicas' },
          { id: 'quorum', label: 'quorum reached' },
          { id: 'rt', label: 'round-trips' },
        ],
        cap: 'Supermajority ⇒ commit in one round trip; a simple majority falls back to a second; ' +
          'no leader on the normal path. <span style="opacity:.8">View changes pick a deterministic ' +
          'merge leader <code>view % N</code> — only off this path. Committed timestamps never regress: ' +
          '<code>highest_committed_ts</code> is a high-water mark.</span>',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, `🌱 ready — seed ${st.seed}, dropping ${st.drop} replies · press Commit`, 'hl');
    }

    function drawScene() {
      content.innerHTML = '';

      // --- client / coordinator box (green = driver/SUT) ---
      K.el('rect', { id: id('client', 0), x: CLIENT.x, y: CLIENT.y, width: CLIENT.w, height: CLIENT.h, rx: 10,
        fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
      K.el('text', { x: CLIENT.x + 13, y: CLIENT.y + 22, fill: c.green, 'font-size': 12, 'font-weight': 700 }, content)
        .textContent = 'client';
      K.el('text', { x: CLIENT.x + 13, y: CLIENT.y + 39, fill: c.muted, 'font-size': 9.5 }, content)
        .textContent = '= transaction';
      K.el('text', { x: CLIENT.x + 13, y: CLIENT.y + 52, fill: c.muted, 'font-size': 9.5 }, content)
        .textContent = 'coordinator';
      K.el('text', { id: id('phase', 0), x: CLIENT.x + 13, y: CLIENT.y + 73, fill: c.text, 'font-size': 11.5,
        'font-weight': 700, filter: K.glow(uid) }, content).textContent = 'idle';

      // --- fan-out hub line from client toward replicas ---
      K.el('line', { x1: clientCx, y1: clientCy, x2: REP.x - 14, y2: clientCy,
        stroke: c.separator, 'stroke-width': 1, 'stroke-dasharray': '5 5', opacity: 0.5 }, content);
      K.el('text', { x: (clientCx + REP.x) / 2, y: clientCy - 8, 'text-anchor': 'middle',
        fill: c.muted, 'font-size': 9 }, content).textContent = 'Prepare → all replicas';

      // --- replica rows (blue = network peers) ---
      for (let i = 0; i < N; i++) {
        const y = repY(i);
        K.el('rect', { id: id('rep', i), x: REP.x, y, width: REP.w, height: REP.h, rx: 8,
          fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.6 }, content);
        K.el('circle', { id: id('dot', i), cx: repCx, cy: y + REP.h / 2, r: 5, fill: c.blue }, content);
        K.el('text', { x: REP.x + 34, y: y + REP.h / 2 + 4, fill: c.text, 'font-size': 12, 'font-weight': 700 }, content)
          .textContent = 'r' + i;
        K.el('text', { id: id('rlbl', i), x: REP.x + REP.w - 12, y: y + REP.h / 2 + 4, 'text-anchor': 'end',
          fill: c.muted, 'font-size': 10, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '—';
      }

      // --- quorum threshold legend (amber) on the left under the client ---
      K.el('text', { x: CLIENT.x, y: Hh - 70, fill: c.muted, 'font-size': 9.5 }, content)
        .textContent = 'fast quorum = ⌈3f/2⌉+1';
      K.el('text', { x: CLIENT.x, y: Hh - 56, fill: c.amber, 'font-size': 12, 'font-weight': 700 }, content)
        .textContent = `= ${FAST_Q}  →  1 round trip`;
      K.el('text', { x: CLIENT.x, y: Hh - 34, fill: c.muted, 'font-size': 9.5 }, content)
        .textContent = 'slow quorum = f+1';
      K.el('text', { x: CLIENT.x, y: Hh - 20, fill: c.purple, 'font-size': 12, 'font-weight': 700 }, content)
        .textContent = `= ${SLOW_Q}  →  2nd round trip`;
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('reps', N);
      stat('quorum', st.reached);
      stat('rt', st.roundTrips);
    }

    function setPhase(txt, col) {
      const p = E('phase', 0);
      if (p) { p.textContent = txt; p.setAttribute('fill', col || c.text); }
    }
    function resetRows() {
      for (let i = 0; i < N; i++) {
        const rl = E('rlbl', i); if (rl) { rl.textContent = '—'; rl.setAttribute('fill', c.muted); }
        const r = E('rep', i); if (r) { r.setAttribute('stroke', c.blue); r.setAttribute('fill', K.grad(uid, 'blue')); }
        const d = E('dot', i); if (d) d.setAttribute('fill', c.blue);
      }
    }

    // Deterministically choose WHICH replicas are slow/disagree from the seed: shuffle ids, take k.
    function chooseSlow(k) {
      const ids = Array.from({ length: N }, (_, i) => i);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(st.rng() * (i + 1));
        const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
      }
      return new Set(ids.slice(0, k));
    }

    // Fly a particle along a path; resolves when it lands.
    async function fly(sx, sy, tx, ty, color, d) {
      const dot = K.el('circle', { cx: sx, cy: sy, r: 6, fill: color, filter: K.glow(uid) }, anim);
      await animate(dot, { cx: tx, cy: ty, duration: d, ease: 'inOutQuad' });
      dot.remove();
    }
    function flash(el, col) {
      if (!el) return; const old = el.getAttribute('stroke'); el.setAttribute('stroke', col);
      animate(el, { opacity: [1, 0.5, 1], duration: 280, ease: 'inOut(2)', onComplete: () => el.setAttribute('stroke', old) });
    }

    // One Prepare round trip: fan out to `targets`, fly replies back from those that answer.
    // Returns the set of replica ids that replied Ok this round.
    async function prepareRound(targets, slow, roundLabel) {
      st.roundTrips++; render();
      setPhase(roundLabel, c.amber);
      // fan-out: Prepare dot to each targeted replica
      const outs = targets.map((i) => fly(clientCx, clientCy, repCx, repY(i) + REP.h / 2, c.green, 360));
      await Promise.all(outs);

      const ok = [];
      const ins = [];
      for (const i of targets) {
        const answers = !slow.has(i);
        const rl = E('rlbl', i);
        if (answers) {
          ok.push(i);
          if (rl) { rl.textContent = 'Ok'; rl.setAttribute('fill', c.green); }
          E('dot', i).setAttribute('fill', c.green);
          flash(E('rep', i), c.green);
          ins.push(fly(repCx, repY(i) + REP.h / 2, clientCx, clientCy, c.green, 360));
        } else {
          if (rl) { rl.textContent = 'abstain'; rl.setAttribute('fill', c.red); }
          E('dot', i).setAttribute('fill', c.red);
          flash(E('rep', i), c.red);
        }
      }
      await Promise.all(ins);
      return ok;
    }

    async function commit() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.roundTrips = 0; st.reached = '—';
      st.rng = K.rng(st.seed >>> 0);
      resetRows(); render();

      const drop = Math.max(0, Math.min(N, st.drop));
      const slow = chooseSlow(drop);
      const answering = N - drop;
      K.addLog(logBody, `Prepare fan-out → all ${N} replicas (seed ${st.seed}; slow: ${[...slow].map((i) => 'r' + i).join(',') || 'none'})`, 'hl');

      // ---- Round 1: Prepare to all replicas ----
      const ok1 = await prepareRound(Array.from({ length: N }, (_, i) => i), slow, 'round 1: Prepare');
      K.addLog(logBody, `round 1: ${ok1.length}/${N} replied Ok`, ok1.length >= SLOW_Q ? 'ok' : 'warn');

      // FAST path: fast quorum on the first round trip ⇒ commit immediately.
      if (ok1.length >= FAST_Q) {
        st.reached = `fast (${ok1.length}≥${FAST_Q})`;
        setPhase('COMMIT (fast)', c.green);
        K.addLog(logBody, `fast quorum ${ok1.length} ≥ ${FAST_Q} → commit in 1 round trip · ts is a high-water mark`, 'ok');
        render(); await K.delay(280);
        return finish();
      }

      // SLOW path: missed fast quorum but a simple majority answered ⇒ second round, then commit.
      if (answering >= SLOW_Q) {
        K.addLog(logBody, `fast quorum missed (${ok1.length} < ${FAST_Q}) — fall back to slow path`, 'warn');
        await K.delay(220);
        // re-send to the stragglers; in this round they answer (the second round trip).
        const stragglers = Array.from({ length: N }, (_, i) => i).filter((i) => slow.has(i));
        const ok2 = await prepareRound(stragglers, new Set(), 'round 2: Prepare (slow)');
        const total = ok1.length + ok2.length;
        st.reached = `slow (${SLOW_Q})`;
        setPhase('COMMIT (slow)', c.purple);
        K.addLog(logBody, `slow quorum f+1=${SLOW_Q} met after 2nd round (${total}/${N}) → commit`, 'ok');
        render(); await K.delay(280);
        return finish();
      }

      // STALL: not even the slow quorum is reachable.
      st.reached = 'none — stalled';
      setPhase('stalled', c.red);
      K.addLog(logBody, `only ${answering} reachable < slow quorum ${SLOW_Q} — stalled, waiting for quorum`, 'err');
      render();
      finish();
    }

    function finish() { st.busy = false; setLock(false); }

    function bind() {
      root.querySelector('.t-commit').onclick = commit;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-drop').onchange = (e) => {
        st.drop = Math.max(0, Math.min(N, parseInt(e.target.value, 10) || 0));
        e.target.value = st.drop; reset();
      };
      root.querySelector('.t-seed').onchange = (e) => { st.seed = parseInt(e.target.value, 10) || 0; reset(); };
    }

    function reset() {
      st.busy = false; st.roundTrips = 0; st.reached = '—'; st.rng = K.rng(st.seed >>> 0);
      setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}, dropping ${st.drop} · same seed ⇒ same replicas slow`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-commit', '.t-reset', '.t-drop', '.t-seed'], b); }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.DSTTapirCommit = { init };
})();
