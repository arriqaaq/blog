/**
 * DST Same-Seed Replay (re-skinned via dst-kit) — the seed contract, made visible.
 *
 * Two panels step in lockstep. Both fold every event (deliver / push) into a running hash, the
 * JS analogue of dst's running SHA-256 over History → RunSummary.history_hash (whose
 * Display shows the first 8 bytes = 16 hex chars). Same seed ⇒ identical RNG draws ⇒ identical
 * event order ⇒ identical hash (✅). Change the right seed ⇒ the traces diverge and the hashes
 * mismatch (✗). The repro line mirrors repro_command_line: DST_SEED=<n> cargo test <filter>.
 *
 * Exposes window.DSTSameSeedReplay.init(containerId).
 */
(function () {
  'use strict';
  if (typeof anime === 'undefined' || !anime.animate) {
    console.error('DST Same-Seed Replay: anime v4 required'); return;
  }
  if (!window.DSTKit) { console.error('DST Same-Seed Replay: dst-kit required'); return; }
  const { animate } = anime;
  const K = window.DSTKit;

  // --- layout constants ---
  const W = 780, H = 372, NODES = 3, TICK = 10, STEPS = 8;
  // Two stacked runs: Run A on top, Run B below — same shape, easy to compare top-to-bottom.
  const RUN = { x: 14, w: W - 28, h: 116, y0: 70, gap: 16 };
  const runY = (s) => RUN.y0 + s * (RUN.h + RUN.gap);
  // Event chips: a short fixed row per run; each lights up as it folds into the fingerprint.
  const CHIP = { x0: 150, w: 58, gap: 6, h: 30 };
  const chipX = (i) => CHIP.x0 + i * (CHIP.w + CHIP.gap);
  // Fingerprint readout sits at the right end of each run row.
  const FP = { x: W - 24 };

  // --- one FNV-style fingerprint, displayed as 16 hex chars (stand-in for SHA-256 first 8 bytes) ---
  function newHash() { return { a: 0x811c9dc5 >>> 0, b: 0x1000193 >>> 0 }; }
  function feedHash(hsh, str) {
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hsh.a = Math.imul(hsh.a ^ ch, 0x01000193) >>> 0;
      hsh.b = Math.imul(hsh.b ^ ((ch + i) & 0xff), 0x85ebca77) >>> 0;
    }
  }
  const hexHash = (hsh) =>
    (hsh.a >>> 0).toString(16).padStart(8, '0') + (hsh.b >>> 0).toString(16).padStart(8, '0');

  const cmp = (a, b) => (a.deliverAt - b.deliverAt) || (a.seq - b.seq);

  function init(containerId) {
    const root = document.getElementById(containerId); if (!root) return;
    const uid = containerId;

    const makeRun = (seed) => ({
      seed, rng: K.rng(seed >>> 0), now: 0, step: 0, seq: 0,
      nodes: Array.from({ length: NODES }, () => ({})),
      heap: [], hash: newHash(), events: [],
    });

    const st = {
      runs: [makeRun(7), makeRun(7)],
      rightSeed: 7,
      playing: false, busy: false, speed: 1,
      done: false,
    };

    let svg, content, anim, logBody, c;

    build();

    // --- controls HTML ---
    function controls() {
      return `<div class="dstk-tgroup">
          <button class="dstk-btn dstk-btn--purple t-step">⏭ Fold one event</button>
          <button class="dstk-btn dstk-btn--green t-play">▶ Run both</button>
          <button class="dstk-btn dstk-btn--ghost t-pause" disabled>⏸</button>
          <button class="dstk-btn dstk-btn--ghost t-reset">↺ Reset</button>
        </div>
        <span class="dstk-sp"></span>
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">speed</span>
          <select class="t-speed">
            <option value="0.5">0.5×</option>
            <option value="1" selected>1×</option>
            <option value="2">2×</option>
          </select>
        </div>
        <span class="dstk-tdiv"></span>
        <div class="dstk-tgroup">
          <span class="dstk-tlabel">run B seed</span>
          <input type="number" class="t-seed" value="${st.rightSeed}" min="0" step="1">
        </div>`;
    }

    // --- build: full re-render from scratch ---
    function build() {
      root.innerHTML = K.container({
        title: 'Run it twice with the same seed — same fingerprint?',
        sub: 'each run folds its events into one running hash',
        controls: controls(),
        viewBox: `0 0 ${W} ${H}`,
        uid,
        stats: [
          { id: 'folded', label: 'events folded' },
          { id: 'verdict', label: 'A vs B' },
        ],
        cap: 'Two runs of the same simulator. Each chip is one event; folding it into the running '
           + 'fingerprint is dst’s SHA-256 over history. Same seed ⇒ identical events ⇒ identical '
           + 'fingerprint, byte for byte. Flip one bit of the seed ⇒ a different universe.',
      });
      c = K.palette();
      svg = root.querySelector('.dstk-svg');
      content = svg.querySelector('.content');
      anim = svg.querySelector('.anim');
      logBody = root.querySelector('.dstk-log-body');
      drawScene();
      bind();
      render();
      const msg = st.rightSeed === 7
        ? 'ready — both runs seeded 7 · press Run both and compare the fingerprints'
        : 'ready — run A seed 7 vs run B seed ' + st.rightSeed + ' · watch them diverge';
      K.addLog(logBody, msg, 'hl');
    }

    // --- scene skeleton ---
    function drawScene() {
      content.innerHTML = '';
      anim.innerHTML = '';

      // Big verdict banner across the top — the single most important fact.
      K.el('rect', { id: uid + '-vbox', x: 8, y: 6, width: W - 16, height: 50, rx: 9,
        fill: K.grad(uid, 'gray'), stroke: c.separator, 'stroke-width': 1.4 }, content);
      K.el('text', { id: uid + '-verdict', x: W / 2, y: 30, 'text-anchor': 'middle',
        'font-size': 19, 'font-weight': 700, fill: c.muted }, content)
        .textContent = 'press Run both →';
      K.el('text', { id: uid + '-vsub', x: W / 2, y: 47, 'text-anchor': 'middle',
        'font-size': 10, fill: c.muted }, content)
        .textContent = 'do the two fingerprints come out identical?';

      // Two run rows.
      for (let s = 0; s < 2; s++) drawRun(s);

      // Repro line at the very bottom — the payoff: how you replay this exact run.
      K.el('text', { id: uid + '-repro', x: W / 2, y: H - 10, 'text-anchor': 'middle',
        'font-size': 11, fill: c.muted, 'font-family': 'ui-monospace,monospace' }, content)
        .textContent = 'DST_SEED=7 cargo test two_run_hash_equality_full_chaos -- --exact';
    }

    function drawRun(s) {
      const y = runY(s);
      const r = st.runs[s];
      const isA = s === 0;
      const zone = isA ? 'green' : 'purple';

      // Run frame.
      K.el('rect', { id: eid('box', s), x: RUN.x, y, width: RUN.w, height: RUN.h, rx: 11,
        fill: K.grad(uid, zone), stroke: c[zone], 'stroke-width': 1.6 }, content);

      // Run label (plain) + seed tag (small, secondary).
      K.el('circle', { cx: RUN.x + 20, cy: y + 24, r: 5, fill: c[zone] }, content);
      K.el('text', { x: RUN.x + 32, y: y + 28, fill: c.text, 'font-size': 14, 'font-weight': 700 }, content)
        .textContent = isA ? 'Run A' : 'Run B';
      K.el('rect', { id: eid('seedtag', s), x: RUN.x + 92, y: y + 14, width: 70, height: 19, rx: 9.5,
        fill: c[zone], 'fill-opacity': 0.16, stroke: c[zone], 'stroke-opacity': 0.55 }, content);
      K.el('text', { id: eid('seedtxt', s), x: RUN.x + 127, y: y + 27, 'text-anchor': 'middle',
        fill: c[zone], 'font-size': 10, 'font-weight': 700 }, content)
        .textContent = 'seed ' + r.seed;

      // Caption above the chip row (offset right so it clears the seed tag at x 106–176).
      K.el('text', { x: CHIP.x0 + 44, y: y + 28, fill: c.muted, 'font-size': 9.5 }, content)
        .textContent = 'events, in order →';

      // Event chips (one row). Start grey; light up as each event folds in.
      for (let i = 0; i < STEPS; i++) {
        K.el('rect', { id: eid('chip-' + i, s), x: chipX(i), y: y + 38, width: CHIP.w, height: CHIP.h, rx: 5,
          fill: c.separator, 'fill-opacity': 0.32, stroke: c.separator, 'stroke-width': 1 }, content);
        K.el('text', { id: eid('chiptxt-' + i, s), x: chipX(i) + CHIP.w / 2, y: y + 38 + 19,
          'text-anchor': 'middle', fill: c.muted, 'font-size': 9.5, 'font-weight': 600,
          'font-variant-numeric': 'tabular-nums' }, content).textContent = '·';
      }

      // Fingerprint readout (right end of the row): label + big hash value.
      K.el('text', { x: FP.x, y: y + 88, 'text-anchor': 'end', fill: c.muted, 'font-size': 9 }, content)
        .textContent = 'fingerprint so far';
      K.el('text', { id: eid('fp', s), x: FP.x, y: y + 106, 'text-anchor': 'end',
        fill: c.blue, 'font-size': 14, 'font-weight': 700,
        'font-family': 'ui-monospace,monospace', filter: K.glow(uid) }, content)
        .textContent = hexHash(r.hash);
    }

    // id helpers scoped to uid
    function eid(k, s) { return uid + '-' + k + '-' + s; }
    function E(k, s) { return svg.querySelector('#' + CSS.escape(eid(k, s))); }

    // --- render: sync live readouts to state ---
    function render() {
      const h0 = hexHash(st.runs[0].hash);
      const h1 = hexHash(st.runs[1].hash);
      const same = h0 === h1;

      for (let s = 0; s < 2; s++) {
        const r = st.runs[s];
        const seedtxt = E('seedtxt', s); if (seedtxt) seedtxt.textContent = 'seed ' + r.seed;
        const fp = E('fp', s);
        if (fp) {
          fp.textContent = s === 0 ? h0 : h1;
          fp.setAttribute('fill', !st.done ? c.blue : (same ? c.green : c.red));
        }
      }

      // Verdict only shouts once both runs have finished folding.
      const vEl = svg.querySelector('#' + CSS.escape(uid + '-verdict'));
      const vSub = svg.querySelector('#' + CSS.escape(uid + '-vsub'));
      const vBox = svg.querySelector('#' + CSS.escape(uid + '-vbox'));
      if (vEl && vSub && vBox) {
        if (!st.done) {
          vEl.textContent = st.runs[0].step === 0 ? 'press Run both →' : 'folding events…';
          vEl.setAttribute('fill', c.muted);
          vSub.textContent = 'do the two fingerprints come out identical?';
          vSub.setAttribute('fill', c.muted);
          vBox.setAttribute('fill', K.grad(uid, 'gray'));
          vBox.setAttribute('stroke', c.separator);
        } else if (same) {
          vEl.textContent = '✓ MATCH — same universe, byte for byte';
          vEl.setAttribute('fill', c.green);
          vSub.textContent = 'same seed ⇒ identical events ⇒ identical fingerprint';
          vSub.setAttribute('fill', c.green);
          vBox.setAttribute('fill', K.grad(uid, 'green'));
          vBox.setAttribute('stroke', c.green);
        } else {
          vEl.textContent = '✗ DIVERGED — a completely different run';
          vEl.setAttribute('fill', c.red);
          vSub.textContent = 'one bit of seed changed ⇒ different draws ⇒ different fingerprint';
          vSub.setAttribute('fill', c.red);
          vBox.setAttribute('fill', K.grad(uid, 'red'));
          vBox.setAttribute('stroke', c.red);
        }
      }

      // Stat cards (the full fingerprints are shown big in the run rows — keep these short so they
      // never overflow their card).
      stat('folded', st.runs[0].step + '/' + STEPS);
      stat('verdict', !st.done ? '—' : (same ? 'MATCH' : 'DIFFER'));

      // Repro line tracks run B's seed.
      const repro = svg.querySelector('#' + CSS.escape(uid + '-repro'));
      if (repro) {
        repro.textContent =
          'DST_SEED=' + st.runs[1].seed +
          ' cargo test two_run_hash_equality_full_chaos -- --exact';
      }
    }

    function stat(k, v) {
      const e = root.querySelector('#' + CSS.escape(uid + '-stat-' + k));
      if (e) e.textContent = v;
    }

    // --- produce the next event for a run (deterministic from its seeded rng) ---
    function nextEvent(r) {
      // Deliver one due packet if any are ready; otherwise a node sends a new packet.
      const due = r.heap.filter((q) => q.deliverAt <= r.now).sort(cmp);
      if (due.length) {
        const q = due[0];
        r.heap = r.heap.filter((x) => x.seq !== q.seq);
        const ev = 'deliver s' + q.seq + ' n' + q.from + '→n' + q.to;
        return { kind: 'deliver', text: 'recv n' + q.to, full: ev };
      }
      // pick a sender deterministically
      const i = Math.floor(r.rng() * NODES);
      let j = Math.floor(r.rng() * (NODES - 1)); if (j >= i) j++;
      const lat = 20 + Math.floor(r.rng() * 70);
      const pkt = { seq: ++r.seq, from: i, to: j, deliverAt: r.now + TICK + lat };
      r.heap.push(pkt);
      r.now += TICK;
      const ev = 'push s' + pkt.seq + ' n' + i + '→n' + j + ' @' + pkt.deliverAt;
      return { kind: 'send', text: 'n' + i + '→n' + j, full: ev };
    }

    // --- fold ONE event into one run: light its chip, fold into the fingerprint ---
    async function foldOne(s) {
      const r = st.runs[s];
      if (r.step >= STEPS) return;
      const i = r.step;
      const e = nextEvent(r);
      r.events.push(e.full);
      feedHash(r.hash, e.full + '|' + r.step);
      r.step++;

      const zone = e.kind === 'deliver' ? 'blue' : (s === 0 ? 'green' : 'purple');
      const col = c[zone];
      const chip = E('chip-' + i, s), txt = E('chiptxt-' + i, s);
      if (chip && txt) {
        chip.setAttribute('fill', col);
        chip.setAttribute('fill-opacity', 0.18);
        chip.setAttribute('stroke', col);
        chip.setAttribute('stroke-width', 1.6);
        chip.setAttribute('filter', K.glow(uid));
        txt.setAttribute('fill', col);
        txt.textContent = e.text;
        animate(chip, { opacity: [0.3, 1], duration: 160 / st.speed, ease: 'out(2)' });
        // drop the glow after the pulse so the row stays readable
        setTimeout(() => { if (chip) chip.removeAttribute('filter'); }, 200 / st.speed);
      }
      // pulse the fingerprint to show it just changed
      const fp = E('fp', s);
      if (fp) animate(fp, { opacity: [1, 0.45, 1], duration: 200 / st.speed, ease: 'inOut(2)' });
    }

    // --- one Step: fold the next event into BOTH runs, in lockstep ---
    async function stepBoth() {
      if (st.busy || st.done) return;
      st.busy = true; setLock(true);

      const stepNo = st.runs[0].step + 1;
      await Promise.all([foldOne(0), foldOne(1)]);
      render();

      const h0 = hexHash(st.runs[0].hash), h1 = hexHash(st.runs[1].hash);
      const same = h0 === h1;
      if (same) {
        K.addLog(logBody, 'event ' + stepNo + ': both fingerprints still ' + h0.slice(0, 8) + ' — identical', 'ok');
      } else {
        K.addLog(logBody, 'event ' + stepNo + ': A ' + h0.slice(0, 8) + ' ≠ B ' + h1.slice(0, 8) + ' — diverged', 'err');
      }

      // Finished folding? Announce the loud verdict.
      if (st.runs[0].step >= STEPS && st.runs[1].step >= STEPS) {
        st.done = true; st.playing = false; pp();
        render();
        verdictBanner(same);
        K.addLog(logBody, same
          ? 'VERDICT: MATCH — same seed reproduced the run byte for byte'
          : 'VERDICT: DIVERGED — seed ' + st.runs[1].seed + ' is a different universe', 'hl');
      }

      await K.delay(60 / st.speed);
      st.busy = false; setLock(false);
    }

    // A transient pulse on the verdict banner the moment the runs finish.
    function verdictBanner(same) {
      const box = svg.querySelector('#' + CSS.escape(uid + '-vbox'));
      const txt = svg.querySelector('#' + CSS.escape(uid + '-verdict'));
      if (box) animate(box, { opacity: [0.4, 1], duration: 320 / st.speed, ease: 'out(2)' });
      if (txt) animate(txt, { opacity: [0, 1], duration: 360 / st.speed, ease: 'out(2)' });
    }

    function bind() {
      root.querySelector('.t-step').onclick = () => { if (!st.busy) stepBoth(); };
      root.querySelector('.t-play').onclick = play;
      root.querySelector('.t-pause').onclick = pause;
      root.querySelector('.t-reset').onclick = reset;
      root.querySelector('.t-speed').onchange = (e) => { st.speed = parseFloat(e.target.value); };
      root.querySelector('.t-seed').onchange = (e) => {
        const v = parseInt(e.target.value, 10);
        st.rightSeed = Number.isFinite(v) && v >= 0 ? v : 7;
        reset();
      };
    }

    async function play() {
      if (st.playing || st.done) return;
      st.playing = true; pp();
      while (st.playing && !st.done) {
        await stepBoth();
        if (!st.playing || st.done) break;
        await K.delay(240 / st.speed);
      }
    }
    function pause() { st.playing = false; pp(); }
    function reset() {
      st.playing = false; pp();
      st.runs = [makeRun(7), makeRun(st.rightSeed)];
      st.busy = false; st.done = false; setLock(false);
      drawScene(); render();
      const seedMsg = st.rightSeed === 7
        ? '↺ reset — both runs seeded 7 · same seed ⇒ same fingerprint'
        : '↺ reset — run A seed 7 vs run B seed ' + st.rightSeed + ' · watch them diverge';
      K.addLog(logBody, seedMsg, 'hl');
    }
    function pp() {
      root.querySelector('.t-play').disabled = st.playing || st.done;
      root.querySelector('.t-pause').disabled = !st.playing;
    }
    function setLock(b) {
      K.lock(root, ['.t-step', '.t-reset', '.t-seed'], b);
      if (!st.playing) root.querySelector('.t-play').disabled = b || st.done;
    }

    new MutationObserver((m) => {
      for (const x of m) if (x.attributeName === 'data-mode') build();
    }).observe(document.documentElement, { attributes: true });
  }

  window.DSTSameSeedReplay = { init };
})();
