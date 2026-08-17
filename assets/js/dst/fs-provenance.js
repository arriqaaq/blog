/**
 * FS Provenance (dst-kit) — "which tool call wrote this byte" is ONE query.
 *
 * The climax of the post: every mutation row carries the path it touched (indexed), every
 * commit carries the span that authored it, and every span belongs to a tool call. So
 * provenance is a single indexed lookup plus two record-link hops:
 *   commit_mutation → commit → author_span → tool call
 * Click a file on the left (or press ❓ explain) and watch an amber pulse walk the chain:
 * path → its newest mutation row → its commit → the commit's span → the tool card — then an
 * answer card slides in. "☰ what else did that run touch" flips the question around: every
 * other path the same tool call's commits touched lights up green (the blast radius).
 * Exposes window.FSProvenance.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-provenance: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-provenance: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 336;
  const TOOL_POOL = ['web_search', 'edit_file', 'run_tests', 'fetch_url', 'format_code'];
  const PATHS = ['/report.md', '/src/main.rs', '/notes/plan.md', '/data/cache.json'];
  const FILE = { x: 16, w: 168, h: 30, y: (i) => 34 + i * 42 };
  const CHIP = { x: 276, w: 64, h: 14 };
  const CMT = { cx: 396, r: 13, y: (i) => 52 + i * 46 };
  const CARD = { x: 556, w: 208, h: 56, y: (i) => 56 + i * 68 };
  const ANS = { x: 16, y: 288, w: 748, h: 36 };
  const MONO = "ui-monospace,'SF Mono',monospace";

  // Seeded history: 3 tools → 5 commits (c1..c5) → 1–2 mutation rows each; every path covered.
  function genData(rng) {
    const pool = TOOL_POOL.slice(), names = [];
    for (let i = 0; i < 3; i++) names.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const failedAt = Math.floor(rng() * 3);
    const tools = names.map((name, i) => ({
      name, status: (i === failedAt || rng() < 0.12) ? 'FAILED' : 'SUCCEEDED',
      span: 's_' + Math.floor(rng() * 0xffff).toString(16).padStart(4, '0'), commits: [],
    }));
    const counts = [1, 2, 2];
    for (let i = counts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1)); const t = counts[i]; counts[i] = counts[j]; counts[j] = t;
    }
    const commits = []; let idx = 0;
    tools.forEach((t, ti) => {
      for (let k = 0; k < counts[ti]; k++) {
        idx++;
        const n = rng() < 0.5 ? 1 : 2, ps = [];
        while (ps.length < n) { const p = PATHS[Math.floor(rng() * PATHS.length)]; if (!ps.includes(p)) ps.push(p); }
        commits.push({ id: 'c' + idx, idx, tool: ti, paths: ps });
        t.commits.push(commits.length - 1);
      }
    });
    // coverage: every path must have at least one mutation row so every click has an answer
    PATHS.forEach((p) => {
      if (commits.some((cm) => cm.paths.includes(p))) return;
      const open = commits.filter((cm) => cm.paths.length === 1);
      if (open.length) { open[Math.floor(rng() * open.length)].paths.push(p); return; }
      const freq = {};
      commits.forEach((cm) => cm.paths.forEach((q) => { freq[q] = (freq[q] || 0) + 1; }));
      const q = PATHS.slice().sort((a, b) => (freq[b] || 0) - (freq[a] || 0))[0];
      const cm = commits.find((x) => x.paths.includes(q));
      cm.paths[cm.paths.indexOf(q)] = p;
    });
    return { tools, commits };
  }

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 7 : seed, rng = K.rng(s);
      return { seed: s, data: genData(rng), queries: 0, nextPath: 0, lastTool: null, lastPath: null,
        busy: false, playing: false, speed: 1 };
    };
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const R = (k) => root.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const base = (p) => p.slice(p.lastIndexOf('/') + 1);
    const rowMid = (i) => FILE.y(i) + FILE.h / 2;
    const chipY = (ci, k) => {
      const cy = CMT.y(ci);
      return st.data.commits[ci].paths.length === 1 ? cy - CHIP.h / 2 : cy - 16 + k * 18;
    };
    const spanY = (ti) => CARD.y(ti) + 38;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-explain">❓ explain a path</button>
        <button class="dstk-btn dstk-btn--green t-blast" disabled>☰ what else did that run touch</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    // Hand-rolled SurrealQL highlighting — the WHERE line and the record-link hop get ids so
    // the traversal can glow the exact clause it is executing.
    function queryHtml() {
      return `<pre class="dstk-code"><span class="k">SELECT</span> commit, <span id="${uid}-q-hop">commit.author_span.name</span> <span class="k">AS</span> tool
<span class="k">FROM</span> commit_mutation
<span id="${uid}-q-where"><span class="k">WHERE</span> path = <span class="n">$path</span></span>
<span class="k">ORDER BY</span> domain_sequence <span class="k">DESC</span> <span class="k">LIMIT</span> <span class="n">1</span></pre>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Who wrote this byte? One query.',
        sub: 'commit_mutation → commit → author_span → tool call',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'paths', label: 'paths' }, { id: 'commits', label: 'commits' },
          { id: 'hops', label: 'hops' }, { id: 'queries', label: 'queries' }],
        cap: "Every mutation carries its path; every commit carries its author. 'Who wrote this byte' is one "
           + 'indexed lookup and two record-link hops — not an audit-log reconstruction.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      const code = document.createElement('div');
      code.innerHTML = queryHtml();
      root.querySelector('.dstk-toolbar').insertAdjacentElement('afterend', code.firstChild);
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 click a file on the left (or ❓ explain) — the query walks mutation → commit → span → tool', 'hl');
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      const { tools, commits } = st.data;
      const head = (x, zone, t) => { K.el('text', { x, y: 20, 'text-anchor': 'middle', fill: c[zone], 'font-size': 9.5, 'font-weight': 700, 'letter-spacing': '.06em' }, content).textContent = t; };
      head(100, 'blue', 'FILES · path (indexed)');
      head(372, 'purple', 'COMMITS · mutation rows');
      head(660, 'green', 'TOOL CALLS · author spans');
      // faint pre-drawn graph edges (the joins are already there; a query just walks them)
      commits.forEach((cm, ci) => {
        cm.paths.forEach((p, k) => {
          const pi = PATHS.indexOf(p), my = chipY(ci, k) + CHIP.h / 2;
          K.el('line', { id: `${uid}-e-p-${ci}-${k}`, x1: FILE.x + FILE.w, y1: rowMid(pi), x2: CHIP.x, y2: my, stroke: c.blue, 'stroke-width': 1, opacity: 0.16 }, content);
          K.el('line', { x1: CHIP.x + CHIP.w, y1: my, x2: CMT.cx - CMT.r, y2: CMT.y(ci), stroke: c.gray, 'stroke-width': 1, opacity: 0.35 }, content);
        });
        K.el('line', { id: `${uid}-e-c-${ci}`, x1: CMT.cx + CMT.r, y1: CMT.y(ci), x2: CARD.x + 10, y2: spanY(cm.tool), stroke: c.gray, 'stroke-width': 1, opacity: 0.2 }, content);
      });
      // LEFT — clickable file panel
      PATHS.forEach((p, i) => {
        const y = FILE.y(i);
        const r = K.el('rect', { id: `${uid}-prow-${i}`, x: FILE.x, y, width: FILE.w, height: FILE.h, rx: 7, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1.3, cursor: 'pointer' }, content);
        K.el('text', { x: FILE.x + 10, y: y + 19, fill: c.text, 'font-size': 10, 'font-weight': 600, 'pointer-events': 'none', 'font-family': MONO }, content).textContent = p;
        K.el('text', { x: FILE.x + FILE.w - 9, y: y + 19, 'text-anchor': 'end', fill: c.blue, 'font-size': 9, 'pointer-events': 'none' }, content).textContent = '▸';
        r.addEventListener('click', () => { if (!st.busy && !st.playing) explain(i); });
      });
      // MIDDLE — commits with their mutation-row stubs
      commits.forEach((cm, ci) => {
        const cy = CMT.y(ci);
        cm.paths.forEach((p, k) => {
          const y = chipY(ci, k);
          K.el('rect', { id: `${uid}-mchip-${ci}-${k}`, x: CHIP.x, y, width: CHIP.w, height: CHIP.h, rx: 4, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1 }, content);
          K.el('text', { x: CHIP.x + CHIP.w / 2, y: y + 10.5, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content).textContent = base(p);
        });
        K.el('circle', { id: `${uid}-cnode-${ci}`, cx: CMT.cx, cy, r: CMT.r, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.5 }, content);
        K.el('text', { x: CMT.cx, y: cy + 3.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 9.5, 'font-weight': 700, 'pointer-events': 'none' }, content).textContent = cm.id;
      });
      // RIGHT — tool-call cards with their span chip
      tools.forEach((t, ti) => {
        const y = CARD.y(ti), fail = t.status === 'FAILED';
        K.el('rect', { id: `${uid}-tcard-${ti}`, x: CARD.x, y, width: CARD.w, height: CARD.h, rx: 9, fill: K.grad(uid, fail ? 'red' : 'green'), stroke: fail ? c.red : c.green, 'stroke-width': 1.4 }, content);
        K.el('text', { x: CARD.x + 12, y: y + 20, fill: c.text, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = t.name;
        K.el('text', { x: CARD.x + CARD.w - 12, y: y + 20, 'text-anchor': 'end', fill: fail ? c.red : c.green, 'font-size': 8.5, 'font-weight': 700 }, content).textContent = t.status;
        K.el('rect', { id: `${uid}-schip-${ti}`, x: CARD.x + 10, y: y + 30, width: 72, height: 16, rx: 4, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1 }, content);
        K.el('text', { x: CARD.x + 46, y: y + 41.5, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5, 'font-family': MONO }, content).textContent = t.span;
        K.el('text', { x: CARD.x + 90, y: y + 41.5, fill: c.muted, 'font-size': 8.5 }, content).textContent = '← author_span';
      });
    }

    function stat(k, v) { const e = R('stat-' + k); if (e) e.textContent = v; }
    function render() { stat('paths', PATHS.length); stat('commits', st.data.commits.length); stat('hops', 3); stat('queries', st.queries); }

    function lite(id, color) {
      const e = E(id); if (!e) return;
      e.setAttribute('stroke', color); e.setAttribute('stroke-width', 2.4); e.setAttribute('filter', K.glow(uid));
    }
    function liteEdge(id) {
      const e = E(id); if (!e) return;
      e.setAttribute('stroke', c.amber); e.setAttribute('stroke-width', 2); e.setAttribute('opacity', 0.95);
    }
    async function pulse(x1, y1, x2, y2) {
      const dot = K.el('circle', { cx: x1, cy: y1, r: 4.5, fill: c.amber, filter: K.glow(uid) }, anim);
      const p = { t: 0 };
      await animate(p, { t: 1, duration: dur(340), ease: 'inOut(2)', onUpdate: () => {
        dot.setAttribute('cx', x1 + (x2 - x1) * p.t); dot.setAttribute('cy', y1 + (y2 - y1) * p.t);
      } });
      dot.remove();
    }
    async function qGlow(id) {
      const e = R('q-' + id); if (!e) return;
      e.style.background = 'rgba(224,133,15,.32)'; e.style.borderRadius = '3px';
      await K.delay(dur(650));
      e.style.background = '';
    }
    function flashHops() {
      const e = R('stat-hops'); if (!e) return;
      e.style.color = c.amber;
      animate(e, { opacity: [1, 0.25, 1, 0.25, 1], duration: dur(700), ease: 'inOut(2)',
        onComplete: () => { e.style.color = ''; } });
    }

    // the one query, animated: index seek, then three hops, then the answer card
    async function explain(pi) {
      if (st.busy) return; st.busy = true; setLock(true);
      drawScene(); // clear previous trace/halos/answer — the graph is redrawn dim
      const p = PATHS[pi];
      st.nextPath = (pi + 1) % PATHS.length;
      st.queries++; render();
      const { commits, tools } = st.data;
      let ci = -1, k = -1; // newest mutation row for this path = highest domain_sequence
      commits.forEach((cm, i) => { const j = cm.paths.indexOf(p); if (j >= 0) { ci = i; k = j; } });
      const cm = commits[ci], ti = cm.tool, t = tools[ti];
      lite('prow-' + pi, c.amber);
      qGlow('where');
      K.addLog(logBody, `WHERE path = "${p}" → index seek on commit_mutation`, 'warn');
      liteEdge(`e-p-${ci}-${k}`);
      await pulse(FILE.x + FILE.w, rowMid(pi), CHIP.x, chipY(ci, k) + CHIP.h / 2);
      lite(`mchip-${ci}-${k}`, c.amber);
      K.addLog(logBody, `hop 1 · newest mutation row (${base(p)}, ${cm.id}) → its commit`);
      await pulse(CHIP.x + CHIP.w, chipY(ci, k) + CHIP.h / 2, CMT.cx - CMT.r, CMT.y(ci));
      lite('cnode-' + ci, c.amber);
      qGlow('hop');
      K.addLog(logBody, `hop 2 · commit ${cm.id} → author_span ${t.span} (record link)`);
      liteEdge('e-c-' + ci);
      await pulse(CMT.cx + CMT.r, CMT.y(ci), CARD.x + 10, spanY(ti));
      lite('schip-' + ti, c.amber);
      await pulse(CARD.x + 46, spanY(ti), CARD.x + CARD.w / 2, CARD.y(ti) + 10);
      lite('tcard-' + ti, c.amber);
      K.addLog(logBody, `hop 3 · span ${t.span} → tool ${t.name} · ${t.status}`, t.status === 'FAILED' ? 'err' : 'ok');
      flashHops();
      showAnswer(p, cm, t);
      st.lastTool = ti; st.lastPath = p;
      st.busy = false; setLock(false);
    }

    function showAnswer(p, cm, t) {
      const ago = st.data.commits.length - cm.idx;
      const agoTxt = ago === 0 ? 'latest commit' : ago + ' commit' + (ago > 1 ? 's' : '') + ' ago';
      const g = K.el('g', { id: uid + '-ans', opacity: 0 }, content);
      K.el('rect', { x: ANS.x, y: ANS.y, width: ANS.w, height: ANS.h, rx: 9, fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.7, filter: K.glow(uid) }, g);
      const tx = K.el('text', { x: ANS.x + ANS.w / 2, y: ANS.y + 23, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 700 }, g);
      [[p, c.blue], ['  —  written by ', c.muted], [t.name, c.text],
        ['  ·  commit ' + cm.id + '  ·  ', c.muted], [t.status, t.status === 'FAILED' ? c.red : c.green],
        ['  ·  ' + agoTxt, c.muted]]
        .forEach(([s, col]) => { K.el('tspan', { fill: col }, tx).textContent = s; });
      animate(g, { opacity: [0, 1], duration: dur(260), ease: 'out(2)' });
      const pr = { v: 16 };
      animate(pr, { v: 0, duration: dur(320), ease: 'out(3)', onUpdate: () => g.setAttribute('transform', `translate(0,${pr.v})`) });
    }

    // the blast-radius question: what ELSE did that run touch?
    async function blast() {
      if (st.busy || st.lastTool == null) return; st.busy = true; setLock(true);
      const ti = st.lastTool, t = st.data.tools[ti];
      const touched = new Set();
      t.commits.forEach((ci) => st.data.commits[ci].paths.forEach((p) => touched.add(p)));
      const others = PATHS.filter((p) => touched.has(p) && p !== st.lastPath);
      lite('tcard-' + ti, c.green);
      for (const p of others) {
        const pi = PATHS.indexOf(p);
        halo(FILE.x - 3, FILE.y(pi) - 3, FILE.w + 6, FILE.h + 6);
        st.data.commits.forEach((cm, ci) => {
          if (cm.tool !== ti) return;
          const k = cm.paths.indexOf(p);
          if (k >= 0) halo(CHIP.x - 2.5, chipY(ci, k) - 2.5, CHIP.w + 5, CHIP.h + 5);
        });
        await K.delay(dur(260));
      }
      K.addLog(logBody, others.length
        ? `blast radius · ${t.name}'s commits also touched ${others.join(', ')}`
        : `blast radius · ${t.name} touched nothing besides ${st.lastPath}`, 'ok');
      st.busy = false; setLock(false);
    }
    function halo(x, y, w, h) {
      const r = K.el('rect', { x, y, width: w, height: h, rx: 8, fill: 'none', stroke: c.green, 'stroke-width': 2, filter: K.glow(uid), opacity: 0 }, anim);
      animate(r, { opacity: [0, 0.95], duration: dur(260), ease: 'out(2)' });
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      const my = st;
      while (st === my && my.playing) { await explain(my.nextPath); await K.delay(dur(1200)); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 7); st.speed = sp;
      pp(); drawScene(); render();
      root.querySelector('.t-blast').disabled = true;
      K.addLog(logBody, `↺ reset — seed ${st.seed}: fresh history, same one-query answer`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-explain', '.t-reset'], b);
      root.querySelector('.t-blast').disabled = b || st.lastTool == null;
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-explain').onclick = () => { if (!st.busy && !st.playing) explain(st.nextPath); };
      root.querySelector('.t-blast').onclick = () => { if (!st.playing) blast(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSProvenance = { init };
})();
