/**
 * SKV Merge Chunks (dst-kit) — atomic or resumable, decided by the size of the data.
 *
 * The post's point: surrealkv bounds a merge's writes at the memtable size and reports how many
 * transactions it took. MergeOutcome::chunks is documented as "One means it landed atomically; more
 * means each chunk is durable on its own and a failure part-way would have left the earlier ones
 * applied." Nothing you pass to merge_into decides which of those you get — the SIZE OF YOUR DATA
 * does. So scrub the seed: the same budget and the same key count split into two chunks on one seed
 * and four on another, which is exactly why the contract is to READ `chunks` rather than assume
 * atomicity. And because data commits before the promotion edge, a failure part-way leaves the
 * earlier chunks applied with the edge already advanced — so a re-run resumes instead of restarting.
 * Exposes window.SKVMergeChunks.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('skv-merge-chunks: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('skv-merge-chunks: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, Hh = 292;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const RULER = { x: 18, y: 34, w: 250, h: 16 };     // 250px === one chunk budget
  const ROW = { x: 18, y0: 68, h: 38, gap: 46, max: 4 };
  const PANEL = { x: 404, w: 358 };
  const BUDGETS = { small: 0.6, default: 1.0, large: 2.0 };   // MiB

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    // The seed varies the byte size of every write and the write count — and therefore WHERE the
    // chunk boundaries land. Same budget, same key count, different split. That unpredictability is
    // the entire reason `chunks` is reported instead of promised.
    function fresh(seed) {
      const rng = K.rng(seed);
      const n = 10 + Math.floor(rng() * 9);          // 10..18 writes
      const writes = [];
      for (let i = 0; i < n; i++) {
        writes.push({ key: 'user:' + (i + 1), bytes: 60000 + Math.floor(rng() * 420000) });
      }
      return { seed, rng, writes, budgetName: 'default', chunks: [], done: 0,
               failedAt: -1, edgeSeq: 100, busy: false, playing: false, speed: 1 };
    }
    let st = fresh(7);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;

    const budgetBytes = () => BUDGETS[st.budgetName] * 1024 * 1024;
    const mib = (b) => (b / (1024 * 1024)).toFixed(2);

    // ---- greedy packing, exactly as a bounded merge would do it -------------------------
    function pack() {
      const budget = budgetBytes();
      const chunks = [];
      let cur = { items: [], bytes: 0 };
      for (const w of st.writes) {
        if (w.bytes > budget) {
          // a single entry above the budget cannot be split, so the merge refuses up front
          return { chunks: [], tooLarge: w };
        }
        if (cur.bytes + w.bytes > budget && cur.items.length) { chunks.push(cur); cur = { items: [], bytes: 0 }; }
        cur.items.push(w); cur.bytes += w.bytes;
      }
      if (cur.items.length) chunks.push(cur);
      return { chunks, tooLarge: null };
    }
    function repack() {
      const { chunks, tooLarge } = pack();
      st.chunks = chunks; st.tooLarge = tooLarge;
      st.done = 0; st.failedAt = -1; st.edgeSeq = 100;
    }

    // ---- chrome -------------------------------------------------------------------------
    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ Commit next chunk</button>
        <button class="dstk-btn dstk-btn--red t-fail">💥 Fail next chunk</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">chunk budget</span>
          <select class="t-budget">
            <option value="small">small · 0.6 MiB</option>
            <option value="default" selected>default · 1.0 MiB</option>
            <option value="large">large · 2.0 MiB</option></select></div>
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
        title: 'Atomic, or resumable', sub: 'chunks depends on the size of the data, so it is returned to the caller',
        controls: controls(), viewBox: `0 0 ${W} ${Hh}`, uid,
        stats: [{ id: 'writes', label: 'writes' }, { id: 'chunks', label: 'chunks' },
                { id: 'applied', label: 'applied' }, { id: 'verdict', label: 'verdict' }],
        cap: 'Scrub the seed without touching the budget: the same number of keys splits differently every time, '
           + 'because the byte sizes decide the boundaries. Then fail a chunk part-way — the earlier chunks stay '
           + 'applied and the promotion edge has already moved, so re-running the merge resumes rather than restarts.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      repack();
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 note the chunk count, then change only the seed and look again', 'hl');
    }

    // ---- drawing ------------------------------------------------------------------------
    function drawScene() {
      content.innerHTML = '';
      const intro = K.el('text', { x: 18, y: 20, 'font-size': 10.5, fill: c.muted }, content);
      intro.textContent = `a merge with ${st.writes.length} writes to apply`;

      // the budget ruler — the accent
      K.el('rect', { x: RULER.x, y: RULER.y, width: RULER.w, height: RULER.h, rx: 5,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.5 }, content);
      const rl = K.el('text', { x: RULER.x + RULER.w + 10, y: RULER.y + 12, 'font-size': 10,
        'font-weight': 700, fill: c.purple, 'font-family': MONO }, content);
      rl.textContent = `one chunk budget = ${BUDGETS[st.budgetName].toFixed(1)} MiB`;

      if (st.tooLarge) {
        K.el('rect', { x: 18, y: 76, width: 744, height: 34, rx: 6, fill: K.grad(uid, 'red'),
          stroke: c.red, 'stroke-width': 1.6 }, content);
        const t = K.el('text', { x: 30, y: 97, 'font-size': 11, 'font-weight': 700, fill: c.red,
          'font-family': MONO }, content);
        t.textContent = `MergeTooLarge — ${st.tooLarge.key} alone is ${mib(st.tooLarge.bytes)} MiB, above the budget: refused up front`;
        return;
      }

      const scale = RULER.w / budgetBytes();
      st.chunks.slice(0, ROW.max).forEach((ch, i) => {
        const y = ROW.y0 + i * ROW.gap;
        const committed = i < st.done;
        const failed = i === st.failedAt;
        const w = Math.max(24, ch.bytes * scale);
        const zone = failed ? 'red' : committed ? 'green' : 'gray';
        const col = failed ? c.red : committed ? c.green : c.muted;
        K.el('rect', { x: ROW.x, y, width: w, height: ROW.h, rx: 5, fill: K.grad(uid, zone),
          stroke: col, 'stroke-width': committed || failed ? 1.7 : 1,
          'stroke-dasharray': !committed && !failed ? '4 3' : '' }, content);
        // the packed writes inside
        let ix = ROW.x + 3;
        for (const it of ch.items) {
          const iw = Math.max(4, it.bytes * scale - 2);
          K.el('rect', { x: ix, y: y + 22, width: iw, height: 12, rx: 2, fill: col, opacity: 0.32 }, content);
          ix += iw + 2;
        }
        const t = K.el('text', { x: ROW.x + 8, y: y + 16, 'font-size': 9.5, 'font-weight': 700,
          fill: col, 'font-family': MONO }, content);
        t.textContent = `chunk ${i + 1} · ${ch.items.length} keys · ${mib(ch.bytes)} MiB`;
        if (failed) {
          K.el('line', { x1: ROW.x, y1: y + ROW.h, x2: ROW.x + w, y2: y, stroke: c.red,
            'stroke-width': 1.8 }, content);
        }
        const status = K.el('text', { x: RULER.x + RULER.w + 14, y: y + 22, 'font-size': 9.5,
          fill: col }, content);
        status.textContent = failed ? '✗ failed'
          : committed ? 'committed — durable on its own'
          : st.failedAt >= 0 && i > st.failedAt ? 'never attempted' : 'pending';
      });
      if (st.chunks.length > ROW.max) {
        const t = K.el('text', { x: ROW.x, y: ROW.y0 + ROW.max * ROW.gap + 4, 'font-size': 9.5,
          fill: c.muted }, content);
        t.textContent = `+${st.chunks.length - ROW.max} more chunks`;
      }

      // verdict panel
      const atomic = st.chunks.length === 1;
      const zone = atomic ? 'green' : 'amber';
      const col = atomic ? c.green : c.amber;
      K.el('rect', { x: PANEL.x, y: 68, width: PANEL.w, height: 54, rx: 7, fill: K.grad(uid, zone),
        stroke: col, 'stroke-width': 1.6 }, content);
      const v1 = K.el('text', { x: PANEL.x + PANEL.w / 2, y: 90, 'text-anchor': 'middle',
        'font-size': 12, 'font-weight': 700, fill: col, 'font-family': MONO }, content);
      v1.textContent = `chunks = ${st.chunks.length}`;
      const v2 = K.el('text', { x: PANEL.x + PANEL.w / 2, y: 108, 'text-anchor': 'middle',
        'font-size': 10, fill: col }, content);
      v2.textContent = atomic ? 'one transaction — all or nothing'
        : 'each chunk durable on its own — RESUMABLE, not atomic';

      // edge marker
      if (st.done > 0) {
        K.el('rect', { x: PANEL.x, y: 132, width: PANEL.w, height: 30, rx: 6, fill: K.grad(uid, 'blue'),
          stroke: c.blue, 'stroke-width': 1.3 }, content);
        const e = K.el('text', { x: PANEL.x + 12, y: 152, 'font-size': 9.5, fill: c.blue,
          'font-family': MONO }, content);
        e.textContent = `promotion edge → seq ${st.edgeSeq}  (data committed first)`;
      }

      const foot1 = K.el('text', { x: 18, y: Hh - 24, 'font-size': 9.5, fill: c.muted }, content);
      foot1.textContent = 'The size of the data decides atomicity, not anything passed to the call. A single entry above the budget is refused up front as MergeTooLarge.';
      const foot2 = K.el('text', { x: 18, y: Hh - 9, 'font-size': 9.5, fill: c.muted }, content);
      foot2.textContent = 'A chunk count of 0 means there was nothing to write; 1 means one transaction; anything more means you must not assume the merge was atomic.';
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(`${uid}-stat-${k}`));
      if (e) e.textContent = v;
    }
    function render() {
      const applied = st.chunks.slice(0, st.done).reduce((n, ch) => n + ch.items.length, 0);
      stat('writes', st.writes.length);
      stat('chunks', st.tooLarge ? '—' : st.chunks.length);
      stat('applied', applied);
      stat('verdict', st.tooLarge ? 'refused' : st.chunks.length === 1 ? 'atomic' : 'resumable');
    }

    // ---- actions ------------------------------------------------------------------------
    async function step(fail) {
      if (st.busy || st.tooLarge) return;
      if (st.failedAt >= 0) {
        K.addLog(logBody, '⏹ this merge stopped at a failed chunk — reset, or re-run to resume from the edge', 'warn');
        return;
      }
      if (st.done >= st.chunks.length) {
        K.addLog(logBody, `⏹ all ${st.chunks.length} chunk(s) committed`, 'ok');
        return;
      }
      st.busy = true; setLock(true);
      const i = st.done;
      const ch = st.chunks[i];
      if (fail) {
        st.failedAt = i;
        drawScene(); render();
        if (i === 0) {
          K.addLog(logBody, `💥 chunk 1 of ${st.chunks.length} failed before anything was committed — the merge `
            + `applied nothing at all`, 'err');
        } else {
          K.addLog(logBody, `💥 chunk ${i + 1} of ${st.chunks.length} failed: chunks 1–${i} are applied and will `
            + `STAY applied, and the promotion edge sits at seq ${st.edgeSeq} — re-running this merge resumes `
            + `rather than restarts`, 'err');
        }
      } else {
        st.done++;
        st.edgeSeq += ch.items.length;
        drawScene(); render();
        const last = st.done === st.chunks.length;
        if (st.chunks.length === 1) {
          K.addLog(logBody, `⏭ the whole merge committed in one transaction — ${ch.items.length} keys, `
            + `${mib(ch.bytes)} MiB. chunks = 1, so it landed all-or-nothing`, 'ok');
        } else {
          K.addLog(logBody, `⏭ chunk ${st.done} of ${st.chunks.length} committed: ${ch.items.length} keys, `
            + `${mib(ch.bytes)} MiB — durable on its own, which is not the same promise as the merge being atomic`,
            last ? 'ok' : 'warn');
        }
      }
      await K.delay(dur(380));
      st.busy = false; setLock(false);
    }

    function setBudget(name) {
      st.budgetName = name;
      repack();
      drawScene(); render();
      if (st.tooLarge) {
        K.addLog(logBody, `📏 budget → ${BUDGETS[name].toFixed(1)} MiB: one entry no longer fits, so the merge is refused up front`, 'err');
      } else {
        K.addLog(logBody, `📏 budget → ${BUDGETS[name].toFixed(1)} MiB: the same ${st.writes.length} writes now take `
          + `${st.chunks.length} chunk(s)` + (st.chunks.length === 1 ? ' — all or nothing' : ''), st.chunks.length === 1 ? 'ok' : 'warn');
      }
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) {
        if (st.done >= st.chunks.length || st.failedAt >= 0 || st.tooLarge) {
          const seed = (st.seed % 900) + 1;
          root.querySelector('.t-seed').value = seed;
          reset();
          if (!st.playing) break;
          await K.delay(dur(700));
          continue;
        }
        await step(false);
        if (!st.playing) break;
        await K.delay(dur(520));
      }
    }
    function pause() { st.playing = false; pp(); }

    function reset() {
      const sp = st.speed, b = st.budgetName, playing = st.playing;
      const seed = parseInt(root.querySelector('.t-seed').value, 10) || 7;
      st = fresh(seed);
      st.speed = sp; st.budgetName = b; st.playing = playing;
      root.querySelector('.t-budget').value = b;
      repack();
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ seed ${seed}: ${st.writes.length} writes → ${st.tooLarge ? 'refused' : st.chunks.length + ' chunk(s)'} `
        + `at the same ${BUDGETS[b].toFixed(1)} MiB budget`, 'hl');
    }

    function pp() {
      root.querySelector('.t-play').disabled = st.playing;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-fail', '.t-budget', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-step').onclick = () => step(false);
      root.querySelector('.t-fail').onclick = () => step(true);
      root.querySelector('.t-budget').onchange = (e) => setBudget(e.target.value);
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

  window.SKVMergeChunks = { init };
})();
