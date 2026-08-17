/**
 * SKV Moving Base (dst-kit) — a merge base that moves, and what happens without the promotion edge.
 *
 * The post's point: a three-way merge needs the state the two branches last AGREED on. That is the
 * fork anchor exactly once; afterwards it is the recorded promotion edge. surrealkv's EffectiveBase
 * carries three sequences, not one: `fork_at` (the original divergence, which a scan probe must cover
 * from), `source_through` (the source snapshot at this cap IS the base side of the comparison), and
 * `target_at` (durable edge history, reported to callers, and explicitly NOT a source-side base value).
 * The reason the target head cannot serve as the base: merging into a target never mutates the source,
 * so target-only values present at that edge were never incorporated into source history — treating
 * them as a common base makes a later source edit look uncontested and overwrites the target.
 * Turn the edge off, merge twice, and watch the second merge re-litigate the first.
 * Exposes window.SKVMovingBase.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-moving-base: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-moving-base: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 344;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const KEYS = ['user:1', 'user:2', 'user:3', 'user:4', 'user:5'];
  const VALS = ['"alpha"', '"beta"', '"gamma"', '"delta"', '"omega"'];
  const LANE = { x: 18, w: 744, ty: 48, sy: 102, h: 46, plate: 104 };
  const TBL = { y: 196, rh: 24 };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    // The seed varies which key each write touches and what value it writes — hence which keys
    // converge (both sides wrote the same bytes), which conflict, and which apply cleanly. The
    // classification table itself is fixed; the seed only decides which rows of it you land on.
    function fresh(seed) {
      const rng = K.rng(seed);
      const atFork = {};
      for (const k of KEYS) atFork[k] = VALS[Math.floor(rng() * VALS.length)];
      const forkAt = 8;
      return { seed, rng, atFork, seq: forkAt, forkAt,
               srcWrites: {}, tgtWrites: {},
               base: { fork_at: forkAt, source_through: forkAt, target_at: forkAt },
               edge: true, strategy: 'Strict', rows: [], merges: 0, mergedKeys: [],
               applied: 0, converged: 0, conflicts: 0,
               busy: false, playing: false, speed: 1 };
    }
    let st = fresh(7);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    const maxSeq = () => Math.max(st.seq, 34) + 4;
    const X = (s) => LANE.x + LANE.plate + 18 + (s / maxSeq()) * (LANE.w - LANE.plate - 46);

    // ---- the classifier -----------------------------------------------------------------
    function srcBaseVal(k) {
      const w = st.srcWrites[k];
      return (w && w.seq <= st.base.source_through) ? w.val : st.atFork[k];
    }
    function targetNow(k) { return st.tgtWrites[k] ? st.tgtWrites[k].val : st.atFork[k]; }

    function plan() {
      const out = [];
      for (const k of KEYS) {
        const sw = st.srcWrites[k];
        if (!sw || sw.seq <= st.base.source_through) continue;   // nothing new from the source
        const base = srcBaseVal(k);
        const tgt = targetNow(k);
        const tw = st.tgtWrites[k];
        // a scan probe covers every target write above the ORIGINAL divergence, not above the edge
        const targetMoved = !!tw && tw.seq > st.base.fork_at;
        let verdict;
        if (!targetMoved) verdict = 'apply';
        else if (tgt === base) verdict = 'apply';
        else if (sw.val === tgt) verdict = 'converged';
        else verdict = 'conflict';
        out.push({ key: k, base, src: sw.val, tgt, verdict, targetMoved });
      }
      return out;
    }

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--blue t-wsrc">＋ Write on source</button>
        <button class="dstk-btn dstk-btn--green t-wtgt">＋ Write on target</button>
        <button class="dstk-btn dstk-btn--purple t-merge">⇉ Merge</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">strategy</span>
          <select class="t-strategy">
            <option value="Strict" selected>Strict</option>
            <option value="SourceWins">SourceWins</option>
            <option value="TargetWins">TargetWins</option></select></div>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--amber t-edge">🔗 Promotion edge: on</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}" min="1" max="999" style="width:4.2rem"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'A merge base that moves', sub: 'fork_at · source_through · target_at',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'applied', label: 'applied' }, { id: 'converged', label: 'converged' },
                { id: 'conflicts', label: 'conflicts' }, { id: 'merges', label: 'merges' }],
        cap: 'Write on the source, merge, write on the target, merge again. With the promotion edge ON the second '
           + 'merge considers only what the source has done since the first. Turn it OFF and the second merge '
           + 're-offers everything the first one applied — and the keys the target has legitimately edited since '
           + 'come back as conflicts that were already settled.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      st.rows = plan();
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 write on source → merge → write on target → merge. Then do it again with the edge off.', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function drawScene() {
      content.innerHTML = '';
      const intro = K.el('text', { x: 18, y: 18, 'font-size': 10.5, fill: c.muted }, content);
      intro.textContent = 'The base is where the two branches last agreed — and after the first merge, that is not the fork point.';

      // lanes
      const lanes = [[LANE.ty, 'green', 'main', 'target', st.tgtWrites], [LANE.sy, 'blue', 'feature', 'source', st.srcWrites]];
      for (const [y, zone, name, role, writes] of lanes) {
        K.el('rect', { x: LANE.x, y, width: LANE.w, height: LANE.h, rx: 7, fill: 'none',
          stroke: c.separator, 'stroke-width': 1 }, content);
        K.el('rect', { x: LANE.x + 6, y: y + 7, width: LANE.plate - 12, height: LANE.h - 14, rx: 5,
          fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.3 }, content);
        const nm = K.el('text', { x: LANE.x + 14, y: y + 21, 'font-size': 10.5, 'font-weight': 700,
          fill: c[zone], 'font-family': MONO }, content);
        nm.textContent = name;
        const rl = K.el('text', { x: LANE.x + 14, y: y + 33, 'font-size': 8.5, fill: c[zone], opacity: 0.8 }, content);
        rl.textContent = role;
        for (const k of KEYS) {
          const wr = writes[k]; if (!wr) continue;
          const x = X(wr.seq);
          K.el('circle', { cx: x, cy: y + 20, r: 7.5, fill: K.grad(uid, zone), stroke: c[zone],
            'stroke-width': 1.5 }, content);
          const t = K.el('text', { x, y: y + 37, 'text-anchor': 'middle', 'font-size': 8,
            fill: c.muted, 'font-family': MONO }, content);
          t.textContent = k.replace('user:', 'k');
        }
      }

      // the three base marks
      const marks = [
        [st.base.fork_at, 'fork_at', 'gray', 'original divergence — a scan probe covers target writes above this'],
        [st.base.source_through, 'source_through', 'purple', 'the source snapshot here IS the base side'],
        [st.base.target_at, 'target_at', 'amber', 'durable edge history — not a base value'],
      ];
      let ly = 168;
      const seen = {};
      for (const [s, nm, zone, note] of marks) {
        const x = X(s);
        const dashed = zone === 'gray';
        const off = seen[s] ? (seen[s] * 3) : 0; seen[s] = (seen[s] || 0) + 1;
        K.el('line', { x1: x + off, y1: LANE.ty - 8, x2: x + off, y2: LANE.sy + LANE.h + 6,
          stroke: zone === 'purple' ? c.purple : c[zone], 'stroke-width': 2,
          'stroke-dasharray': dashed ? '5 4' : '' }, content);
        K.el('rect', { x: 172, y: ly - 13, width: 148, height: 18, rx: 4, fill: K.grad(uid, zone),
          stroke: zone === 'purple' ? c.purple : c[zone], 'stroke-width': 1.2 }, content);
        const t = K.el('text', { x: 180, y: ly, 'font-size': 9.5, 'font-weight': 700,
          fill: zone === 'purple' ? c.purple : c[zone], 'font-family': MONO }, content);
        t.textContent = `${nm} = ${s}`;
        const n = K.el('text', { x: 330, y: ly, 'font-size': 9.5, fill: c.muted }, content);
        n.textContent = note;
        ly += 22;
      }
      const el = K.el('text', { x: 18, y: 168, 'font-size': 9.5, 'font-weight': 700,
        fill: st.edge ? c.amber : c.red }, content);
      el.textContent = st.edge ? 'EffectiveBase' : 'edge OFF';

      // decision table
      const hy = TBL.y - 8;
      const cols = [[26, 'key'], [110, 'at base'], [250, 'source'], [390, 'target now'], [530, 'verdict']];
      for (const [x, t] of cols) {
        const e = K.el('text', { x, y: hy, 'font-size': 9, fill: c.muted, 'font-family': MONO }, content);
        e.textContent = t;
      }
      if (!st.rows.length) {
        const e = K.el('text', { x: 26, y: TBL.y + 16, 'font-size': 10, fill: c.muted }, content);
        e.textContent = st.merges
          ? 'nothing new from the source since the recorded edge — the base moved, so this merge has no work to do'
          : 'no source changes above the base yet — write on the source';
      }
      st.rows.slice(0, 5).forEach((r, i) => {
        const y = TBL.y + i * TBL.rh;
        const col = r.verdict === 'conflict' ? c.red : r.verdict === 'converged' ? c.gray : c.green;
        const zone = r.verdict === 'conflict' ? 'red' : r.verdict === 'converged' ? 'gray' : 'green';
        K.el('rect', { x: 18, y, width: 744, height: 21, rx: 4, fill: K.grad(uid, zone),
          stroke: col, 'stroke-width': 1.1 }, content);
        const cells = [[26, r.key], [110, r.base], [250, r.src], [390, r.tgt],
          [530, r.verdict === 'conflict' ? 'conflict · both modified' : r.verdict]];
        for (const [x, t] of cells) {
          const e = K.el('text', { x, y: y + 14, 'font-size': 9.5, fill: col, 'font-family': MONO }, content);
          e.textContent = t;
        }
      });

      const foot = K.el('text', { x: 18, y: Hh - 8, 'font-size': 9.5, fill: c.muted }, content);
      foot.textContent = 'Absence counts as a value throughout, which is what makes delete-vs-delete converge and delete-vs-modify conflict with no special cases.';
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      stat('applied', st.applied); stat('converged', st.converged);
      stat('conflicts', st.conflicts); stat('merges', st.merges);
    }

    // ---- actions ------------------------------------------------------------------------
    function pickKey() { return KEYS[Math.floor(st.rng() * KEYS.length)]; }
    function pickVal() { return VALS[Math.floor(st.rng() * VALS.length)]; }

    // A target write prefers a key some earlier merge already applied. Those are the keys where
    // turning the promotion edge off re-raises a conflict that was already settled, which is the
    // case worth reaching. Tracked directly rather than derived from source_through, because with
    // the edge off that cursor never advances and no key would ever look settled.
    function pickTargetKey() {
      const settled = KEYS.filter((k) => st.mergedKeys.includes(k));
      if (settled.length && st.rng() < 0.7) return settled[Math.floor(st.rng() * settled.length)];
      return pickKey();
    }

    // On a settled key the target's value must differ from BOTH the fork value and the source's,
    // or the comparison lands on apply/converged instead of the conflict this is meant to show.
    function pickTargetVal(k) {
      const avoid = [st.atFork[k], st.srcWrites[k] && st.srcWrites[k].val].filter(Boolean);
      const free = VALS.filter((v) => !avoid.includes(v));
      return free.length ? free[Math.floor(st.rng() * free.length)] : pickVal();
    }

    async function writeOn(side) {
      if (st.busy) return; st.busy = true; setLock(true);
      const k = side === 'src' ? pickKey() : pickTargetKey();
      const v = side === 'src' ? pickVal() : pickTargetVal(k);
      st.seq += 1;
      (side === 'src' ? st.srcWrites : st.tgtWrites)[k] = { val: v, seq: st.seq };
      st.rows = plan();
      drawScene(); render();
      K.addLog(logBody, `＋ ${side === 'src' ? 'feature' : 'main'} wrote ${k} = ${v} at sequence ${st.seq}`, 'ok');
      await K.delay(dur(300));
      st.busy = false; setLock(false);
    }

    async function merge() {
      if (st.busy) return; st.busy = true; setLock(true);
      const rows = plan();
      st.rows = rows;
      const conflicts = rows.filter((r) => r.verdict === 'conflict');
      const applies = rows.filter((r) => r.verdict === 'apply');
      const conv = rows.filter((r) => r.verdict === 'converged');
      const srcHead = st.seq;

      if (!rows.length) {
        drawScene(); render();
        K.addLog(logBody, st.merges
          ? `⇉ nothing to merge: the base sits at source_through ${st.base.source_through}, and the source has written nothing above it`
          : '⇉ nothing to merge — the source has no changes yet', 'warn');
        await K.delay(dur(300)); st.busy = false; setLock(false); return;
      }

      if (conflicts.length && st.strategy === 'Strict') {
        st.conflicts += conflicts.length;
        drawScene(); render();
        const names = conflicts.map((r) => r.key).join(', ');
        K.addLog(logBody, `⇉ Strict refused: MergeConflicts { count: ${conflicts.length} } on ${names} — `
          + `nothing was written, which is the point of the default`, 'err');
        await K.delay(dur(420)); st.busy = false; setLock(false); return;
      }

      // apply
      let wrote = 0;
      for (const r of rows) {
        let take = null;
        if (r.verdict === 'apply') take = r.src;
        else if (r.verdict === 'converged') take = null;
        else if (r.verdict === 'conflict') take = st.strategy === 'SourceWins' ? r.src : null;
        if (take != null && take !== r.tgt) { st.seq += 1; st.tgtWrites[r.key] = { val: take, seq: st.seq }; wrote++; }
        if (r.verdict === 'apply' && !st.mergedKeys.includes(r.key)) st.mergedKeys.push(r.key);
      }
      st.applied += applies.length; st.converged += conv.length;
      if (conflicts.length) st.conflicts += conflicts.length;
      st.merges += 1;

      if (st.edge) {
        st.base = { fork_at: st.base.fork_at, source_through: srcHead, target_at: st.seq };
      }
      st.rows = plan();
      drawScene(); render();

      const resolvedNote = conflicts.length
        ? `, ${conflicts.length} resolved by ${st.strategy}` : '';
      if (st.edge) {
        K.addLog(logBody, `⇉ merged: ${applies.length} applied, ${conv.length} converged${resolvedNote} — `
          + `the base moved to source_through ${srcHead} / target_at ${st.seq}, so the next merge measures from here`, 'ok');
      } else {
        K.addLog(logBody, `🔗 edge OFF: the base stayed at the fork point, so this merge re-offered `
          + `${rows.length} ${rows.length === 1 ? 'key' : 'keys'}${conflicts.length ? ` and raised ${conflicts.length} conflict(s) that a previous merge already settled` : ''}`, 'err');
      }
      await K.delay(dur(460));
      st.busy = false; setLock(false);
    }

    function toggleEdge() {
      st.edge = !st.edge;
      root.querySelector('.t-edge').textContent = `🔗 Promotion edge: ${st.edge ? 'on' : 'off'}`;
      if (!st.edge) st.base = { fork_at: st.forkAt, source_through: st.forkAt, target_at: st.forkAt };
      st.rows = plan();
      drawScene(); render();
      K.addLog(logBody, st.edge
        ? '🔗 promotion edge on — the base will advance with each merge'
        : '🔗 promotion edge off — the base is pinned to the fork point. Merge again and watch it re-litigate.', 'hl');
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      const script = ['src', 'src', 'merge', 'tgt', 'src', 'merge', 'tgt', 'merge'];
      let i = 0;
      while (st.playing) {
        const a = script[i % script.length]; i++;
        if (a === 'merge') await merge(); else await writeOn(a);
        if (!st.playing) break;
        await K.delay(dur(680));
      }
    }
    function pause() { st.playing = false; pp(); }

    function reset() {
      const sp = st.speed, edge = st.edge, strat = st.strategy;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 7;
      st = fresh(seed);
      st.speed = sp; st.edge = edge; st.strategy = strat;
      if (!edge) st.base = { fork_at: st.forkAt, source_through: st.forkAt, target_at: st.forkAt };
      root.querySelector('.t-strategy').value = strat;
      root.querySelector('.t-edge').textContent = `🔗 Promotion edge: ${edge ? 'on' : 'off'}`;
      st.rows = plan();
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset to seed ${seed} — same keys, same values, same verdicts`, 'hl');
    }

    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-wsrc', '.t-wtgt', '.t-merge', '.t-strategy', '.t-edge', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-wsrc').onclick = () => writeOn('src');
      root.querySelector('.t-wtgt').onclick = () => writeOn('tgt');
      root.querySelector('.t-merge').onclick = merge;
      root.querySelector('.t-edge').onclick = toggleEdge;
      root.querySelector('.t-strategy').onchange = (e) => {
        st.strategy = e.target.value;
        K.addLog(logBody, `⇄ strategy → ${st.strategy}`
          + (st.strategy === 'Strict' ? ' — refuses the whole merge on any conflict' : ' — resolves conflicts without asking'), 'hl');
      };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-seed').onchange = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value) || 1; };
    }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.SKVMovingBase = { init };
})();
