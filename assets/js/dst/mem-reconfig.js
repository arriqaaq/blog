/**
 * MEM Reconfig (dst-kit) — growing and shrinking a voting set safely.
 *
 * The other kind of membership: not "who is up?" but "who forms the replicated store, and which
 * of them vote?" That is an agreed, versioned configuration, and the only rule that matters at
 * this level is that each installed view keeps an old majority, so consecutive quorums overlap.
 *
 *   • Voters vote and count toward the quorum (a majority: ⌊n/2⌋+1 of the voters).
 *   • Learners receive data and catch up, but do NOT vote yet — the staging state for a join.
 *   • A new node joins as a learner (quorum unchanged); the leader promotes it to voter
 *     automatically once it is caught up — one promotion per view, so the set grows 3 → 4 → 5.
 *   • A voter is removed only while the retained voters still hold a majority of the old set,
 *     which can retire more than one at once (5 → 3 keeps an old majority). Each installed view
 *     overlaps the last, so no committed write is orphaned.
 *   • Adds and removes are driven by an operator reloading the cluster config; promotion is the
 *     leader's, automatic.
 *
 * Exposes window.MEMReconfig.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-reconfig: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-reconfig: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 300, MAXN = 7;
  const SLOTX = (i) => 70 + i * 96;
  const NY = 150, NR = 26;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    // nodes: { id, role: 'voter'|'learner', caught } ; view number; next label counter
    const fresh = () => ({
      view: 3,
      nodes: [
        { id: 'a', role: 'voter', caught: true },
        { id: 'b', role: 'voter', caught: true },
        { id: 'c', role: 'voter', caught: true },
      ],
      nextLetter: 3, // 'd'
      busy: false, speed: 1,
    });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const voters = () => st.nodes.filter((n) => n.role === 'voter');
    const learners = () => st.nodes.filter((n) => n.role === 'learner');
    const quorum = () => Math.floor(voters().length / 2) + 1;

    build();

    function controls() {
      return `<div class="dstk-tgroup"><span class="dstk-tlabel">operator · config reload</span>
        <button class="dstk-btn dstk-btn--blue t-add">＋ add node</button>
        <button class="dstk-btn dstk-btn--red t-remove">✕ remove a voter</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">leader promotes learners automatically</span></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Growing a voting set safely', sub: 'join as a learner, get promoted, one change per view',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'view', label: 'view' }, { id: 'voters', label: 'voters' }, { id: 'learners', label: 'learners' }, { id: 'quorum', label: 'quorum' }],
        cap: 'A new node joins as a learner — it receives data and catches up but does not vote, so the quorum is '
           + 'unchanged. Once it is current the leader promotes it automatically and the voting set grows by one (the '
           + 'view number bumps). A voter is removed only while the retained voters still hold a majority of the old '
           + 'set, so the quorums before and after the change always share a member. The operator adds and removes '
           + 'nodes by reloading the cluster config; promotion is the leader’s.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 three voters, quorum 2. Add a node — it joins as a learner (quorum unchanged), then the leader promotes it automatically.', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      // header row: view badge + quorum readout
      K.el('rect', { x: 40, y: 24, width: 96, height: 30, rx: 8, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6 }, content);
      K.el('text', { id: `${uid}-viewbadge`, x: 88, y: 44, 'text-anchor': 'middle', fill: c.amber, 'font-size': 13, 'font-weight': 700 }, content).textContent = 'view ' + st.view;
      K.el('text', { id: `${uid}-qread`, x: 152, y: 44, fill: c.text, 'font-size': 11, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
      K.el('text', { x: W - 40, y: 44, 'text-anchor': 'end', fill: c.muted, 'font-size': 9.5 }, content).textContent = 'operator reloads config; the leader promotes learners';
      // legend
      K.el('circle', { cx: 54, cy: 268, r: 8, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 2 }, content);
      K.el('text', { x: 68, y: 272, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'voter (counts toward quorum)';
      K.el('circle', { cx: 300, cy: 268, r: 8, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 2, 'stroke-dasharray': '3,2' }, content);
      K.el('text', { x: 314, y: 272, fill: c.muted, 'font-size': 9.5 }, content).textContent = 'learner (catching up · does not vote)';
      K.el('g', { id: `${uid}-nodes` }, content);
      K.el('text', { id: `${uid}-note`, x: W / 2, y: 214, 'text-anchor': 'middle', fill: c.muted, 'font-size': 11, 'font-weight': 700 }, content).textContent = '';
      redrawNodes();
    }

    function redrawNodes() {
      const g = E('nodes'); g.innerHTML = '';
      st.nodes.forEach((n, i) => {
        const x = SLOTX(i), zone = n.role === 'voter' ? 'green' : 'blue';
        K.el('circle', { id: `${uid}-n-${n.id}`, cx: x, cy: NY, r: NR, fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 2.4,
          'stroke-dasharray': n.role === 'learner' ? '5,4' : 'none' }, g);
        K.el('text', { x, y: NY + 5, 'text-anchor': 'middle', fill: c.text, 'font-size': 15, 'font-weight': 700 }, g).textContent = n.id;
        const tag = n.role === 'voter' ? 'voter'
          : (n.caught ? 'learner ✓ caught up' : 'learner · catching up');
        K.el('text', { x, y: NY + NR + 16, 'text-anchor': 'middle', fill: n.role === 'voter' ? c.green : c.blue, 'font-size': 8.5, 'font-weight': 700 }, g).textContent = tag;
      });
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('view', st.view); stat('voters', voters().length); stat('learners', learners().length); stat('quorum', quorum());
      const q = E('qread'); if (q) q.textContent = `quorum = ⌊${voters().length}/2⌋+1 = ${quorum()} voters`;
      const vb = E('viewbadge'); if (vb) vb.textContent = 'view ' + st.view;
    }

    function pulse(id, color) {
      const e = E('n-' + id); if (!e) return;
      e.setAttribute('stroke', color); e.setAttribute('filter', K.glow(uid));
      animate(e, { r: [NR, NR + 5, NR], duration: dur(460), ease: 'inOut(2)', onComplete: () => e.removeAttribute('filter') });
    }
    function note(msg, color) {
      const n = E('note'); if (!n) return;
      n.textContent = msg; n.setAttribute('fill', color || c.muted);
      animate(n, { opacity: [0.3, 1], duration: dur(300), ease: 'out(2)' });
    }
    function overlapFlash(prevVoters, newVoters) {
      // a voter present in both a majority of the old set and a majority of the new set
      const shared = prevVoters.find((id) => newVoters.includes(id));
      if (!shared) return;
      pulse(shared, c.amber);
      note(`view ${st.view - 1} → ${st.view}: the quorums overlap at ${shared} — safe`, c.amber);
      // the arithmetic behind that overlap: q_old + q_new must exceed the size of the set the two
      // quorums live in — the union of old and new voters (the larger of the two, since one ⊆ other).
      // Using |V_new| would be wrong for a shrink, where the union is the old (larger) set.
      const qOld = Math.floor(prevVoters.length / 2) + 1;
      const qNew = Math.floor(newVoters.length / 2) + 1;
      const vAll = Math.max(prevVoters.length, newVoters.length);
      K.addLog(logBody, `overlap check: q_old ${qOld} + q_new ${qNew} = ${qOld + qNew} > |V| ${vAll} → the quorums share ≥ ${qOld + qNew - vAll} voter`, 'ok');
    }

    function addNode() {
      if (st.busy) return;
      if (st.nodes.length >= MAXN) { K.addLog(logBody, 'that is plenty of nodes for a demo — remove or reset first', 'warn'); return; }
      const id = String.fromCharCode(97 + st.nextLetter++);
      st.nodes.push({ id, role: 'learner', caught: false });
      redrawNodes(); render();
      pulse(id, c.blue);
      note(`${id} joins as a learner — quorum still ${quorum()}`, c.blue);
      K.addLog(logBody, `operator adds ${id} (config reload): it joins as a LEARNER — receives data, catches up, does not vote. Quorum unchanged.`, 'hl');
      // catch up shortly after, then the leader promotes it automatically
      setTimeout(() => {
        const n = st.nodes.find((x) => x.id === id);
        if (n && n.role === 'learner') {
          n.caught = true; redrawNodes();
          K.addLog(logBody, `${id} has caught up — the leader promotes it automatically`, 'ok');
          leaderPromote(id);
        }
      }, dur(700));
    }

    // The leader promotes a caught-up learner — automatic, one promotion per view.
    function leaderPromote(id) {
      const l = st.nodes.find((n) => n.id === id && n.role === 'learner');
      if (!l || !l.caught) return;
      const prevVoters = voters().map((n) => n.id);
      l.role = 'voter';
      st.view++;
      redrawNodes(); render();
      pulse(l.id, c.green);
      overlapFlash(prevVoters, voters().map((n) => n.id));
      K.addLog(logBody, `leader promotes ${l.id} to VOTER in view ${st.view} — automatic, one per view; voting set now ${voters().length}, quorum ${quorum()}`, 'ok');
    }

    function removeVoter() {
      if (st.busy) return;
      const vs = voters();
      if (vs.length <= 3) { K.addLog(logBody, 'three voters is the floor here — a smaller set cannot tolerate a failure', 'warn'); return; }
      // safe to remove one iff retained voters still hold an old majority
      const oldMajority = Math.floor(vs.length / 2) + 1;
      const retained = vs.length - 1;
      if (retained < oldMajority) {
        note(`that removal would drop below an old majority — not allowed`, c.red);
        K.addLog(logBody, `refused: removing would leave ${retained} voters, fewer than a majority of the old set (${oldMajority}); a removal must keep an old majority so consecutive quorums still overlap.`, 'err');
        return;
      }
      const gone = vs[vs.length - 1];
      const prevVoters = vs.map((n) => n.id);
      st.nodes = st.nodes.filter((n) => n.id !== gone.id);
      st.view++;
      redrawNodes(); render();
      overlapFlash(prevVoters, voters().map((n) => n.id));
      K.addLog(logBody, `operator removes ${gone.id} (config reload) in view ${st.view} — ${retained} voters remain, still holding an old majority, so the quorums overlap`, 'ok');
    }

    function reset() {
      if (st.busy) return;
      const sp = st.speed;
      st = fresh(); st.speed = sp;
      anim.innerHTML = ''; drawScene(); render();
      K.addLog(logBody, '↺ reset — back to three voters at view 3', 'hl');
    }

    function bind() {
      root.querySelector('.t-add').onclick = addNode;
      root.querySelector('.t-remove').onclick = removeVoter;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMReconfig = { init };
})();
