/**
 * SKV Compaction Pins (dst-kit) — one compaction job over one key's version chain, with fork
 * anchors sitting between versions.
 *
 * Compaction's ordinary job is to discard superseded versions; a live fork anchor says some
 * superseded version is still somebody's current value. The job runs in four stages —
 * SAMPLE → MERGE → DECIDE → PUBLISH — and the widget shows, per version, whether it is dropped or
 * retained and which anchor forced the retention. Anchors descend and versions arrive newest-first,
 * so one index over both lists is enough (AnchorWalker::serves in src/branch.rs).
 *
 * Two switches make points the prose also makes:
 *   • anchors: none — the output is the same set of versions a store that never forked would
 *     produce, because the pin is an override layer that only ever ADDS retention.
 *   • mid-job anchor — an anchor lands after this job sampled, so at PUBLISH appeared_since finds
 *     it and the output is refused (Error::CompactionPinRaced); the inputs stay live for the next
 *     cycle. An anchor that vanished would be harmless: the job merely over-retained.
 *
 * Every stage is recomputed from the seed and the switches, so Back is exact.
 * Exposes window.SKVCompactionPins.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-compaction-pins: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-compaction-pins: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 352;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const STRIP = { x: 20, y: 8, w: 740, h: 22 };
  const VN = 6, VW = 80, VGAP = 26, VX0 = 132;
  const VY = 52, VH = 34;
  const SET = { x: 20, y: 110, w: 740, h: 54 };
  const DY = 182, DH = 34;
  const OUT = { x: 20, y: 226, w: 740, h: 60 };
  const BAN = { x: 20, y: 306, w: 740, h: 30 };
  const STAGES = ['SAMPLE', 'MERGE', 'DECIDE', 'PUBLISH'];
  const vx = (d) => VX0 + d * (VW + VGAP);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    // ---- deterministic scene ------------------------------------------------------------
    // The seed varies the six sequences (gaps never 1, so an anchor can always land strictly
    // between two versions), which gaps the two anchors sit in, and which gap the late anchor
    // lands in. It varies nothing about the retention arithmetic.
    function fresh(seed, opts) {
      const o = opts || {};
      const rng = K.rng(seed);
      const asc = [];
      let s = 5 + Math.floor(rng() * 5);
      for (let i = 0; i < VN; i++) {
        asc.push({ label: 'v' + (i + 1), seq: s });
        s += 3 + Math.floor(rng() * 5);
      }
      // two anchors, in two different gaps, strictly between the versions that bound them
      const gaps = [0, 1, 2, 3, 4];
      const g1 = gaps.splice(Math.floor(rng() * gaps.length), 1)[0];
      const g2 = gaps.splice(Math.floor(rng() * gaps.length), 1)[0];
      const mk = (g, name) => {
        const lo = asc[g].seq, hi = asc[g + 1].seq;
        return { branch: name, gap: g, seq: lo + 1 + Math.floor(rng() * (hi - lo - 1)) };
      };
      const anchors = [mk(g1, 'b2'), mk(g2, 'b3')].sort((a, b) => b.seq - a.seq);
      const lateGap = gaps[Math.floor(rng() * gaps.length)];
      const late = mk(lateGap, 'b4');
      return { seed, rng, asc, anchors, late, branches: o.branches !== false, race: !!o.race,
               i: 0, busy: false, playing: false, speed: 1 };
    }
    let st = fresh(23, {});
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    // ---- the retention decision ---------------------------------------------------------
    const desc = () => st.asc.slice().reverse();                  // newest first, as the merge sees it
    const sampled = () => (st.branches ? st.anchors.slice() : []); // sorted descending already
    // the late anchor is published after this job sampled, so it is only live from MERGE onwards
    const liveAt = (s) => {
      const a = sampled();
      if (st.branches && st.race && s && s.name !== 'SAMPLE') {
        return a.concat([st.late]).sort((x, y) => y.seq - x.seq);
      }
      return a;
    };

    // AnchorWalker: anchors descend, versions arrive newest-first, one index that never rewinds.
    function decide(anchorList) {
      const A = anchorList.slice().sort((x, y) => y.seq - x.seq);
      let next = 0;
      return desc().map((v, d) => {
        const before = next;
        while (next < A.length && A[next].seq >= v.seq) next++;
        const serves = A.slice(before, next);
        const current = d === 0;
        return { v, d, current, serves, retained: current || serves.length > 0 };
      });
    }
    const unsampledNeed = () => {
      // which version the late anchor would need — the newest at or below it
      if (!st.branches || !st.race) return null;
      const v = desc().find((x) => x.seq <= st.late.seq);
      return v ? v.label : null;
    };

    function stages() {
      const rows = decide(sampled());
      const pinned = rows.filter((r) => !r.current && r.retained).length;
      const dropped = rows.filter((r) => !r.retained).length;
      const need = unsampledNeed();
      const raced = st.branches && st.race;
      const seqs = desc().map((v) => `${v.label} s${v.seq}`).join(', ');
      const aTxt = sampled().map((a) => `s${a.seq}`).join(', ') || 'none';
      const out = [];

      out.push({ name: 'SAMPLE', showLive: true, rows: null, output: false, outcome: null,
        note: 'the pins come from the durable catalog, so two runs over the same inputs sample the same set',
        log: [{ msg: `▣ SAMPLE — the job samples the retention anchor set from the catalog: ${aTxt}`
          + (st.branches ? '. Not from the live snapshot tracker, whose contents depend on who happens to be reading'
                         : '. With no anchors the pin layer adds nothing at all'), cls: 'ok' }] });

      out.push({ name: 'MERGE', showLive: true, rows: null, output: false, outcome: null, walking: true,
        note: 'the newest version is the current value; every version under it is a candidate to drop',
        log: [{ msg: `▣ MERGE — the merge walks this key's versions newest-first: ${seqs}`, cls: 'ok' }]
          .concat(raced ? [{ msg: `⚡ an anchor at s${st.late.seq} (${st.late.branch}) was published after this job `
            + 'sampled. The job is mid-merge and cannot see it', cls: 'warn' }] : []) });

      out.push({ name: 'DECIDE', showLive: true, rows, output: true, outcome: null, pinned, dropped, need,
        note: 'should_output = output_ignoring_pin || pinned_by_child_view — the pin is an override that only adds',
        log: [{ msg: `▣ DECIDE — ${rows.length - dropped} retained (1 current value`
          + (pinned ? `, ${pinned} for ${pinned === 1 ? 'an anchor' : 'anchors'}` : '')
          + `), ${dropped} dropped. One index walks both sorted lists, so this costs versions + anchors `
          + 'rather than versions × anchors', cls: 'ok' }]
          .concat(need && raced ? [{ msg: `⚡ ${need} is about to be dropped, and the anchor at s${st.late.seq} `
            + 'would need it. A discarded version cannot be un-discarded', cls: 'err' }] : []) });

      out.push({ name: 'PUBLISH', showLive: true, rows, output: true, pinned,
        dropped: raced ? 0 : dropped, outcome: raced ? 'refused' : 'published', need,
        note: raced
          ? 'the output is discarded and the inputs stay live for the next cycle'
          : (pinned ? 'published, with the extra versions each named to the anchor that needs them'
                    : 'published — the same versions a store that never forked would have kept'),
        log: raced
          ? [{ msg: `▣ PUBLISH — appeared_since finds s${st.late.seq}, which this job never sampled: `
              + `CompactionPinRaced { unsampled_anchor: ${st.late.seq} }. The output is discarded, the inputs stay `
              + 'live, and compaction_pin_races counts one', cls: 'err' }]
          : [{ msg: '▣ PUBLISH — the anchor set is re-checked under the publication lock and nothing appeared, so the '
              + `output is published: ${rows.length - dropped} version(s) kept, ${dropped} dropped. An anchor that `
              + 'vanished would publish too — the job merely over-retained', cls: 'ok' }] });
      return out;
    }
    const cur = () => stages()[st.i];

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      const sp = [0.5, 1, 2].map((v) =>
        `<option value="${v}"${v === st.speed ? ' selected' : ''}>${v}×</option>`).join('');
      return `<div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-back">◀ Back</button>
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--purple t-next">Next ▶</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--blue t-branches">${st.branches ? '⑂ anchors: 2' : '⑂ anchors: none'}</button>
          <button class="dstk-btn dstk-btn--amber t-race"${st.branches ? '' : ' disabled'}>${st.race ? '⚡ mid-job anchor: on' : '⚡ mid-job anchor: off'}</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}" min="1" max="999" style="width:4.2rem"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed">${sp}</select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'A compaction job with anchors in the way', sub: 'sample → merge → decide → publish',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'in', label: 'versions in' }, { id: 'dropped', label: 'dropped' },
                { id: 'pinned', label: 'kept for anchors' }, { id: 'outcome', label: 'outcome' }],
        cap: 'Six versions of one key, and two anchors sitting between versions — the placement where a retention '
           + 'policy has to make a choice. Switch the anchors off and the job keeps exactly what a store with no '
           + 'branches would keep. Switch the mid-job anchor on and one lands after SAMPLE: the re-check at PUBLISH '
           + 'finds it and refuses the output, so the inputs are still there for the next cycle.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 step the four stages, then turn the mid-job anchor on and step again', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function chip(g, x, y, w, h, zone, l1, l2, o) {
      const opt = o || {};
      const grp = K.el('g', { opacity: opt.dim ? 0.42 : 1 }, g);
      const r = K.el('rect', { x, y, width: w, height: h, rx: 4,
        fill: opt.hollow ? 'none' : K.grad(uid, zone), stroke: c[zone],
        'stroke-width': opt.bold ? 1.8 : 1.2, 'stroke-dasharray': opt.dash ? '3 2' : 'none' }, grp);
      if (opt.glow) r.setAttribute('filter', K.glow(uid));
      const t = K.el('text', { x: x + w / 2, y: y + (l2 ? 14 : h / 2 + 3.4), 'text-anchor': 'middle',
        'font-size': 9, 'font-weight': 700, fill: c[zone], 'font-family': MONO }, grp);
      t.textContent = l1;
      if (l2) {
        const t2 = K.el('text', { x: x + w / 2, y: y + 26, 'text-anchor': 'middle', 'font-size': 7.6,
          fill: c[zone], opacity: 0.9, 'font-family': MONO }, grp);
        t2.textContent = l2;
      }
      if (opt.strike) {
        K.el('line', { x1: x + 4, y1: y + h - 4, x2: x + w - 4, y2: y + 4, stroke: c.red,
          'stroke-width': 1.4 }, grp);
      }
      return grp;
    }

    function rowLabel(y, l1, l2) {
      const t = K.el('text', { x: 24, y, 'font-size': 8.5, 'font-weight': 700, fill: c.text }, content);
      t.textContent = l1;
      if (l2) {
        const t2 = K.el('text', { x: 24, y: y + 11, 'font-size': 8, fill: c.muted }, content);
        t2.textContent = l2;
      }
    }

    function drawStrip(i) {
      const n = STAGES.length, gap = 8;
      const w = (STRIP.w - gap * (n - 1)) / n;
      STAGES.forEach((nm, k) => {
        const x = STRIP.x + k * (w + gap);
        const isCur = k === i, past = k < i;
        const r = K.el('rect', { x, y: STRIP.y, width: w, height: STRIP.h, rx: 5,
          fill: isCur ? K.grad(uid, 'purple') : (past ? K.grad(uid, 'green') : 'none'),
          stroke: isCur ? c.purple : (past ? c.green : c.separator), 'stroke-width': isCur ? 1.8 : 1.1 }, content);
        if (isCur) r.setAttribute('filter', K.glow(uid));
        const t = K.el('text', { x: x + w / 2, y: STRIP.y + 15, 'text-anchor': 'middle', 'font-size': 9.5,
          'font-weight': isCur ? 700 : 600, fill: isCur ? c.purple : (past ? c.green : c.muted),
          'font-family': MONO }, content);
        t.textContent = `${k + 1}. ${nm}`;
      });
    }

    function drawVersions(s) {
      rowLabel(VY + 14, 'merge input', 'newest first →');
      desc().forEach((v, d) => {
        chip(content, vx(d), VY, VW, VH, 'blue', v.label, 's' + v.seq, { glow: !!s.walking });
      });
      // anchors sit strictly between two versions
      const live = liveAt(s);
      for (const a of live) {
        const d = 4 - a.gap;                 // display gap: to the right of display index d
        const x = vx(d) + VW + VGAP / 2;
        const late = st.race && a === st.late;
        const zone = late ? 'red' : 'amber';
        K.el('line', { x1: x, y1: VY - 6, x2: x, y2: VY + VH + 6, stroke: c[zone], 'stroke-width': 2,
          'stroke-dasharray': '5 4' }, content);
        const t = K.el('text', { x, y: VY + VH + 20, 'text-anchor': 'middle', 'font-size': 8.5,
          'font-weight': 700, fill: c[zone], 'font-family': MONO }, content);
        t.textContent = `${a.branch}@s${a.seq}`;
      }
      if (!live.length) {
        const t = K.el('text', { x: VX0, y: VY + VH + 20, 'font-size': 8.5, fill: c.muted }, content);
        t.textContent = 'no anchors — nothing pins any of these versions';
      }
    }

    function drawSet(s) {
      K.el('rect', { x: SET.x, y: SET.y, width: SET.w, height: SET.h, rx: 7, fill: 'none',
        stroke: c.separator, 'stroke-width': 1 }, content);
      const l1 = K.el('text', { x: SET.x + 8, y: SET.y + 16, 'font-size': 8.5, fill: c.muted }, content);
      l1.textContent = 'sampled at job creation, from the catalog';
      let x = SET.x + 236;
      const smp = sampled();
      if (!smp.length) {
        const t = K.el('text', { x, y: SET.y + 16, 'font-size': 8.5, fill: c.muted, 'font-family': MONO }, content);
        t.textContent = 'empty';
      }
      smp.forEach((a, i) => chip(content, x + i * 62, SET.y + 5, 58, 16, 'amber', `s${a.seq}`, null));
      const l2 = K.el('text', { x: SET.x + 8, y: SET.y + 42, 'font-size': 8.5, fill: c.muted }, content);
      l2.textContent = 'live in the catalog now';
      const live = liveAt(s);
      if (!live.length) {
        const t = K.el('text', { x, y: SET.y + 42, 'font-size': 8.5, fill: c.muted, 'font-family': MONO }, content);
        t.textContent = 'empty';
      }
      live.forEach((a, i) => {
        const late = st.race && a === st.late;
        chip(content, x + i * 62, SET.y + 31, 58, 16, late ? 'red' : 'amber', `s${a.seq}`, null,
          { bold: late, glow: late && s.name !== 'SAMPLE' });
      });
      if (st.race && st.branches && s.name !== 'SAMPLE') {
        const t = K.el('text', { x: x + live.length * 62 + 6, y: SET.y + 42, 'font-size': 8,
          'font-weight': 600, fill: c.red }, content);
        t.textContent = 'this one appeared after the sample';
      }
      if (s.rows) {
        const served = s.rows.reduce((n, r) => n + r.serves.length, 0);
        const t = K.el('text', { x: SET.x + SET.w - 8, y: SET.y + 16, 'text-anchor': 'end',
          'font-size': 8, fill: c.muted, 'font-family': MONO }, content);
        t.textContent = `walker index: ${served} of ${sampled().length} anchors served`;
      }
    }

    function drawDecisions(s) {
      rowLabel(DY + 14, 'decision', 'per version');
      if (!s.rows) {
        const t = K.el('text', { x: VX0, y: DY + 20, 'font-size': 9, fill: c.muted }, content);
        t.textContent = s.name === 'SAMPLE'
          ? 'nothing decided yet — the job has only read the anchor set'
          : 'the merge is still running; the retention decision comes next';
        return;
      }
      s.rows.forEach((r) => {
        const needed = s.need && s.need === r.v.label && !r.retained;
        const zone = r.current ? 'green' : (r.retained ? 'amber' : (needed ? 'red' : 'gray'));
        const why = r.current ? 'current value'
          : (r.retained ? 'serves ' + r.serves.map((a) => a.branch).join(', ')
            : (needed ? `s${st.late.seq} needs it` : 'superseded'));
        chip(content, vx(r.d), DY, VW, DH, zone, r.retained ? 'retain' : 'drop', why,
          { hollow: !r.retained, dim: !r.retained && !needed, bold: needed });
      });
    }

    function drawOutput(s) {
      K.el('rect', { x: OUT.x, y: OUT.y, width: OUT.w, height: OUT.h, rx: 7, fill: 'none',
        stroke: c.separator, 'stroke-width': 1 }, content);
      rowLabel(OUT.y + 18, 'this job', 'output');
      rowLabel(OUT.y + 48, 'no anchors', 'for comparison');
      if (!s.output) {
        const t = K.el('text', { x: VX0, y: OUT.y + 22, 'font-size': 9, fill: c.muted }, content);
        t.textContent = 'no output yet';
      } else {
        const refused = s.outcome === 'refused';
        s.rows.forEach((r) => {
          if (!r.retained) return;
          chip(content, vx(r.d), OUT.y + 6, VW, 22, r.current ? 'green' : 'amber',
            `${r.v.label} s${r.v.seq}`, null, { strike: refused, dim: refused });
        });
      }
      // what the same job produces with no anchors at all: the ordinary rules alone
      decide([]).forEach((r) => {
        if (!r.retained) return;
        chip(content, vx(r.d), OUT.y + 36, VW, 22, 'green', `${r.v.label} s${r.v.seq}`, null, { hollow: true });
      });
      if (s.rows) {
        const extra = s.rows.filter((r) => !r.current && r.retained).length;
        const t = K.el('text', { x: OUT.x + 4, y: OUT.y + 72, 'font-size': 8.5,
          fill: extra ? c.amber : c.green, 'font-family': MONO }, content);
        t.textContent = extra
          ? `the same set plus ${extra} version(s), each kept for a named anchor`
          : 'the two rows hold the same set — the pin layer added nothing';
      }
    }

    function drawBanner(s) {
      if (!s.outcome) {
        const t = K.el('text', { x: BAN.x, y: BAN.y + 20, 'font-size': 9.5, fill: c.muted }, content);
        t.textContent = `stage ${st.i + 1} of ${STAGES.length} · ${s.name} — ${s.note}`;
        return;
      }
      const bad = s.outcome === 'refused';
      K.el('rect', { x: BAN.x, y: BAN.y, width: BAN.w, height: BAN.h, rx: 6,
        fill: bad ? K.grad(uid, 'red') : K.grad(uid, 'green'), stroke: bad ? c.red : c.green,
        'stroke-width': 1.4 }, content);
      const t = K.el('text', { x: BAN.x + 10, y: BAN.y + 19, 'font-size': 9.5, 'font-weight': 600,
        fill: bad ? c.red : c.green }, content);
      t.textContent = bad
        ? `refused: CompactionPinRaced { unsampled_anchor: ${st.late.seq} } — ${s.note}`
        : `published — ${s.note}`;
    }

    function drawScene() {
      content.innerHTML = '';
      anim.innerHTML = '';
      const s = cur();
      drawStrip(st.i);
      drawVersions(s);
      drawSet(s);
      drawDecisions(s);
      drawOutput(s);
      drawBanner(s);
      const f = K.el('text', { x: 20, y: Hh - 8, 'font-size': 9.5, fill: c.muted }, content);
      f.textContent = 'Anchors descend and versions arrive newest-first, so the walker keeps one index and never rewinds; '
        + 'one version can serve several anchors.';
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      const s = cur();
      stat('in', VN);
      stat('dropped', s.rows ? s.dropped : '—');
      stat('pinned', s.rows ? s.pinned : '—');
      stat('outcome', s.outcome === 'refused' ? 'refused' : (s.outcome ? 'publish' : '—'));
      root.querySelector('.t-back').disabled = st.busy || st.i === 0;
      root.querySelector('.t-next').disabled = st.busy || st.i >= STAGES.length - 1;
      root.querySelector('.t-play').textContent = st.playing ? '⏸ Pause' : '▶ Play';
      root.querySelector('.t-branches').textContent = st.branches ? '⑂ anchors: 2' : '⑂ anchors: none';
      const race = root.querySelector('.t-race');
      race.textContent = st.race ? '⚡ mid-job anchor: on' : '⚡ mid-job anchor: off';
      race.disabled = st.busy || !st.branches;
    }

    // ---- animation ----------------------------------------------------------------------
    async function walk(s) {
      // sweep a marker across the version row: the merge, and then the decision, in one direction
      const y = s.rows ? DY - 6 : VY - 10;
      const line = K.el('line', { x1: VX0 - 8, y1: y, x2: VX0 - 8, y2: y + (s.rows ? DH + 12 : VH + 16),
        stroke: c.purple, 'stroke-width': 2, opacity: 0.85 }, anim);
      const p = { t: 0 };
      const x1 = VX0 - 8, x2 = vx(VN - 1) + VW + 8;
      await animate(p, { t: 1, duration: dur(700), ease: 'inOutQuad',
        onUpdate: () => {
          const x = x1 + (x2 - x1) * p.t;
          line.setAttribute('x1', x); line.setAttribute('x2', x);
          line.setAttribute('opacity', 0.85 * (1 - p.t * 0.6));
        },
        onComplete: () => line.remove() });
    }

    function flash(box, zone) {
      const r = K.el('rect', { x: box.x, y: box.y, width: box.w, height: box.h, rx: 7, fill: 'none',
        stroke: c[zone], 'stroke-width': 2, opacity: 0.9 }, anim);
      const p = { o: 0.9, s: 0 };
      animate(p, { o: 0, s: 8, duration: dur(620), ease: 'outQuad',
        onUpdate: () => {
          r.setAttribute('opacity', p.o);
          r.setAttribute('x', box.x - p.s); r.setAttribute('y', box.y - p.s);
          r.setAttribute('width', box.w + p.s * 2); r.setAttribute('height', box.h + p.s * 2);
        },
        onComplete: () => r.remove() });
    }

    // ---- stepping -----------------------------------------------------------------------
    async function goTo(i, announce) {
      st.i = Math.max(0, Math.min(STAGES.length - 1, i));
      st.busy = true; setLock(true);
      drawScene(); render();
      const s = cur();
      if (announce) for (const l of s.log) K.addLog(logBody, l.msg, l.cls, 4);
      if (s.name === 'SAMPLE') flash(SET, 'amber');
      if (s.name === 'PUBLISH') flash(OUT, s.outcome === 'refused' ? 'red' : 'green');
      if (s.name === 'MERGE' || s.name === 'DECIDE') await walk(s);
      await K.delay(dur(180));
      st.busy = false; setLock(false); render();
    }
    async function next() {
      if (st.busy) return;
      if (st.i >= STAGES.length - 1) {
        K.addLog(logBody, '⏹ PUBLISH is the last stage — step Back, or flip a switch and run it again', 'warn', 4);
        return;
      }
      await goTo(st.i + 1, true);
    }
    async function back() {
      if (st.busy || st.i === 0) return;
      const nm = STAGES[st.i - 1];
      await goTo(st.i - 1, false);
      K.addLog(logBody, `◀ back to ${nm} — the job is recomputed at this stage from the same seed`, 'hl', 4);
    }
    async function play() {
      if (st.playing) { st.playing = false; render(); return; }
      st.playing = true; render();
      while (st.playing && st.i < STAGES.length - 1) {
        await goTo(st.i + 1, true);
        if (!st.playing) break;
        await K.delay(dur(780));
      }
      st.playing = false; render();
    }

    function rebuildScene(msg, cls) {
      st.i = 0; st.playing = false;
      drawScene(); render();
      K.addLog(logBody, msg, cls || 'hl', 4);
    }

    function toggleBranches() {
      if (st.busy) return;
      st.branches = !st.branches;
      if (!st.branches) st.race = false;
      rebuildScene(st.branches
        ? `⑂ anchors: 2 — ${st.anchors.map((a) => a.branch + '@s' + a.seq).join(' and ')}, both between versions`
        : '⑂ anchors: none — the pin layer has nothing to add, so the job keeps what the ordinary rules keep');
    }
    function toggleRace() {
      if (st.busy || !st.branches) return;
      st.race = !st.race;
      rebuildScene(st.race
        ? `⚡ mid-job anchor on — s${st.late.seq} will land after SAMPLE, so the re-check at PUBLISH has something to find`
        : '⚡ mid-job anchor off — the live set will still match the sample at PUBLISH');
    }

    function reset() {
      const sp = st.speed, br = st.branches, ra = st.race;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 23;
      st = fresh(seed, { branches: br, race: ra });
      st.speed = sp;
      setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset to seed ${seed} — the six versions and both anchors return to where they started`, 'hl', 4);
    }

    function setLock(b) {
      K.lock(root, ['.t-reset', '.t-seed', '.t-branches'], b);
      root.querySelector('.t-back').disabled = b || st.i === 0;
      root.querySelector('.t-next').disabled = b || st.i >= STAGES.length - 1;
      root.querySelector('.t-race').disabled = b || !st.branches;
    }

    function bind() {
      root.querySelector('.t-back').onclick = back;
      root.querySelector('.t-next').onclick = next;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-branches').onclick = toggleBranches;
      root.querySelector('.t-race').onclick = toggleRace;
      root.querySelector('.t-seed').onchange = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value) || 1; };
    }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.SKVCompactionPins = { init };
})();
