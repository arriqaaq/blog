/**
 * FS FUSE Loop (dst-kit) — a filesystem implemented by a normal userspace process.
 *
 * FUSE is not a filesystem. It is a kernel module that answers the VFS by asking someone else:
 * a plain userspace process sitting in read(/dev/fuse). One read(2) from an application therefore
 * becomes a lap: syscall → VFS → fuse module → a FUSE_READ request tagged with a unique id →
 * /dev/fuse → the daemon wakes with it → the daemon writes a reply carrying the SAME unique id →
 * the module matches it → VFS → the application finally gets its bytes. Four crossings of the
 * kernel/userspace line, three copies. Press ⚡ to run the same read() against an in-kernel
 * filesystem and watch it never leave the kernel at all. Exposes window.FSFuseLoop.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('fs-fuse-loop: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('fs-fuse-loop: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 312, LINE = 148;
  const MONO = "ui-monospace,'SF Mono',monospace";
  const FWD = 228, RET = 248;
  const N = {
    app: { x: 28, y: 44, w: 170, h: 72, cx: 113 },
    dmn: { x: 482, y: 44, w: 220, h: 80, cx: 592 },
    sys: { x: 53, y: 182, w: 120, h: 76, cx: 113 },
    vfs: { x: 196, y: 182, w: 110, h: 76, cx: 251 },
    mod: { x: 326, y: 182, w: 150, h: 76, cx: 401 },
    dev: { x: 502, y: 174, w: 180, h: 92, cx: 592 },
  };
  const NAMES = ['main.rs', 'lib.rs', 'notes.md', 'config.toml', 'data.bin'];
  const SIZES = [4096, 8192, 16384, 32768];
  // segments, reused by every op
  const S_IN = [95, 116, 95, 182], S_OUT = [131, 182, 131, 116];
  const S_UP = [566, 174, 566, 124], S_DOWN = [618, 124, 618, 174];
  const S_SV = [113, FWD, 251, FWD], S_VM = [251, FWD, 401, FWD], S_MD = [401, FWD, 592, FWD];
  const S_DM = [592, RET, 401, RET], S_MV = [401, RET, 251, RET], S_VS = [251, RET, 113, RET];

  function codeHtml(uid) {
    return `<pre class="dstk-code"><span class="k">loop</span> {
<span id="${uid}-c-read">    <span class="k">let</span> req = read(<span class="s">/dev/fuse</span>)?;   <span class="c">// blocks until the kernel has work</span></span>
<span id="${uid}-c-disp">    <span class="k">let</span> reply = dispatch(req);    <span class="c">// FUSE_LOOKUP, FUSE_READ, ...</span></span>
<span id="${uid}-c-write">    write(<span class="s">/dev/fuse</span>, reply)?;     <span class="c">// matched by req.unique</span></span>
}</pre>`;
  }

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => {
      const s = seed == null ? 7 : seed, rnd = K.rng(s);
      return { seed: s, nodeid: 2 + Math.floor(rnd() * 250), name: NAMES[Math.floor(rnd() * NAMES.length)],
        size: SIZES[Math.floor(rnd() * SIZES.length)], think: 260 + Math.floor(rnd() * 380),
        unique: 42, reqs: 0, cross: 0, copies: 0, fuseCross: 0, mode: 'fuse', turn: 0,
        busy: false, playing: false, speed: 1 };
    };
    let st = fresh();
    let svg, content, anim, logBody, c;
    const zones = {};   // box id → its resting zone colour, so dim() can restore it
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const R = (k) => root.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const T = (a, s, p) => { const e = K.el('text', a, p || content); e.textContent = s; return e; };

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-read">📖 read()</button>
        <button class="dstk-btn dstk-btn--blue t-lookup">🔍 lookup()</button>
        <button class="dstk-btn dstk-btn--amber t-kernel">⚡ compare: in-kernel fs</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'FUSE: a filesystem that lives in userspace',
        sub: 'one read() — count how many times it crosses the line',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 'req', label: 'requests' }, { id: 'cross', label: 'boundary crossings' },
          { id: 'kcross', label: 'in-kernel crossings' }],
        cap: 'A FUSE filesystem is an ordinary process. Every operation the kernel would have answered itself '
           + 'becomes a round trip out to userspace and back — which is the whole cost, and the whole point.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      const code = document.createElement('div');
      code.innerHTML = codeHtml(uid);
      root.querySelector('.dstk-toolbar').insertAdjacentElement('afterend', code.firstChild);
      root.querySelector('.t-speed').value = String(st.speed);
      drawScene(); bind(); render(); pp(); setLock(false);
      K.addLog(logBody, `🌱 seed ${st.seed} · nodeid ${st.nodeid} — unique ids start at 42 and step by 2 `
        + '(the low bit marks an INTERRUPT request)', 'hl');
    }

    function box(id, n, zone, title, sub, tf) {
      zones[id] = zone;
      K.el('rect', { id: `${uid}-${id}`, x: n.x, y: n.y, width: n.w, height: n.h, rx: 10,
        fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.5 }, content);
      T({ x: n.cx, y: n.y + 26, 'text-anchor': 'middle', fill: c.text, 'font-size': tf || 11.5, 'font-weight': 700 }, title);
      T({ x: n.cx, y: n.y + 40, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5 }, sub);
    }

    function drawScene() {
      content.innerHTML = ''; anim.innerHTML = '';
      const kern = st.mode === 'kernel';
      T({ x: 16, y: 16, fill: c.muted, 'font-size': 10 },
        'Every arrow that crosses the heavy line is a userspace ⇄ kernel transition. Count them.');
      // the two worlds
      K.el('rect', { x: 8, y: 26, width: 764, height: 104, rx: 10, fill: K.grad(uid, 'gray'), stroke: 'none', opacity: 0.5 }, content);
      K.el('rect', { x: 8, y: 166, width: 764, height: 108, rx: 10, fill: K.grad(uid, 'blue'), stroke: 'none', opacity: 0.45 }, content);
      T({ x: 16, y: 142, fill: c.text, 'font-size': 9.5, 'font-weight': 700, 'letter-spacing': '.1em' }, 'USERSPACE ▲');
      T({ x: 16, y: 162, fill: c.blue, 'font-size': 9.5, 'font-weight': 700, 'letter-spacing': '.1em' }, 'KERNEL ▼');
      T({ id: uid + '-readout', x: 764, y: 142, 'text-anchor': 'end', fill: c.muted, 'font-size': 10, 'font-weight': 700 }, '');
      // THE line — the whole point of the widget
      K.el('line', { id: uid + '-line', x1: 8, y1: LINE, x2: 772, y2: LINE, stroke: c.text, 'stroke-width': 3 }, content);
      K.el('line', { x1: 8, y1: LINE + 4, x2: 772, y2: LINE + 4, stroke: c.text, 'stroke-width': 1, opacity: 0.35, 'stroke-dasharray': '6 5' }, content);

      box('app', N.app, 'gray', 'application', 'cat · rustc · your editor', 12);
      K.el('rect', { id: uid + '-appchip', x: N.app.x + 12, y: N.app.y + 48, width: N.app.w - 24, height: 18, rx: 5,
        fill: K.grad(uid, 'gray'), stroke: c.gray, 'stroke-width': 1 }, content);
      T({ id: uid + '-appt', x: N.app.cx, y: N.app.y + 61, 'text-anchor': 'middle', fill: c.muted, 'font-size': 8.5, 'font-family': MONO }, 'idle');

      if (kern) {
        box('dmn', N.dmn, 'gray', 'no daemon involved', 'nothing in userspace is woken', 12);
        E('dmn').setAttribute('opacity', 0.32);
      } else {
        box('dmn', N.dmn, 'green', 'your filesystem daemon', 'an ordinary process — no kernel code', 12);
      }
      K.el('rect', { id: uid + '-dmnchip', x: N.dmn.x + 12, y: N.dmn.y + 50, width: N.dmn.w - 24, height: 20, rx: 5,
        fill: K.grad(uid, kern ? 'gray' : 'green'), stroke: kern ? c.gray : c.green, 'stroke-width': 1, opacity: kern ? 0.32 : 1 }, content);
      T({ id: uid + '-dmnt', x: N.dmn.cx, y: N.dmn.y + 64, 'text-anchor': 'middle', fill: kern ? c.muted : c.text,
        'font-size': 8.5, 'font-family': MONO, opacity: kern ? 0.4 : 1 }, kern ? '—' : 'blocked in read(/dev/fuse)');

      box('sys', N.sys, 'blue', 'syscall', 'read(2) traps in');
      box('vfs', N.vfs, 'blue', 'VFS', 'f_op->read_iter');
      if (kern) {
        box('mod', N.mod, 'blue', 'ext4', 'the fs IS kernel code');
        box('dev', N.dev, 'blue', 'page cache · block layer', 'the answer never leaves', 12);
      } else {
        box('mod', N.mod, 'blue', 'fuse kernel module', 'fs/fuse — builds requests');
        box('dev', N.dev, 'purple', '/dev/fuse', 'the queue both sides share', 13);
      }
      // the lanes, drawn faintly so the loop shape is legible before anything moves
      [[173, 196], [306, 326], [476, 502]].forEach(([a, b]) => {
        K.el('line', { x1: a, y1: FWD, x2: b, y2: FWD, stroke: c.muted, 'stroke-width': 1, opacity: 0.3 }, content);
        K.el('line', { x1: b, y1: RET, x2: a, y2: RET, stroke: c.muted, 'stroke-width': 1, opacity: 0.3 }, content);
      });
      T({ id: uid + '-hdr', x: 16, y: 288, fill: c.muted, 'font-size': 8.5, 'font-family': MONO }, 'no request in flight');
      T({ id: uid + '-hop', x: 16, y: 302, fill: c.muted, 'font-size': 9 }, 'press 📖 read() to send one request all the way round');
    }

    function stat(k, v) { const e = R('stat-' + k); if (e) e.textContent = v; }
    function render() {
      stat('req', st.reqs); stat('cross', st.fuseCross); stat('kcross', 0);
      const r = E('readout'); if (!r) return;
      r.textContent = st.mode === 'kernel'
        ? `crossings out to a filesystem: 0  ·  copies ${st.copies}`
        : `crossings ${st.cross} / 4  ·  copies ${st.copies}`;
      r.setAttribute('fill', st.mode === 'kernel' ? c.green : (st.cross ? c.red : c.muted));
    }

    function lite(id, col, w) {
      const e = E(id); if (!e) return;
      e.setAttribute('stroke', col); e.setAttribute('stroke-width', w || 2.6); e.setAttribute('filter', K.glow(uid));
    }
    function dim(id) {
      const e = E(id); if (!e) return;
      e.setAttribute('stroke', c[zones[id] || 'gray']);
      e.setAttribute('stroke-width', 1.5); e.removeAttribute('filter');
    }
    function chip(id, txt, col) {
      const t = E(id + 't'); if (t) { t.textContent = txt; t.setAttribute('fill', col || c.text); t.setAttribute('opacity', 1); }
      const r = E(id + 'chip'); if (r) r.setAttribute('opacity', 1);
    }
    function say(hop, hdr) {
      const h = E('hop'); if (h) { h.textContent = hop ? '→ ' + hop : ''; h.setAttribute('fill', c.text); }
      if (hdr != null) { const d = E('hdr'); if (d) d.textContent = hdr; }
    }
    function cGlow(id, col) {
      const e = R('c-' + id); if (!e) return;
      e.style.background = col; e.style.borderRadius = '3px';
      setTimeout(() => { e.style.background = ''; }, dur(760));
    }
    async function burst(x, counted) {
      const ring = K.el('circle', { cx: x, cy: LINE, r: 4, fill: 'none', stroke: counted ? c.red : c.gray,
        'stroke-width': 2.4, filter: K.glow(uid) }, anim);
      const ln = E('line');
      if (ln) animate(ln, { opacity: [1, 0.35, 1], duration: dur(320), ease: 'inOut(2)' });
      const p = { r: 4, o: 1 };
      await animate(p, { r: 20, o: 0, duration: dur(420), ease: 'out(2)', onUpdate: () => {
        ring.setAttribute('r', p.r); ring.setAttribute('opacity', p.o);
      } });
      ring.remove();
    }
    async function pulse(seg, zone) {
      const [x1, y1, x2, y2] = seg, col = c[zone];
      K.el('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': zone === 'red' ? 2.8 : 2, opacity: 0.75,
        'marker-end': K.arrow(uid, zone) }, anim);
      const dot = K.el('circle', { cx: x1, cy: y1, r: 5, fill: col, filter: K.glow(uid) }, anim);
      const p = { t: 0 };
      await animate(p, { t: 1, duration: dur(360), ease: 'inOut(2)', onUpdate: () => {
        dot.setAttribute('cx', x1 + (x2 - x1) * p.t); dot.setAttribute('cy', y1 + (y2 - y1) * p.t);
      } });
      dot.remove();
    }

    // ---- the three scripts -------------------------------------------------------------
    function opRead(u) {
      const sz = st.size;
      return { hdr: `fuse_in_header { len: 80, opcode: FUSE_READ (15), unique: ${u}, nodeid: ${st.nodeid} } + fuse_read_in { offset, size: ${sz} }`,
        hops: [
          { seg: S_IN, col: 'blue', cross: 1, to: 'sys', app: 'blocked in read(2)', hop: `read(fd, buf, ${sz})`,
            log: 'crossing 1 · user → kernel: the application traps into the syscall' },
          { seg: S_SV, col: 'blue', to: 'vfs', hop: 'vfs_read() → the file\'s f_op',
            log: 'the VFS dispatches on f_op — it neither knows nor cares who implements this file' },
          { seg: S_VM, col: 'blue', to: 'mod', hop: 'fuse_file_read_iter()',
            log: 'to the VFS, the "filesystem" is the fuse kernel module — which cannot answer either' },
          { seg: S_MD, col: 'purple', to: 'dev', hop: `queue FUSE_READ · unique = ${u}`, showHdr: 1,
            log: `the module builds a request and queues it on /dev/fuse: opcode FUSE_READ (15), unique ${u}` },
          { seg: S_UP, col: 'green', cross: 1, to: 'dmn', copy: 1, code: 'read', dmn: 'got req · dispatch()',
            hop: 'the daemon\'s blocked read(/dev/fuse) returns', cls: 'warn',
            log: 'crossing 2 · kernel → user: the daemon wakes holding the request — copy 1 of 3' },
          { seg: null, col: 'green', to: 'dmn', code: 'disp', dmn: 'computing the answer',
            hop: 'dispatch(req) — ordinary userspace code', think: 1,
            log: `the daemon produces ${sz} bytes however it likes: memory, network, a database, thin air` },
          { seg: S_DOWN, col: 'green', cross: 1, to: 'dev', copy: 1, code: 'write', dmn: 'write(reply)',
            hop: `write(/dev/fuse, reply) · unique = ${u}`, cls: 'warn',
            log: `crossing 3 · user → kernel: fuse_out_header { unique: ${u}, error: 0 } + ${sz} bytes — copy 2 of 3` },
          { seg: S_DM, col: 'blue', to: 'mod', hop: `match the reply to the request by unique = ${u}`, cls: 'ok',
            log: 'that is what unique is for: replies arrive out of order, the module pairs them up' },
          { seg: S_MV, col: 'blue', to: 'vfs', hop: 'request complete — wake the blocked task',
            log: 'the pages are filled and the application\'s task is made runnable again' },
          { seg: S_VS, col: 'blue', to: 'sys', hop: 'back out through the VFS',
            log: 'nothing left to do but return the way we came' },
          { seg: S_OUT, col: 'blue', cross: 1, to: 'app', copy: 1, app: `${sz} bytes`, hop: `read(2) returns ${sz}`, cls: 'ok',
            log: `crossing 4 · kernel → user: the application has its bytes. 4 crossings, 3 copies, one read().` },
        ] };
    }

    function opLookup(u) {
      const nm = st.name;
      return { hdr: `fuse_in_header { len: ${41 + nm.length}, opcode: FUSE_LOOKUP (1), unique: ${u}, nodeid: ${st.nodeid} } + "${nm}\\0"`,
        hops: [
          { seg: S_IN, col: 'blue', cross: 1, to: 'sys', app: `open(".../${nm}")`, hop: `openat(2) — the VFS must resolve the path`,
            log: 'crossing 1 · user → kernel: opening a path under the FUSE mount' },
          { seg: S_SV, col: 'blue', to: 'vfs', hop: `dcache miss on "${nm}" → i_op->lookup()`, cls: 'warn',
            log: 'the dentry cache has no entry for this name, so the VFS has to ask the filesystem' },
          { seg: S_VM, col: 'blue', to: 'mod', hop: 'fuse_lookup()',
            log: 'only the daemon knows what this name is — the module has to go and ask' },
          { seg: S_MD, col: 'purple', to: 'dev', hop: `queue FUSE_LOOKUP · unique = ${u}`, showHdr: 1,
            log: `same queue, different opcode: FUSE_LOOKUP (1), unique ${u}, parent nodeid ${st.nodeid}` },
          { seg: S_UP, col: 'green', cross: 1, to: 'dmn', copy: 1, code: 'read', dmn: 'got req · dispatch()',
            hop: `the daemon receives the name "${nm}"`, cls: 'warn',
            log: 'crossing 2 · kernel → user: 40-byte header plus the name — copy 1 of 2' },
          { seg: null, col: 'green', to: 'dmn', code: 'disp', dmn: 'resolving the name', think: 1,
            hop: 'dispatch(req) — one name in, one entry out',
            log: 'the daemon answers with a nodeid, attributes, and an entry_valid timeout' },
          { seg: S_DOWN, col: 'green', cross: 1, to: 'dev', copy: 1, code: 'write', dmn: 'write(reply)',
            hop: `write(/dev/fuse, reply) · unique = ${u}`, cls: 'warn',
            log: `crossing 3 · user → kernel: fuse_out_header (16 B) + fuse_entry_out (128 B) — 144 bytes, not ${st.size} — copy 2 of 2` },
          { seg: S_DM, col: 'blue', to: 'mod', hop: `matched by unique = ${u} → instantiate the dentry`, cls: 'ok',
            log: 'the kernel builds a dentry and inode and caches them for entry_valid seconds' },
          { seg: S_MV, col: 'blue', to: 'vfs', hop: 'one component of the path is resolved',
            log: 'until that timeout expires, this component is answered from the dcache for free' },
          { seg: S_VS, col: 'blue', to: 'sys', hop: '…and now the next component', cls: 'warn',
            log: 'a path of depth N costs N of these round trips whenever the dentry cache is cold' },
          { seg: S_OUT, col: 'blue', cross: 1, to: 'app', app: 'fd', hop: 'openat(2) returns', cls: 'ok',
            log: 'crossing 4 · kernel → user: same loop, cheaper payload — 4 crossings, 2 copies' },
        ] };
    }

    function opKernel() {
      const sz = st.size;
      return { hdr: 'no request is built — ext4_file_read_iter() runs in the caller\'s own context, below the line',
        hops: [
          { seg: S_IN, col: 'blue', shared: 1, to: 'sys', app: 'blocked in read(2)', hop: `read(fd, buf, ${sz}) — the same syscall`,
            log: 'the syscall in and out is identical either way — that is not what FUSE costs you' },
          { seg: S_SV, col: 'blue', to: 'vfs', hop: 'vfs_read() → the file\'s f_op',
            log: 'same VFS, same dispatch, same call stack' },
          { seg: S_VM, col: 'blue', to: 'mod', hop: 'ext4_file_read_iter()',
            log: 'the filesystem is kernel code: it runs right here, inline, in this thread' },
          { seg: S_MD, col: 'blue', to: 'dev', hop: 'page cache hit — or one block-layer read',
            log: 'no request is built, no id has to be matched, no process is scheduled' },
          { seg: S_DM, col: 'blue', to: 'mod', hop: 'the pages are ready',
            log: 'the answer was produced entirely below the line' },
          { seg: S_MV, col: 'blue', to: 'vfs', hop: 'straight back out through the VFS',
            log: 'nothing in userspace was ever woken to service this read' },
          { seg: S_OUT, col: 'blue', shared: 1, to: 'app', copy: 1, app: `${sz} bytes`, hop: `read(2) returns ${sz}`, cls: 'ok',
            log: `0 crossings out to a filesystem, 1 copy. FUSE needs 4 transitions for the same read — 2 of them exist only because the filesystem lives in userspace — and 3 copies.` },
        ] };
    }

    // ---- the runner --------------------------------------------------------------------
    async function run(kind) {
      if (st.busy) return; st.busy = true; setLock(true);
      const kern = kind === 'kernel';
      st.mode = kern ? 'kernel' : 'fuse';
      st.cross = 0; st.copies = 0;
      let u = 0;
      if (!kern) { u = st.unique; st.unique += 2; st.reqs++; }
      drawScene(); render();
      const op = kern ? opKernel() : kind === 'lookup' ? opLookup(u) : opRead(u);
      K.addLog(logBody, kern
        ? '⚡ same read(), but the filesystem is in the kernel — watch where it goes'
        : `📨 ${kind === 'lookup' ? 'FUSE_LOOKUP' : 'FUSE_READ'} · unique ${u} · nodeid ${st.nodeid}`, 'hl');
      for (const h of op.hops) {
        say(h.hop, h.showHdr ? op.hdr : null);
        if (h.code) cGlow(h.code, 'rgba(217,244,0,.35)');
        if (h.app) chip('app', h.app, c.text);
        if (h.dmn) chip('dmn', h.dmn, c.text);
        const z = h.cross ? 'red' : h.col;
        if (h.seg) {
          const p = pulse(h.seg, z);
          if (h.cross || h.shared) { burst(h.seg[0], !!h.cross); }
          await p;
        } else {
          await K.delay(dur(st.think));
          const d = E('dmn'); if (d) animate(d, { opacity: [1, 0.6, 1], duration: dur(300), ease: 'inOut(2)' });
        }
        if (h.cross) { st.cross++; if (!kern) st.fuseCross = st.cross; }
        if (h.copy) st.copies++;
        if (h.to) { ['app', 'dmn', 'sys', 'vfs', 'mod', 'dev'].forEach(dim); lite(h.to, c[z]); }
        render();
        K.addLog(logBody, h.log, h.cls || null);
        if (!h.seg) continue;
        await K.delay(dur(90));
      }
      if (!kern) chip('dmn', 'blocked in read(/dev/fuse)', c.muted);
      say(kern ? 'in-kernel read: 0 crossings out to a filesystem' : `round trip complete · 4 crossings · ${st.copies} copies`, op.hdr);
      st.busy = false; setLock(false);
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      const my = st, order = ['read', 'lookup', 'kernel'];
      while (st === my && my.playing) {
        await run(order[my.turn % order.length]);
        my.turn++;
        await K.delay(dur(1100));
      }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 0); st.speed = sp;
      pp(); drawScene(); render(); setLock(false);
      K.addLog(logBody, `↺ reset — seed ${st.seed} · nodeid ${st.nodeid} · next unique 42 · the loop is idle again`, 'hl');
    }

    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function setLock(b) {
      K.lock(root, ['.t-read', '.t-lookup', '.t-kernel', '.t-reset'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b;
    }
    function bind() {
      root.querySelector('.t-read').onclick = () => { if (!st.busy && !st.playing) run('read'); };
      root.querySelector('.t-lookup').onclick = () => { if (!st.busy && !st.playing) run('lookup'); };
      root.querySelector('.t-kernel').onclick = () => { if (!st.busy && !st.playing) run('kernel'); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = () => { if (!st.busy) reset(); };
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
      root.querySelector('.t-seed').onchange = () => { if (!st.busy) reset(); };
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.FSFuseLoop = { init };
})();
