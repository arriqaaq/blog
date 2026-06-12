(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('ds-commit: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('ds-commit: dst-kit required'); return; }
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
        title: 'DS commit — no leader on the normal path',
        sub: `client asks all ${N} replicas · ${FAST_Q} agree → commit in 1 trip · ${SLOW_Q} → maybe a 2nd · fewer → stuck`,
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [
          { id: 'reps', label: 'replicas' },
          { id: 'quorum', label: 'quorum reached' },
          { id: 'rt', label: 'round-trips' },
        ],
        cap: 'Supermajority ⇒ commit in one round trip; a simple majority commits from the replies ' +
          'already in hand (a 2nd round trip only if too few arrived); no leader on the normal path. ' +
          '<span style="opacity:.8">View changes pick a deterministic merge leader <code>view % N</code> ' +
          '— only off this path. Committed timestamps never regress: <code>highest_committed</code> is a ' +
          'high-water mark.</span>',
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
        .textContent = `= ${SLOW_Q}  →  slow-path commit`;
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
    // loud outcome banner across the top — the takeaway of a Commit
    function verdict(txt, zone) {
      const old = svg.querySelector('#' + CSS.escape(uid + '-verdict')); if (old) old.remove();
      const col = c[zone], cxm = (clientCx + REP.x) / 2, bw = 320, bx = cxm - bw / 2, by = 6;
      const g = K.el('g', { id: uid + '-verdict', opacity: 0 }, content);
      K.el('rect', { x: bx, y: by, width: bw, height: 30, rx: 8, fill: K.grad(uid, zone), stroke: col, 'stroke-width': 1.8, filter: K.glow(uid) }, g);
      K.el('text', { x: cxm, y: by + 20, 'text-anchor': 'middle', fill: col, 'font-size': 13, 'font-weight': 700 }, g).textContent = txt;
      animate(g, { opacity: [0, 1], duration: 260, ease: 'out(2)' });
    }
    function resetRows() {
      for (let i = 0; i < N; i++) {
        const rl = E('rlbl', i); if (rl) { rl.textContent = '—'; rl.setAttribute('fill', c.muted); }
        const r = E('rep', i); if (r) { r.setAttribute('stroke', c.blue); r.setAttribute('fill', K.grad(uid, 'blue')); }
        const d = E('dot', i); if (d) d.setAttribute('fill', c.blue);
      }
    }

    // Deterministically choose WHICH replies are lost this round from the seed: shuffle ids, take k.
    // A 2nd round trip can only rescue *transient* losses; a replica that is genuinely DOWN stays
    // silent on the retry too. The cluster tolerates f down replicas, so model the first
    // max(0, k - f) of the lost replies as down (never answer) and the rest as transiently slow
    // (answer on the retry). This keeps every outcome reachable: ≤f lost → retry forms the quorum
    // (2 trips); >f down → even the retry can't reach f+1 → stall.
    function chooseLost(k) {
      const ids = Array.from({ length: N }, (_, i) => i);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(st.rng() * (i + 1));
        const t = ids[i]; ids[i] = ids[j]; ids[j] = t;
      }
      const lost = ids.slice(0, k);
      const nDown = Math.max(0, k - F);          // losses beyond the f the cluster tolerates are "down"
      return { lost: new Set(lost), down: new Set(lost.slice(0, nDown)) };
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
          if (rl) { rl.textContent = 'no reply'; rl.setAttribute('fill', c.red); }
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
      const ov = svg.querySelector('#' + CSS.escape(uid + '-verdict')); if (ov) ov.remove();

      const drop = Math.max(0, Math.min(N, st.drop));
      const { lost, down } = chooseLost(drop);
      const downNote = down.size ? `; down (>f, never answer): ${[...down].map((i) => 'r' + i).join(',')}` : '';
      K.addLog(logBody, `Prepare fan-out → all ${N} replicas (seed ${st.seed}; lost: ${[...lost].map((i) => 'r' + i).join(',') || 'none'}${downNote})`, 'hl');

      // ---- Round 1: Prepare to all replicas ----
      const ok1 = await prepareRound(Array.from({ length: N }, (_, i) => i), lost, 'round 1: Prepare');
      K.addLog(logBody, `round 1: ${ok1.length}/${N} replied Ok`, ok1.length >= SLOW_Q ? 'ok' : 'warn');

      // FAST path: fast quorum on the first round trip ⇒ commit immediately.
      if (ok1.length >= FAST_Q) {
        st.reached = `fast (${ok1.length}≥${FAST_Q})`;
        setPhase('COMMIT (fast)', c.green);
        verdict('✓ COMMIT · 1 round trip', 'green');
        K.addLog(logBody, `fast quorum ${ok1.length} ≥ ${FAST_Q} → commit in 1 round trip · ts is a high-water mark`, 'ok');
        render(); await K.delay(280);
        return finish();
      }

      // SLOW path, replies already in hand: fast quorum missed, but the slow quorum is satisfied by
      // the round-1 replies ⇒ decide from those, NO second round trip (client.rs:282-293).
      if (ok1.length >= SLOW_Q) {
        st.reached = `slow (${ok1.length}≥${SLOW_Q})`;
        setPhase('COMMIT (slow)', c.purple);
        verdict('✓ COMMIT · slow quorum, 1 trip', 'purple');
        K.addLog(logBody, `fast quorum missed (${ok1.length} < ${FAST_Q}); slow quorum f+1=${SLOW_Q} already in hand → commit, still 1 round trip`, 'ok');
        render(); await K.delay(280);
        return finish();
      }

      // SLOW path, too few replies: re-send to the ones whose reply was lost (a 2nd round trip);
      // commit only if the retry collects the slow quorum (client.rs:286-293, send_until_quorum).
      // Transiently-slow replicas answer the retry; genuinely-down ones (`down`) stay silent, so
      // the retry forms a quorum only when at most f replicas are actually down.
      const stragglers = Array.from({ length: N }, (_, i) => i).filter((i) => lost.has(i));
      if (stragglers.length) {
        K.addLog(logBody, `fast & slow quorum missed in round 1 (${ok1.length} < ${SLOW_Q}) — re-send to non-responders (2nd round trip)`, 'warn');
        await K.delay(220);
        const ok2 = await prepareRound(stragglers, down, 'round 2: Prepare (retry)');
        const total = ok1.length + ok2.length;
        if (total >= SLOW_Q) {
          st.reached = `slow (${total}≥${SLOW_Q})`;
          setPhase('COMMIT (slow)', c.purple);
          verdict('✓ COMMIT · slow quorum, 2 trips', 'purple');
          K.addLog(logBody, `slow quorum f+1=${SLOW_Q} met after 2nd round (${total}/${N}) → commit`, 'ok');
          render(); await K.delay(280);
          return finish();
        }
      }

      // STALL: not even the slow quorum is reachable — more than f replicas are down.
      st.reached = 'none — stalled';
      setPhase('stalled', c.red);
      verdict('✗ STALLED · no quorum', 'red');
      K.addLog(logBody, `>${F} replicas down → slow quorum f+1=${SLOW_Q} unreachable even after retry — stalled, waiting for quorum`, 'err');
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

  window.DSTCommit = { init };
})();
