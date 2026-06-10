/**
 * DST Partition vs Hold — the most-misunderstood distinction, made kinetic.
 *
 * Grounded in src/topology/link.rs: LinkState { Healthy, Hold { VecDeque<HeldPacket> }, Partitioned }.
 *   • PARTITIONED — a packet crossing the link is DROPPED: gone forever.
 *   • HOLD        — a packet is BUFFERED in a per-link queue: alive but parked. On release() it
 *     re-enters delivery with its ORIGINAL deliver_at preserved (seq + payload identity intact).
 *   • HEALTHY     — packets cross and are delivered.
 *
 * Re-skinned via dst-kit. Exposes window.DSTPartitionHold.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('partition-hold: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('partition-hold: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 320;
  const NODE = { w: 154, h: 108, y: 130 };
  const n0x = 32, n1x = W - 32 - NODE.w;
  const linkY = NODE.y + NODE.h / 2;
  const leftEdge = n0x + NODE.w, rightEdge = n1x;
  const midX = (leftEdge + rightEdge) / 2;
  const BUF = { x: midX - 90, y: 22, w: 180, h: 74 };

  function init(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return;
    const uid = containerId;

    const st = {
      link: 'healthy',   // 'healthy' | 'partitioned' | 'hold'
      held: [],          // [{ seq, from, to }]
      delivered: 0,
      dropped: 0,
      heldCount: 0,
      seq: 0,
      busy: false,
    };

    let svg, content, anim, logBody, c;

    build();

    function controls() {
      return `
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">send</span>
          <button class="dstk-btn dstk-btn--blue t-send-r">n0 → n1</button>
          <button class="dstk-btn dstk-btn--blue t-send-l">n1 → n0</button>
        </div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">link</span>
          <button class="dstk-btn dstk-btn--red t-partition">Partition</button>
          <button class="dstk-btn dstk-btn--ghost t-repair">Repair</button>
          <button class="dstk-btn dstk-btn--amber t-hold">Hold</button>
          <button class="dstk-btn dstk-btn--green t-release">Release</button>
        </div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>
        </div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">status</span>
          <span id="${uid}-status-pill" style="font-size:.72rem;font-weight:700;padding:.22rem .55rem;border-radius:999px;border:1px solid;transition:color .2s,border-color .2s">HEALTHY</span>
        </div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Partition vs Hold',
        sub: 'drop vs buffer-and-release',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'delivered', label: 'delivered' },
          { id: 'dropped',   label: 'dropped'   },
          { id: 'held',      label: 'held'       },
        ],
        cap: 'Partition <b>drops</b> (gone forever). Hold <b>buffers</b> — on release, parked packets re-enter in their original (deliver_at, seq) order.',
      });
      c = K.palette();
      svg     = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim    = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene();
      bind();
      render();
      K.addLog(logBody, 'ready — link healthy, send a packet across', 'ok');
    }

    // ---- scene ---------------------------------------------------------------

    function drawScene() {
      content.innerHTML = '';

      // link line
      K.el('line', {
        id: uid + '-link',
        x1: leftEdge, y1: linkY, x2: rightEdge, y2: linkY,
        stroke: c.separator, 'stroke-width': 3,
      }, content);

      // directional arrows on link (decorative)
      K.el('line', {
        x1: midX - 28, y1: linkY - 9, x2: midX + 28, y2: linkY - 9,
        stroke: c.blue, 'stroke-width': 1.2,
        'marker-end': K.arrow(uid, 'blue'), opacity: 0.45,
      }, content);
      K.el('line', {
        x1: midX + 28, y1: linkY + 9, x2: midX - 28, y2: linkY + 9,
        stroke: c.blue, 'stroke-width': 1.2,
        'marker-end': K.arrow(uid, 'blue'), opacity: 0.45,
      }, content);

      // hold buffer lane
      const bufg = K.el('g', { id: uid + '-bufg', opacity: 0 }, content);
      K.el('rect', {
        x: BUF.x, y: BUF.y, width: BUF.w, height: BUF.h, rx: 9,
        fill: K.grad(uid, 'amber'), stroke: c.amber,
        'stroke-width': 1.6, 'stroke-dasharray': '6,4',
      }, bufg);
      K.el('text', {
        id: uid + '-buflabel',
        x: BUF.x + BUF.w / 2, y: BUF.y + 16,
        fill: c.amber, 'font-size': 10, 'font-weight': 700, 'text-anchor': 'middle',
      }, bufg).textContent = 'hold buffer (VecDeque)';

      // stem from buffer to link
      K.el('line', {
        id: uid + '-bufstem',
        x1: midX, y1: BUF.y + BUF.h, x2: midX, y2: linkY,
        stroke: c.amber, 'stroke-width': 1.2, 'stroke-dasharray': '4,3', opacity: 0,
      }, content);

      // nodes
      drawNode(0, n0x, 'client');
      drawNode(1, n1x, 'host');

      // barrier (partitioned=red dashed, hold=amber dashed)
      K.el('line', {
        id: uid + '-barrier',
        x1: midX, y1: NODE.y - 8, x2: midX, y2: NODE.y + NODE.h + 8,
        stroke: c.red, 'stroke-width': 3.5, 'stroke-dasharray': '7,5', opacity: 0,
      }, content);
    }

    function drawNode(i, x, role) {
      const g = K.el('g', {}, content);
      K.el('rect', {
        id: nid('box', i), x, y: NODE.y, width: NODE.w, height: NODE.h, rx: 10,
        fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 1.6,
      }, g);
      K.el('circle', { cx: x + 16, cy: NODE.y + 18, r: 5, fill: c.purple }, g);
      K.el('text', { x: x + 30, y: NODE.y + 24, fill: c.text, 'font-size': 14, 'font-weight': 700 }, g).textContent = 'n' + i;
      K.el('text', {
        x: x + NODE.w - 12, y: NODE.y + 24,
        'text-anchor': 'end', fill: c.muted, 'font-size': 10,
      }, g).textContent = role;
      K.el('text', {
        id: nid('cnt', i),
        x: x + NODE.w / 2, y: NODE.y + 72,
        fill: c.muted, 'font-size': 11, 'text-anchor': 'middle',
      }, g).textContent = 'delivered 0';
    }

    function nid(k, i) { return `${uid}-${k}-${i}`; }
    function E(k, i) { return svg.querySelector('#' + CSS.escape(nid(k, i))); }
    function Eid(id) { return svg.querySelector('#' + CSS.escape(uid + '-' + id)); }

    // ---- render --------------------------------------------------------------

    function render() {
      // stat cards
      stat('delivered', st.delivered);
      stat('dropped',   st.dropped);
      stat('held',      st.held.length);

      // status pill
      const pillEl = root.querySelector('#' + CSS.escape(uid + '-status-pill'));
      if (pillEl) {
        const map = {
          healthy:     ['HEALTHY',     c.green],
          partitioned: ['PARTITIONED', c.red  ],
          hold:        ['HOLD',        c.amber ],
        };
        const [label, col] = map[st.link];
        pillEl.textContent = label;
        pillEl.style.color = col;
        pillEl.style.borderColor = col;
      }

      // barrier
      const bar = Eid('barrier');
      if (bar) {
        bar.setAttribute('opacity', st.link === 'healthy' ? 0 : 1);
        bar.setAttribute('stroke', st.link === 'hold' ? c.amber : c.red);
      }

      // buffer lane + stem
      const bufg = Eid('bufg');
      const stem = Eid('bufstem');
      const show = st.link === 'hold' || st.held.length > 0;
      if (bufg) bufg.setAttribute('opacity', show ? 1 : 0);
      if (stem) stem.setAttribute('opacity', show ? 1 : 0);

      // buffer label
      const lbl = Eid('buflabel');
      if (lbl) lbl.textContent = `hold buffer · ${st.held.length} parked`;

      // chips for parked packets (render into anim layer so they layer above static)
      [...anim.querySelectorAll('.ph-chip')].forEach((c) => c.remove());
      st.held.forEach((p, idx) => {
        const cx = BUF.x + 20 + idx * 32, cy = BUF.y + 50;
        const g = K.el('g', { class: 'ph-chip' }, anim);
        K.el('circle', { cx, cy, r: 12, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.4, filter: K.glow(uid) }, g);
        K.el('text', { x: cx, y: cy + 4, fill: c.amber, 'font-size': 9, 'font-weight': 700, 'text-anchor': 'middle' }, g).textContent = 's' + p.seq;
      });

      // delivered counts per node
      E('cnt', 0).textContent = 'delivered ' + st.delivered;
      E('cnt', 1).textContent = 'delivered ' + st.delivered;
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // ---- actions -------------------------------------------------------------

    async function send(from) {
      if (st.busy) return;
      const to  = from === 0 ? 1 : 0;
      const seq = ++st.seq;
      setLock(true);

      const sx  = from === 0 ? leftEdge  : rightEdge;
      const tx  = from === 0 ? rightEdge : leftEdge;
      const dot = K.el('circle', { cx: sx, cy: linkY, r: 7, fill: c.blue, filter: K.glow(uid) }, anim);

      if (st.link === 'partitioned') {
        await animate(dot, { cx: midX, duration: 380, ease: 'out(2)' });
        dot.setAttribute('fill', c.red);
        await animate(dot, { r: [7, 14], opacity: [1, 0], duration: 240, ease: 'out(2)' });
        dot.remove();
        st.dropped++;
        K.addLog(logBody, `dropped: seq=${seq} n${from}→n${to} (partitioned — gone forever)`, 'err');
      } else if (st.link === 'hold') {
        await animate(dot, { cx: midX, duration: 340, ease: 'inOutQuad' });
        const slotX = BUF.x + 20 + st.held.length * 32;
        dot.setAttribute('fill', c.amber);
        await animate(dot, { cx: slotX, cy: BUF.y + 50, duration: 300, ease: 'inOutQuad' });
        await animate(dot, { opacity: [1, 0], duration: 110 });
        dot.remove();
        st.held.push({ seq, from, to });
        K.addLog(logBody, `held: seq=${seq} n${from}→n${to} — buffered, deliver_at preserved`, 'warn');
        render();
      } else {
        // healthy delivery
        await animate(dot, { cx: tx, duration: 520, ease: 'inOutQuad' });
        flash(E('box', to));
        await animate(dot, { r: [7, 13], opacity: [1, 0], duration: 160, ease: 'out(2)' });
        dot.remove();
        st.delivered++;
        K.addLog(logBody, `delivered: seq=${seq} n${from}→n${to}`, 'ok');
        render();
      }

      setLock(false);
    }

    async function release() {
      if (st.busy || !st.held.length) return;
      setLock(true);
      K.addLog(logBody, `release — ${st.held.length} packet(s) burst out in (deliver_at, seq) order`, 'hl');
      st.link = 'healthy';
      render();
      const queue = st.held.slice();
      st.held = [];
      render();

      for (const p of queue) {
        const startX = BUF.x + 20, startY = BUF.y + 50;
        const dot = K.el('circle', { cx: startX, cy: startY, r: 9, fill: c.amber, filter: K.glow(uid) }, anim);
        await animate(dot, { cx: midX, cy: linkY, duration: 230, ease: 'inOutQuad' });
        const destX = p.to === 0 ? leftEdge : rightEdge;
        dot.setAttribute('fill', c.green);
        await animate(dot, { cx: destX, duration: 340, ease: 'inOutQuad' });
        flash(E('box', p.to));
        await animate(dot, { r: [9, 14], opacity: [1, 0], duration: 150, ease: 'out(2)' });
        dot.remove();
        st.delivered++;
        K.addLog(logBody, `released: seq=${p.seq} n${p.from}→n${p.to} — delivered`, 'ok');
        render();
      }

      setLock(false);
    }

    function setLink(s, msg, cls) {
      if (st.busy) return;
      st.link = s;
      K.addLog(logBody, msg, cls);
      render();
    }

    function flash(box) {
      animate(box, { opacity: [1, 0.4, 1], duration: 280, ease: 'inOut(2)' });
    }

    // ---- bind ----------------------------------------------------------------

    function bind() {
      root.querySelector('.t-send-r').onclick    = () => send(0);
      root.querySelector('.t-send-l').onclick    = () => send(1);
      root.querySelector('.t-partition').onclick  = () => setLink('partitioned', 'partition(n0,n1) — packets now dropped forever', 'err');
      root.querySelector('.t-repair').onclick    = () => setLink('healthy', 'repair(n0,n1) — link restored', 'ok');
      root.querySelector('.t-hold').onclick      = () => setLink('hold', 'hold(n0,n1) — packets buffered in VecDeque', 'warn');
      root.querySelector('.t-release').onclick   = () => release();
      root.querySelector('.t-reset').onclick     = () => {
        if (st.busy) return;
        st.link = 'healthy'; st.held = []; st.delivered = 0; st.dropped = 0; st.seq = 0;
        [...anim.querySelectorAll('.ph-chip')].forEach((x) => x.remove());
        anim.innerHTML = '';
        K.addLog(logBody, '↺ reset — link healthy', 'hl');
        render();
      };
    }

    function setLock(b) {
      st.busy = b;
      K.lock(root, ['.t-send-r', '.t-send-l', '.t-partition', '.t-repair', '.t-hold', '.t-release', '.t-reset'], b);
    }

    // theme observer
    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTPartitionHold = { init };
})();
