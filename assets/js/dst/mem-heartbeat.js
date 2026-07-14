/**
 * MEM Heartbeat (dst-kit) — membership as plain rows in a transactional store.
 *
 * The simplest correct architecture on the whole map, and the one our store uses: every
 * compute node upserts a heartbeat row (node-id → { heartbeat, archived? }) into the shared
 * transactional KV store every 3s. Any node may run the expiry sweep: rows whose heartbeat is
 * >30s stale get archived; a later cleanup pass deletes the dead node's resources (its live
 * queries) and finally the row itself. A task lease — a compare-and-set with an expiry — elects
 * the single runner for singleton background jobs.
 *
 * There is no gossip and no quorum math anywhere in the compute layer. Every mutation is one
 * KV transaction; when two concurrent sweeps collide, one commits and the other aborts and
 * re-runs on its next sweep. The store's transactions ARE the agreement box.
 * Exposes window.MEMHeartbeat.init(id).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) { console.error('mem-heartbeat: anime v4 required'); return; }
  if (!window.DSTKit) { console.error('mem-heartbeat: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  const W = 780, H = 366;
  const NB = [{ id: 'a', zone: 'green', y: 48 }, { id: 'b', zone: 'blue', y: 140 }, { id: 'c', zone: 'pink', y: 232 }];
  const NBOX = { x: 30, w: 156, h: 64 };
  const STORE = { x: 300, y: 36, w: 456, h: 246 };
  const ROWY = (i) => STORE.y + 52 + i * 60;
  const LEASE = { x: 300, y: 296, w: 456, h: 46 };
  const REFRESH = 3, EXPIRE = 30, SWEEP = 15, CLEAN = 30, LEASE_DUR = 30;

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;
    const fresh = (seed) => ({
      seed: seed == null ? 4 : seed, rng: K.rng(seed == null ? 4 : seed),
      t: 0, nodes: NB.map((n) => ({ id: n.id, alive: true, lastWrite: 0 })),
      rows: { a: { hb: 0, status: 'active', lqs: 2 }, b: { hb: 0, status: 'active', lqs: 2 }, c: { hb: 0, status: 'active', lqs: 2 } },
      lease: { owner: 'a', expires: LEASE_DUR },
      conflicts: 0, busy: false, playing: false, speed: 1,
    });
    let st = fresh();
    let svg, content, anim, logBody, c;
    const dur = (ms) => ms / st.speed;
    const E = (k) => svg.querySelector('#' + CSS.escape(`${uid}-${k}`));
    const zoneOf = (id) => NB.find((n) => n.id === id).zone;

    build();

    function controls() {
      return `<div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--purple t-step">⏭ +1 s</button>
        <button class="dstk-btn dstk-btn--green t-play">▶ Play</button>
        <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button></div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
        <button class="dstk-btn dstk-btn--red t-kill">💥 kill node b</button>
        <button class="dstk-btn dstk-btn--blue t-revive" disabled>💚 revive node b</button>
        <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button></div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup"><span class="dstk-tlabel">seed</span>
          <input class="t-seed" type="number" value="${st.seed}"></div>
        <div class="dstk-tgroup"><span class="dstk-tlabel">speed</span>
          <select class="t-speed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select></div>`;
    }

    function build() {
      root.innerHTML = K.container({
        title: 'Membership as rows in a transactional store', sub: 'the store’s transactions serialize every change',
        controls: controls(), viewBox: `0 0 ${W} ${H}`, uid,
        stats: [{ id: 't', label: 'clock (s)' }, { id: 'active', label: 'active rows' }, { id: 'arch', label: 'archived' }, { id: 'conf', label: 'txn conflicts' }],
        cap: 'Real numbers from the open-source engine: heartbeat every 3 s, archived after 30 s stale, sweep every '
           + '15 s (cleanup compressed here). Every mutation is one KV transaction — when concurrent sweeps collide '
           + 'the loser aborts and re-runs on its next sweep, which is the entire coordination story. No gossip, no '
           + 'quorum math in the compute layer.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene(); bind(); render();
      K.addLog(logBody, '🌱 Play, then kill node b — watch its row go stale, get archived, then cleaned up', 'hl');
    }

    function drawScene() {
      content.innerHTML = '';
      NB.forEach((n) => {
        K.el('rect', { id: `${uid}-nb-${n.id}`, x: NBOX.x, y: n.y, width: NBOX.w, height: NBOX.h, rx: 10, fill: K.grad(uid, n.zone), stroke: c[n.zone], 'stroke-width': 1.8 }, content);
        K.el('text', { x: NBOX.x + 14, y: n.y + 24, fill: c.text, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = 'compute node ' + n.id;
        K.el('text', { id: `${uid}-ns-${n.id}`, x: NBOX.x + 14, y: n.y + 44, fill: c.muted, 'font-size': 9 }, content).textContent = 'stateless · heartbeats every 3 s';
      });
      // store
      K.el('rect', { x: STORE.x, y: STORE.y, width: STORE.w, height: STORE.h, rx: 12, fill: K.grad(uid, 'purple'), stroke: c.purple, 'stroke-width': 2 }, content);
      K.el('text', { x: STORE.x + 16, y: STORE.y + 24, fill: c.purple, 'font-size': 11.5, 'font-weight': 700 }, content).textContent = 'shared transactional KV store';
      K.el('text', { x: STORE.x + STORE.w - 16, y: STORE.y + 24, 'text-anchor': 'end', fill: c.muted, 'font-size': 8.5 }, content).textContent = 'every mutation = one transaction';
      K.el('g', { id: `${uid}-rows` }, content);
      // lease strip
      K.el('rect', { x: LEASE.x, y: LEASE.y, width: LEASE.w, height: LEASE.h, rx: 9, fill: K.grad(uid, 'amber'), stroke: c.amber, 'stroke-width': 1.4 }, content);
      K.el('text', { x: LEASE.x + 16, y: LEASE.y + 19, fill: c.amber, 'font-size': 9.5, 'font-weight': 700 }, content).textContent = 'task lease (compare-and-set + expiry)';
      K.el('text', { id: `${uid}-lease`, x: LEASE.x + 16, y: LEASE.y + 35, fill: c.text, 'font-size': 9.5, 'font-variant-numeric': 'tabular-nums' }, content).textContent = '';
      redrawRows(); redrawLease();
    }

    function redrawRows() {
      const g = E('rows'); g.innerHTML = '';
      let i = 0;
      for (const id of ['a', 'b', 'c']) {
        const r = st.rows[id];
        if (!r || r.status === 'gone') continue;
        const y = ROWY(i++);
        const zone = r.status === 'archived' ? 'red' : zoneOf(id);
        K.el('rect', { id: `${uid}-row-${id}`, x: STORE.x + 14, y, width: STORE.w - 28, height: 46, rx: 8, fill: K.grad(uid, zone), stroke: r.status === 'archived' ? c.red : c[zoneOf(id)], 'stroke-width': 1.4 }, g);
        K.el('text', { x: STORE.x + 28, y: y + 19, fill: c.text, 'font-size': 10.5, 'font-family': "ui-monospace,'SF Mono',monospace", 'font-weight': 700 }, g).textContent = 'node:' + id;
        K.el('text', { x: STORE.x + 28, y: y + 36, fill: c.muted, 'font-size': 9, 'font-variant-numeric': 'tabular-nums' }, g)
          .textContent = `heartbeat t=${r.hb}  ·  ${st.t - r.hb}s ago`;
        const badge = r.status === 'archived' ? 'ARCHIVED (gc=true)' : 'ACTIVE';
        K.el('text', { x: STORE.x + STORE.w - 96, y: y + 20, 'text-anchor': 'end', fill: r.status === 'archived' ? c.red : c.green, 'font-size': 9.5, 'font-weight': 700 }, g).textContent = badge;
        for (let q = 0; q < r.lqs; q++)
          K.el('rect', { x: STORE.x + STORE.w - 80 + q * 26, y: y + 8, width: 22, height: 13, rx: 3, fill: K.grad(uid, 'blue'), stroke: c.blue, 'stroke-width': 1 }, g);
        if (r.lqs > 0)
          K.el('text', { x: STORE.x + STORE.w - 80 + r.lqs * 13, y: y + 36, 'text-anchor': 'middle', fill: c.muted, 'font-size': 7.5 }, g).textContent = 'live queries';
      }
      if (i === 0)
        K.el('text', { x: STORE.x + STORE.w / 2, y: ROWY(1), 'text-anchor': 'middle', fill: c.muted, 'font-size': 10 }, g).textContent = '(no node rows)';
    }
    function redrawLease() {
      const l = E('lease');
      l.textContent = `changefeed-cleanup → owner: node ${st.lease.owner} · expires t=${st.lease.expires}` +
        (st.lease.expires <= st.t ? '  (EXPIRED)' : '');
    }

    function fly(x1, y1, x2, y2, color, ms, r) {
      const p = K.el('circle', { cx: x1, cy: y1, r: r || 4.5, fill: color, filter: K.glow(uid) }, anim);
      const o = { t: 0 };
      return animate(o, { t: 1, duration: dur(ms || 420), ease: 'inOut(2)',
        onUpdate: () => { p.setAttribute('cx', x1 + (x2 - x1) * o.t); p.setAttribute('cy', y1 + (y2 - y1) * o.t); },
        onComplete: () => p.remove() });
    }
    const rowIndex = (id) => {
      let i = 0;
      for (const k of ['a', 'b', 'c']) { if (k === id) return i; if (st.rows[k] && st.rows[k].status !== 'gone') i++; }
      return 0;
    };
    const nodeY = (id) => NB.find((n) => n.id === id).y + NBOX.h / 2;

    async function step() {
      if (st.busy) return; st.busy = true; setLock(true);
      st.t++;
      const flights = [];
      // heartbeat refresh (update_node — one small write txn)
      for (const n of st.nodes) {
        if (!n.alive || st.t - n.lastWrite < REFRESH) continue;
        n.lastWrite = st.t;
        const r = st.rows[n.id];
        flights.push(fly(NBOX.x + NBOX.w, nodeY(n.id), STORE.x + 14, ROWY(rowIndex(n.id)) + 23, c[zoneOf(n.id)], 380));
        if (!r || r.status === 'gone') {
          st.rows[n.id] = { hb: st.t, status: 'active', lqs: 2 };
          K.addLog(logBody, `node ${n.id}: insert_node — idempotent, same id re-registers after restart`, 'ok');
        } else { r.hb = st.t; if (r.status === 'archived') { r.status = 'active'; } }
      }
      await Promise.all(flights);
      // expiry sweep (expire_nodes) — any node may run it; concurrent sweeps conflict + retry
      if (st.t % SWEEP === 0) {
        const ups = st.nodes.filter((n) => n.alive);
        if (ups.length) {
          const sweeper = ups[Math.floor(st.rng() * ups.length)];
          await sweepAnim(sweeper.id);
          let archived = 0;
          for (const id of ['a', 'b', 'c']) {
            const r = st.rows[id];
            if (r && r.status === 'active' && st.t - r.hb > EXPIRE) {
              r.status = 'archived'; archived++;
              K.addLog(logBody, `node ${sweeper.id} archived node ${id} — heartbeat ${st.t - r.hb}s stale (>30s)`, 'warn');
            }
          }
          if (ups.length > 1 && st.rng() < 0.5) {
            const other = ups.find((n) => n.id !== sweeper.id);
            st.conflicts++;
            K.addLog(logBody, `node ${other.id} swept concurrently → transaction CONFLICT → aborts, re-runs next sweep (nothing left to do)`, 'warn');
          }
          if (!archived && st.t % (SWEEP * 2) === 0)
            K.addLog(logBody, `node ${sweeper.id} ran the expiry sweep — every heartbeat fresh, nothing to archive`, 'ok');
        }
      }
      // cleanup (remove_nodes): delete the archived node's live queries, then the row
      if (st.t % CLEAN === 0) {
        for (const id of ['a', 'b', 'c']) {
          const r = st.rows[id];
          if (r && r.status === 'archived') {
            r.lqs = 0; r.status = 'gone';
            K.addLog(logBody, `cleanup: node ${id}'s live queries deleted, node:${id} removed — all in transactions`, 'ok');
          }
        }
      }
      // task lease: renew by CAS; if the owner died, the next claimant CASes after expiry
      const owner = st.nodes.find((n) => n.id === st.lease.owner);
      if (owner && owner.alive && st.lease.expires - st.t <= 10) {
        st.lease.expires = st.t + LEASE_DUR;
        K.addLog(logBody, `node ${st.lease.owner} renewed the task lease (compare-and-set)`, 'ok');
      } else if ((!owner || !owner.alive) && st.t > st.lease.expires) {
        const claimant = st.nodes.find((n) => n.alive);
        if (claimant) {
          st.lease.owner = claimant.id; st.lease.expires = st.t + LEASE_DUR;
          K.addLog(logBody, `lease expired — node ${claimant.id} claimed it with a compare-and-set. New singleton runner.`, 'hl');
        }
      }
      redrawRows(); redrawLease(); render();
      st.busy = false; setLock(false);
    }

    async function sweepAnim(sweeperId) {
      const line = K.el('line', { x1: STORE.x + 14, y1: STORE.y + 44, x2: STORE.x + STORE.w - 14, y2: STORE.y + 44, stroke: c.amber, 'stroke-width': 2, opacity: 0.9 }, anim);
      const o = { y: STORE.y + 44 };
      await animate(o, { y: STORE.y + STORE.h - 14, duration: dur(650), ease: 'inOut(2)',
        onUpdate: () => { line.setAttribute('y1', o.y); line.setAttribute('y2', o.y); } });
      line.remove();
    }

    function kill() {
      const n = st.nodes.find((x) => x.id === 'b');
      if (!n.alive) return;
      n.alive = false;
      const box = E('nb-b'), sub = E('ns-b');
      box.setAttribute('stroke', c.gray); box.setAttribute('fill', K.grad(uid, 'gray'));
      sub.textContent = '💥 dead — heartbeats stopped';
      root.querySelector('.t-kill').disabled = true;
      root.querySelector('.t-revive').disabled = false;
      K.addLog(logBody, '💥 node b is gone. Nobody was told — the row just stops being refreshed.', 'err');
    }
    function revive() {
      const n = st.nodes.find((x) => x.id === 'b');
      if (n.alive) return;
      n.alive = true; n.lastWrite = st.t - REFRESH;
      const box = E('nb-b'), sub = E('ns-b');
      box.setAttribute('stroke', c.blue); box.setAttribute('fill', K.grad(uid, 'blue'));
      sub.textContent = 'stateless · heartbeats every 3 s';
      root.querySelector('.t-kill').disabled = false;
      root.querySelector('.t-revive').disabled = true;
      K.addLog(logBody, '💚 node b restarted — its next heartbeat re-registers the same node id', 'ok');
    }

    function stat(k, v) { const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k)); if (e) e.textContent = v; }
    function render() {
      stat('t', st.t);
      const rows = Object.values(st.rows);
      stat('active', rows.filter((r) => r.status === 'active').length);
      stat('arch', rows.filter((r) => r.status === 'archived').length);
      stat('conf', st.conflicts);
    }

    async function play() {
      if (st.playing) return; st.playing = true; pp();
      while (st.playing) { await step(); await K.delay(dur(420)); }
    }
    function pause() { st.playing = false; pp(); }
    function pp() { root.querySelector('.t-play').disabled = st.playing; root.querySelector('.t-pause').disabled = !st.playing; }
    function reset() {
      st.playing = false;
      const sp = st.speed;
      st = fresh(parseInt(root.querySelector('.t-seed').value, 10) || 4); st.speed = sp;
      pp(); anim.innerHTML = ''; drawScene(); render();
      root.querySelector('.t-kill').disabled = false;
      root.querySelector('.t-revive').disabled = true;
      K.addLog(logBody, `↺ reset — three nodes, three fresh rows, lease owned by node a`, 'hl');
    }
    function setLock(b) { K.lock(root, ['.t-step', '.t-reset'], b); if (!st.playing) root.querySelector('.t-play').disabled = b; }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.playing) step(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-kill').onclick = kill;
      root.querySelector('.t-revive').onclick = revive;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => st.speed = parseFloat(e.target.value);
      root.querySelector('.t-seed').onchange = reset;
    }

    new MutationObserver((m) => { for (const x of m) if (x.attributeName === 'data-mode') build(); })
      .observe(document.documentElement, { attributes: true });
  }
  window.MEMHeartbeat = { init };
})();
