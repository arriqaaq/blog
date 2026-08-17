/* Bespoke static SVG diagrams for the post (replaces mermaid). Kit color language; text uses
 * currentColor so they adapt to light/dark. Each entry: { title, type:'svg'|'html', body }. */
'use strict';
const INK = '#1a1a1a';
const C = { green: '#16a34a', blue: '#2563eb', purple: '#d9f400', amber: '#e0850f', red: '#dc2626', pink: '#db2777', gray: '#64748b' };
const fade = (hex) => hex + '20'; // ~12% alpha
// The accent (C.purple = neon) reads on cream only as a fill, so accent boxes paint solid neon
// with ink text/stroke (like the site's neon button); its arrows/markers use ink too.
const isNeon = (hex) => hex === C.purple;
const strokeFor = (hex) => (isNeon(hex) ? INK : hex);
const fillFor = (hex) => (isNeon(hex) ? hex : fade(hex));

function svg(vb, body, extraDefs) {
  const markers = Object.entries(C).map(([n, c]) =>
    `<marker id="m-${n}" markerWidth="9" markerHeight="7" refX="7.5" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="${strokeFor(c)}"/></marker>`).join('');
  return `<svg class="dgm-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><defs>${markers}${extraDefs || ''}</defs>${body}</svg>`;
}
function box(x, y, w, h, accent, title, lines) {
  const t = `<text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-size="13" font-weight="700" fill="${strokeFor(accent)}">${title}</text>`;
  const ls = (lines || []).map((l, i) =>
    `<text x="${x + w / 2}" y="${y + 38 + i * 15}" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.78">${l}</text>`).join('');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${fillFor(accent)}" stroke="${strokeFor(accent)}" stroke-width="1.6"/>${t}${ls}`;
}
function arrow(x1, y1, x2, y2, name, dash) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${strokeFor(C[name])}" stroke-width="1.8" marker-end="url(#m-${name})"${dash ? ' stroke-dasharray="5,4"' : ''}/>`;
}
const label = (x, y, s, anchor, op) => `<text x="${x}" y="${y}" text-anchor="${anchor || 'start'}" font-size="10.5" fill="currentColor" opacity="${op == null ? 0.7 : op}">${s}</text>`;

