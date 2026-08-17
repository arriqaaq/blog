/**
 * FS Syscall Path (dst-kit) — write() returns long before the bytes reach the disk.
 *
 * The post's point: write(2) walks application → syscall → VFS → ext4 → PAGE CACHE, copies the
 * bytes into a page there (copy_from_user), marks the page dirty, and returns. That is the whole
 * syscall. Nothing has touched the device. Only the kernel's own writeback (the bdi flusher
 * threads, woken on dirty_writeback_centisecs, writing pages older than dirty_expire_centisecs)
 * or an explicit fsync(2) pushes those pages through the block layer to the disk — and fsync
 * additionally issues a device cache FLUSH before it returns. A power cut in between destroys
 * exactly the pages that were still dirty: no more, no less.
 * Exposes window.FSSyscallPath.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-syscall-path: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-syscall-path: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 330;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const BX = 34, BW = 722;                       // layer band geometry
  const TOKX = 262, PGW = 42, PGH = 24, PGG = 6; // page tokens
  const MAXD = 9, MAXDISK = 10;
  const PCROW = 200, DISKROW = 294, LANEX = 228; // token rows + the descent lane
  const LAYERS = [
    { k: 'app',  y: 40,  h: 30, z: 'gray',   n: 'application',       s: 'char buf[5];  n = write(fd, buf, 5);' },
    { k: 'sys',  y: 76,  h: 30, z: 'blue',   n: 'write() syscall',   s: 'trap into the kernel — sys_write()' },
    { k: 'vfs',  y: 112, h: 30, z: 'gray',   n: 'VFS',               s: 'generic layer — file->f_op->write_iter' },
    { k: 'fs',   y: 148, h: 30, z: 'gray',   n: 'filesystem (ext4)', s: 'ext4_file_write_iter → generic_perform_write' },
    { k: 'pc',   y: 184, h: 52, z: 'purple', n: 'page cache',        s: 'copy_from_user → set_page_dirty' },
    { k: 'blk',  y: 242, h: 30, z: 'gray',   n: 'block layer',       s: 'bio → request queue → device driver' },
    { k: 'disk', y: 278, h: 46, z: 'green',  n: 'disk',              s: 'the only durable place' },
  ];
  const LM = {}; LAYERS.forEach((L) => { LM[L.k] = L; });
  const cy = (k) => LM[k].y + LM[k].h / 2;
  const sw = (k) => (k === 'pc' ? 1.8 : 1.2);
  const slotX = (i) => TOKX + i * (PGW + PGG);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 5 : seed;
      return { seed: s, rng: K.rng(s), dirty: [], disk: 0, lost: 0, nid: 0,
        busy: false, playing: false, speed: 1 };
    };
    let st = fresh(5);
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const R = (k) => root.querySelector('#' + CSS.escape(`${uid}-${k}`));

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--amber t-write">✎ write()</button>
        <button class="dstk-btn dstk-btn--blue t-wb">⏱ writeback</button>
        <button class="dstk-btn dstk-btn--green t-fsync">⇩ fsync()</button>
        <button class="dstk-btn dstk-btn--red t-crash">⚡ crash</button></div>
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

    function build() {
      root.innerHTML = K.container({
        title: 'write() returns before the disk knows', sub: 'user buffer → page cache → (later) block layer → disk',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'dirty', label: 'dirty pages' }, { id: 'disk', label: 'on disk' }, { id: 'lost', label: 'lost' }],
        cap: 'write() copies into the page cache and returns. Only writeback or fsync() moves it to disk — '
           + 'and a crash in between loses exactly what was still dirty.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 press ✎ write() and watch where the token stops — it never reaches the disk on its own', 'hl');
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      K.el('text', { x: BX, y: 18, fill: c.muted, 'font-size': 10 }, content)
        .textContent = 'One write(2) call, top to bottom. Watch where it actually stops.';
      K.el('text', { x: BX + BW, y: 18, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
        .textContent = 'each token = one 4 KiB page';
      // the return path: the syscall unwinds from the page cache, not from the disk
      K.el('path', { d: `M ${BX},${cy('pc')} L 18,${cy('pc')} L 18,${cy('app')} L ${BX - 3},${cy('app')}`,
        fill: 'none', stroke: c.green, 'stroke-width': 1.6, 'marker-end': K.arrow(uid, 'green'), opacity: 0.85 }, content);
      LAYERS.forEach(drawBand);
      redrawTrays();
    }

    function drawBand(L) {
      const wide = L.h > 40;
      K.el('rect', { id: `${uid}-b-${L.k}`, x: BX, y: L.y, width: BW, height: L.h, rx: 8,
        fill: K.grad(uid, L.z), stroke: c[L.z], 'stroke-width': sw(L.k) }, content);
      K.el('text', { x: BX + 12, y: L.y + (wide ? 17 : 19), fill: c.text, 'font-size': 11.5, 'font-weight': 700 }, content)
        .textContent = L.n;
      K.el('text', { x: wide ? BX + 12 : BX + BW - 12, y: L.y + (wide ? 31 : 19),
        'text-anchor': wide ? 'start' : 'end', fill: c.muted, 'font-size': 8.5, 'font-family': MONO }, content)
        .textContent = L.s;
      if (L.k === 'pc')
        K.el('text', { x: BX + 12, y: L.y + 45, fill: c.green, 'font-size': 9, 'font-weight': 700 }, content)
          .textContent = '◄ write() returns from here';
    }

    // both token trays re-render straight from state, so a theme rebuild keeps the picture
    function redrawTrays() {
      let g = E('trays'); if (g) g.remove();
      g = K.el('g', { id: uid + '-trays' }, content);
      const nd = st.dirty.length;
      K.el('text', { x: TOKX, y: 196, fill: nd ? c.amber : c.muted, 'font-size': 8.5, 'font-weight': nd ? 700 : 400 }, g)
        .textContent = nd ? `${nd} dirty page${nd > 1 ? 's' : ''} — RAM only, gone if the power drops`
                          : 'no dirty pages — every page here matches the disk';
      const dg = K.el('g', { id: uid + '-dirtyg' }, g);
      st.dirty.slice(0, MAXD).forEach((p, i) => {
        const x = slotX(i);
        const tg = K.el('g', { id: `${uid}-d-${i}` }, dg);
        K.el('rect', { id: `${uid}-dr-${i}`, x, y: PCROW, width: PGW, height: PGH, rx: 5,
          fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.6 }, tg);
        K.el('text', { x: x + PGW / 2, y: PCROW + 10, 'text-anchor': 'middle', fill: c.amber, 'font-size': 8.5, 'font-weight': 700 }, tg)
          .textContent = 'dirty';
        K.el('text', { x: x + PGW / 2, y: PCROW + 20, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5, 'font-family': MONO }, tg)
          .textContent = 'p' + p.id;
      });
      K.el('text', { x: TOKX, y: 290, fill: st.disk ? c.green : c.muted, 'font-size': 8.5, 'font-weight': st.disk ? 700 : 400 }, g)
        .textContent = st.disk ? `${st.disk} page${st.disk > 1 ? 's' : ''} written out — these survive a power cut`
                               : 'nothing here yet — write() alone never puts a byte on the platter';
      const kg = K.el('g', { id: uid + '-diskg' }, g);
      const shown = Math.min(st.disk, MAXDISK);
      for (let i = 0; i < shown; i++) {
        const x = slotX(i);
        K.el('rect', { x, y: DISKROW, width: PGW, height: PGH, rx: 5,
          fill: K.grad(uid, 'green'), stroke: c.green, 'stroke-width': 1.5 }, kg);
        K.el('text', { x: x + PGW / 2, y: DISKROW + 15, 'text-anchor': 'middle', fill: c.green, 'font-size': 9, 'font-weight': 700 }, kg)
          .textContent = 'clean';
      }
      if (st.disk > MAXDISK)
        K.el('text', { x: BX + BW - 10, y: DISKROW + 16, 'text-anchor': 'end', fill: c.green, 'font-size': 9, 'font-weight': 700 }, kg)
          .textContent = '+' + (st.disk - MAXDISK);
    }

    function flash(k, col) {
      const r = E('b-' + k); if (!r) return;
      r.setAttribute('stroke', col); r.setAttribute('stroke-width', 2.8);
      animate(r, { opacity: [0.4, 1], duration: dur(340), ease: 'out(2)',
        onComplete: () => { r.setAttribute('stroke', c[LM[k].z]); r.setAttribute('stroke-width', sw(k)); } });
    }
    function mkToken(x, y, label, zone) {
      const g = K.el('g', { transform: `translate(${x},${y})` }, anim);
      K.el('rect', { x: -PGW / 2, y: -PGH / 2, width: PGW, height: PGH, rx: 5,
        fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.7, filter: K.glow(uid) }, g);
      K.el('text', { x: 0, y: 3.5, 'text-anchor': 'middle', fill: c.text, 'font-size': 9, 'font-weight': 700 }, g).textContent = label;
      return g;
    }
    function move(g, p, x, y, ms) {
      return animate(p, { x, y, duration: dur(ms), ease: 'inOut(2)',
        onUpdate: () => g.setAttribute('transform', `translate(${p.x},${p.y})`) });
    }
    function chip(x, y, w, msg, zone, hold) {
      const g = K.el('g', { opacity: 0 }, anim);
      K.el('rect', { x, y, width: w, height: 20, rx: 6, fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.6, filter: K.glow(uid) }, g);
      K.el('text', { x: x + w / 2, y: y + 14, 'text-anchor': 'middle', fill: c[zone], 'font-size': 9.5, 'font-weight': 700 }, g).textContent = msg;
      animate(g, { opacity: [0, 1], duration: dur(180), ease: 'out(2)' });
      animate(g, { opacity: [1, 0], delay: dur(hold || 1300), duration: dur(480), ease: 'in(2)', onComplete: () => g.remove() });
    }
    // a transient caption that does not cover the token trays
    function note(x, y, msg, col) {
      const t = K.el('text', { x, y, 'text-anchor': 'end', fill: col, 'font-size': 9.5, 'font-weight': 700, opacity: 0 }, anim);
      t.textContent = msg;
      animate(t, { opacity: [0, 1], duration: dur(180), ease: 'out(2)' });
      animate(t, { opacity: [1, 0], delay: dur(1400), duration: dur(480), ease: 'in(2)', onComplete: () => t.remove() });
    }

    async function doWrite() {
      if (st.busy) return;
      if (st.dirty.length >= MAXD) {
        K.addLog(logBody, '✎ write() stalls — dirty_ratio reached: balance_dirty_pages() throttles the writer '
          + 'until writeback catches up. The kernel bounds how much you can lose, it does not save it', 'warn');
        return;
      }
      st.busy = true; setLock(true);
      const idx = st.dirty.length;
      const p = { x: LANEX, y: cy('app') };
      const g = mkToken(p.x, p.y, '5 B', 'blue');
      flash('app', c.blue);
      K.addLog(logBody, 'write(fd, buf, 5) → sys_write → VFS → ext4 → page cache', null);
      for (const k of ['sys', 'vfs', 'fs']) { flash(k, c.blue); await move(g, p, LANEX, cy(k), 230); }
      flash('pc', c.amber);
      await move(g, p, LANEX, PCROW + PGH / 2, 230);
      await move(g, p, slotX(idx) + PGW / 2, PCROW + PGH / 2, 300);
      g.remove();
      st.dirty.push({ id: ++st.nid });
      redrawTrays(); render();
      flash('app', c.green);
      chip(300, LM.app.y + 5, 200, '↩ write() returned 5', 'green');
      K.addLog(logBody, 'write() returned 5 — nothing is on disk yet', 'warn');
      st.busy = false; setLock(false);
    }

    // move the first n dirty pages down through the block layer into the disk tray
    async function flushPages(n) {
      const moving = st.dirty.slice(0, n);
      const base = st.disk;
      // the departing pages dim in place; the tray only compacts once they have landed
      for (let j = 0; j < Math.min(n, MAXD); j++) { const t = E('d-' + j); if (t) t.setAttribute('opacity', 0.16); }
      flash('blk', c.blue);
      await Promise.all(moving.map((pg, j) => (async () => {
        await K.delay(dur(110 * j));
        const p = { x: slotX(Math.min(j, MAXD - 1)) + PGW / 2, y: PCROW + PGH / 2 };
        const g = mkToken(p.x, p.y, 'p' + pg.id, 'amber');
        await move(g, p, LANEX, cy('blk'), 230);
        await move(g, p, slotX(Math.min(base + j, MAXDISK - 1)) + PGW / 2, DISKROW + PGH / 2, 260);
        g.remove();
      })()));
      st.dirty.splice(0, n);
      st.disk += moving.length;
      flash('disk', c.green);
      redrawTrays(); render();
      return moving.length;
    }

    async function writeback() {
      if (st.busy) return;
      if (!st.dirty.length) {
        K.addLog(logBody, '⏱ writeback timer fired — no dirty pages for this file, nothing to submit', null);
        return;
      }
      st.busy = true; setLock(true);
      const n = 1 + Math.floor(st.rng() * st.dirty.length);   // the kernel picks how much, not you
      K.addLog(logBody, '⏱ dirty_writeback_centisecs elapsed → a bdi flusher thread submits bios for aged pages', null);
      await flushPages(n);
      K.addLog(logBody, `⏱ writeback wrote ${n} page${n > 1 ? 's' : ''}, ${st.dirty.length} still dirty — `
        + 'unrequested, unordered, and on no schedule you may depend on', null);
      st.busy = false; setLock(false);
    }

    async function fsync() {
      if (st.busy) return;
      st.busy = true; setLock(true);
      const n = st.dirty.length;
      if (n) {
        K.addLog(logBody, `⇩ fsync(fd) → forcing all ${n} dirty page${n > 1 ? 's' : ''} plus the file's metadata down the block layer`, 'warn');
        await flushPages(n);
      } else {
        K.addLog(logBody, '⇩ fsync(fd) → nothing dirty for this file, but it still orders a device cache FLUSH before returning', null);
      }
      chip(BX + BW - 236, LM.blk.y + 5, 224, 'FLUSH — device write cache emptied', 'green', 1000);
      await K.delay(dur(340));
      K.addLog(logBody, 'fsync() returned — now it is durable', 'ok');
      st.busy = false; setLock(false);
    }

    async function crash() {
      if (st.busy) return;
      st.busy = true; setLock(true);
      const n = st.dirty.length;
      for (let i = 0; i < Math.min(n, MAXD); i++) {
        const r = E('dr-' + i); if (!r) continue;
        r.setAttribute('fill', K.grad(uid, 'red')); r.setAttribute('stroke', c.red);
      }
      flash('pc', c.red);
      note(BX + BW - 10, 196, '⚡ power loss — RAM contents gone', c.red);
      await K.delay(dur(420));
      const dg = E('dirtyg');
      if (dg) await animate(dg, { opacity: [1, 0], duration: dur(340), ease: 'in(2)' });
      st.lost += n; st.dirty = [];
      redrawTrays(); render();
      if (n) {
        K.addLog(logBody, `⚡ ${n} dirty page${n > 1 ? 's' : ''} lost — exactly the pages that had not reached the disk`, 'err');
        K.addLog(logBody, `${st.disk} page${st.disk === 1 ? '' : 's'} already written survive. ext4 replays its journal so the `
          + 'metadata is consistent again — that does not bring the data back', 'warn');
      } else {
        K.addLog(logBody, '⚡ power loss with 0 dirty pages — nothing to lose. The last fsync() is your recovery point', 'ok');
      }
      st.busy = false; setLock(false);
    }

    function stat(k, v) { const e = R('stat-' + k); if (e) e.textContent = v; }
    function render() {
      stat('dirty', st.dirty.length); stat('disk', st.disk); stat('lost', st.lost);
      const d = R('stat-dirty'); if (d) d.style.color = st.dirty.length ? c.amber : '';
      const l = R('stat-lost'); if (l) l.style.color = st.lost ? c.red : '';
    }

    // seeded action mix: mostly writes, some writeback, the occasional fsync, a rare power cut
    async function tick() {
      if (st.dirty.length >= MAXD) { await writeback(); return; }
      const r = st.rng();
      if (r < 0.58) await doWrite();
      else if (r < 0.80) await writeback();
      else if (r < 0.93) await fsync();
      else if (st.dirty.length) await crash();
      else await doWrite();
    }
    async function play() {
      if (st.playing) return; st.playing = true; pp();
      const my = st;
      while (st === my && my.playing) { await tick(); await K.delay(dur(560)); }
      if (st === my) { my.playing = false; pp(); }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 5); st.speed = sp;
      pp(); setLock(false); drawScene(); render();
      K.addLog(logBody, `↺ reset — seed ${st.seed} decides how many pages each writeback happens to flush`, 'hl');
    }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-write', '.t-wb', '.t-fsync', '.t-crash', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-write').onclick = doWrite;
      root.querySelector('.t-wb').onclick = writeback;
      root.querySelector('.t-fsync').onclick = fsync;
      root.querySelector('.t-crash').onclick = crash;
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSSyscallPath = { init };
})();
