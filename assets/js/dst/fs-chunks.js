/**
 * FS Chunks (dst-kit) — content addressing: a chunk's name IS the hash of its bytes.
 *
 * The post's point: a file's bytes are split into fixed 256 KiB chunks and each chunk is stored
 * under the BLAKE3 digest of its bytes. Equal bytes ⟹ equal name, so writing the same data twice
 * stores it once (dedup falls out for free), and editing one byte mints a NEW chunk while the old
 * one stays in the store untouched (immutability — nothing is ever overwritten in place).
 * Exposes window.FSChunks.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-chunks: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-chunks: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 268;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const FA = { label: 32, y: 40 };                                   // file A strip
  const FB = { label: 96, y: 104 };                                  // file B strip (after ⿻)
  const CH = { x0: 24, w: 92, gap: 8, h: 34, max: 7 };               // logical chunk boxes
  const ST = { x: 18, y: 152, w: 744, h: 108, x0: 28, r0: 176, r1: 218, bw: 84, gx: 6, bh: 34, cols: 8, cap: 16 };

  // A chunk's NAME is a pure function of its BYTES (stand-in for BLAKE3): FNV-1a → 'a3f2…9c'.
  // Equal content strings ALWAYS map to the equal digest string; different content differs.
  function digest(bytes) {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h >>>= 0;
    const x = h.toString(16).padStart(8, '0');
    return x.slice(0, 4) + '…' + x.slice(6, 8);
  }

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 7 : seed;
      const rng = K.rng(s);
      const n = 4 + Math.floor(rng() * 3);                           // 4–6 chunks, seeded
      const fileA = [];
      for (let j = 0; j < n; j++) fileA.push('blob-' + j + '-' + Math.floor(rng() * 0xffffff).toString(16));
      return { seed: s, rng, files: [fileA], store: fileA.slice(), edits: 0,
               busy: false, playing: false, speed: 1 };
    };
    let st = fresh(7);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const chunkX = (j) => CH.x0 + j * (CH.w + CH.gap);
    const refSet = () => { const r = new Set(); st.files.forEach((f) => f.forEach((b) => r.add(b))); return r; };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--amber t-edit">✎ edit one byte</button>
        <button class="dstk-btn dstk-btn--blue t-append">＋ append</button>
        <button class="dstk-btn dstk-btn--purple t-dup">⿻ duplicate file</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="dstk-seed t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Chunks are named by their bytes', sub: 'BLAKE3(content) → chunk id · dedup and immutability fall out',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'logical', label: 'logical chunks' }, { id: 'stored', label: 'stored chunks' }, { id: 'saved', label: 'dedup saved' }],
        cap: "A chunk's name is the hash of its bytes. Change one byte and you get a new name; "
           + 'write the same bytes twice and you get the same chunk once.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 each box in the store below is named by the hash of its bytes — try ✎ edit, then ⿻ duplicate', 'hl');
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      const ref = refSet();
      const sPos = {}; st.store.forEach((b, i) => { sPos[b] = i; });
      K.el('text', { x: 18, y: 16, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'Equal bytes ⟹ equal name: every logical chunk points at THE stored chunk carrying its digest.';
      // pointer lines first, so the boxes overlay them
      st.files.forEach((f, fi) => {
        const sy = fi === 0 ? FA.y : FB.y;
        f.forEach((b, j) => {
          const i = sPos[b]; if (i == null) return;
          const col = i % ST.cols, row = Math.floor(i / ST.cols);
          K.el('line', { x1: chunkX(j) + CH.w / 2, y1: sy + CH.h,
            x2: ST.x0 + col * (ST.bw + ST.gx) + ST.bw / 2, y2: row === 0 ? ST.r0 : ST.r1,
            stroke: fi === 0 ? c.blue : c.green, 'stroke-width': 1, opacity: 0.32 }, content);
        });
      });
      drawFile(0, FA, 'file A — logical bytes, split into 256 KiB chunks', 'blue');
      if (st.files[1]) drawFile(1, FB, 'file B — duplicate: same bytes, same names, zero new chunks', 'green');
      // the content-addressed chunk store
      const unref = st.store.filter((b) => !ref.has(b)).length;
      K.el('rect', { x: ST.x, y: ST.y, width: ST.w, height: ST.h, rx: 10, fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1.2, opacity: 0.9 }, content);
      K.el('text', { x: ST.x + 10, y: ST.y + 16, fill: c.text, 'font-size': 10, 'font-weight': 700 }, content)
        .textContent = 'chunk store (content-addressed)';
      K.el('text', { x: ST.x + ST.w - 10, y: ST.y + 16, 'text-anchor': 'end', fill: c.muted, 'font-size': 8.5 }, content)
        .textContent = `${st.store.length - unref} referenced · ${unref} unreferenced (kept — chunks are immutable)`;
      st.store.forEach((b, i) => {
        const col = i % ST.cols, row = Math.floor(i / ST.cols);
        const x = ST.x0 + col * (ST.bw + ST.gx), y = row === 0 ? ST.r0 : ST.r1;
        const on = ref.has(b);
        K.el('rect', { id: `${uid}-st-${i}`, x, y, width: ST.bw, height: ST.bh, rx: 6,
          fill: K.grad(uid, on ? 'purple' : 'gray'), stroke: on ? c.purple : c.gray, 'stroke-width': on ? 1.6 : 1 }, content);
        K.el('text', { x: x + ST.bw / 2, y: y + 14, 'text-anchor': 'middle', fill: on ? c.text : c.gray,
          'font-size': 9, 'font-weight': 700, 'font-family': MONO }, content).textContent = digest(b);
        K.el('text', { x: x + ST.bw / 2, y: y + 27, 'text-anchor': 'middle', fill: on ? c.muted : c.gray, 'font-size': 8.5 }, content)
          .textContent = on ? '256 KiB' : 'unreferenced';
      });
    }

    function drawFile(fi, F, label, zone) {
      K.el('text', { x: CH.x0, y: F.label, fill: c.muted, 'font-size': 8.5, 'font-weight': 700 }, content).textContent = label;
      st.files[fi].forEach((b, j) => {
        const x = chunkX(j);
        K.el('rect', { id: `${uid}-f${fi}-${j}`, x, y: F.y, width: CH.w, height: CH.h, rx: 6,
          fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.4 }, content);
        K.el('text', { x: x + CH.w / 2, y: F.y + 13, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, content)
          .textContent = 'c' + (j + 1) + ' · 256 KiB';
        K.el('text', { x: x + CH.w / 2, y: F.y + 28, 'text-anchor': 'middle', fill: c.text,
          'font-size': 9.5, 'font-weight': 700, 'font-family': MONO }, content).textContent = digest(b);
      });
    }

    function pulse(elm) { if (elm) animate(elm, { opacity: [0.12, 1], duration: dur(620), ease: 'out(2)' }); }
    function addToStore(b) { if (st.store.indexOf(b) < 0) { st.store.push(b); return true; } return false; }
    function trimStore() {
      let trimmed = false;
      while (st.store.length > ST.cap) {
        const ref = refSet();
        const i = st.store.findIndex((b) => !ref.has(b));
        if (i < 0) break;
        st.store.splice(i, 1); trimmed = true;
      }
      if (trimmed) K.addLog(logBody, '(oldest unreferenced chunks scrolled off the view — in the real store they stay until GC)', null);
    }

    async function editOne() {
      if (st.busy) return; st.busy = true; setLock(true);
      const f = st.files[0];
      const j = Math.floor(st.rng() * f.length);
      const oldB = f[j], newB = oldB + '*';                           // one changed byte ⟹ entirely new name
      f[j] = newB; st.edits++;
      const isNew = addToStore(newB); trimStore();
      drawScene(); render();
      pulse(E(`f0-${j}`)); pulse(E('st-' + st.store.indexOf(newB)));
      const refB = st.files[1] && st.files[1].indexOf(oldB) >= 0;
      K.addLog(logBody, `✎ edit in chunk ${j + 1} → digest ${digest(newB)} → ${isNew ? 'new chunk stored' : 'same bytes already stored — reused'}; `
        + `old ${digest(oldB)} kept (immutable, ${refB ? 'still referenced by file B' : 'now unreferenced'})`, 'warn');
      await K.delay(dur(420));
      st.busy = false; setLock(false);
    }

    async function append() {
      if (st.busy) return;
      const f = st.files[0];
      if (f.length >= CH.max) { K.addLog(logBody, 'file A strip is full — Reset to start over', 'warn'); return; }
      st.busy = true; setLock(true);
      const b = 'blob-' + f.length + '-' + Math.floor(st.rng() * 0xffffff).toString(16);
      f.push(b);
      const isNew = addToStore(b); trimStore();
      drawScene(); render();
      pulse(E(`f0-${f.length - 1}`)); pulse(E('st-' + st.store.indexOf(b)));
      K.addLog(logBody, `＋ append → new bytes hash to ${digest(b)} → ${isNew ? 'one new chunk stored' : 'same bytes already stored — reused'}`, null);
      await K.delay(dur(420));
      st.busy = false; setLock(false);
    }

    async function duplicate() {
      if (st.busy) return;
      if (st.files[1]) { K.addLog(logBody, '⿻ file B already exists — writing the same bytes again would still add 0 chunks', 'warn'); return; }
      st.busy = true; setLock(true);
      const before = st.store.length;
      st.files.push(st.files[0].slice());
      drawScene(); render();
      st.files[1].forEach((b, j) => pulse(E(`f1-${j}`)));
      K.addLog(logBody, `⿻ duplicate file → +${st.files[1].length} logical chunks, +${st.store.length - before} stored chunks: `
        + 'every chunk hashes to a name already in the store', 'ok');
      await K.delay(dur(420));
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      const logical = st.files.reduce((a, f) => a + f.length, 0);
      const stored = refSet().size;
      stat('logical', logical); stat('stored', stored); stat('saved', logical - stored);
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await editOne(); await K.delay(dur(700)); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      const sp = st.speed;
      st.playing = false;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 7); st.speed = sp;
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed}: ${st.files[0].length} chunks, each stored once under the hash of its bytes`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-edit', '.t-append', '.t-dup', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }

    function bind() {
      root.querySelector('.t-edit').onclick = editOne;
      root.querySelector('.t-append').onclick = append;
      root.querySelector('.t-dup').onclick = duplicate;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSChunks = { init };
})();
