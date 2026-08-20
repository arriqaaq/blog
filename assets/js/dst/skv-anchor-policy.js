/**
 * SKV Anchor Policy (dst-kit) — why retention anchors have to be kept as a SET.
 *
 * The post's point: compaction's job is to discard superseded versions, but a live fork anchor says
 * some superseded version is still somebody's CURRENT. surrealkv keeps every such cap in a
 * descending, deduplicated set (RetentionAnchors) and preserves the newest version at or below EACH
 * of them. The doc comment in src/branch.rs argues for the set by killing the three cheaper policies,
 * and this widget lets you run all four against the same version chain:
 *   • "pin the lowest"  — a fork anchored higher reads a version that was never current at its anchor
 *   • "pin the highest" — the lower fork finds nothing at all and starves
 *   • "range to highest" — every reader is correct, and nothing is ever reclaimed
 *   • "the set"          — every reader is correct, at one retained version per anchor
 * Anchors land strictly BETWEEN versions, because that is the only case where the policies disagree.
 * Exposes window.SKVAnchorPolicy.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-anchor-policy: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-anchor-policy: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 356;
  const AX = { x0: 52, x1: 706, vy: 50, ay: 116, h: 28 };  // version row, "kept" row
  const MONO = "ui-monospace,'SF Mono',monospace";
  const MAXV = 7, MAXA = 4;

  const POLICIES = {
    set: 'the set (as built)',
    lowest: 'pin only the lowest',
    highest: 'pin only the highest',
    range: 'range-pin to the highest',
  };

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    // ---- deterministic scene generation -------------------------------------------------
    // The seed varies: how many versions the key has, the GAP between consecutive versions
    // (never 1, so an anchor can always land strictly between two of them), and where inside a
    // chosen gap each fork anchor lands. It varies nothing about the policy arithmetic.
    function fresh(seed) {
      const rng = K.rng(seed);
      const n = 5 + Math.floor(rng() * 3);              // 5..7 versions
      const versions = [];
      let s = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        versions.push({ seq: s, label: 'v' + (i + 1) });
        s += 3 + Math.floor(rng() * 4);                  // gap 3..6 — room for an anchor inside
      }
      return { seed, rng, versions, anchors: [], policy: 'set', kept: [], verdicts: [],
               nextBranch: 2, busy: false, playing: false, speed: 1 };
    }
    let st = fresh(7);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    // ---- geometry -----------------------------------------------------------------------
    function maxSeq() {
      const vs = st.versions.length ? st.versions[st.versions.length - 1].seq : 10;
      return Math.max(vs, ...st.anchors.map((a) => a.seq), 10) + 3;
    }
    const X = (seq) => AX.x0 + (seq / maxSeq()) * (AX.x1 - AX.x0);
    const invX = (x) => ((x - AX.x0) / (AX.x1 - AX.x0)) * maxSeq();

    // ---- the four policies --------------------------------------------------------------
    // Each returns the set of sequences compaction keeps. `newest` is always kept: it is the
    // current value of the key and no policy may drop it.
    function computeKept() {
      const V = st.versions.map((v) => v.seq).slice().sort((a, b) => b - a);   // descending
      const A = st.anchors.map((a) => a.seq).slice().sort((a, b) => b - a);
      const keep = new Set();
      if (V.length) keep.add(V[0]);
      if (!A.length) return [...keep];
      const newestAtOrBelow = (cap) => V.find((s) => s <= cap);
      if (st.policy === 'set') {
        for (const a of A) { const s = newestAtOrBelow(a); if (s != null) keep.add(s); }
      } else if (st.policy === 'lowest') {
        const s = newestAtOrBelow(Math.min(...A)); if (s != null) keep.add(s);
      } else if (st.policy === 'highest') {
        const s = newestAtOrBelow(Math.max(...A)); if (s != null) keep.add(s);
      } else if (st.policy === 'range') {
        for (const s of V) if (s <= Math.max(...A)) keep.add(s);
      }
      return [...keep];
    }

    // What each anchored reader actually gets, versus what was truly current at its anchor.
    function computeVerdicts(kept) {
      const V = st.versions.map((v) => v.seq).slice().sort((a, b) => b - a);
      const K2 = kept.slice().sort((a, b) => b - a);
      const nameOf = (seq) => (st.versions.find((v) => v.seq === seq) || {}).label || '—';
      return st.anchors.map((a) => {
        const truth = V.find((s) => s <= a.seq);
        const read = K2.find((s) => s <= a.seq);
        let kind, text;
        if (read == null) {
          kind = 'starved';
          text = `reads nothing  ✗ starved — every version at or below ${a.seq} was dropped`;
        } else if (read === truth) {
          kind = 'ok';
          text = `reads ${nameOf(read)} · s${read}  ✓ correct`;
        } else {
          kind = 'stale';
          text = `reads ${nameOf(read)} · s${read}  ✗ but ${nameOf(truth)} · s${truth} was current at ${a.seq}`;
        }
        return { branch: a.branch, at: a.seq, kind, text };
      });
    }

    function recompute() {
      st.kept = computeKept();
      st.verdicts = computeVerdicts(st.kept);
    }

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      const opts = Object.entries(POLICIES)
        .map(([k, v]) => `<option value="${k}"${k === 'set' ? ' selected' : ''}>${v}</option>`).join('');
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-write">＋ Write</button>
        <button class="dstk-btn dstk-btn--blue t-fork">⑂ Place fork</button>
        <button class="dstk-btn dstk-btn--ghost t-drop">🗑 Delete a branch</button>
        <button class="dstk-btn dstk-btn--amber t-compact">✂ Compact</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">retention</span>
          <select class="t-policy">${opts}</select></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="7" min="1" max="999" style="width:4.2rem"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'What compaction must keep', sub: 'one key, its version chain, and four retention policies',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'kept', label: 'versions kept' }, { id: 'dropped', label: 'dropped' },
                { id: 'wrong', label: 'wrong answers' }, { id: 'pin', label: 'pin-retained' }],
        cap: 'Click the strip (or press ⑂) to place a fork anchor BETWEEN two versions — the only case where the '
           + 'policies disagree. Then switch policy: "pin the lowest" hands a reader a value that was already stale at '
           + 'its anchor, "pin the highest" starves the lower fork, and "range to highest" is correct at the price of '
           + 'never dropping anything. The set answers every anchor while retaining fewer versions than the range.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      recompute();
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 place two forks at different anchors, compact, then try "pin only the lowest"', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function chip(parent, x, y, w, h, fill, stroke, text, sub, bold) {
      K.el('rect', { x, y, width: w, height: h, rx: 5, fill, stroke, 'stroke-width': bold ? 1.8 : 1.3 }, parent);
      const t = K.el('text', { x: x + w / 2, y: y + (sub ? 13 : 18), 'text-anchor': 'middle',
        'font-size': 10.5, 'font-weight': 700, fill: stroke, 'font-family': MONO }, parent);
      t.textContent = text;
      if (sub) {
        const s = K.el('text', { x: x + w / 2, y: y + 24, 'text-anchor': 'middle', 'font-size': 9,
          fill: stroke, opacity: 0.75, 'font-family': MONO }, parent);
        s.textContent = sub;
      }
    }

    function drawScene() {
      content.innerHTML = '';
      const intro = K.el('text', { x: 18, y: 18, 'font-size': 10.5, fill: c.muted }, content);
      intro.textContent = 'key user:7 — every version it has ever had, oldest on the left';

      // version row
      K.el('line', { x1: AX.x0 - 6, y1: AX.vy + 14, x2: AX.x1 + 6, y2: AX.vy + 14,
        stroke: c.separator, 'stroke-width': 1 }, content);
      for (const v of st.versions) {
        chip(content, X(v.seq) - 24, AX.vy, 48, AX.h, K.grad(uid, 'blue'), c.blue, v.label, 's' + v.seq);
      }

      // anchors
      for (const a of st.anchors) {
        K.el('line', { x1: X(a.seq), y1: AX.vy - 12, x2: X(a.seq), y2: AX.ay + AX.h + 10,
          stroke: c.purple, 'stroke-width': 2, 'stroke-dasharray': '5 4' }, content);
        chip(content, X(a.seq) - 32, AX.vy - 32, 64, 17, K.grad(uid, 'purple'), c.purple, `${a.branch} @ ${a.seq}`);
      }

      // what compaction keeps
      const lbl = K.el('text', { x: 18, y: AX.ay - 8, 'font-size': 10.5, 'font-weight': 700, fill: c.text }, content);
      lbl.textContent = 'compaction keeps →';
      for (const v of st.versions) {
        const kept = st.kept.includes(v.seq);
        const g = K.el('g', {}, content);
        chip(g, X(v.seq) - 24, AX.ay, 48, AX.h, kept ? K.grad(uid, 'purple') : 'none',
          kept ? c.purple : c.muted, v.label, 's' + v.seq, kept);
        if (!kept) {
          K.el('line', { x1: X(v.seq) - 20, y1: AX.ay + AX.h - 4, x2: X(v.seq) + 20, y2: AX.ay + 4,
            stroke: c.muted, 'stroke-width': 1.4, opacity: 0.9 }, g);
          g.setAttribute('opacity', '0.5');
        } else if (kept) {
          g.setAttribute('filter', K.glow(uid));
        }
      }

      // verdict rows
      let y = AX.ay + AX.h + 22;
      if (!st.verdicts.length) {
        const t = K.el('text', { x: 18, y: y + 15, 'font-size': 10.5, fill: c.muted }, content);
        t.textContent = 'no live branches: no anchors, nothing pinned — compaction behaves exactly as it would in a store that never forked';
      }
      for (const v of st.verdicts) {
        const col = v.kind === 'ok' ? c.green : c.red;
        K.el('rect', { x: 18, y, width: 744, height: 22, rx: 5,
          fill: v.kind === 'ok' ? K.grad(uid, 'green') : K.grad(uid, 'red'), stroke: col, 'stroke-width': 1.2 }, content);
        const t = K.el('text', { x: 28, y: y + 15, 'font-size': 10, fill: col, 'font-family': MONO }, content);
        t.textContent = `${v.branch} @ ${v.at}  →  ${v.text}`;
        y += 26;
      }

      const foot = K.el('text', { x: 18, y: Hh - 8, 'font-size': 9.5, fill: c.muted }, content);
      foot.textContent = 'pin-retained counts versions kept ONLY because an anchor needed them — the storage a live branch actually costs its parent.';
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }

    function render() {
      const wrong = st.verdicts.filter((v) => v.kind !== 'ok').length;
      stat('kept', st.kept.length);
      stat('dropped', st.versions.length - st.kept.length);
      stat('wrong', wrong);
      stat('pin', Math.max(0, st.kept.length - 1));   // 1 = the newest version, kept by every policy
    }

    // ---- actions ------------------------------------------------------------------------
    async function write() {
      if (st.busy) return; st.busy = true; setLock(true);
      if (st.versions.length >= MAXV) st.versions.shift();
      const last = st.versions[st.versions.length - 1];
      const seq = (last ? last.seq : 0) + 3 + Math.floor(st.rng() * 4);
      st.versions.push({ seq, label: 'v' + (st.versions.length + 1) });
      recompute(); drawScene(); render();
      K.addLog(logBody, `＋ wrote user:7 at sequence ${seq} — the previous version is now superseded, but not yet gone`, 'ok');
      await K.delay(dur(320));
      st.busy = false; setLock(false);
    }

    function gapAnchor() {
      // Place strictly BETWEEN two versions. A seed whose anchors all sit ON versions makes every
      // policy agree, which would make this widget argue for nothing.
      const cands = [];
      for (let i = 0; i < st.versions.length - 1; i++) {
        const lo = st.versions[i].seq, hi = st.versions[i + 1].seq;
        if (hi - lo >= 2) cands.push([lo, hi]);
      }
      if (!cands.length) return null;
      const [lo, hi] = cands[Math.floor(st.rng() * cands.length)];
      return lo + 1 + Math.floor(st.rng() * (hi - lo - 1));
    }

    async function fork(atSeq) {
      if (st.busy) return;
      if (st.anchors.length >= MAXA) {
        K.addLog(logBody, `⑂ four anchors is the maximum here — delete one first`, 'warn'); return;
      }
      const seq = atSeq != null ? atSeq : gapAnchor();
      if (seq == null) { K.addLog(logBody, '⑂ no gap wide enough — write another version first', 'warn'); return; }
      if (st.anchors.some((a) => a.seq === seq)) {
        K.addLog(logBody, `⑂ a branch is already anchored at ${seq}`, 'warn'); return;
      }
      st.busy = true; setLock(true);
      const name = 'b' + st.nextBranch++;
      st.anchors.push({ branch: name, seq });
      st.anchors.sort((a, b) => a.seq - b.seq);
      recompute(); drawScene(); render();
      const between = st.versions.filter((v) => v.seq < seq).slice(-1)[0];
      const above = st.versions.find((v) => v.seq > seq);
      K.addLog(logBody, `⑂ ${name} forked at anchor ${seq}`
        + (between && above ? ` — between ${between.label} · s${between.seq} and ${above.label} · s${above.seq}` : '')
        + `, so it reads whatever was current at ${seq}`, 'ok');
      await K.delay(dur(320));
      st.busy = false; setLock(false);
    }

    async function drop() {
      if (st.busy || !st.anchors.length) return;
      st.busy = true; setLock(true);
      const gone = st.anchors.splice(Math.floor(st.rng() * st.anchors.length), 1)[0];
      recompute(); drawScene(); render();
      if (!st.anchors.length) {
        K.addLog(logBody, `🗑 ${gone} deleted — 0 anchors and 0 pin-retained versions: compaction's output is now `
          + `byte-identical to a store that never had branching compiled in`, 'ok');
      } else {
        K.addLog(logBody, `🗑 ${gone.branch} deleted — its anchor is released, and the versions only it needed become droppable`, 'ok');
      }
      await K.delay(dur(320));
      st.busy = false; setLock(false);
    }

    async function compact() {
      if (st.busy) return; st.busy = true; setLock(true);
      recompute(); drawScene(); render();
      const dropped = st.versions.filter((v) => !st.kept.includes(v.seq));
      // fade the versions this policy discards
      for (const v of dropped) {
        const proxy = { o: 1 };
        animate(proxy, { o: 0.35, duration: dur(420), ease: 'outQuad' });
      }
      const wrong = st.verdicts.filter((x) => x.kind !== 'ok');
      const pol = POLICIES[st.policy];
      if (!st.anchors.length) {
        K.addLog(logBody, `✂ compacted under "${pol}": no anchors, so only the newest version survives — the same output an unbranched store would produce`, 'ok');
      } else if (!wrong.length && st.policy === 'range') {
        K.addLog(logBody, `✂ compacted under "${pol}": every reader is correct, and ${st.kept.length} of ${st.versions.length} `
          + `versions were retained — correct, and nothing is ever reclaimed`, 'warn');
      } else if (!wrong.length) {
        K.addLog(logBody, `✂ compacted under "${pol}": every anchor answered correctly, on ${st.kept.length} retained versions `
          + `for ${st.anchors.length} ${st.anchors.length === 1 ? 'branch' : 'branches'}`, 'ok');
      } else {
        const w = wrong[0];
        K.addLog(logBody, `✂ compacted under "${pol}": ${w.branch} @ ${w.at} ${w.text.replace(/^reads /, 'now reads ')}`, 'err');
      }
      await K.delay(dur(460));
      st.busy = false; setLock(false);
    }

    // ---- play / reset -------------------------------------------------------------------
    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        const r = st.rng();
        if (st.anchors.length < 2 || r < 0.3) await fork();
        else if (r < 0.55) await write();
        else if (r < 0.72 && st.anchors.length > 1) await drop();
        else await compact();
        if (!st.playing) break;
        await K.delay(dur(700));
      }
    }
    function pause() { st.playing = false; pp(); }

    function reset() {
      const sp = st.speed, pol = st.policy;
      st.playing = false;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 7;
      st = fresh(seed);
      st.speed = sp; st.policy = pol;
      root.querySelector('.t-policy').value = pol;
      recompute(); pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset to seed ${seed} — this seed always lays the versions and anchors out the same way`, 'hl');
    }

    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-write', '.t-fork', '.t-drop', '.t-compact', '.t-policy', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-write').onclick = write;
      root.querySelector('.t-fork').onclick = () => fork();
      root.querySelector('.t-drop').onclick = drop;
      root.querySelector('.t-compact').onclick = compact;
      root.querySelector('.t-policy').onchange = (e) => {
        st.policy = e.target.value;
        recompute(); drawScene(); render();
        K.addLog(logBody, `⇄ retention policy → "${POLICIES[st.policy]}" — press ✂ Compact to apply it`, 'hl');
      };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-seed').onchange = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value) || 1; };
      // click the strip to place an anchor exactly where you want it
      svg.onclick = (ev) => {
        if (st.busy || st.playing) return;
        const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
        const m = svg.getScreenCTM(); if (!m) return;
        const loc = p.matrixTransform(m.inverse());
        if (loc.y < AX.vy - 34 || loc.y > AX.ay + AX.h + 12) return;
        if (loc.x < AX.x0 || loc.x > AX.x1) return;
        const seq = Math.round(invX(loc.x));
        if (seq <= 0) return;
        if (st.versions.some((v) => v.seq === seq)) {
          K.addLog(logBody, `⑂ ${seq} is exactly on a version — the policies only differ for anchors sitting BETWEEN two versions`, 'warn');
          return;
        }
        fork(seq);
      };
    }

    build();

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }

  window.SKVAnchorPolicy = { init };
})();