// SVG <text> does not wrap, so a long prose label silently runs past the viewBox. `wrapText`
// greedily splits on spaces to fit `maxW` pixels (Inter averages ~0.52em per mixed-case char),
// and `para` emits one <text> per line, growing downward from y.
function wrapText(s, maxW, fs) {
  const perChar = fs * 0.52;
  const maxChars = Math.max(10, Math.floor(maxW / perChar));
  const lines = [];
  let cur = '';
  for (const w of String(s).split(/\s+/)) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function para(x, y, s, opts) {
  const o = opts || {};
  const fs = o.size == null ? 10.5 : o.size;
  const lh = o.lh == null ? 13 : o.lh;
  const anchor = o.anchor || 'start';
  const op = o.op == null ? 0.7 : o.op;
  return wrapText(s, o.maxW == null ? 676 : o.maxW, fs)
    .map((ln, i) => `<text x="${x}" y="${y + i * lh}" text-anchor="${anchor}" font-size="${fs}" fill="currentColor" opacity="${op}">${ln}</text>`)
    .join('');
}
// how many lines `para` will produce — used to size viewBoxes
para.count = (s, maxW, fs) => wrapText(s, maxW == null ? 676 : maxW, fs == null ? 10.5 : fs).length;

module.exports = {
  coverage: {
    title: 'Where DST sits: systematic, fast, and reproducible',
    type: 'svg',
    body: svg('0 0 600 340', (() => {
      const X0 = 70, X1 = 560, Y0 = 300, Y1 = 40;
      const px = (n) => X0 + n * (X1 - X0), py = (n) => Y0 - n * (Y0 - Y1);
      const axes = `<line x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}" stroke="currentColor" opacity="0.3"/>
        <line x1="${X0}" y1="${Y0}" x2="${X0}" y2="${Y1}" stroke="currentColor" opacity="0.3"/>
        ${label(X1, Y0 + 22, 'reproducibility →', 'end', 0.6)}
        <text x="${X0 - 8}" y="${Y1 + 6}" transform="rotate(-90 ${X0 - 8} ${Y1 + 6})" font-size="10.5" fill="currentColor" opacity="0.6">coverage →</text>`;
      const pts = [
        ['Unit tests', 0.78, 0.22, C.gray], ['Chaos eng.', 0.2, 0.74, C.gray],
        ['Jepsen', 0.34, 0.6, C.gray], ['Formal methods', 0.82, 0.46, C.gray], ['DST', 0.86, 0.86, C.purple],
      ].map(([n, x, y, col]) => {
        const big = col === C.purple;
        return `<circle cx="${px(x)}" cy="${py(y)}" r="${big ? 8 : 5.5}" fill="${col}"${big ? ` stroke="${INK}" stroke-width="1.6" filter="url(#dgm-glow)"` : ''}/>
          <text x="${px(x) + (x > 0.6 ? -10 : 12)}" y="${py(y) + 4}" text-anchor="${x > 0.6 ? 'end' : 'start'}" font-size="${big ? 12.5 : 11}" font-weight="${big ? 700 : 500}" fill="${big ? INK : 'currentColor'}" opacity="${big ? 1 : 0.82}">${n}</text>`;
      }).join('');
      return axes + pts;
    })(), '<filter id="dgm-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'),
  },

  lineage: {
    title: 'The lineage we read our way into',
    type: 'svg',
    body: svg('0 0 720 150',
      box(20, 40, 180, 78, C.blue, 'FoundationDB', ['built the simulator', 'before the database']) +
      box(270, 40, 180, 78, C.green, 'madsim', ['async runtime +', 'libc interposition']) +
      box(520, 40, 180, 78, C.purple, 'dst', ['rebuilt from scratch', 'to learn the fundamentals']) +
      arrow(200, 79, 268, 79, 'blue') + arrow(450, 79, 518, 79, 'green') +
      label(235, 70, 'read', 'middle', 0.6) + label(485, 70, 'borrowed', 'middle', 0.6)),
  },

  prng: {
    title: 'A seed fans out: SHA-256 domain separation → ChaCha8',
    type: 'svg',
    body: svg('0 0 720 210',
      box(20, 24, 120, 60, C.amber, 'seed : u64', ['e.g. 42']) +
      box(190, 14, 230, 56, C.purple, 'SHA-256', ["b\"…Prng::v1\" ++ seed_le"]) +
      box(470, 14, 230, 56, C.green, 'ChaCha8Rng', ['master stream']) +
      box(190, 120, 230, 56, C.purple, 'SHA-256', ["…derive_stream::v1 ++ salt"]) +
      box(470, 120, 230, 56, C.blue, 'ChaCha8Rng', ['independent child stream']) +
      arrow(140, 48, 188, 42, 'amber') + arrow(420, 42, 468, 42, 'purple') +
      arrow(140, 60, 188, 148, 'amber') + arrow(420, 148, 468, 148, 'purple') +
      label(360, 100, 'domain prefix ⇒ no accidental correlation between streams', 'middle', 0.6)),
  },

  borrowed: {
    title: 'What we took from whom',
    type: 'svg',
    body: svg('0 0 720 265',
      box(20, 50, 200, 64, C.green, 'Tokio', ['paused clock + LocalSet']) +
      box(20, 150, 200, 64, C.amber, 'madsim', ['libc interposition']) +
      box(500, 100, 200, 64, C.pink, 'FoundationDB', ['swizzle-clog + sim-first']) +
      box(290, 90, 140, 84, C.purple, 'dst', ['our core']) +
      arrow(220, 82, 288, 120, 'green') + arrow(220, 182, 288, 150, 'amber') +
      arrow(500, 132, 432, 132, 'pink')),
  },

  'safety-liveness': {
    title: 'Two modes: safety turns chaos up, liveness builds a healthy window',
    type: 'svg',
    body: svg('0 0 720 230',
      box(24, 24, 320, 120, C.green, 'SAFETY', []) +
      label(40, 70, 'Turn the chaos up — loss, jitter,', 'start', 0.85) +
      label(40, 88, 'crashes, partitions.', 'start', 0.85) +
      label(40, 112, 'Assert nothing bad ever happens:', 'start', 0.85) +
      label(40, 130, 'no lost acked write · no two leaders · serializable', 'start', 0.7) +
      box(376, 24, 320, 120, C.blue, 'LIVENESS', []) +
      label(392, 70, 'Construct a healthy-quorum window', 'start', 0.85) +
      label(392, 88, '(core healed; faults elsewhere permanent).', 'start', 0.85) +
      label(392, 112, 'Assert something good happens:', 'start', 0.85) +
      label(392, 130, 'the cluster keeps committing.', 'start', 0.7) +
      `<rect x="24" y="166" width="672" height="46" rx="9" fill="${fade(C.amber)}" stroke="${C.amber}" stroke-width="1.4"/>` +
      `<text x="360" y="193" text-anchor="middle" font-size="11.5" fill="${C.amber}" font-weight="600">Uniform random faults always heal — so pure chaos is structurally blind to liveness.</text>`),
  },

  quorum: {
    title: 'Quorum convergence across a partition',
    type: 'svg',
    body: svg('0 0 720 150',
      box(20, 36, 190, 78, C.green, 'Healthy 3/3', ['all reachable,', 'committing']) +
      box(265, 36, 190, 78, C.red, 'Split', ['{n0,n2} keep quorum;', 'n1 isolated']) +
      box(510, 36, 190, 78, C.green, 'Healed', ['n1 catches up;', '3/3 agree again']) +
      arrow(210, 75, 263, 75, 'red') + arrow(455, 75, 508, 75, 'green') +
      label(237, 66, 'partition', 'middle', 0.65) + label(482, 66, 'repair', 'middle', 0.65)),
  },

  'build-vs-buy': {
    title: 'DST on the build-vs-buy curve',
    type: 'html',
    body: `<table class="cmp"><thead><tr><th>Approach</th><th>Integration cost</th><th>Determinism</th><th>Teaches the fundamentals</th></tr></thead><tbody>
      <tr><td>FoundationDB / Flow</td><td>rewrite in a custom language</td><td>total</td><td>—</td></tr>
      <tr><td>madsim</td><td><code>--cfg madsim</code> + Cargo <code>[patch]</code> swaps</td><td>high (patched deps only)</td><td>some</td></tr>
      <tr><td>Antithesis</td><td>package into Docker, pay</td><td>total (hypervisor)</td><td>no</td></tr>
      <tr><td><strong>from scratch (this)</strong></td><td>build it yourself</td><td>high, with known boundaries</td><td>that was the point</td></tr>
      </tbody></table>`,
  },

  'mem-words': {
    title: 'Membership means two things',
    type: 'svg',
    body: svg('0 0 720 196',
      box(20, 55, 175, 76, C.amber, '“membership”', ['two meanings, in two', 'consistency tiers']) +
      box(280, 20, 420, 66, C.blue, 'meaning 1 · a liveness view', ['who seems up right now — weak, fleet-wide, always changing', 'failure detection: SWIM · φ-accrual · memberlist']) +
      box(280, 100, 420, 66, C.green, 'meaning 2 · an agreed view sequence', ['v1 → v2 → v3, the same order everywhere — needs agreement', 'group membership service · virtual synchrony']) +
      arrow(195, 82, 278, 54, 'blue') + arrow(195, 104, 278, 133, 'green') +
      label(360, 182, 'a soft local estimate, and an agreed ordered history — different consistency needs', 'middle', 0.6)),
  },

  'mem-flp': {
    title: 'The universal answer to FLP: cheap when everyone agrees, careful when they do not',
    type: 'svg',
    body: svg('0 0 720 230',
      box(24, 24, 320, 120, C.green, 'GOOD PERIOD — fast path', []) +
      label(40, 70, 'Everyone proposes the same thing;', 'start', 0.85) +
      label(40, 88, 'the network behaves.', 'start', 0.85) +
      label(40, 112, 'Decide in one hop:', 'start', 0.85) +
      label(40, 130, 'a single clean ping/ack settles it', 'start', 0.7) +
      box(376, 24, 320, 120, C.amber, 'BAD PERIOD — fallback', []) +
      label(392, 70, 'Conflicting proposals, partitions,', 'start', 0.85) +
      label(392, 88, 'silence.', 'start', 0.85) +
      label(392, 112, 'Pay for coordination:', 'start', 0.85) +
      label(392, 130, 'an extra round with a coordinator', 'start', 0.7) +
      `<rect x="24" y="166" width="672" height="46" rx="9" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.4"/>` +
      `<text x="360" y="193" text-anchor="middle" font-size="11.5" fill="${C.red}" font-weight="600">Safety holds in both periods. Only progress is negotiable — that is the FLP bargain.</text>`),
  },

  'mem-stack': {
    title: 'The invariant: an agreement box between soft detection and the configuration',
    type: 'svg',
    body: svg('0 0 720 266',
      box(90, 20, 360, 62, C.blue, 'soft detection', ['heartbeats · gossip · suspicion — weak and noisy']) +
      box(90, 106, 360, 62, C.purple, 'THE AGREEMENT BOX', ['one agreed, totally-ordered truth']) +
      box(90, 192, 360, 62, C.red, 'the voter set', ['what majorities are computed from — safety-critical']) +
      arrow(270, 82, 270, 104, 'blue') + arrow(270, 168, 270, 190, 'purple') +
      label(482, 112, 'where the box can live:', 'start', 0.78) +
      label(482, 132, '· an external store (ZooKeeper, etcd)', 'start', 0.65) +
      label(482, 150, '· the protocol itself (Raft, Matchmaker)', 'start', 0.65) +
      label(482, 168, '· the membership layer (Rapid)', 'start', 0.65) +
      arrow(476, 137, 456, 137, 'gray', true)),
  },

  'mem-timeline': {
    title: 'Four decades of asking “who else is here?”',
    type: 'svg',
    body: svg('0 0 800 252', (() => {
      const Y = 140, XL = 76, XR = 724;
      // category colors: detection=blue · dissemination=green · consistent views=pink · reconfiguration=amber
      const items = [
        ['1987', 'Demers et al.', 'epidemics / anti-entropy', C.green, 'up'],
        ['1998', 'van Renesse', 'gossip failure detection', C.blue, 'down'],
        ['2002', 'SWIM', 'detection ≠ dissemination', C.blue, 'up'],
        ['2004', 'φ-accrual', 'suspicion as a level', C.blue, 'down'],
        ['2006', 'FireFlies', 'Byzantine membership', C.pink, 'up'],
        ['2009', 'Census', 'consistent, location-aware', C.pink, 'down'],
        ['2013', 'memberlist / Serf', 'implemented + extended', C.green, 'up'],
        ['2017', 'Lifeguard', 'the accuser is the problem', C.blue, 'down'],
        ['2018', 'Rapid', 'one agreed view, at scale', C.pink, 'up'],
        ['2021', 'Matchmaker', 'reconfigurable consensus', C.amber, 'down'],
      ];
      // Even horizontal spacing by index — a proportional year axis bunches the recent papers
      // (2002-2009, 2013-2021) and collides their glosses. Years are still labelled per node.
      const x = (i) => XL + (i * (XR - XL)) / (items.length - 1);
      let out = `<line x1="${XL - 14}" y1="${Y}" x2="${XR + 14}" y2="${Y}" stroke="currentColor" opacity="0.35" stroke-width="1.6"/>`;
      items.forEach(([yr, name, gloss, col, dir], i) => {
        const px = x(i), up = dir === 'up';
        const ly = up ? Y - 58 : Y + 34;
        out += `<line x1="${px}" y1="${Y}" x2="${px}" y2="${up ? Y - 26 : Y + 22}" stroke="${col}" stroke-width="1.2" opacity="0.6"/>`;
        out += `<circle cx="${px}" cy="${Y}" r="5" fill="${col}"/>`;
        out += `<text x="${px}" y="${ly}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${col}">${name}</text>`;
        out += `<text x="${px}" y="${ly + 13}" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="0.72">${gloss}</text>`;
        out += `<text x="${px}" y="${ly + 26}" text-anchor="middle" font-size="8" fill="currentColor" opacity="0.5">${yr}</text>`;
      });
      const legend = [[C.blue, 'failure detection'], [C.green, 'dissemination'], [C.pink, 'consistent views'], [C.amber, 'reconfiguration']];
      legend.forEach(([col, name], i) => {
        const lx = 120 + i * 160;
        out += `<circle cx="${lx}" cy="238" r="4.5" fill="${col}"/><text x="${lx + 10}" y="242" font-size="9.5" fill="currentColor" opacity="0.7">${name}</text>`;
      });
      return out;
    })()),
  },

  'mem-membership-kinds': {
    title: 'How SurrealDB uses SurrealDS',
    type: 'svg',
    body: svg('0 0 720 266',
      // left: SurrealDB drives a transaction into the store
      box(24, 92, 118, 60, C.gray, 'SurrealDB', ['runs a SQL', 'transaction']) +
      box(168, 92, 120, 60, C.green, 'coordinator', ['drives it against', 'the replica set']) +
      arrow(142, 122, 166, 122, 'green') +
      label(84, 176, 'the database engine', 'middle', 0.6) +
      // right: the SurrealDS replica set (the membership)
      `<rect x="312" y="20" width="390" height="218" rx="11" fill="none" stroke="${C.red}" stroke-width="1.4" opacity="0.5"/>` +
      `<text x="328" y="42" font-size="12" font-weight="700" fill="${C.red}">SurrealDS — the distributed transactional store</text>` +
      `<text x="688" y="42" text-anchor="end" font-size="11" font-weight="700" fill="currentColor" opacity="0.6">view v4</text>` +
      box(330, 58, 104, 46, C.red, 'voter', []) +
      box(448, 58, 104, 46, C.red, 'voter', []) +
      box(566, 58, 104, 46, C.red, 'voter', []) +
      `<rect x="448" y="120" width="104" height="46" rx="9" fill="${fade(C.blue)}" stroke="${C.blue}" stroke-width="1.4" stroke-dasharray="5,4"/>` +
      `<text x="500" y="141" text-anchor="middle" font-size="12" font-weight="700" fill="${C.blue}">learner</text>` +
      `<text x="500" y="156" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.72">catching up</text>` +
      arrow(500, 120, 500, 106, 'green') +
      label(560, 141, 'leader promotes', 'start', 0.62) +
      box(330, 182, 340, 40, C.amber, 'operator → reload cluster config', ['add or remove nodes — one direction per reload']) +
      arrow(500, 182, 500, 168, 'amber') +
      arrow(288, 122, 328, 90, 'green') +
      label(500, 240, 'voters make the quorum · learners stage a join · consecutive views overlap', 'middle', 0.58)),
  },

  'mem-raft-joint': {
    title: 'Joint consensus: a transition that cannot split',
    type: 'svg',
    body: svg('0 0 720 210',
      box(30, 62, 180, 72, C.blue, 'C_old', ['decide with a majority', 'of the old set']) +
      box(270, 62, 180, 72, C.purple, 'C_old,new (joint)', ['a decision needs BOTH an', 'old and a new majority']) +
      box(510, 62, 180, 72, C.green, 'C_new', ['decide with a majority', 'of the new set']) +
      arrow(210, 98, 268, 98, 'blue') +
      arrow(450, 98, 508, 98, 'purple') +
      label(360, 40, 'commit the joint config, THEN move on — the two worlds can never both decide alone', 'middle', 0.68) +
      label(360, 166, 'while the joint config is in force, no old-only or new-only majority can commit — no split brain', 'middle', 0.6) +
      label(360, 186, 'contrast: a naive C_old → C_new jump leaves a window where disjoint majorities each decide', 'middle', 0.5)),
  },

  'mem-matchmaker': {
    title: 'Matchmaker Paxos communication (after the frankenpaxos visualization)',
    type: 'svg',
    body: svg('0 0 720 330', (() => {
      const dot = (cx, cy, col, lbl) =>
        `<circle cx="${cx}" cy="${cy}" r="16" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="2"/>` +
        `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${isNeon(col) ? INK : 'currentColor'}">${lbl}</text>`;
      const cliX = 80, ldrX = 250, mmX = 430, accX = 610;
      const CLI = [108, 158, 208], LDR = [133, 183], MM = [108, 158, 208];
      const C0 = [70, 108, 146], C1 = [196, 234, 272];
      const lx = ldrX, ly = LDR[0]; // the active leader drives the round
      let s = '';
      // edges from the active leader, drawn behind the (opaque) matchmaker nodes
      s += arrow(cliX + 16, CLI[0], ldrX - 16, ly, 'gray');
      MM.forEach((y) => { s += arrow(lx + 16, ly, mmX - 16, y, 'pink'); });
      C0.forEach((y) => { s += arrow(lx + 16, ly - 3, accX - 16, y, 'blue'); });
      C1.forEach((y) => { s += arrow(lx + 16, ly + 5, accX - 16, y, 'green'); });
      // nodes (on top of edges)
      CLI.forEach((y, i) => { s += dot(cliX, y, C.gray, 'c' + (i + 1)); });
      LDR.forEach((y, i) => { s += dot(ldrX, y, C.amber, 'l' + (i + 1)); });
      MM.forEach((y, i) => { s += dot(mmX, y, C.purple, 'm' + (i + 1)); });
      C0.forEach((y, i) => { s += dot(accX, y, C.blue, 'a' + (i + 1)); });
      C1.forEach((y, i) => { s += dot(accX, y, C.green, 'a' + (i + 4)); });
      // column headers + config labels
      s += label(cliX, 34, 'Clients', 'middle', 0.62);
      s += label(ldrX, 34, 'Leaders', 'middle', 0.62);
      s += label(mmX, 34, 'Matchmakers', 'middle', 0.62);
      s += label(accX, 34, 'Acceptors', 'middle', 0.62);
      s += label(accX + 24, 112, 'C₀', 'start', 0.62);
      s += label(accX + 24, 238, 'C₁', 'start', 0.62);
      // legend
      s += `<line x1="40" y1="314" x2="66" y2="314" stroke="${C.pink}" stroke-width="2.6"/>` + label(72, 318, 'matchmaking', 'start', 0.72);
      s += `<line x1="210" y1="314" x2="236" y2="314" stroke="${C.blue}" stroke-width="2.6"/>` + label(242, 318, 'Phase 1 · recover from C₀', 'start', 0.72);
      s += `<line x1="480" y1="314" x2="506" y2="314" stroke="${C.green}" stroke-width="2.6"/>` + label(512, 318, 'Phase 2 · commit to C₁', 'start', 0.72);
      return s;
    })()),
  },

  'mem-surrealds-parts': {
    title: 'SurrealDS: failure detection, an agreed member list, and reconfiguration',
    type: 'svg',
    body: svg('0 0 720 280',
      box(40, 20, 640, 58, C.blue, 'Failure detection', ['keep-alives + a leader-stall timer + a coordinator probe (soft, local);', 'triggers leader failover and recovery — but never changes the member set']) +
      box(40, 96, 640, 58, C.purple, 'The agreed member list', ['a numbered sequence of member lists every node agrees on and steps', 'through in order — the view change is where that agreement happens']) +
      box(40, 172, 640, 58, C.red, 'Changing the voter set', ['the voter set (voters + learners), reconfigured through that same view', 'change — grow one voter per view, shrink while a majority is retained']) +
      label(360, 252, 'failure detection never decides the voter set — an external operator reconciles the node count, and the store installs each change safely', 'middle', 0.58)),
  },

  'mem-two-majorities': {
    title: 'Any two majorities of one set must overlap',
    type: 'svg',
    body: svg('0 0 720 224', (() => {
      const NY = 108, R = 24, x = (i) => 168 + i * 96;   // 5 nodes, centred
      let out = '';
      for (let i = 0; i < 5; i++) {
        let fill, stroke;
        if (i === 2) { fill = C.purple; stroke = INK; }        // the shared node — neon emphasis
        else if (i < 2) { fill = fade(C.blue); stroke = C.blue; }
        else { fill = fade(C.green); stroke = C.green; }
        out += `<circle cx="${x(i)}" cy="${NY}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="2.2"/>`;
        out += `<text x="${x(i)}" y="${NY + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${i === 2 ? INK : 'currentColor'}">n${i + 1}</text>`;
      }
      // brackets: A over n1..n3 (above), B over n3..n5 (below)
      const yA = NY - R - 16, yB = NY + R + 30;
      out += `<path d="M${x(0)} ${yA + 8} L${x(0)} ${yA} L${x(2)} ${yA} L${x(2)} ${yA + 8}" fill="none" stroke="${C.blue}" stroke-width="1.6" opacity="0.85"/>`;
      out += `<text x="${(x(0) + x(2)) / 2}" y="${yA - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.blue}">majority A = {n1…n3}</text>`;
      out += `<path d="M${x(2)} ${yB - 8} L${x(2)} ${yB} L${x(4)} ${yB} L${x(4)} ${yB - 8}" fill="none" stroke="${C.green}" stroke-width="1.6" opacity="0.85"/>`;
      out += `<text x="${(x(2) + x(4)) / 2}" y="${yB + 16}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.green}">majority B = {n3…n5}</text>`;
      out += label(360, 212, '3 + 3 = 6 > 5 — two majorities of 5 cannot be disjoint; they meet at n3, which carries a committed write across a cut', 'middle', 0.62);
      return out;
    })()),
  },

  'mem-serf-stack': {
    title: 'What Serf actually is: three layers, one agent',
    type: 'svg',
    body: svg('0 0 720 265',
      box(120, 20, 480, 58, C.amber, 'Serf — the agent', ['+ join / leave / failed events · leave intents · Lamport-clocked user events']) +
      box(120, 100, 480, 58, C.green, 'memberlist — the library', ['+ dedicated gossip every 200 ms · TCP push/pull every 30 s · Lifeguard']) +
      box(120, 180, 480, 58, C.blue, 'SWIM — the paper (2002)', ['probe · ping-req · suspicion · incarnation numbers']) +
      arrow(360, 178, 360, 160, 'blue') + arrow(360, 98, 360, 80, 'green') +
      label(612, 129, 'Consul and Nomad', 'start', 0.6) +
      label(612, 144, 'both embed Serf', 'start', 0.6) +
      label(360, 256, 'each layer builds on the one below', 'middle', 0.6)),
  },

  'mem-swim-lifecycle': {
    title: 'One failure, end to end: probe → suspect → a definite, gossiped verdict',
    type: 'svg',
    body: svg('0 0 720 240',
      box(20, 86, 140, 72, C.green, 'ALIVE', ['acks its probes', 'within the timeout']) +
      box(290, 86, 140, 72, C.amber, 'SUSPECT', ['still routed as alive,', 'on a gossiped timer']) +
      box(560, 86, 140, 72, C.red, 'CONFIRMED DEAD', ['removed everywhere;', 'rejoins only @ inc 0']) +
      arrow(160, 122, 288, 122, 'amber') +
      label(224, 102, 'probe fails, then', 'middle', 0.72) +
      label(224, 115, 'all k ping-reqs fail', 'middle', 0.72) +
      arrow(430, 122, 558, 122, 'red') +
      label(494, 102, 'timer expires,', 'middle', 0.72) +
      label(494, 115, 'no refutation', 'middle', 0.72) +
      `<path d="M360 86 C 300 36, 150 36, 90 86" fill="none" stroke="${C.green}" stroke-width="1.8" stroke-dasharray="5,4" marker-end="url(#m-green)"/>` +
      label(225, 30, 'incarnation++ → Alive@i+1 refutes', 'middle', 0.72) +
      `<rect x="20" y="182" width="680" height="44" rx="9" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.4"/>` +
      `<text x="360" y="201" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">Suspect and Confirm both ride gossip out to every node.</text>` +
      `<text x="360" y="217" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">A Confirm outranks Alive/Suspect — every node's list converges on removal.</text>`),
  },

  'mem-rapid-watermarks': {
    title: 'Rapid cut detection: K observers vote, two watermarks decide',
    type: 'svg',
    body: svg('0 0 720 327', (() => {
      const MX = 96, MW = 80, TOP = 44, BOT = 250, K = 10;
      const yc = (c) => BOT - (c / K) * (BOT - TOP);
      const hY = yc(9), lY = yc(3);
      let out = '';
      out += `<rect x="${MX}" y="${TOP}" width="${MW}" height="${hY - TOP}" rx="6" fill="${C.purple}" stroke="${INK}" stroke-width="1.4"/>`;
      out += `<rect x="${MX}" y="${hY}" width="${MW}" height="${lY - hY}" fill="${fade(C.amber)}" stroke="${C.amber}" stroke-width="1.4"/>`;
      out += `<rect x="${MX}" y="${lY}" width="${MW}" height="${BOT - lY}" rx="6" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.4"/>`;
      out += `<line x1="${MX - 8}" y1="${hY}" x2="${MX + MW + 8}" y2="${hY}" stroke="${INK}" stroke-width="1.6" stroke-dasharray="4,3"/>`;
      out += `<line x1="${MX - 8}" y1="${lY}" x2="${MX + MW + 8}" y2="${lY}" stroke="${C.gray}" stroke-width="1.6" stroke-dasharray="4,3"/>`;
      out += label(MX - 12, hY + 4, 'H = 9', 'end', 0.85);
      out += label(MX - 12, lY + 4, 'L = 3', 'end', 0.85);
      out += `<text x="${MX + MW / 2}" y="${TOP - 12}" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">alert count ↑ (max K=10)</text>`;
      out += box(228, TOP, 236, 30, C.purple, 'STABLE  (≥ H)', []);
      out += label(236, TOP + 48, 'observers agree → goes into the cut', 'start', 0.72);
      out += box(228, 112, 236, 30, C.amber, 'UNSTABLE  (L…H)', []);
      out += label(236, 160, 'flapping / one-way link → defer the proposal', 'start', 0.72);
      out += box(228, 200, 236, 30, C.gray, 'NOISE  (< L)', []);
      out += label(236, 248, 'too few alerts → ignore', 'start', 0.72);
      out += box(506, TOP, 196, 74, C.purple, 'one batched cut', ['every stable change in', 'a single view —', '10 crashes → 1 change']);
      out += arrow(466, TOP + 15, 504, TOP + 15, 'gray');
      out += label(400, 288, 'the tally against the two watermarks — not any single observer — classifies each node', 'middle', 0.58);
      return out;
    })()),
  },

  'mem-rapid-quorum': {
    title: 'Why more than three-quarters, not a majority: two fast quorums must overlap past half',
    type: 'svg',
    body: svg('0 0 720 291', (() => {
      const N = 12, X0 = 92, CW = 42, GAP = 3, CH = 26;
      const cx = (i) => X0 + i * (CW + GAP);
      const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
      const row = (yy, onSet, colOn) => {
        let s = '';
        for (let i = 0; i < N; i++) {
          const on = onSet.includes(i);
          const fillC = on ? (colOn === C.purple ? C.purple : fade(colOn)) : fade(C.gray);
          const strokeC = on ? (colOn === C.purple ? INK : colOn) : C.gray;
          s += `<rect x="${cx(i)}" y="${yy}" width="${CW}" height="${CH}" rx="5" fill="${fillC}" stroke="${strokeC}" stroke-width="1.3" opacity="${on ? 1 : 0.5}"/>`;
        }
        return s;
      };
      let out = label(X0, 30, 'membership = 12 nodes · a fast quorum = more than ¾ (10 of 12)', 'start', 0.72);
      out += row(44, range(0, 9), C.purple) + label(X0 - 8, 61, 'A', 'end', 0.85);
      out += row(88, range(2, 11), C.purple) + label(X0 - 8, 105, 'B', 'end', 0.85);
      const bx0 = cx(2), bx1 = cx(9) + CW;
      out += `<path d="M${bx0} 118 L${bx0} 126 L${bx1} 126 L${bx1} 118" fill="none" stroke="${INK}" stroke-width="1.4"/>`;
      out += label((bx0 + bx1) / 2, 141, 'shared by A and B: 8 nodes > n/2  →  one leaderless round is safe', 'middle', 0.85);
      out += label(X0, 176, 'a bare majority = any 7 of 12', 'start', 0.72);
      out += row(188, range(0, 6), C.blue) + label(X0 - 8, 205, 'A', 'end', 0.85);
      out += row(226, range(5, 11), C.blue) + label(X0 - 8, 243, 'B', 'end', 0.85);
      const mx0 = cx(5), mx1 = cx(6) + CW;
      out += `<path d="M${mx0} 256 L${mx0} 264 L${mx1} 264 L${mx1} 256" fill="none" stroke="${C.red}" stroke-width="1.4"/>`;
      out += label((mx0 + mx1) / 2, 279, 'overlap as small as 2 — far below half; two conflicting values could each win', 'middle', 0.8);
      return out;
    })()),
  },

  'mem-phi-accrual': {
    title: 'φ-accrual: a tunable suspicion level, not a binary timeout',
    type: 'svg',
    body: svg('0 0 720 327', (() => {
      const X0 = 66, X1 = 660, Y0 = 250, Y1 = 46, PHIMAX = 4;
      const px = (t) => X0 + t * (X1 - X0);
      const py = (phi) => Y0 - (phi / PHIMAX) * (Y0 - Y1);
      let out = '';
      out += `<line x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}" stroke="currentColor" opacity="0.3"/>`;
      out += `<line x1="${X0}" y1="${Y0}" x2="${X0}" y2="${Y1}" stroke="currentColor" opacity="0.3"/>`;
      out += label(X1, Y0 + 22, 'time since last heartbeat →', 'end', 0.6);
      out += `<text x="${X0 - 8}" y="${Y1 - 6}" font-size="10.5" fill="currentColor" opacity="0.6">φ (suspicion)</text>`;
      const mu = 0.34, sig = 0.11;
      let bell = `M ${px(mu - 3 * sig)} ${Y0}`;
      for (let t = mu - 3 * sig; t <= mu + 3 * sig; t += 0.01) {
        const g = Math.exp(-((t - mu) * (t - mu)) / (2 * sig * sig));
        bell += ` L ${px(t)} ${Y0 - g * 42}`;
      }
      out += `<path d="${bell}" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.1" opacity="0.7"/>`;
      out += label(px(mu), Y0 - 62, 'expected arrival', 'middle', 0.55);
      [[1, '≈ 10% mistake'], [2, '≈ 1%'], [3, '≈ 0.1%']].forEach(([phi, txt]) => {
        out += `<line x1="${X0}" y1="${py(phi)}" x2="${X1}" y2="${py(phi)}" stroke="${C.gray}" stroke-width="1" stroke-dasharray="4,3" opacity="0.55"/>`;
        out += label(X1 - 2, py(phi) - 4, 'φ=' + phi + '   ' + txt, 'end', 0.6);
      });
      const pts = [[0, 0.05], [0.15, 0.09], [0.28, 0.16], [0.36, 0.3], [0.46, 0.7], [0.56, 1.3], [0.66, 2.0], [0.76, 2.8], [0.86, 3.5], [1.0, 4.0]];
      let curve = 'M ' + px(pts[0][0]) + ' ' + py(pts[0][1]);
      pts.slice(1).forEach(([t, phi]) => { curve += ' L ' + px(t) + ' ' + py(phi); });
      out += `<path d="${curve}" fill="none" stroke="${C.blue}" stroke-width="2.2"/>`;
      const tc = 0.53;
      out += `<line x1="${px(tc)}" y1="${py(1)}" x2="${px(tc)}" y2="${Y0}" stroke="${INK}" stroke-width="1.6" stroke-dasharray="5,4"/>`;
      out += `<circle cx="${px(tc)}" cy="${py(1)}" r="5" fill="${C.purple}" stroke="${INK}" stroke-width="1.5" filter="url(#phi-glow)"/>`;
      out += label(px(tc) + 10, py(1) + 22, 'app suspects here (φ ≥ 1)', 'start', 0.8);
      return out;
    })(), '<filter id="phi-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'),
  },

  'mem-gossip-fanout': {
    title: 'Gossip reaches everyone in about log n rounds',
    type: 'svg',
    body: svg('0 0 720 285', (() => {
      const XL = 150, XR = 660, tiers = [1, 2, 4, 8, 16], ys = [46, 92, 138, 184, 230];
      const xOf = (k, i) => XL + (i + 0.5) * ((XR - XL) / k);
      let edges = '', dots = '', labels = '';
      tiers.forEach((k, r) => {
        for (let i = 0; i < k; i++) {
          const x = xOf(k, i), y = ys[r];
          if (r > 0) {
            const pxp = xOf(tiers[r - 1], Math.floor(i / 2)), pyp = ys[r - 1];
            edges += `<line x1="${pxp}" y1="${pyp}" x2="${x}" y2="${y}" stroke="${C.green}" stroke-width="1" opacity="0.4"/>`;
          }
          const rad = k <= 4 ? 5.5 : (k === 8 ? 4 : 3);
          dots += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${C.green}" opacity="0.9"/>`;
        }
        labels += label(20, ys[r] + 4, 'round ' + r + ': ' + k, 'start', 0.7);
      });
      const notes =
        label(20, 262, 'cost ≈ constant per node — vs n² for all-to-all', 'start', 0.6) +
        label(XR, 262, 'infected set ≈ doubles each round → all n in ≈ log₂ n rounds', 'end', 0.62);
      return edges + dots + labels + notes;
    })()),
  },

  'mem-lhm': {
    title: 'The Local Health Multiplier: a node that suspects itself probes more gently',
    type: 'svg',
    body: svg('0 0 720 244', (() => {
      const GX = 232, GY = 92, GW = 238, GH = 30, CELLS = 9;
      const cw = (GW - (CELLS - 1) * 3) / CELLS;
      let cells = '';
      for (let i = 0; i < CELLS; i++) {
        const col = i < 3 ? C.green : (i < 6 ? C.amber : C.red);
        const solid = i === CELLS - 1;
        cells += `<rect x="${GX + i * (cw + 3)}" y="${GY}" width="${cw}" height="${GH}" rx="4" fill="${solid ? C.purple : fade(col)}" stroke="${solid ? INK : col}" stroke-width="1.3"/>`;
      }
      const gaugeLabels =
        label(GX, GY + GH + 15, '0 — healthy', 'start', 0.6) +
        label(GX + GW, GY + GH + 15, 'saturates at 8', 'end', 0.6) +
        label(GX + GW / 2, GY - 10, 'LHM  (self-health, 0…8)', 'middle', 0.72);
      const inc = box(16, 66, 176, 86, C.red, 'raise LHM  (+1)', ['· failed probe', '· missed nack (no reply)', '· refuting self-suspicion']);
      const dec = box(240, 176, 180, 42, C.green, 'lower LHM  (−1)', ['a clean probe']);
      const outb = box(524, 64, 182, 90, C.purple, '× (LHM + 1)', ['scales probe interval', 'AND timeout together', 'at LHM 8 → 9 s / 4.5 s']);
      const arrows =
        arrow(194, 107, 230, 107, 'red') +
        arrow(330, 174, 330, 126, 'green') +
        arrow(472, 107, 522, 107, 'purple');
      const foot = label(360, 236, 'memberlist ships a lighter version: cap ×8, scale the interval only, nack at the full timeout', 'middle', 0.58);
      return cells + gaugeLabels + inc + dec + outb + arrows + foot;
    })()),
  },
};

module.exports["layers-plan"] = { title: "The build plan: layers over a seed", type: "svg", body: "<svg class=\"dgm-svg\" viewBox=\"0 0 720 300\" xmlns=\"http://www.w3.org/2000/svg\"><defs><marker id=\"lp-green\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#16a34a\"/></marker><marker id=\"lp-amber\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#e0850f\"/></marker><marker id=\"lp-purple\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#1a1a1a\"/></marker></defs><rect x=\"250\" y=\"262\" width=\"160\" height=\"30\" rx=\"9\" fill=\"#e0850f20\" stroke=\"#e0850f\" stroke-width=\"1.6\"/><text x=\"330\" y=\"282\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#e0850f\">seed : u64</text><line x1=\"330\" y1=\"262\" x2=\"330\" y2=\"244\" stroke=\"#e0850f\" stroke-width=\"1.8\" marker-end=\"url(#lp-amber)\"/><rect x=\"110\" y=\"206\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#64748b20\" stroke=\"#64748b\" stroke-width=\"1.6\"/><text x=\"360\" y=\"223\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#64748b\">single-threaded driver</text><text x=\"360\" y=\"237\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">one thread steps the whole world, in order</text><rect x=\"110\" y=\"162\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"360\" y=\"179\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#16a34a\">paused Tokio runtimes</text><text x=\"360\" y=\"193\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">time advances only when we say so</text><rect x=\"110\" y=\"118\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#d9f400\" stroke=\"#1a1a1a\" stroke-width=\"1.6\"/><text x=\"360\" y=\"135\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#1a1a1a\">seeded PRNG</text><text x=\"360\" y=\"149\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">ChaCha8 + SHA-256 domain separation</text><rect x=\"110\" y=\"74\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#2563eb20\" stroke=\"#2563eb\" stroke-width=\"1.6\"/><text x=\"360\" y=\"91\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#2563eb\">OS interposition</text><text x=\"360\" y=\"105\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">clock_gettime / getrandom routed through the sim</text><rect x=\"110\" y=\"30\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#db277720\" stroke=\"#db2777\" stroke-width=\"1.6\"/><text x=\"360\" y=\"47\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#db2777\">network substrate</text><text x=\"360\" y=\"61\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">fault patterns + history hash</text><line x1=\"95\" y1=\"244\" x2=\"95\" y2=\"40\" stroke=\"#16a34a\" stroke-width=\"1.8\" marker-end=\"url(#lp-green)\"/><text x=\"78\" y=\"150\" transform=\"rotate(-90 78 150)\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.65\">each layer strangles one more source of nondeterminism</text></svg>" };

module.exports["sim-first"] = { title: "Simulation first: the whole cluster in one process, time compressed", type: "svg", body: "<svg class=\"dgm-svg\" viewBox=\"0 0 720 250\" xmlns=\"http://www.w3.org/2000/svg\"><defs><marker id=\"m-green\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#16a34a\"/></marker><marker id=\"m-blue\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#2563eb\"/></marker><marker id=\"m-purple\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#1a1a1a\"/></marker><marker id=\"m-amber\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#e0850f\"/></marker><marker id=\"m-gray\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#64748b\"/></marker></defs><rect x=\"20\" y=\"20\" width=\"470\" height=\"210\" rx=\"9\" fill=\"#2563eb20\" stroke=\"#2563eb\" stroke-width=\"1.6\"/><text x=\"36\" y=\"42\" font-size=\"13\" font-weight=\"700\" fill=\"#2563eb\">one OS process</text><rect x=\"40\" y=\"60\" width=\"110\" height=\"58\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"95\" y=\"80\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#16a34a\">n0</text><text x=\"95\" y=\"98\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">node task</text><rect x=\"165\" y=\"60\" width=\"110\" height=\"58\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"220\" y=\"80\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#16a34a\">n1</text><text x=\"220\" y=\"98\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">node task</text><rect x=\"290\" y=\"60\" width=\"110\" height=\"58\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"345\" y=\"80\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#16a34a\">n2</text><text x=\"345\" y=\"98\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">node task</text><rect x=\"40\" y=\"134\" width=\"360\" height=\"40\" rx=\"9\" fill=\"#d9f400\" stroke=\"#1a1a1a\" stroke-width=\"1.6\"/><text x=\"220\" y=\"159\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#1a1a1a\">network backplane</text><line x1=\"95\" y1=\"118\" x2=\"105\" y2=\"132\" stroke=\"#1a1a1a\" stroke-width=\"1.8\" marker-end=\"url(#m-purple)\"/><line x1=\"220\" y1=\"118\" x2=\"220\" y2=\"132\" stroke=\"#1a1a1a\" stroke-width=\"1.8\" marker-end=\"url(#m-purple)\"/><line x1=\"345\" y1=\"118\" x2=\"335\" y2=\"132\" stroke=\"#1a1a1a\" stroke-width=\"1.8\" marker-end=\"url(#m-purple)\"/><rect x=\"40\" y=\"186\" width=\"230\" height=\"34\" rx=\"9\" fill=\"#e0850f20\" stroke=\"#e0850f\" stroke-width=\"1.6\"/><text x=\"155\" y=\"208\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#e0850f\">driver + clock</text><rect x=\"286\" y=\"186\" width=\"114\" height=\"34\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"343\" y=\"208\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"#16a34a\">seed -&gt; RNG</text><line x1=\"220\" y1=\"174\" x2=\"170\" y2=\"184\" stroke=\"#e0850f\" stroke-width=\"1.8\" marker-end=\"url(#m-amber)\"/><line x1=\"270\" y1=\"203\" x2=\"284\" y2=\"203\" stroke=\"#16a34a\" stroke-width=\"1.8\" marker-end=\"url(#m-green)\"/><text x=\"255\" y=\"50\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.6\">entire cluster, one driver</text><line x1=\"490\" y1=\"125\" x2=\"516\" y2=\"125\" stroke=\"#64748b\" stroke-width=\"1.8\" marker-end=\"url(#m-gray)\" stroke-dasharray=\"5,4\"/><text x=\"610\" y=\"42\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#64748b\">time compression</text><rect x=\"540\" y=\"60\" width=\"40\" height=\"150\" rx=\"6\" fill=\"none\" stroke=\"#64748b\" stroke-width=\"1.4\"/><rect x=\"540\" y=\"196\" width=\"40\" height=\"14\" rx=\"5\" fill=\"#64748b20\" stroke=\"#64748b\" stroke-width=\"1.4\"/><text x=\"560\" y=\"228\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.7\">wall clock</text><rect x=\"640\" y=\"60\" width=\"40\" height=\"150\" rx=\"6\" fill=\"none\" stroke=\"#16a34a\" stroke-width=\"1.4\"/><rect x=\"640\" y=\"66\" width=\"40\" height=\"144\" rx=\"5\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"660\" y=\"228\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.7\">sim time</text><line x1=\"586\" y1=\"100\" x2=\"634\" y2=\"100\" stroke=\"#16a34a\" stroke-width=\"1.8\" marker-end=\"url(#m-green)\"/><text x=\"610\" y=\"92\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.65\">month -&gt; hour</text></svg>" };

// --- agent-filesystem post ---

module.exports['fs-stack'] = {
  title: 'Every door leads to the same kernel; only the store speaks to the database',
  type: 'svg',
  body: svg('0 0 720 330',
    box(18, 18, 124, 52, C.blue, 'Rust SDK', ['embedded']) +
    box(158, 18, 124, 52, C.blue, 'MCP', ['tool calls']) +
    box(298, 18, 124, 52, C.blue, 'mount', ['POSIX / FUSE']) +
    box(438, 18, 124, 52, C.blue, 'CLI', ['inspect · publish']) +
    box(578, 18, 124, 52, C.blue, 'run', ['confined exec']) +
    label(360, 98, 'translations, never second implementations', 'middle', 0.6) +
    box(110, 112, 500, 52, C.purple, 'semantic kernel', ['workspaces · publication · history — one implementation of the rules']) +
    box(110, 190, 500, 48, C.green, 'surrealfs-store', ['the only crate that speaks to the database']) +
    box(110, 264, 500, 48, C.gray, 'embedded SurrealDB → SurrealKV', ['records · transactions · RELATE edges · indexes']) +
    arrow(80, 70, 150, 110, 'blue') + arrow(220, 70, 255, 110, 'blue') +
    arrow(360, 70, 360, 110, 'blue') + arrow(500, 70, 465, 110, 'blue') +
    arrow(640, 70, 570, 110, 'blue') +
    arrow(360, 164, 360, 188, 'green') + arrow(360, 238, 360, 262, 'gray')),
};

module.exports['fs-forgets'] = {
  title: 'A POSIX write is destructive by design',
  type: 'svg',
  body: svg('0 0 720 196',
    box(20, 44, 210, 88, C.blue, '/report.md — 09:02', ['Q2 revenue: $4.1M']) +
    box(292, 44, 210, 88, C.red, '/report.md — 09:14', ['Q2 revenue: $1.4M']) +
    arrow(230, 88, 290, 88, 'red') + label(260, 78, 'write()', 'middle', 0.7) +
    box(548, 22, 156, 56, C.gray, 'what survives', ['mtime 09:14 · 0644']) +
    box(548, 100, 156, 74, C.red, 'what is gone', ['the previous bytes', 'the author', 'the reason']) +
    arrow(502, 70, 546, 50, 'gray') + arrow(502, 106, 546, 130, 'red', true) +
    label(360, 182, 'a write replaces bytes in place — the model has no previous value to ask about', 'middle', 0.6)),
};

module.exports['fs-root-anatomy'] = {
  title: 'A state root: two content-addressed halves, one name for everything',
  type: 'svg',
  body: svg('0 0 720 327',
    box(250, 20, 220, 56, C.purple, 'state root', ['digest = H( ns , kv )']) +
    box(90, 122, 230, 56, C.green, 'namespace node', ['the whole file tree, by digest']) +
    box(430, 122, 200, 56, C.blue, 'KV node', ['runtime keys, by digest']) +
    arrow(320, 78, 235, 120, 'green') + arrow(400, 78, 500, 120, 'blue') +
    box(48, 212, 150, 48, C.green, '/src', ['dir node · digest']) +
    box(222, 212, 150, 48, C.green, '/docs', ['dir node · digest']) +
    arrow(170, 180, 140, 210, 'green') + arrow(240, 180, 280, 210, 'green') +
    label(530, 226, 'theme → chunk b3:9c41…', 'middle', 0.6) +
    label(530, 244, 'cursor → chunk b3:02ee…', 'middle', 0.6) +
    label(123, 274, 'entries → chunk digests', 'middle', 0.55) +
    label(297, 274, 'entries → chunk digests', 'middle', 0.55) +
    label(360, 292, 'equal logical state ⟹ equal root digest — whatever history produced it', 'middle', 0.7)),
};

module.exports['fs-publish-steps'] = {
  title: 'The publication transaction — six steps, committed once',
  type: 'svg',
  body: svg('0 0 720 248',
    `<rect x="16" y="30" width="688" height="172" rx="12" fill="none" stroke="${C.gray}" stroke-width="1.4" stroke-dasharray="6,5"/>` +
    label(28, 22, 'one SurrealDB transaction', 'start', 0.65) +
    box(36, 48, 200, 56, C.gray, '1 · receipt re-check', ['seen this request before?']) +
    box(260, 48, 200, 56, C.amber, '2 · expected-head CAS', ['believed head still head?']) +
    box(484, 48, 200, 56, C.blue, '3 · verify staged chunks', ['content already present?']) +
    box(484, 128, 200, 56, C.green, '4 · write state + commit', ['nodes · mutations · edges']) +
    box(260, 128, 200, 56, C.purple, '5 · advance branch head', ['the one mutable write']) +
    box(36, 128, 200, 56, C.gray, '6 · store receipt', ['for crash-safe retries']) +
    arrow(236, 76, 258, 76, 'gray') + arrow(460, 76, 482, 76, 'amber') +
    arrow(584, 104, 584, 126, 'blue') + arrow(484, 156, 462, 156, 'green') +
    arrow(260, 156, 238, 156, 'purple') +
    arrow(360, 48, 360, 20, 'red', true) +
    label(360, 14, 'HeadConflict — typed; rebase and retry', 'middle', 0.7) +
    label(360, 230, 'any step fails ⇒ nothing happened; conflict and ambiguity are typed outcomes, not log lines', 'middle', 0.65)),
};

module.exports['fs-used-not-used'] = {
  title: 'What we asked of SurrealDB — and what we deliberately did not',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>SurrealDB feature</th><th>Used?</th><th>Why</th></tr></thead><tbody>
    <tr><td>Schemaful tables + <code>ASSERT</code></td><td>yes</td><td>malformed records refused at the boundary</td></tr>
    <tr><td>Deterministic record ids</td><td>yes</td><td>digest-keyed nodes — re-writing an existing node is free</td></tr>
    <tr><td>Client transactions</td><td>yes</td><td>the publication protocol commits once</td></tr>
    <tr><td><code>RELATE</code> graph edges</td><td>yes</td><td>span <em>caused</em> commit is a queryable row</td></tr>
    <tr><td>Record-link dereference</td><td>yes</td><td><code>commit.author_span.name</code> — three tables, one SELECT</td></tr>
    <tr><td>Composite indexes</td><td>yes</td><td>(repository, path, sequence) — provenance is an index walk</td></tr>
    <tr><td>Live queries</td><td>—</td><td>nothing subscribes</td></tr>
    <tr><td>Full-text / vector search</td><td>—</td><td>engine support is not a use case</td></tr>
    <tr><td>Engine temporal versioning</td><td>—</td><td>application history ≠ storage history; commits are the model</td></tr>
    </tbody></table>`,
};

module.exports['fs-anatomy'] = {
  title: 'The four structures — and the one that holds no name',
  type: 'svg',
  body: svg('0 0 720 330',
    box(20, 22, 150, 74, C.gray, 'superblock', ['the filesystem itself:', 'size, block size,', 'where the tables start']) +
    box(210, 22, 220, 74, C.blue, 'directory entry', ['name → inode number', '"report.md" → 12']) +
    box(470, 22, 230, 74, C.purple, 'inode', ['mode · uid · gid · size', 'link count · block pointers', 'NO NAME']) +
    box(470, 152, 230, 62, C.green, 'data blocks', ['where the bytes actually are']) +
    box(210, 152, 220, 62, C.amber, 'open file description', ['the cursor: offset + flags', 'shared across dup() and fork()']) +
    arrow(430, 59, 468, 59, 'blue') +
    arrow(585, 96, 585, 150, 'purple') +
    arrow(430, 183, 468, 183, 'amber') +
    label(449, 50, 'names it', 'middle', 0.6) +
    `<rect x="20" y="240" width="680" height="70" rx="9" fill="${fade(C.purple)}" stroke="${strokeFor(C.purple)}" stroke-width="1.4"/>` +
    `<text x="360" y="266" text-anchor="middle" font-size="12.5" font-weight="700" fill="${strokeFor(C.purple)}">The name and the file are separate objects.</text>` +
    label(360, 286, 'Two directory entries may name one inode — that is a hard link. The inode counts its names,', 'middle', 0.8) +
    label(360, 302, 'and the data is freed only when that count reaches zero.', 'middle', 0.8)),
};

module.exports['fs-journal'] = {
  title: 'Why a journal exists: one logical append is several block writes',
  type: 'svg',
  body: svg('0 0 720 327',
    label(20, 20, 'Appending one block to a file must update three places — and a crash can land between any of them:', 'start', 0.75) +
    box(20, 34, 200, 60, C.blue, 'block bitmap', ['mark block 812 used']) +
    box(258, 34, 200, 60, C.blue, 'inode', ['size += 4096, add pointer']) +
    box(496, 34, 204, 60, C.blue, 'data block', ['the bytes themselves']) +
    `<line x1="20" y1="112" x2="700" y2="112" stroke="${C.red}" stroke-width="1.6" stroke-dasharray="5,4"/>` +
    label(360, 128, '⚡ crash here → the bitmap says used, the inode never learned: a leaked block, or worse, a file pointing at garbage', 'middle', 0.8) +
    box(20, 150, 320, 66, C.amber, 'without a journal', ['blocks land in whatever order', 'the scheduler chose — fsck must', 'scan the whole filesystem to guess']) +
    box(380, 150, 320, 66, C.green, 'with a journal', ['write the intent first, commit it,', 'then apply — replay on mount', 'makes the set all-or-nothing']) +
    arrow(180, 216, 180, 240, 'amber') + arrow(540, 216, 540, 240, 'green') +
    `<rect x="20" y="246" width="680" height="44" rx="9" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.4"/>` +
    label(360, 264, 'ext4 default is data=ordered: metadata is journalled, file data is only ordered before it —', 'middle', 0.82) +
    label(360, 280, 'so the structure survives a crash, which is not the same promise as your bytes surviving.', 'middle', 0.82)),
};

module.exports['fs-storage-layers'] = {
  title: 'Where a byte actually ends up',
  type: 'svg',
  body: svg('0 0 720 340',
    box(20, 18, 300, 56, C.blue, 'the file you wrote', ['split into fixed 256 KiB pieces']) +
    box(400, 18, 300, 56, C.purple, 'chunk', ['named by BLAKE3 of its own bytes']) +
    arrow(320, 46, 398, 46, 'blue') +
    box(400, 100, 300, 68, C.green, 'a row in the chunk table', ['id  chunk:⟨repo⟩/⟨blake3⟩', 'inline_bytes  the payload itself']) +
    arrow(550, 74, 550, 98, 'purple') +
    label(690, 90, 'UPSERT — one per chunk', 'end', 0.6) +
    box(400, 194, 300, 56, C.gray, 'SurrealDB record', ['one embedded database']) +
    arrow(550, 168, 550, 192, 'green') +
    box(400, 276, 300, 52, C.gray, 'SurrealKV — an LSM tree', ['payload lands in the value log']) +
    arrow(550, 250, 550, 274, 'gray') +
    `<rect x="20" y="100" width="330" height="228" rx="10" fill="none" stroke="${C.gray}" stroke-width="1.3" stroke-dasharray="6,5"/>` +
    label(185, 122, 'There is no blob store.', 'middle', 0.9) +
    label(185, 146, 'No sidecar file, no object storage,', 'middle', 0.7) +
    label(185, 163, 'no external path of any kind.', 'middle', 0.7) +
    label(185, 194, 'Every byte of every file is a column', 'middle', 0.7) +
    label(185, 211, 'inside a database row — which is the', 'middle', 0.7) +
    label(185, 228, 'whole reason files and history can', 'middle', 0.7) +
    label(185, 245, 'move in one transaction.', 'middle', 0.7) +
    label(185, 280, 'A 256 KiB chunk clears the 4 KiB', 'middle', 0.55) +
    label(185, 296, 'value-log threshold, so payloads sit', 'middle', 0.55) +
    label(185, 312, 'beside the tree rather than in it.', 'middle', 0.55)),
};

module.exports['fs-component-swap'] = {
  title: 'Each piece of a filesystem, and what replaced it',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>A traditional filesystem</th><th>What it does</th><th>What I built instead</th></tr></thead><tbody>
    <tr><td>superblock</td><td>names the filesystem and where its tables start</td><td>a <code>repository</code> row plus a <strong>state root</strong> digest</td></tr>
    <tr><td>inode</td><td>metadata + where the data lives</td><td>an entry inside a content-addressed directory node — <strong>there is no inode table</strong></td></tr>
    <tr><td>inode number</td><td>the file's identity</td><td>nothing — identity is the <strong>path</strong>; inode numbers exist only to satisfy the kernel</td></tr>
    <tr><td>directory entry</td><td>maps a name to an inode number</td><td>a name→entry pair inside an immutable directory node</td></tr>
    <tr><td>data blocks</td><td>the bytes, at fixed offsets on a device</td><td>content-addressed chunks, named by the hash of their own bytes</td></tr>
    <tr><td>block allocator + free bitmap</td><td>decides where new bytes go</td><td><strong>deleted</strong> — content addressing chooses the name, and the engine chooses the placement</td></tr>
    <tr><td>journal</td><td>makes a multi-block update crash-safe</td><td>one database transaction, guarded by an expected-head compare-and-swap</td></tr>
    <tr><td><code>fsck</code></td><td>scans and repairs a damaged filesystem</td><td>recompute the root digest and compare — the state either re-derives or it doesn't</td></tr>
    <tr><td>mtime</td><td>a timestamp stored in the inode</td><td>derived from the commit that last wrote the path</td></tr>
    <tr><td>overwrite in place</td><td>destroys the previous bytes</td><td>a new immutable version, with the old one still addressable</td></tr>
    </tbody></table>`,
};

module.exports['fs-fuse-ops'] = {
  title: 'The callbacks a FUSE filesystem has to answer',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Callback</th><th>What the kernel is asking</th><th>Implemented?</th></tr></thead><tbody>
    <tr><td><code>init</code></td><td>which capabilities do you want?</td><td>yes — requests atomic <code>O_TRUNC</code></td></tr>
    <tr><td><code>lookup</code></td><td>does this name exist in this directory?</td><td>yes — the busiest call of all</td></tr>
    <tr><td><code>getattr</code></td><td><code>stat</code>: mode, size, times</td><td>yes</td></tr>
    <tr><td><code>open</code> / <code>release</code></td><td>open a file / last close of it</td><td>yes — <code>release</code> is where writes get staged</td></tr>
    <tr><td><code>read</code> / <code>write</code></td><td>bytes at an offset</td><td>yes</td></tr>
    <tr><td><code>readdir</code></td><td>list a directory</td><td>yes — synthesises <code>.</code> and <code>..</code></td></tr>
    <tr><td><code>create</code> / <code>mkdir</code></td><td>make a file / directory</td><td>yes</td></tr>
    <tr><td><code>unlink</code> / <code>rmdir</code> / <code>rename</code></td><td>remove or move a name</td><td>yes</td></tr>
    <tr><td><code>symlink</code> / <code>readlink</code> / <code>link</code></td><td>symbolic and hard links</td><td>yes</td></tr>
    <tr><td><code>setattr</code></td><td><code>chmod</code>, <code>chown</code>, <code>truncate</code></td><td>yes — timestamps are dropped</td></tr>
    <tr><td><code>flush</code> / <code>fsync</code></td><td>make it durable</td><td>answers OK and flushes nothing</td></tr>
    <tr><td><code>statfs</code></td><td><code>df</code>: how big is this filesystem?</td><td>no — so <code>df</code> reports zero bytes</td></tr>
    <tr><td><code>forget</code></td><td>you can drop this inode now</td><td>no — so the inode table only grows</td></tr>
    <tr><td><code>getxattr</code> · <code>setlk</code> · <code>fallocate</code> · <code>lseek</code> · <code>mknod</code></td><td>xattrs, locking, preallocation, holes, device nodes</td><td>no — <code>ENOSYS</code></td></tr>
    </tbody></table>`,
};

/* ─────────────────────────── branching-lsm (surrealkv v2) ─────────────────────────── */

module.exports['skv-lsm-anatomy'] = {
  title: 'An LSM tree: buffer in memory, flush sorted runs, merge them later',
  type: 'svg',
  body: svg('0 0 720 280', (() => {
    let o = '';
    o += label(360, 20, 'One constraint shapes all of it: small random writes are expensive, so never do them.', 'middle', 0.72);
    o += box(20, 34, 130, 52, C.green, 'write()', ['a key and a value']);
    o += box(184, 34, 150, 62, C.amber, 'WAL', ['append-only, for crash', 'recovery only']);
    o += box(184, 104, 150, 62, C.blue, 'memtable', ['arena skiplist,', 'sorted, in memory']);
    o += arrow(150, 60, 182, 60, 'green');
    o += arrow(259, 98, 259, 112, 'amber');
    o += label(344, 90, 'durable first, then visible', 'start', 0.55);
    o += box(376, 104, 150, 62, C.gray, 'flush', ['when it is full, write it', 'out once, sequentially']);
    o += arrow(334, 130, 374, 130, 'blue');
    // levels
    const lv = [['L0', 'overlapping runs', 190], ['L1', 'non-overlapping', 208], ['L2', 'ten times larger', 226]];
    let i = 0;
    for (const [n, note, y] of lv) {
      o += `<rect x="184" y="${y - 12}" width="342" height="15" rx="3" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1"/>`;
      o += label(192, y - 1, n, 'start', 0.85);
      o += label(232, y - 1, note, 'start', 0.55);
      i++;
    }
    o += arrow(451, 156, 451, 176, 'gray');
    o += box(556, 104, 146, 62, C.purple, 'compaction', ['merges runs, and is the', 'only thing that deletes']);
    o += arrow(629, 168, 629, 196, 'purple');
    o += `<line x1="629" y1="196" x2="536" y2="196" stroke="${INK}" stroke-width="1.8"/>`;
    o += arrow(540, 196, 528, 196, 'purple');
    o += para(360, 254, 'Nothing is ever overwritten in place. A key’s old versions survive until compaction decides they are unreachable — which is the property everything later in this post is built on.', { anchor: 'middle', maxW: 676, op: 0.6 });
    return o;
  })()),
};

module.exports['skv-primitives'] = {
  title: 'The three primitives a branch is built out of',
  type: 'svg',
  body: svg('0 0 720 340', (() => {
    let o = '';
    // (a) the sequence number
    o += label(20, 20, '(a)  a sequence number — one monotone integer, drawn per commit, for the whole store', 'start', 0.82);
    o += `<rect x="20" y="30" width="680" height="26" rx="7" fill="${C.purple}" stroke="${INK}" stroke-width="1.6"/>`;
    o += `<text x="30" y="47" font-size="11" font-weight="700" fill="${INK}">global commit sequence</text>`;
    for (let s = 1; s <= 10; s++) {
      const x = 250 + (s - 1) * 48;
      o += `<line x1="${x}" y1="30" x2="${x}" y2="56" stroke="${INK}" stroke-width="0.9" opacity="0.45"/>`;
      o += `<text x="${x + 6}" y="47" font-size="10" fill="${INK}" opacity="0.8">${s}</text>`;
    }
    // (b) the internal key
    o += label(20, 88, '(b)  visibility is a filter on that integer — and the integer lives inside the key', 'start', 0.82);
    const seg = [[20, 300, 'user_key', 'the bytes you wrote'], [326, 190, 'trailer : u64 BE', '(seq << 8) | kind'], [522, 178, 'timestamp : u64 BE', 'a selector, not the order']];
    for (const [x, w, t, sub] of seg) {
      o += `<rect x="${x}" y="98" width="${w}" height="40" rx="6" fill="${fade(C.blue)}" stroke="${C.blue}" stroke-width="1.4"/>`;
      o += `<text x="${x + w / 2}" y="115" text-anchor="middle" font-size="11.5" font-weight="700" fill="${C.blue}">${t}</text>`;
      o += label(x + w / 2, 130, sub, 'middle', 0.66);
    }
    o += box(326, 154, 190, 47, C.purple, '56-bit seq · 8-bit kind', ['Set · Delete · SoftDelete · …']);
    o += arrow(421, 152, 421, 140, 'purple');
    o += para(534, 172, 'Ordering: user key ASCENDING, then sequence DESCENDING.', { anchor: 'start', maxW: 166, op: 0.78 });
    o += para(534, 198, 'Newest version of a key comes first.', { anchor: 'start', maxW: 166, op: 0.55 });
    // (c) compaction
    o += label(20, 232, '(c)  exactly one component destroys anything', 'start', 0.82);
    o += box(20, 242, 150, 62, C.gray, 'a read', ['ignores seq > s.', 'Destroys nothing.']);
    o += box(196, 242, 150, 62, C.gray, 'a write', ['adds a version.', 'Destroys nothing.']);
    o += box(372, 242, 170, 62, C.red, 'compaction', ['drops superseded versions.', 'The only destroyer.']);
    o += box(568, 242, 132, 62, C.green, 'so: ask it', ['to keep more, and', 'the past stays readable']);
    o += arrow(544, 265, 566, 265, 'red');
    o += para(360, 314, 'Put (a) and (b) together and “read the store as it was at sequence s” already works — every engine with snapshot isolation does it. The only reason it is not a branch is (c): nothing has promised compaction will keep serving that particular s.', { anchor: 'middle', maxW: 676, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-checkpoint-vs-fork'] = {
  title: 'A checkpoint makes a second store; a fork makes a second view of one',
  type: 'svg',
  body: svg('0 0 720 265', (() => {
    let o = '';
    o += label(180, 20, 'a checkpoint', 'middle', 0.9);
    o += label(540, 20, 'a fork', 'middle', 0.9);
    o += `<line x1="360" y1="30" x2="360" y2="246" stroke="currentColor" stroke-width="1" opacity="0.25" stroke-dasharray="4,4"/>`;
    // checkpoint side
    o += box(24, 34, 148, 62, C.green, 'store A', ['memtable, WAL,', '14 live SSTables']);
    o += box(196, 34, 148, 62, C.gray, 'store B', ['a copy or hard link of', 'all 14, rebased WAL']);
    o += arrow(172, 64, 194, 64, 'green');
    o += label(184, 112, 'cost tracks the live FILE COUNT', 'middle', 0.72);
    o += label(184, 128, 'no shared future: both sides now', 'middle', 0.6);
    o += label(184, 141, 'compact, flush and grow separately', 'middle', 0.6);
    o += label(184, 160, 'no diff · no merge back · whole-store only', 'middle', 0.6);
    o += `<rect x="24" y="176" width="320" height="26" rx="6" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.3"/>`;
    o += `<text x="184" y="193" text-anchor="middle" font-size="11" font-weight="600" fill="${C.red}">two stores that used to be equal</text>`;
    // fork side
    o += box(384, 34, 148, 62, C.green, 'main', ['keeps its memtable,', 'WAL and SSTables']);
    o += box(556, 34, 144, 62, C.purple, 'feature', ['owns nothing yet —', 'one catalog record']);
    o += arrow(554, 64, 534, 64, 'gray');
    o += label(628, 112, 'reads through main,', 'middle', 0.72);
    o += label(628, 125, 'capped at the anchor', 'middle', 0.72);
    o += label(542, 150, 'cost is one metadata record, whatever the store weighs', 'middle', 0.62);
    o += label(542, 166, 'diff and merge are defined, because both sides share a clock', 'middle', 0.6);
    o += `<rect x="384" y="176" width="316" height="26" rx="6" fill="${C.purple}" stroke="${INK}" stroke-width="1.3"/>`;
    o += `<text x="542" y="193" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}">one store, two views of it</text>`;
    o += para(360, 226, 'The arrow is the whole difference: a fork keeps a read path into its parent, so nothing had to be copied to create it — and the parent can no longer forget whatever that arrow still points at. Everything expensive about branching follows from that second clause.', { anchor: 'middle', maxW: 676, op: 0.6 });
    return o;
  })()),
};

module.exports['skv-ceiling'] = {
  title: 'A branch is a ceiling on one clock, not a second history',
  type: 'svg',
  body: svg('0 0 720 284', (() => {
    let o = '';
    // what it is NOT
    o += label(20, 20, 'what it is not', 'start', 0.85);
    o += box(70, 30, 240, 52, C.gray, 'main', ['its own clock, its own HEAD']);
    o += box(410, 30, 240, 52, C.gray, 'feature', ['a second, independent history']);
    o += arrow(312, 56, 408, 56, 'gray', true);
    o += arrow(360, 90, 360, 104, 'red', true);
    o += label(360, 118, '✗ there is no second clock, and no per-branch head', 'middle', 0.82);
    // what it IS
    o += label(20, 152, 'what it is', 'start', 0.85);
    o += `<rect x="20" y="162" width="680" height="30" rx="8" fill="${C.purple}" stroke="${INK}" stroke-width="1.7"/>`;
    o += `<text x="32" y="181" font-size="11.5" font-weight="700" fill="${INK}">one global commit sequence</text>`;
    const ticks = [10, 20, 25, 30, 40];
    const X = (s) => 240 + (s - 5) * 12.4;
    for (const s of ticks) {
      o += `<line x1="${X(s)}" y1="162" x2="${X(s)}" y2="192" stroke="${INK}" stroke-width="1" opacity="0.5"/>`;
      o += `<text x="${X(s)}" y="206" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">${s}</text>`;
    }
    // anchor
    o += `<line x1="${X(25)}" y1="150" x2="${X(25)}" y2="236" stroke="${INK}" stroke-width="2.2"/>`;
    o += `<rect x="${X(25) - 44}" y="132" width="88" height="17" rx="4" fill="${C.purple}" stroke="${INK}" stroke-width="1.2"/>`;
    o += `<text x="${X(25)}" y="145" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">fork_seq = 25</text>`;
    // invisible region
    o += `<rect x="${X(25)}" y="214" width="${700 - X(25)}" height="22" rx="4" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.1" stroke-dasharray="4,3"/>`;
    o += `<text x="${(X(25) + 700) / 2}" y="229" text-anchor="middle" font-size="10.5" fill="${C.red}">invisible to the child, permanently</text>`;
    o += label(20, 229, 'the child inherits', 'start', 0.7);
    o += para(360, 258, 'The child’s own commits draw numbers from the same counter, so they land to the right of 25 — above everything it inherited. That is the entire mechanism behind copy-on-write shadowing: no flags, no shadow table, just arithmetic.', { anchor: 'middle', maxW: 676, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-fork-anchor'] = {
  title: 'The fork anchor: a number on the parent’s clock, and everything above it invisible forever',
  type: 'svg',
  body: svg('0 0 720 270', (() => {
    let o = '';
    const X = (s) => 150 + s * 12.6;
    o += label(20, 20, 'One anchor per link. On a chain, the effective ceiling is the lowest anchor on the path.', 'start', 0.72);
    // lanes
    o += box(20, 40, 116, 40, C.green, 'main', []);
    o += box(20, 104, 116, 40, C.blue, 'child', []);
    o += box(20, 168, 116, 40, C.gray, 'grandchild', []);
    const lanes = [[40, C.green, [10, 20, 30, 40], null], [104, C.blue, [32, 41], 25], [168, C.gray, [44], 33]];
    for (const [y, col, dots, anchor] of lanes) {
      o += `<line x1="146" y1="${y + 20}" x2="700" y2="${y + 20}" stroke="currentColor" stroke-width="0.9" opacity="0.22"/>`;
      for (const s of dots) {
        o += `<circle cx="${X(s)}" cy="${y + 20}" r="7.5" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.5"/>`;
        o += `<text x="${X(s)}" y="${y + 38}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">${s}</text>`;
      }
      if (anchor != null) {
        o += `<line x1="${X(anchor)}" y1="${y - 6}" x2="${X(anchor)}" y2="${y + 46}" stroke="${INK}" stroke-width="2"/>`;
        o += `<rect x="${X(anchor) - 30}" y="${y - 22}" width="60" height="16" rx="4" fill="${C.purple}" stroke="${INK}" stroke-width="1.1"/>`;
        o += `<text x="${X(anchor)}" y="${y - 10}" text-anchor="middle" font-size="10" font-weight="700" fill="${INK}">@ ${anchor}</text>`;
      }
    }
    // effective cap for grandchild
    o += `<line x1="${X(25)}" y1="188" x2="${X(25)}" y2="222" stroke="${INK}" stroke-width="1.6" stroke-dasharray="5,4"/>`;
    o += para(20, 232, 'the grandchild’s view of main also caps at 25 — min(33, 25) — never at its own anchor', { maxW: 676, op: 0.72 });
    o += para(20, 244, 'A snapshot is released when its reader leaves. An anchor is the branch’s definition: it outlives every reader, survives restart, and is what makes the view writable.', { anchor: 'start', maxW: 680, op: 0.6 });
    return o;
  })()),
};

module.exports['skv-use-cases'] = {
  title: 'Four things people want a fork for, and what each one needs to be exact about',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Use</th><th>Lifetime</th><th>How many live at once</th><th>What it must be exact about</th><th>What you do today instead</th></tr></thead><tbody>
    <tr><td><b>Agent sandbox</b></td><td>seconds to minutes</td><td>one per task, thrown away</td><td>being <i>undoable</i> — the discard must leave nothing</td><td>copy the directory, or hope</td></tr>
    <tr><td><b>Dev / test / preview</b></td><td>hours to days</td><td>tens, concurrently</td><td>being a faithful copy of production data</td><td>restore a dump per environment</td></tr>
    <tr><td><b>Time travel &amp; audit</b></td><td>as long as the retention policy</td><td>read-only, many</td><td>the <i>point in time</i> — an approximation is useless</td><td>read a backup, or an audit table you wrote yourself</td></tr>
    <tr><td><b>Multi-tenant copy-on-write</b></td><td>the tenant's lifetime</td><td>thousands</td><td>isolation of cost — one tenant must not bill the others</td><td>a full copy per tenant</td></tr>
    </tbody></table>
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">They disagree on everything except one requirement: <b>the cost of creating one must not scale with the size of the store.</b> That single line is the scoring function for every design below — and the lifetime column is what makes <i>many short-lived branches</i> the target rather than a few long-lived release lines.</p>`,
};

module.exports['skv-options'] = {
  title: 'Four ways to build a branch on an LSM tree, and where each one puts the cost',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Approach</th><th>What a fork writes</th><th>What it does to compaction</th><th>Why not this</th></tr></thead><tbody>
    <tr><td><b>Put the branch id in every key</b></td><td>nothing</td><td>every branch's rows interleave in one keyspace, so a compaction job can never be scoped to one branch</td><td>deleting a branch becomes a range delete over live data; a key's version chain is no longer contiguous, which the comparator and the bloom filters both depend on; and a scan at fork depth <i>d</i> becomes <i>d</i> scans</td></tr>
    <tr><td><b>A separate engine per branch, with a copy</b></td><td>everything</td><td>nothing — each engine is independent</td><td>trivially correct, and it fails the one requirement: cost scales with the data</td></tr>
    <tr><td><b>Per-branch roots over a content-addressed tree</b></td><td>one root hash</td><td>replaces it — reachability over digests rather than sequence numbers</td><td>sound, and it means <i>replacing</i> the storage engine rather than extending it: MVCC, compaction and crash recovery all have to be re-derived over a new address space</td></tr>
    <tr><td><b>A ceiling on a shared sequence counter</b><br><small>what this post describes</small></td><td>one metadata record</td><td>all of the difficulty lands here: compaction must be told which superseded versions are still somebody's current</td><td>the cost is real; it is concentrated in one component instead of spread across the key format</td></tr>
    </tbody></table>
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">Read the third column rather than the second. Every one of these is cheap to fork; they differ almost entirely in what they do to the component whose job is to forget things.</p>`,
};

module.exports['skv-key-vs-metadata'] = {
  title: 'Where the owner is named — and what one compaction job therefore sees',
  type: 'svg',
  body: svg('0 0 720 321', (() => {
    let o = '';
    o += label(180, 20, 'as built — the owner rides in component metadata', 'middle', 0.88);
    o += label(540, 20, 'rejected — the owner is a prefix in every key', 'middle', 0.88);
    o += `<line x1="360" y1="30" x2="360" y2="274" stroke="currentColor" stroke-width="1" opacity="0.25" stroke-dasharray="4,4"/>`;
    // left: key layout unchanged
    o += `<rect x="20" y="36" width="320" height="30" rx="6" fill="${C.purple}" stroke="${INK}" stroke-width="1.5"/>`;
    o += `<line x1="216" y1="36" x2="216" y2="66" stroke="${INK}" stroke-width="1"/>`;
    o += `<line x1="280" y1="36" x2="280" y2="66" stroke="${INK}" stroke-width="1"/>`;
    o += `<text x="118" y="55" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">user_key</text>`;
    o += `<text x="248" y="55" text-anchor="middle" font-size="9.5" font-weight="700" fill="${INK}">trailer</text>`;
    o += `<text x="310" y="55" text-anchor="middle" font-size="9.5" font-weight="700" fill="${INK}">ts</text>`;
    o += label(180, 80, 'byte-for-byte what it was before branching existed', 'middle', 0.62);
    // components carrying the owner
    const comps = [['memtable', 20], ['SSTable meta', 128], ['manifest entry', 236]];
    for (const [n, x] of comps) {
      o += `<rect x="${x}" y="94" width="104" height="42" rx="7" fill="${fade(C.green)}" stroke="${C.green}" stroke-width="1.4"/>`;
      o += `<text x="${x + 52}" y="110" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.green}">${n}</text>`;
      o += `<rect x="${x + 10}" y="116" width="84" height="14" rx="3" fill="${fade(C.amber)}" stroke="${C.amber}" stroke-width="1"/>`;
      o += `<text x="${x + 52}" y="126" text-anchor="middle" font-size="8.5" fill="${C.amber}">BatchOwner b7·g2</text>`;
    }
    o += `<rect x="20" y="172" width="320" height="46" rx="7" fill="none" stroke="${C.green}" stroke-width="1.6" stroke-dasharray="6,4"/>`;
    o += `<text x="180" y="190" text-anchor="middle" font-size="11" font-weight="700" fill="${C.green}">what one compaction job sees</text>`;
    o += label(180, 206, 'exactly one owner’s rows — by construction', 'middle', 0.66);
    o += arrow(20, 238, 340, 238, 'green');
    o += label(180, 256, 'a range scan is one seek, at any fork depth', 'middle', 0.66);
    // right: prefixed
    o += `<rect x="380" y="36" width="320" height="30" rx="6" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.5"/>`;
    o += `<line x1="452" y1="36" x2="452" y2="66" stroke="${C.red}" stroke-width="1"/>`;
    o += `<line x1="620" y1="36" x2="620" y2="66" stroke="${C.red}" stroke-width="1"/>`;
    o += `<line x1="662" y1="36" x2="662" y2="66" stroke="${C.red}" stroke-width="1"/>`;
    o += `<text x="416" y="55" text-anchor="middle" font-size="10" font-weight="700" fill="${C.red}">branch_id</text>`;
    o += `<text x="536" y="55" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.red}">user_key</text>`;
    o += `<text x="641" y="55" text-anchor="middle" font-size="9" font-weight="700" fill="${C.red}">trlr</text>`;
    o += `<text x="681" y="55" text-anchor="middle" font-size="9" font-weight="700" fill="${C.red}">ts</text>`;
    o += label(540, 80, 'the comparator now carries branch semantics forever', 'middle', 0.62);
    // interleaved rows
    const rows = [['b7  user:3  s31', C.blue], ['b2  user:3  s28', C.gray], ['b7  user:4  s24', C.blue], ['b2  user:4  s19', C.gray]];
    let y = 94;
    for (const [t, col] of rows) {
      o += `<rect x="380" y="${y}" width="320" height="16" rx="3" fill="${fade(col)}" stroke="${col}" stroke-width="1"/>`;
      o += `<text x="390" y="${y + 12}" font-size="9.5" fill="currentColor" opacity="0.8">${t}</text>`;
      y += 19;
    }
    o += `<rect x="380" y="172" width="320" height="46" rx="7" fill="none" stroke="${C.red}" stroke-width="1.6" stroke-dasharray="6,4"/>`;
    o += `<text x="540" y="190" text-anchor="middle" font-size="11" font-weight="700" fill="${C.red}">what one compaction job sees</text>`;
    o += label(540, 206, 'two branches’ rows — it cannot be scoped to one', 'middle', 0.66);
    o += arrow(380, 232, 700, 232, 'red');
    o += arrow(380, 244, 700, 244, 'red');
    o += arrow(380, 256, 700, 256, 'red');
    o += label(540, 272, 'a scan at fork depth d is d seeks, one per prefix', 'middle', 0.66);
    o += para(360, 282, 'The version chain of one user key is contiguous on the left and fragmented on the right. Contiguity is what the newest-first walk, the comparator and the bloom filters are all built on — so prefixing is not slower by a constant, it invalidates the assumption underneath the read path.', { anchor: 'middle', maxW: 676, op: 0.6 });
    return o;
  })()),
};

module.exports['skv-key-ownership'] = {
  title: 'Ownership in the key, or ownership in the metadata',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Question</th><th>branch id prefixed into every key <small>(rejected)</small></th><th>owner in component metadata <small>(as built)</small></th></tr></thead><tbody>
    <tr><td>internal key layout</td><td><code>branch_id ‖ user_key ‖ trailer ‖ ts</code></td><td><code>user_key ‖ trailer:u64BE ‖ ts:u64BE</code> — <b>unchanged by branching</b></td></tr>
    <tr><td>a user key's version chain</td><td>split across one prefix per branch on the path</td><td>contiguous, newest first, one comparator</td></tr>
    <tr><td>a range scan at fork depth <i>d</i></td><td><i>d</i> disjoint scans, one per prefix</td><td>one scan; the read stack supplies the layers</td></tr>
    <tr><td>bloom filters</td><td>keyed on prefix + key, so one probe per branch</td><td>keyed on the user key</td></tr>
    <tr><td>scope of a compaction job</td><td>necessarily multi-branch</td><td>exactly one owner, by construction</td></tr>
    <tr><td>deleting a branch</td><td>a range delete over live data</td><td>reclaim a component set — no rows are deleted</td></tr>
    <tr><td>where the owner is named</td><td>in the bytes of every row</td><td><code>BatchOwner{branch, generation}</code> on the batch, memtable, SST meta and manifest</td></tr>
    <tr><td>owner lookup cost</td><td>a prefix comparison per row</td><td><code>HashMap&lt;BatchOwner, Levels&gt;</code> — branch count must not enter the lookup</td></tr>
    <tr><td>cost of one more fork level</td><td>one more prefix in every scan</td><td>one more layer, and one more <code>min</code> in the cap</td></tr>
    </tbody></table>`,
};

module.exports['skv-read-stack-anatomy'] = {
  title: 'The read stack: one layer per ancestor, each with its own ceiling',
  type: 'svg',
  body: svg('0 0 720 358', (() => {
    let o = '';
    o += label(20, 20, 'A snapshot is not one filter over one sorted view. It is a stack, walked nearest-first.', 'start', 0.72);
    const layers = [
      [30, C.green, 'own layer  ·  cap = snapshot_seq 31', 'active memtable → immutable, newest first →', 'L0 (key-range filtered) → L1+ (binary search)'],
      [116, C.blue, 'parent  ·  cap = min(31, 25) = 25', 'the same four places, read at 25 — not at 31'],
      [202, C.gray, 'grandparent  ·  cap = min(31, 25, 12) = 12', 'active: None — an idle branch has no runtime and no arena'],
    ];
    for (const [y, col, title, ...subs] of layers) {
      o += box(20, y, 430, 46 + 15 * subs.length, col, title, subs);
    }
    o += arrow(235, 102, 235, 114, 'green');
    o += arrow(235, 188, 235, 200, 'blue');
    o += box(482, 96, 218, 137, C.purple, 'cap narrows monotonically', ['walking the parent chain', 'nearest-first:', 'cap = cap.min(fork_seq)', '', 'so a grandchild can never see', 'more of its grandparent', 'than its parent could']);
    o += arrow(478, 151, 454, 151, 'gray', true);
    o += para(360, 288, 'The first visible version wins, and the walk stops there. A tombstone in a nearer layer hides every farther layer — a delete answers “absent”, it does not abstain and let an ancestor answer. Rows sitting above a layer’s cap are physically present on disk and unreadable through that layer.', { anchor: 'middle', maxW: 676, op: 0.62 });
    o += para(360, 332, 'Read amplification therefore tracks fork depth: d layers each contribute their own live components into one merge. MAX_VIEW_DEPTH = 64 bounds it.', { anchor: 'middle', maxW: 676, op: 0.55 });
    return o;
  })()),
};

module.exports['skv-cap-before-merge'] = {
  title: 'Why the cap is applied per layer, upstream of the k-way merge',
  type: 'svg',
  body: svg('0 0 720 297', (() => {
    let o = '';
    o += label(20, 20, 'Each layer’s iterators are wrapped BEFORE the merge. A single filter on the merged stream cannot express per-layer caps.', 'start', 0.74);
    // as built
    o += label(20, 46, 'as built', 'start', 0.85);
    const src = [[56, C.green, 'own · cap 31', 'user:4 s29'], [104, C.blue, 'parent · cap 19', 'user:4 s27'], [152, C.gray, 'grandpa · cap 11', 'user:4 s8']];
    for (const [y, col, cap, row] of src) {
      o += `<rect x="20" y="${y}" width="150" height="34" rx="6" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.4"/>`;
      o += `<text x="30" y="${y + 14}" font-size="9.5" font-weight="700" fill="${strokeFor(col)}">${cap}</text>`;
      o += label(30, y + 27, row, 'start', 0.7);
      // gate
      o += `<rect x="188" y="${y + 6}" width="52" height="22" rx="5" fill="${C.purple}" stroke="${INK}" stroke-width="1.3"/>`;
      o += `<text x="214" y="${y + 21}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${INK}">≤ cap</text>`;
      o += arrow(172, y + 17, 186, y + 17, 'gray');
      o += arrow(242, y + 17, 262, y + 17, 'gray');
    }
    o += `<rect x="264" y="56" width="46" height="130" rx="7" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.4"/>`;
    o += `<text x="287" y="112" text-anchor="middle" font-size="10" font-weight="700" fill="${C.gray}">k-way</text>`;
    o += `<text x="287" y="126" text-anchor="middle" font-size="10" font-weight="700" fill="${C.gray}">merge</text>`;
    o += arrow(312, 121, 330, 121, 'gray');
    o += `<rect x="332" y="98" width="116" height="46" rx="6" fill="${fade(C.green)}" stroke="${C.green}" stroke-width="1.4"/>`;
    o += `<text x="390" y="116" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.green}">user:4 → s8</text>`;
    o += label(390, 132, 'correct for this reader', 'middle', 0.66);
    // rejected
    o += label(474, 46, 'one global filter instead', 'start', 0.85);
    for (const [y, col, cap, row] of src) {
      o += `<rect x="474" y="${y}" width="96" height="34" rx="6" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.4"/>`;
      o += `<text x="482" y="${y + 14}" font-size="9" font-weight="700" fill="${strokeFor(col)}">${cap}</text>`;
      o += label(482, y + 27, row, 'start', 0.7);
      o += arrow(572, y + 17, 586, y + 17, 'gray');
    }
    o += `<rect x="588" y="56" width="34" height="130" rx="7" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.4"/>`;
    o += `<text x="605" y="115" text-anchor="middle" font-size="9" font-weight="700" fill="${C.gray}">merge</text>`;
    o += `<rect x="632" y="98" width="42" height="24" rx="5" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.3"/>`;
    o += `<text x="653" y="114" text-anchor="middle" font-size="9.5" font-weight="700" fill="${C.red}">≤ 31</text>`;
    o += arrow(622, 110, 630, 110, 'gray');
    o += `<rect x="600" y="146" width="100" height="40" rx="6" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.6"/>`;
    o += `<text x="650" y="163" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.red}">user:4 → s27</text>`;
    o += label(650, 178, 'never visible to anyone', 'middle', 0.7);
    o += para(360, 216, 'The leaked row is well formed, correctly ordered, and below the snapshot’s own sequence — 27 ≤ 31. It is wrong only because of which layer supplied it, and by the time the streams are interleaved that information is gone.', { anchor: 'middle', maxW: 676, op: 0.62 });
    o += para(360, 258, 'The ordering is what makes it subtle: within a key, versions arrive sequence-DESCENDING. A capped iterator walks a key’s above-cap versions down to its visible one; a post-merge filter has already let another layer’s row win the key before the filter is ever consulted.', { anchor: 'middle', maxW: 676, op: 0.55 });
    return o;
  })()),
};

module.exports['skv-shadow'] = {
  title: 'Copy-on-write shadowing is arithmetic, not bookkeeping',
  type: 'svg',
  body: svg('0 0 720 236', (() => {
    let o = '';
    o += label(20, 20, 'The child writes user:7. Nothing in the parent changes, and nothing records that the key is now overridden.', 'start', 0.72);
    o += box(20, 34, 200, 47, C.blue, 'child  ·  cap 31', ['fork anchor at 25']);
    o += box(20, 100, 200, 47, C.green, 'parent  ·  cap 25', ['untouched by the write']);
    // versions
    o += `<rect x="250" y="38" width="180" height="34" rx="6" fill="${C.purple}" stroke="${INK}" stroke-width="1.6"/>`;
    o += `<text x="340" y="52" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">user:7 = "mine"</text>`;
    o += `<text x="340" y="66" text-anchor="middle" font-size="10" fill="${INK}" opacity="0.85">seq 31</text>`;
    o += `<rect x="250" y="104" width="180" height="34" rx="6" fill="${fade(C.green)}" stroke="${C.green}" stroke-width="1.4"/>`;
    o += `<text x="340" y="118" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.green}">user:7 = "theirs"</text>`;
    o += `<text x="340" y="132" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.7">seq 14</text>`;
    o += box(470, 62, 230, 77, C.gray, '31 > 14, so the child’s wins', ['and 31 > 25 = the anchor, so every', 'write the child makes outranks', 'everything it can inherit']);
    o += arrow(432, 55, 468, 78, 'gray');
    o += arrow(432, 121, 468, 98, 'gray');
    o += para(20, 172, 'The same mechanism deletes: a tombstone at seq 32 in the child hides the parent’s row without the parent knowing, so a branch can delete a key it does not have.', { anchor: 'start', maxW: 680, op: 0.62 });
    o += para(20, 197, 'The corollary matters later — “what a branch owns” and “what a branch wrote” are different sets, because detach copies inherited rows into the branch’s own tables at their ORIGINAL sequences. That is why diff still has to filter by sequence even after restricting itself to owned components.', { anchor: 'start', maxW: 680, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-fork-protocol'] = {
  title: 'The fork protocol: fence, drain, resolve, then publish exactly once',
  type: 'svg',
  body: svg('0 0 720 316', (() => {
    let o = '';
    o += `<rect x="16" y="56" width="688" height="176" rx="10" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.3" stroke-dasharray="6,5"/>`;
    o += label(28, 51, 'under the branch-op mutex — every branch operation in the store serialises here', 'start', 0.7);
    o += para(20, 20, 'Before the mutex: if the catalog is at its 4,096-record cap, sweep synchronously and reclaim — a fork blocks rather than fails.', { anchor: 'start', maxW: 680, op: 0.68 });
    o += box(30, 60, 198, 50, C.gray, '1 · resolve the parent', ['depth + 1 ≤ 64, or refuse']);
    o += box(246, 60, 198, 50, C.gray, '2 · idempotent retry?', ['same lineage → same receipt']);
    o += box(462, 60, 222, 50, C.amber, '3 · fence and drain', ['store-wide; the queue, not a counter']);
    o += box(462, 140, 222, 50, C.blue, '4 · resolve fork_seq', ['Head / AtVersion / AtTimestamp']);
    o += box(246, 140, 198, 50, C.blue, '5 · floor check', ['view_is_complete_at(F, floor)?']);
    o += box(30, 140, 198, 50, C.purple, '6 · publish the catalog', ['← this is the commit point']);
    o += arrow(228, 85, 244, 85, 'gray');
    o += arrow(444, 85, 460, 85, 'gray');
    o += arrow(573, 110, 573, 138, 'amber');
    o += arrow(460, 165, 446, 165, 'blue');
    o += arrow(246, 165, 230, 165, 'blue');
    // refusals
    o += arrow(573, 60, 573, 44, 'red', true);
    o += label(573, 38, 'ForkFenceTimeout — retryable', 'middle', 0.72);
    o += arrow(345, 140, 345, 126, 'red', true);
    o += label(345, 122, 'BelowRetentionFloor { requested, floor }', 'middle', 0.72);
    o += arrow(129, 190, 129, 206, 'red', true);
    o += label(129, 211, 'a sequence before the parent’s own', 'middle', 0.72);
    o += label(129, 224, 'creation is refused', 'middle', 0.72);
    o += para(360, 252, 'Why drain at all: the fence makes visible_seq EXACTLY the head, so the anchor is the head rather than an approximation of it. The cost is honest and measured — the fence is store-wide, so fork_drain_nanos / forks is the pause every writer in the store took for somebody else’s fork.', { anchor: 'middle', maxW: 676, op: 0.6 });
    o += para(360, 290, 'No data is copied and no table is written. Nothing before step 6 is durable, so any failure before it leaves no trace of the child at all.', { anchor: 'middle', maxW: 676, op: 0.55 });
    return o;
  })()),
};

module.exports['skv-lineages'] = {
  title: 'Three lineages, numbered and immutable — the catalog is the only authority',
  type: 'svg',
  body: svg('0 0 720 339', (() => {
    let o = '';
    o += para(20, 20, 'A fork’s commit point must be one atomic durable act. Rewriting a manifest and renaming it into place is not one: rename is not compare-and-swap.', { anchor: 'start', maxW: 680, op: 0.7 });
    const tracks = [
      [36, C.purple, 'catalog/⟨v⟩.catalog · SKBC', 'existence, generation, parentage,', 'anchors, TTLs — the sole authority'],
      [122, C.blue, 'branch/⟨id⟩/⟨v⟩.state · SKBM', 'one branch’s owned durable facts —', 'subordinate, meaningless alone'],
      [208, C.gray, 'root/⟨v⟩.root · SKRT', 'global recovery facts, next_table_id', 'watermark, timeline tail'],
    ];
    for (const [y, col, title, ...subs] of tracks) {
      o += box(20, y, 268, 46 + 15 * subs.length, col, title, subs);
      // version chips
      let x = 306;
      for (const v of ['v3', 'v4']) {
        o += `<rect x="${x}" y="${y + 16}" width="34" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3" stroke-dasharray="3,3"/>`;
        o += `<text x="${x + 17}" y="${y + 32}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.4">${v}</text>`;
        x += 40;
      }
      o += label(x + 2, y + 12, 'pruned', 'start', 0.4);
      for (const v of ['v5', 'v6', 'v7', 'v8']) {
        const newest = v === 'v8';
        o += `<rect x="${x}" y="${y + 16}" width="34" height="24" rx="4" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="${newest ? 2.4 : 1.2}"/>`;
        o += `<text x="${x + 17}" y="${y + 32}" text-anchor="middle" font-size="9.5" font-weight="${newest ? 700 : 400}" fill="${strokeFor(col)}">${v}</text>`;
        x += 40;
      }
      o += label(x + 4, y + 32, 'newest', 'start', 0.5);
    }
    o += arrow(154, 122, 154, 96, 'blue');
    o += arrow(154, 208, 154, 182, 'gray');
    o += label(162, 196, 'validated against the catalog', 'start', 0.6);
    o += para(20, 300, 'Each version is magic + version + body + crc32, published by conditional hard-link create. AlreadyExists → byte-compare → AlreadyExistsSame, so an interrupted publish that is retried with identical bytes is indistinguishable from having succeeded: idempotent retries for free. Four versions are kept.', { anchor: 'start', maxW: 680, op: 0.58 });
    return o;
  })()),
};

module.exports['skv-catalog-lifecycle'] = {
  title: 'A deletion tombstone is a transition fence, not a permanent tenant',
  type: 'svg',
  body: svg('0 0 720 300', (() => {
    let o = '';
    o += para(20, 20, 'Deleting a branch cannot just drop its catalog record: runtimes, WAL pins, level state, tables and its authority lineage all still exist. So deletion writes a durable tombstone — and the tombstone has to be retired afterwards, or lifetime create count consumes the 4,096-record format cap.', { anchor: 'start', maxW: 680, op: 0.7 });
    const steps = [
      [24, C.blue, '1 · tombstone', 'deletion is published;\nthe branch is fenced'],
      [200, C.gray, '2 · reclaim', 'runtimes, WAL deps,\nlevels, tables, root'],
      [376, C.amber, '3 · remove lineage', 'branch/⟨id⟩/ removed,\nparent dir synced'],
      [552, C.purple, '4 · retire', 'the tombstone leaves\nthe catalog'],
    ];
    for (const [x, col, t, sub] of steps) {
      const lines = sub.split('\n');
      o += box(x, 56, 144, 60, col, t, lines);
      if (x < 552) o += arrow(x + 146, 86, x + 174, 86, 'gray');
    }
    o += `<rect x="24" y="134" width="672" height="44" rx="6" fill="${fade(C.green)}" stroke="${C.green}" stroke-width="1.4"/>`;
    o += para(360, 152, 'a failure anywhere before step 4 leaves the tombstone in place, so maintenance simply retries — the order is what makes retirement crash-safe', { anchor: 'middle', maxW: 640, size: 11, lh: 14, op: 0.95 });
    o += box(24, 182, 328, 77, C.gray, 'what still fences a reused BranchId', ['branch generations are globally monotone, and a physical', 'owner names its generation — so an old transaction or WAL', 'row stays fenced even if an id is minted again']);
    o += box(376, 182, 320, 77, C.gray, 'what that let go', ['the recovered clock no longer anchors on retired records:', 'their data and authority are already gone, and', 'next_generation alone carries the fencing']);
    o += para(360, 274, 'The knock-on is worth noticing: retiring tombstones weakened what max_version_anchor has to promise. Removing a mechanism made a neighbouring invariant smaller rather than larger — which is the shape most of the decisions in this post have.', { anchor: 'middle', maxW: 676, op: 0.6 });
    return o;
  })()),
};

module.exports['skv-lock-order'] = {
  title: 'Four locks, one order',
  type: 'svg',
  body: svg('0 0 720 318', (() => {
    let o = '';
    o += para(20, 20, 'Every path that touches more than one of these takes them in this order. Two paths taking any pair in opposite orders is a deadlock, not a race.', { anchor: 'start', maxW: 680, op: 0.7 });
    const locks = [
      [40, C.amber, 'branch_materialization', 'serialises O(dataset) work: detach, delete, sweep, checkpoint, restore'],
      [96, C.purple, 'catalog_publish', 'serialises every durable branch operation — the commit point of all of them'],
      [152, C.blue, 'commit_pipeline write fence  |  level_manifest', 'either or both, and never before the two above'],
    ];
    let step = 0;
    for (const [y, col, t, sub] of locks) {
      const x = 40 + step * 60;
      o += box(x, y, 620 - step * 60, 44, col, t, [sub]);
      if (step < 2) o += arrow(x + 24, y + 46, x + 84, y + 92, 'gray');
      step++;
    }
    o += box(40, 212, 200, 62, C.gray, 'why detach needed its own', ['copying an inherited dataset must not', 'block unrelated catalog operations']);
    o += box(262, 212, 200, 62, C.gray, 'so detach now', ['materialises first, takes catalog_publish', 'only for the final parent-link publish']);
    o += box(484, 212, 196, 62, C.green, 'and re-validates after', ['the owner may have been fenced', 'while the copy was running']);
    o += para(360, 292, 'The order is enforced by a test that reads the source text of record_merge_edge and asserts catalog_publish.lock() appears before level_manifest.read().', { anchor: 'middle', maxW: 676, op: 0.6 });
    return o;
  })()),
};

module.exports['skv-compaction-conflict'] = {
  title: 'The collision: the component whose job is forgetting, told what it may not forget',
  type: 'svg',
  body: svg('0 0 720 284', (() => {
    let o = '';
    o += label(20, 20, 'One key, user:7, and the versions compaction is about to merge. Two anchors sit on its history.', 'start', 0.72);
    const vs = [[80, 's4', 'v1'], [200, 's14', 'v2'], [320, 's21', 'v3'], [440, 's27', 'v4'], [560, 's33', 'v5']];
    o += `<line x1="60" y1="76" x2="660" y2="76" stroke="currentColor" stroke-width="1" opacity="0.25"/>`;
    for (const [x, s, v] of vs) {
      o += `<rect x="${x - 30}" y="58" width="60" height="34" rx="6" fill="${fade(C.blue)}" stroke="${C.blue}" stroke-width="1.4"/>`;
      o += `<text x="${x}" y="74" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.blue}">${v}</text>`;
      o += `<text x="${x}" y="87" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.7">${s}</text>`;
    }
    for (const [x, lab] of [[260, 'b2 anchored @ 17'], [500, 'b3 anchored @ 30']]) {
      o += `<line x1="${x}" y1="46" x2="${x}" y2="104" stroke="${INK}" stroke-width="2"/>`;
      o += `<rect x="${x - 52}" y="30" width="104" height="16" rx="4" fill="${fade(C.amber)}" stroke="${C.amber}" stroke-width="1.2"/>`;
      o += `<text x="${x}" y="42" text-anchor="middle" font-size="9.5" font-weight="700" fill="${C.amber}">${lab}</text>`;
    }
    o += label(20, 130, 'three candidate outputs, and the reader each one breaks:', 'start', 0.8);
    const outs = [
      [146, C.red, 'keep only the newest', 'both readers get v5 — never current at either anchor'],
      [178, C.red, 'keep everything below the highest anchor', 'both correct; the parent never reclaims anything'],
      [210, C.green, 'keep the newest version at or below EACH anchor', 'b2 reads v3, b3 reads v4 — two versions retained, not five'],
    ];
    for (const [y, col, t, sub] of outs) {
      o += `<rect x="20" y="${y}" width="676" height="26" rx="5" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.3"/>`;
      o += `<text x="30" y="${y + 17}" font-size="10.5" font-weight="700" fill="${strokeFor(col)}">${t}</text>`;
      o += para(330, y + 12, sub, { maxW: 370, op: 0.72 });
    }
    o += para(20, 258, 'Compaction’s entire purpose is to discard superseded versions. A live anchor says some superseded versions are still somebody’s current. That is the collision.', { anchor: 'start', maxW: 680, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-anchor-kinds'] = {
  title: 'Three kinds of anchor, one promise',
  type: 'svg',
  body: svg('0 0 720 275', (() => {
    let o = '';
    o += label(360, 20, 'Every sequence cap at which some DURABLE reader still reads one owner exactly.', 'middle', 0.75);
    o += box(20, 34, 214, 68, C.blue, 'a live child’s fork anchor', ['its inherited view is re-resolved', 'at that cap on every read']);
    o += box(252, 34, 214, 68, C.amber, 'a live edge’s target head', ['preserves durable merge history —', 'not a base value']);
    o += box(484, 34, 216, 68, C.amber, 'the edge’s source cursor', ['preserves the actual three-way base:', 'merging never mutates the source']);
    o += box(230, 138, 260, 62, C.purple, 'RetentionAnchors', ['sorted descending, deduplicated —', 'and nothing is ever dropped for size']);
    o += arrow(127, 104, 280, 136, 'blue');
    o += arrow(359, 104, 359, 136, 'amber');
    o += arrow(592, 104, 440, 136, 'amber');
    o += `<rect x="20" y="204" width="676" height="42" rx="6" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.3"/>`;
    o += `<text x="30" y="221" font-size="10.5" font-weight="700" fill="${C.gray}">a stale edge pins nothing</text>`;
    o += para(190, 218, 'its source is gone, so no future merge can measure from that base — and holding history for a deleted branch is how a store that churns sandboxes never reclaims', { anchor: 'start', maxW: 510, op: 0.68 });
    o += para(360, 262, 'An anchor is a promise, so the set is never truncated: its size is already bounded by the catalog’s own 4,096-record cap.', { anchor: 'middle', maxW: 676, op: 0.58 });
    return o;
  })()),
};

module.exports['skv-anchor-walker'] = {
  title: 'One index, descending: every anchor served in a single pass',
  type: 'svg',
  body: svg('0 0 720 273', (() => {
    let o = '';
    o += para(20, 20, 'Anchors descend. A key’s versions arrive newest-first. So one shared index that never rewinds is enough for any number of branches.', { anchor: 'start', maxW: 680, op: 0.72 });
    o += label(60, 46, 'anchors (descending)', 'start', 0.82);
    o += label(300, 46, 'versions (newest first)', 'start', 0.82);
    o += label(500, 46, 'verdict', 'start', 0.82);
    const anchors = [[30, 'a1 = 30'], [21, 'a2 = 21'], [17, 'a3 = 17'], [6, 'a4 = 6']];
    let y = 56;
    for (const [, t] of anchors) {
      o += `<rect x="60" y="${y}" width="120" height="26" rx="5" fill="${fade(C.amber)}" stroke="${C.amber}" stroke-width="1.3"/>`;
      o += `<text x="70" y="${y + 17}" font-size="10.5" font-weight="700" fill="${C.amber}">${t}</text>`;
      y += 32;
    }
    // the shared index
    o += `<path d="M40,69 L54,62 L54,76 Z" fill="${C.purple}" stroke="${INK}" stroke-width="1.2"/>`;
    o += `<rect x="20" y="188" width="160" height="24" rx="5" fill="${C.purple}" stroke="${INK}" stroke-width="1.4"/>`;
    o += `<text x="100" y="204" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">one index, never rewinds</text>`;
    const versions = [[33, 'serves nothing → droppable', C.gray], [27, 'serves a1 (30) → KEEP', C.green], [19, 'serves a2 (21) and a3 (17) → KEEP', C.green], [4, 'serves a4 (6) → KEEP', C.green]];
    y = 56;
    for (const [s, verdict, col] of versions) {
      o += `<rect x="300" y="${y}" width="120" height="26" rx="5" fill="${fade(C.blue)}" stroke="${C.blue}" stroke-width="1.3"/>`;
      o += `<text x="310" y="${y + 17}" font-size="10.5" font-weight="700" fill="${C.blue}">seq ${s}</text>`;
      o += `<rect x="440" y="${y}" width="256" height="26" rx="5" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.2"/>`;
      o += `<text x="450" y="${y + 17}" font-size="10" fill="${strokeFor(col)}">${verdict}</text>`;
      y += 32;
    }
    o += para(20, 234, 'One version can serve several anchors — seq 19 answers both 21 and 17, because it is the newest version at or below each of them. Cost is O(versions + anchors), not O(versions × anchors): adding branches raises the anchor count without adding a pass over the key.', { anchor: 'start', maxW: 680, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-pin-shapes'] = {
  title: 'Range-pin or per-anchor pin — what makes many branches affordable',
  type: 'svg',
  body: svg('0 0 720 280', (() => {
    let o = '';
    o += label(20, 20, 'Same key, same four anchors, two different parents.', 'start', 0.75);
    const vs = [[70, 4], [175, 11], [280, 19], [385, 24], [490, 29], [595, 35]];
    const draw = (y, keep, title, note, col) => {
      let s = label(20, y - 10, title, 'start', 0.85);
      s += para(300, y - 30, note, { maxW: 348, op: 0.62 });
      for (const [x, seq] of vs) {
        const k = keep.includes(seq);
        s += `<rect x="${x - 30}" y="${y}" width="60" height="30" rx="5" fill="${k ? C.purple : fade(C.gray)}" stroke="${k ? INK : C.gray}" stroke-width="${k ? 1.6 : 1}"/>`;
        s += `<text x="${x}" y="${y + 19}" text-anchor="middle" font-size="10" font-weight="${k ? 700 : 400}" fill="${k ? INK : C.gray}">s${seq}</text>`;
        if (!k) s += `<line x1="${x - 26}" y1="${y + 25}" x2="${x + 26}" y2="${y + 5}" stroke="${C.gray}" stroke-width="1.2"/>`;
      }
      s += `<text x="664" y="${y + 19}" font-size="10.5" font-weight="700" fill="${col}">${keep.length} kept</text>`;
      return s;
    };
    o += draw(56, [4, 11, 19, 24, 29, 35], 'a VERSIONED parent', 'pins the whole range below its highest anchor — forks inherit full history, so any version under it may be wanted', C.red);
    o += draw(132, [19, 24, 29, 35], 'a NON-VERSIONED parent', 'pins the newest version at or below EACH anchor — all a point-in-time reader can see', C.green);
    o += para(20, 196, 'The second shape is what makes many branches affordable: one version per anchor, not the range. Add a fifth anchor to each and the first keeps growing while the second adds at most one version.', { anchor: 'start', maxW: 680, op: 0.62 });
    o += `<rect x="20" y="226" width="676" height="44" rx="6" fill="${C.purple}" stroke="${INK}" stroke-width="1.5"/>`;
    o += para(360, 244, 'the pin only ever ADDS retention — so with no children, compaction’s output is byte-identical to a store that never had branching compiled in', { anchor: 'middle', maxW: 640, size: 11, lh: 14, op: 1 });
    return o;
  })()),
};

module.exports['skv-two-bottoms'] = {
  title: 'Two ways to be wrong about “the bottom level”',
  type: 'svg',
  body: svg('0 0 720 297', (() => {
    let o = '';
    o += box(232, 12, 256, 30, C.purple, 'force_not_bottom', []);
    o += label(180, 66, 'a branch that is forked FROM', 'middle', 0.88);
    o += label(540, 66, 'a branch that IS a fork child', 'middle', 0.88);
    const stack = (cx, tomb) => {
      let s = '';
      const names = ['L0', 'L1', 'L2', 'L3'];
      let y = 78;
      for (const n of names) {
        const bottom = n === 'L3';
        s += `<rect x="${cx - 140}" y="${y}" width="280" height="28" rx="4" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="${bottom ? 1.8 : 1}"/>`;
        s += `<text x="${cx - 130}" y="${y + 19}" font-size="10.5" font-weight="700" fill="${C.gray}">${n}</text>`;
        if (bottom && tomb) {
          s += `<rect x="${cx - 60}" y="${y + 5}" width="190" height="18" rx="3" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.2"/>`;
          s += `<text x="${cx + 35}" y="${y + 18}" text-anchor="middle" font-size="9.5" fill="${C.red}">✗ delete user:7 · s24</text>`;
        }
        y += 32;
      }
      return s;
    };
    o += stack(180, true);
    o += stack(540, false);
    // left: reader below
    o += `<line x1="40" y1="216" x2="320" y2="216" stroke="currentColor" stroke-width="1" opacity="0.3" stroke-dasharray="4,3"/>`;
    o += arrow(180, 244, 180, 220, 'amber');
    o += label(180, 262, 'an anchored reader resolves this owner', 'middle', 0.75);
    o += label(180, 275, 'BELOW the tombstone — at s17', 'middle', 0.75);
    // right: ancestors below
    o += `<rect x="400" y="212" width="280" height="26" rx="4" fill="${fade(C.blue)}" stroke="${C.blue}" stroke-width="1.3"/>`;
    o += `<text x="540" y="229" text-anchor="middle" font-size="10" font-weight="700" fill="${C.blue}">parent layer</text>`;
    o += `<rect x="400" y="242" width="280" height="26" rx="4" fill="${fade(C.blue)}" stroke="${C.blue}" stroke-width="1.3"/>`;
    o += `<text x="540" y="259" text-anchor="middle" font-size="10" font-weight="700" fill="${C.blue}">grandparent layer</text>`;
    o += label(540, 284, 'its ancestors sit UNDER its own bottom level', 'middle', 0.75);
    o += label(360, 54, 'Neither may treat its lowest level as the bottom of a read stack — for two entirely unrelated reasons.', 'middle', 0.68);
    return o;
  })()),
};

module.exports['skv-pin-race'] = {
  title: 'Sample, merge, re-check: an anchor that appeared refuses the output',
  type: 'svg',
  body: svg('0 0 720 293', (() => {
    let o = '';
    o += label(20, 20, 'Anchors are durable, but they appear concurrently — and a compaction that already discarded a version cannot un-discard it.', 'start', 0.72);
    o += `<rect x="20" y="36" width="676" height="46" rx="7" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.3"/>`;
    o += label(30, 32, 'the compaction job', 'start', 0.7);
    o += `<rect x="30" y="48" width="86" height="22" rx="4" fill="${fade(C.blue)}" stroke="${C.blue}" stroke-width="1.2"/>`;
    o += `<text x="73" y="63" text-anchor="middle" font-size="9.5" font-weight="700" fill="${C.blue}">sample anchors</text>`;
    o += `<rect x="126" y="48" width="330" height="22" rx="4" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.1"/>`;
    o += `<text x="291" y="63" text-anchor="middle" font-size="9.5" fill="${C.gray}">merge — versions are dropped here</text>`;
    o += `<rect x="466" y="48" width="106" height="22" rx="4" fill="${fade(C.amber)}" stroke="${C.amber}" stroke-width="1.2"/>`;
    o += `<text x="519" y="63" text-anchor="middle" font-size="9.5" font-weight="700" fill="${C.amber}">re-check, under lock</text>`;
    o += `<rect x="582" y="48" width="104" height="22" rx="4" fill="${fade(C.green)}" stroke="${C.green}" stroke-width="1.2"/>`;
    o += `<text x="634" y="63" text-anchor="middle" font-size="9.5" font-weight="700" fill="${C.green}">publish</text>`;
    // event
    o += `<line x1="300" y1="94" x2="300" y2="70" stroke="${INK}" stroke-width="1.8" stroke-dasharray="4,3"/>`;
    o += `<rect x="222" y="96" width="156" height="22" rx="4" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.3"/>`;
    o += `<text x="300" y="111" text-anchor="middle" font-size="9.5" font-weight="700" fill="${C.red}">a fork publishes anchor 26</text>`;
    // sets
    o += box(20, 138, 330, 50, C.gray, 'sampled at job creation', ['{ 41, 17 }']);
    o += box(366, 138, 330, 50, C.purple, 'at publish, under the lock', ['{ 41, 26, 17 }  →  appeared_since = 26']);
    o += `<rect x="20" y="204" width="676" height="30" rx="6" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.5"/>`;
    o += `<text x="360" y="223" text-anchor="middle" font-size="11" font-weight="700" fill="${C.red}">CompactionPinRaced { unsampled_anchor: 26 } — the job discards its own output, and the inputs stay live for the next cycle</text>`;
    o += para(360, 254, 'The asymmetry is the design: an anchor that APPEARED may need a version this job already dropped, so the output is refused. An anchor that VANISHED is harmless — the job merely over-retained, and it publishes. A few races are normal; many mean you are forking against heavy compaction.', { anchor: 'middle', maxW: 676, op: 0.6 });
    return o;
  })()),
};

module.exports['skv-branch-runtimes'] = {
  title: 'What a fork allocates, and when',
  type: 'svg',
  body: svg('0 0 720 270', (() => {
    let o = '';
    o += `<rect x="20" y="34" width="676" height="62" rx="8" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.4"/>`;
    o += label(30, 28, 'one per store, however many branches exist', 'start', 0.78);
    const shared = ['WAL', 'commit pipeline', 'clock + timeline', 'table-id allocator', 'write-buffer soft limit'];
    let x = 30;
    for (const s of shared) {
      o += `<rect x="${x}" y="46" width="128" height="40" rx="6" fill="${fade(C.blue)}" stroke="${C.blue}" stroke-width="1.2"/>`;
      o += `<text x="${x + 64}" y="64" text-anchor="middle" font-size="9.5" font-weight="700" fill="${C.blue}">${s}</text>`;
      o += `<text x="${x + 64}" y="78" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.6">×1</text>`;
      x += 134;
    }
    o += `<rect x="20" y="118" width="676" height="66" rx="8" fill="${fade(C.green)}" stroke="${C.green}" stroke-width="1.4"/>`;
    o += label(30, 112, 'one per branch — allocated on its FIRST WRITE, never at the fork', 'start', 0.78);
    const brs = [['main', true], ['feature', true], ['sandbox-1', true], ['sandbox-2', false], ['sandbox-3', false], ['…1000 more', false]];
    x = 30;
    for (const [n, live] of brs) {
      o += `<rect x="${x}" y="130" width="106" height="44" rx="6" fill="${live ? fade(C.green) : 'none'}" stroke="${live ? C.green : C.gray}" stroke-width="1.2"${live ? '' : ' stroke-dasharray="4,3"'}/>`;
      o += `<text x="${x + 53}" y="146" text-anchor="middle" font-size="9.5" font-weight="700" fill="${live ? C.green : C.gray}">${n}</text>`;
      o += `<text x="${x + 53}" y="160" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="${live ? 0.7 : 0.4}">${live ? 'memtable + levels' : 'not allocated'}</text>`;
      o += `<text x="${x + 53}" y="170" text-anchor="middle" font-size="8.5" fill="currentColor" opacity="${live ? 0.7 : 0.4}">${live ? 'arena resident' : 'zero bytes'}</text>`;
      x += 112;
    }
    o += `<rect x="20" y="200" width="676" height="22" rx="5" fill="none" stroke="${C.gray}" stroke-width="1.2"/>`;
    o += `<rect x="21" y="201" width="270" height="20" rx="4" fill="${C.purple}"/>`;
    o += `<text x="156" y="216" text-anchor="middle" font-size="10" font-weight="700" fill="${INK}">write buffer in use — a soft limit, shared</text>`;
    o += para(360, 244, '1,003 branches, 3 runtimes. The soft limit triggers pressure rotation; it is not a hard resident-memory cap, because rotation does not release an immutable arena until its flush completes.', { anchor: 'middle', maxW: 676, op: 0.58 });
    return o;
  })()),
};

module.exports['skv-what-a-branch-costs'] = {
  title: 'What a branch allocates, and what it does not',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Resource</th><th>Per store</th><th>Per branch</th></tr></thead><tbody>
    <tr><td>global commit sequence</td><td>1</td><td><b>none</b> — a branch has no clock</td></tr>
    <tr><td>WAL</td><td>1</td><td>none; segments are <i>pinned</i>, never duplicated</td></tr>
    <tr><td>commit pipeline + write fence</td><td>1</td><td>none — every branch's commits queue through it</td></tr>
    <tr><td>clock + timeline</td><td>1</td><td>none — <code>AtTimestamp</code> resolves against the store's timeline</td></tr>
    <tr><td>table-id allocator</td><td>1, block-reserved in the root lineage</td><td>none</td></tr>
    <tr><td>write buffer</td><td>1 soft limit</td><td>draws from the shared limit</td></tr>
    <tr><td>snapshot tracker</td><td>1</td><td>none — and this is a known conservatism: one branch's snapshot pins visibility for <i>every</i> owner's compaction</td></tr>
    <tr><td>active memtable</td><td>—</td><td>1, allocated on the branch's <b>first write</b>, never at the fork</td></tr>
    <tr><td>level set</td><td>—</td><td>1; every SSTable belongs to exactly one owner</td></tr>
    <tr><td>catalog entry</td><td>—</td><td>one record in one published catalog version — <b>the entire durable cost of a fork</b></td></tr>
    <tr><td>retained versions in the parent</td><td>—</td><td><b>the one that actually grows.</b> One version per anchor per key, for a non-versioned parent</td></tr>
    <tr><td>read amplification</td><td>—</td><td>one more layer in the merge, and one more <code>min</code> in the cap — so it tracks fork <i>depth</i>, not branch count</td></tr>
    </tbody></table>
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">On metrics: <code>pin_retained_versions_total</code> counts versions that completed compactions retained <i>solely</i> because an anchor needed them, cumulatively since the process opened. It measures retention <b>work</b>, not how many extra versions are live on disk right now — so it tells you whether branches are costing you, not how much space they currently hold. <code>wal_pinned_segments</code> counts distinct referenced segments, and <code>timeline_horizon</code> is the range <code>AtTimestamp</code> can still answer inside.</p>`,
};

module.exports['skv-diff'] = {
  title: 'Own components are not own writes',
  type: 'svg',
  body: svg('0 0 720 273', (() => {
    let o = '';
    o += para(20, 20, 'A diff reads the branch’s own components and no ancestor layers at all. It then still has to filter by sequence — and that filter is not redundant.', { anchor: 'start', maxW: 680, op: 0.72 });
    o += `<rect x="20" y="36" width="290" height="176" rx="8" fill="${fade(C.green)}" stroke="${C.green}" stroke-width="1.4"/>`;
    o += label(30, 52, 'feature’s OWN components', 'start', 0.85);
    const comps = [['active memtable', 60, [['user:3 · s31 · Set', true]]], ['L0', 102, [['user:5 · s29 · Delete', true], ['user:8 · s27 · Set', true]]], ['L1', 156, [['user:9 · s6 · inherited', false], ['user:2 · s4 · inherited', false]]]];
    for (const [n, y, rows] of comps) {
      o += `<rect x="30" y="${y}" width="270" height="${18 + rows.length * 17}" rx="5" fill="none" stroke="${C.green}" stroke-width="1" stroke-dasharray="3,3"/>`;
      o += `<text x="38" y="${y + 13}" font-size="9.5" font-weight="700" fill="${C.green}">${n}</text>`;
      let ry = y + 17;
      for (const [t, own] of rows) {
        o += `<rect x="120" y="${ry}" width="172" height="14" rx="3" fill="${own ? fade(C.blue) : fade(C.gray)}" stroke="${own ? C.blue : C.gray}" stroke-width="1"/>`;
        o += `<text x="126" y="${ry + 11}" font-size="8.5" fill="${own ? C.blue : C.gray}">${t}</text>`;
        ry += 17;
      }
    }
    // gate
    o += `<rect x="336" y="106" width="84" height="40" rx="7" fill="${C.purple}" stroke="${INK}" stroke-width="1.6"/>`;
    o += `<text x="378" y="124" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}">seq &gt; 24</text>`;
    o += `<text x="378" y="138" text-anchor="middle" font-size="9" fill="${INK}" opacity="0.85">base = the anchor</text>`;
    o += arrow(312, 126, 334, 126, 'gray');
    o += arrow(422, 126, 444, 126, 'gray');
    o += `<rect x="446" y="36" width="250" height="176" rx="8" fill="none" stroke="${C.blue}" stroke-width="1.4"/>`;
    o += label(456, 52, 'the diff', 'start', 0.85);
    const out = [['user:3 → Set("v9") · s31', C.blue], ['user:5 → Delete · s29', C.red], ['user:8 → Set("x") · s27', C.blue]];
    let y = 62;
    for (const [t, col] of out) {
      o += `<rect x="456" y="${y}" width="230" height="22" rx="4" fill="${fade(col)}" stroke="${col}" stroke-width="1.2"/>`;
      o += `<text x="466" y="${y + 15}" font-size="9.5" fill="${col}">${t}</text>`;
      y += 27;
    }
    o += label(456, 158, 'a delete is a change — and it is the', 'start', 0.66);
    o += label(456, 171, 'change a merge most needs to hear', 'start', 0.66);
    o += label(456, 192, 'the two inherited rows are NOT emitted', 'start', 0.66);
    o += para(20, 234, 'Detach materialises inherited rows into these same tables at their ORIGINAL sequences. So “everything this branch owns” stops being “everything this branch changed”, and only the sequence filter can still tell them apart. That filter is the difference between a diff and a lie.', { anchor: 'start', maxW: 680, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-merge-base'] = {
  title: 'A base that moves: fork point, source cursor, target edge',
  type: 'svg',
  body: svg('0 0 720 285', (() => {
    let o = '';
    const X = (s) => 120 + s * 13.6;
    o += label(20, 20, 'The base is where the two branches last agreed — and after the first merge that is not the fork point.', 'start', 0.72);
    o += box(20, 40, 94, 40, C.green, 'target', []);
    o += box(20, 104, 94, 40, C.blue, 'source', []);
    for (const [y, col, dots] of [[40, C.green, [10, 28, 36]], [104, C.blue, [14, 22, 33]]]) {
      o += `<line x1="120" y1="${y + 20}" x2="700" y2="${y + 20}" stroke="currentColor" stroke-width="0.9" opacity="0.22"/>`;
      for (const s of dots) {
        o += `<circle cx="${X(s)}" cy="${y + 20}" r="7" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.4"/>`;
        o += `<text x="${X(s)}" y="${y + 37}" text-anchor="middle" font-size="9" fill="currentColor" opacity="0.65">${s}</text>`;
      }
    }
    // three marks
    const marks = [[8, 'fork_at = 8', C.gray, 'original divergence — a scan probe must cover every target write above this'], [22, 'source_through = 22', C.purple, 'the source snapshot at this cap IS the base side of the comparison'], [28, 'target_at = 28', C.amber, 'durable edge history — reported to callers, and NOT a base value']];
    let ly = 176;
    for (const [s, t, col, note] of marks) {
      o += `<line x1="${X(s)}" y1="34" x2="${X(s)}" y2="150" stroke="${strokeFor(col)}" stroke-width="2"${col === C.gray ? ' stroke-dasharray="5,4"' : ''}/>`;
      o += `<rect x="${X(s) - 8}" y="${ly - 12}" width="16" height="16" rx="3" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.2"/>`;
      o += `<rect x="176" y="${ly - 13}" width="152" height="18" rx="4" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.2"/>`;
      o += `<text x="184" y="${ly}" font-size="9.5" font-weight="700" fill="${strokeFor(col)}">${t}</text>`;
      o += para(338, ly - 4, note, { maxW: 362, op: 0.7 });
      ly += 24;
    }
    o += para(20, 246, 'Why the target head cannot be the base: merging into a target never mutates the source, so target-only values present at that edge were never incorporated into source history. Treating them as a common base makes a later source edit look uncontested — and quietly overwrites the target.', { anchor: 'start', maxW: 680, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-merge-verdicts'] = {
  title: 'The three-way classification, where absence counts as a value',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>At the base</th><th>On the target now</th><th>On the source</th><th>Verdict</th></tr></thead><tbody>
    <tr><td><code>"a"</code></td><td><code>"a"</code> — untouched</td><td><code>"b"</code></td><td><b>apply</b> — the target has not moved</td></tr>
    <tr><td><code>"a"</code></td><td><code>"b"</code></td><td><code>"b"</code></td><td><b>converged</b> — both sides reached the same bytes; nothing to write</td></tr>
    <tr><td><code>"a"</code></td><td><code>"c"</code></td><td><code>"b"</code></td><td><b>conflict</b> — both modified</td></tr>
    <tr><td>absent</td><td>absent</td><td><code>"b"</code></td><td><b>apply</b> — a new key</td></tr>
    <tr><td>absent</td><td><code>"c"</code></td><td><code>"b"</code></td><td><b>conflict</b> — both added</td></tr>
    <tr><td><code>"a"</code></td><td>deleted</td><td>deleted</td><td><b>converged</b> — absence is a value, and both agree on it</td></tr>
    <tr><td><code>"a"</code></td><td><code>"c"</code></td><td>deleted</td><td><b>conflict</b> — deleted by source, modified by target</td></tr>
    <tr><td><code>"a"</code></td><td>deleted</td><td><code>"b"</code></td><td><b>conflict</b> — modified by source, deleted by target</td></tr>
    </tbody></table>
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">Treating absence as an ordinary value is what makes delete-vs-delete <i>resolve</i> and delete-vs-modify <i>conflict</i>, with no special cases. Strategies: <code>Strict</code> (the default — refuses the whole merge, "because the alternative to knowing is guessing"), <code>SourceWins</code>, <code>TargetWins</code>, and <code>Resolve</code> with a caller-supplied resolver that may itself refuse. Every decision routes through one <code>decide</code> call, so no strategy can drift from the classification.</p>`,
};

module.exports['skv-merge-commit-order'] = {
  title: 'Data first, edge second — and what the other order loses',
  type: 'svg',
  body: svg('0 0 720 265', (() => {
    let o = '';
    o += label(20, 20, 'A merge writes its data through the ordinary commit path, then records the promotion edge. A crash can land between the two.', 'start', 0.72);
    const lane = (y, title, first, second, crashLabel, outcome, col) => {
      let s = label(20, y - 8, title, 'start', 0.85);
      s += `<rect x="150" y="${y}" width="180" height="34" rx="6" fill="${fillFor(C.green)}" stroke="${strokeFor(C.green)}" stroke-width="1.4"/>`;
      s += `<text x="240" y="${y + 21}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.green}">${first}</text>`;
      s += `<rect x="392" y="${y}" width="180" height="34" rx="6" fill="${fillFor(C.amber)}" stroke="${strokeFor(C.amber)}" stroke-width="1.4"/>`;
      s += `<text x="482" y="${y + 21}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.amber}">${second}</text>`;
      s += arrow(332, y + 17, 390, y + 17, 'gray');
      s += `<line x1="361" y1="${y - 6}" x2="361" y2="${y + 40}" stroke="${C.red}" stroke-width="2" stroke-dasharray="4,3"/>`;
      s += `<text x="361" y="${y - 10}" text-anchor="middle" font-size="9" font-weight="700" fill="${C.red}">${crashLabel}</text>`;
      s += `<rect x="588" y="${y}" width="108" height="34" rx="6" fill="${fillFor(col)}" stroke="${strokeFor(col)}" stroke-width="1.5"/>`;
      s += `<text x="642" y="${y + 21}" text-anchor="middle" font-size="10" font-weight="700" fill="${strokeFor(col)}">${outcome}</text>`;
      return s;
    };
    o += lane(56, 'as built', 'commit the data', 'record the edge', 'crash', 'safe', C.green);
    o += label(20, 104, 'the next merge re-offers what was already applied, which either converges or conflicts — never a silent overwrite', 'start', 0.66);
    o += lane(146, 'reversed', 'record the edge', 'commit the data', 'crash', 'data lost', C.red);
    o += para(20, 194, 'the base has advanced past changes that were never written, so the next merge never offers them again — and nothing reports the loss', { anchor: 'start', maxW: 680, op: 0.66 });
    o += para(20, 226, 'This is why the ordering is a correctness property rather than a preference: one order fails loudly and idempotently, the other fails silently. A scoped merge deliberately records no edge at all — a partial apply has not earned the claim that the source is fully merged.', { anchor: 'start', maxW: 680, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-detach'] = {
  title: 'Detach: the opposite trade from forking',
  type: 'svg',
  body: svg('0 0 720 277', (() => {
    let o = '';
    o += label(180, 20, 'before', 'middle', 0.88);
    o += label(540, 20, 'after detach', 'middle', 0.88);
    o += `<line x1="360" y1="30" x2="360" y2="212" stroke="currentColor" stroke-width="1" opacity="0.25" stroke-dasharray="4,4"/>`;
    // before
    o += box(24, 34, 300, 50, C.green, 'parent', ['pinned: 4 versions it cannot drop']);
    o += box(24, 100, 300, 50, C.blue, 'child', ['owns its own writes only']);
    o += arrow(174, 98, 174, 86, 'gray');
    o += label(182, 96, 'reads through, capped at the anchor', 'start', 0.62);
    o += `<rect x="24" y="164" width="300" height="24" rx="5" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.3"/>`;
    o += `<text x="174" y="180" text-anchor="middle" font-size="10" font-weight="600" fill="${C.red}">the parent keeps paying for as long as the child lives</text>`;
    // after
    o += box(396, 34, 300, 50, C.green, 'parent', ['pinned: nothing — free to compact']);
    o += box(396, 100, 300, 62, C.purple, 'child', ['now holds a materialised copy of', 'everything it was inheriting']);
    o += `<rect x="404" y="170" width="284" height="18" rx="3" fill="${fade(C.gray)}" stroke="${C.gray}" stroke-width="1.1"/>`;
    o += `<text x="546" y="183" text-anchor="middle" font-size="9" fill="${C.gray}">one new SSTable, below the child’s own levels</text>`;
    o += `<rect x="396" y="198" width="300" height="24" rx="5" fill="${fade(C.green)}" stroke="${C.green}" stroke-width="1.3"/>`;
    o += `<text x="546" y="214" text-anchor="middle" font-size="10" font-weight="600" fill="${C.green}">paid once, in bytes, and the chain gets shorter</text>`;
    o += para(20, 238, 'The copy runs BEFORE the catalog lock is taken, so an O(dataset) detach does not block unrelated branch operations — and the owner is re-validated afterwards, because it may have been fenced while the copy was running. Detach is the right answer for the branch that turned out to be permanent.', { anchor: 'start', maxW: 680, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-errors'] = {
  title: 'The refusals, and what each one declined to guess',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Refusal</th><th>What it declined to guess</th><th>Retryable?</th><th>What you do instead</th></tr></thead><tbody>
    <tr><td><code>BelowRetentionFloor { requested, floor }</code></td><td>what the store held at a sequence whose versions compaction has already dropped</td><td>no</td><td>fork at or above the floor, or from a branch that pinned it</td></tr>
    <tr><td><code>TimestampBelowHorizon { requested, horizon_floor }</code></td><td>the nearest sequence to a timestamp it can no longer resolve exactly</td><td>no</td><td>read <code>timeline_horizon</code> and ask inside it</td></tr>
    <tr><td><code>CompactionPinRaced { unsampled_anchor }</code></td><td>that an output built against a weaker promise is still valid</td><td><b>yes</b> — the job retries next cycle</td><td>nothing; it is internal, and <code>compaction_pin_races</code> counts it</td></tr>
    <tr><td><code>MergeConflicts { count }</code></td><td>which side of a genuine conflict you meant</td><td>no</td><td>pick a strategy, supply a resolver, or resolve by hand</td></tr>
    <tr><td><code>BranchesUnrelated { reason }</code></td><td>a common base between two branches that never shared one</td><td>no</td><td>merge into the branch the source was forked from</td></tr>
    <tr><td><code>MergeTooLarge { estimated_bytes, budget_bytes }</code></td><td>that one entry above the chunk budget could still be written atomically</td><td>no</td><td>raise the budget, or scope the merge to a range</td></tr>
    <tr><td>the unexpected-head refusal</td><td>that the state you previewed is still the state you are applying to</td><td>no</td><td>re-preview and re-approve</td></tr>
    <tr><td><code>ForkFenceTimeout</code></td><td>that a not-yet-drained pipeline's head is the head</td><td><b>yes</b></td><td>retry the fork</td></tr>
    <tr><td><code>BranchFenced</code></td><td>that a handle naming a deleted or superseded incarnation means the live one</td><td>no</td><td>re-resolve the branch by name</td></tr>
    <tr><td><code>ViewDepthExceeded { depth }</code></td><td>that resolution can degrade gracefully past 64 ancestors</td><td>no</td><td><code>detach</code> somewhere on the chain</td></tr>
    </tbody></table>
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">Read the second column top to bottom: in every case an approximate answer was available and cheap, and was declined. Three newer refusal paths — a fork sequence before its parent's creation, a detach whose owner was fenced mid-copy, and a checkpoint whose drain timed out — reuse existing variants rather than adding new ones, so this list is the taxonomy and not an exhaustive index of call sites.</p>`,
};

module.exports['skv-decision-log'] = {
  title: 'Every decision, what it rejected, and why',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Decision</th><th>What was rejected</th><th>Why</th></tr></thead><tbody>
    <tr><td><b>One global sequence counter; a branch is a ceiling on it</b></td><td>a per-branch clock and head</td><td>two branches' sequences become directly comparable, so an entire view is definable by one integer — which is what lets a fork cost one metadata record</td></tr>
    <tr><td><b>Ownership in component metadata</b></td><td><code>branch_id</code> prefixed into every physical key</td><td>keeps a key's version chain contiguous and every compaction job single-owner; branch deletion becomes component reclamation instead of a range delete over live data</td></tr>
    <tr><td><b>Inherited views are logical</b></td><td>a bounded fork-delta table carrying the parent's unflushed rows</td><td>the child resolves the parent's live memtables under its cap, so every fork point is already exact — the table was a copy, and the point of a fork is that there isn't one</td></tr>
    <tr><td><b>Caps applied per layer, before the k-way merge</b></td><td>one snapshot filter over the merged stream</td><td>once layers interleave, which ceiling applied to which row is gone; a post-merge filter emits rows no reader was allowed to see</td></tr>
    <tr><td><b>Retention anchors are a set</b></td><td>pin the lowest / pin the highest / range-pin to the highest</td><td>the lowest hands a higher fork a version never current at its anchor; the highest starves the lowest; the range makes one fork-at-head retain the parent's whole history</td></tr>
    <tr><td><b>The pin is an additive override</b></td><td>rewriting compaction's retention rules</td><td>with no children, output is byte-identical to a store that never forked — branching cannot regress the unbranched engine by construction rather than by testing</td></tr>
    <tr><td><b>Pins come from the durable catalog only</b></td><td>deriving pins from live snapshots or child state manifests</td><td>otherwise compaction's output depends on who happened to be reading, and a crash could lose a promise that existed only in a reader's memory</td></tr>
    <tr><td><b>Numbered immutable lineages, published by hard link</b></td><td>a rewritten-and-renamed MANIFEST file</td><td>rename is not compare-and-swap; conditional create plus a byte-compare makes retries idempotent for free</td></tr>
    <tr><td><b>Deletion tombstones are retired</b></td><td>keeping every tombstone forever</td><td>otherwise lifetime create count, not concurrent live branches, consumes the 4,096-record cap — and monotone generations already fence a reused id</td></tr>
    <tr><td><b>A separate materialization lock</b></td><td>holding <code>catalog_publish</code> across a detach's copy</td><td>an O(dataset) copy must not block unrelated catalog operations</td></tr>
    <tr><td><b>Diff scans owned components and filters by sequence</b></td><td>a commit change journal</td><td>a branch's own components contain only its own writes, so the scan is already proportional to the diff — and detach materialises inherited rows into those tables, so the filter is load-bearing anyway</td></tr>
    <tr><td><b>The merge base is the source snapshot at the consumed cursor</b></td><td>using the previous target head as the base</td><td>merging into a target never mutates the source, so target-only values at that edge were never source history; treating them as a common base silently overwrites the target</td></tr>
    <tr><td><b>Data commits first, edge second</b></td><td>recording the edge first</td><td>a crash between them re-offers applied work, which converges or conflicts; the other order advances past changes never written and loses them silently</td></tr>
    <tr><td><b>Merges go through the ordinary commit path</b></td><td>a privileged bulk-apply path</td><td>conflict detection, WAL and sequence allocation come for free, and there is no second write path to keep correct</td></tr>
    <tr><td><b><code>chunks</code> is reported, not promised</b></td><td>claiming merges are atomic</td><td>the data's size decides, not the call — so the honest interface is to tell you and let you assert</td></tr>
    <tr><td><b>Refuse rather than approximate</b></td><td>nearest-match timestamps, invented merge bases, best-effort forks</td><td>a fork that quietly lost rows would be worse than a refused one</td></tr>
    <tr><td><b>Registry and level sets keyed by owner in a <code>HashMap</code></b></td><td>a lock-free registry; a <code>Vec</code> scanned linearly</td><td>branch count must not enter a point read's cost; lock-freedom is a recorded optimisation, not a v1 need</td></tr>
    <tr><td><b>Arenas right-sized lazily; the write buffer is a soft limit</b></td><td>chunked arenas; a hard resident-memory cap</td><td>an idle branch should allocate nothing, and rotation cannot release an immutable arena until its flush completes — so a "budget" would have been a name promising something the design does not provide</td></tr>
    </tbody></table>`,
};
