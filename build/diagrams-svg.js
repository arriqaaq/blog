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

// The box vocabulary the branching figures share: a faint outline carries context, and `hot`
// paints the one element a figure is about in neon with ink text. `dash` outlines something the
// figure shows as absent or shared rather than present.
function obox(x, y, w, h, t, sub, opts) {
  const o = opts || {};
  const ink = o.hot ? INK : 'currentColor';
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${o.hot ? C.purple : 'none'}" stroke="${o.hot ? INK : 'currentColor'}" stroke-width="${o.hot ? 1.7 : 1.2}"${o.hot ? '' : ` opacity="${o.dash ? 0.3 : 0.45}"`}${o.dash ? ' stroke-dasharray="5,4"' : ''}/>`;
  if (t) s += `<text x="${x + w / 2}" y="${y + (sub ? 21 : h / 2 + 4)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${ink}" opacity="${o.dash ? 0.55 : 1}">${t}</text>`;
  if (sub) s += `<text x="${x + w / 2}" y="${y + 37}" text-anchor="middle" font-size="10" fill="${ink}" opacity="${o.hot ? 0.8 : 0.6}">${sub}</text>`;
  return s;
}

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
  title: 'Five surfaces, one kernel, one crate that reaches the database',
  type: 'svg',
  body: svg('0 0 720 330',
    box(18, 18, 124, 52, C.blue, 'Rust SDK', ['embedded']) +
    box(158, 18, 124, 52, C.blue, 'MCP', ['tool calls']) +
    box(298, 18, 124, 52, C.blue, 'mount', ['POSIX / FUSE']) +
    box(438, 18, 124, 52, C.blue, 'CLI', ['inspect · publish']) +
    box(578, 18, 124, 52, C.blue, 'run', ['confined exec']) +
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
  title: 'A state root: the namespace half and the key-value half',
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
  title: 'What the database was asked for, and what it was not',
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
  title: 'What each of the four structures holds',
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
  title: 'Where a byte ends up',
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
  type: 'svg',
  // Ten POSIX mechanisms converge onto four database ones, and three have no replacement at all.
  // The convergence is the point a table could not make, so the arrows carry it and the neon
  // marks the row that surprised me: three mechanisms simply have nowhere to go.
  body: svg('0 0 720 360', (() => {
    let o = '';
    const LX = 20, LW = 200, RX = 336, RW = 260, H = 22, DH = 40;
    o += label(20, 15, 'a traditional filesystem', 'start', 0.5);
    o += label(700, 15, 'what replaced it', 'end', 0.5);

    const groups = [
      [['superblock', 'fsck'], 'state root', 'one digest names the whole state'],
      [['inode', 'directory entry'], 'directory nodes', 'content-addressed and immutable'],
      [['data blocks', 'overwrite in place'], 'chunks', 'named by the hash of their bytes'],
      [['journal', 'mtime'], 'one transaction', 'guarded by an expected-head CAS'],
      [['inode number', 'block allocator', 'free bitmap'], 'no replacement',
        'the path is the identity; the engine places bytes', true],
    ];

    let y = 28;
    for (const [srcs, dest, sub, hot] of groups) {
      const ys = srcs.map((_, i) => y + i * 26);
      const dy = (ys[0] + ys[ys.length - 1] + H) / 2 - DH / 2;   // centre the target on its sources
      for (let i = 0; i < srcs.length; i++) {
        o += obox(LX, ys[i], LW, H, srcs[i]);
        o += arrow(LX + LW + 5, ys[i] + H / 2, RX - 5, dy + DH / 2, 'gray');
      }
      o += obox(RX, dy, RW, DH, dest, sub, { hot: !!hot });
      y = ys[ys.length - 1] + 26 + 8;
    }
    return o;
  })()),
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
  body: svg('0 0 720 150', (() => {
    let o = '';
    const pane = (x, y, w, h, t, sub, hot) => {
      let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${hot ? C.purple : 'none'}" stroke="${hot ? INK : 'currentColor'}" stroke-width="${hot ? 1.7 : 1.2}"${hot ? '' : ' opacity="0.45"'}/>`;
      s += `<text x="${x + w / 2}" y="${y + (sub ? 21 : h / 2 + 4)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${hot ? INK : 'currentColor'}">${t}</text>`;
      if (sub) s += `<text x="${x + w / 2}" y="${y + 36}" text-anchor="middle" font-size="9.5" fill="${hot ? INK : 'currentColor'}" opacity="${hot ? 0.8 : 0.62}">${sub}</text>`;
      return s;
    };
    // the write path: durable log and sorted buffer, then one sequential flush
    o += pane(20, 56, 96, 44, 'write', null, 0);
    o += pane(146, 26, 110, 44, 'WAL', 'append-only', 0);
    o += pane(146, 88, 110, 44, 'memtable', 'sorted, in memory', 0);
    o += arrow(120, 72, 144, 54, 'gray');
    o += arrow(120, 84, 144, 102, 'gray');
    // the levels below
    for (const [t, sub, y] of [['L0', 'overlapping', 32], ['L1', 'non-overlapping', 62], ['L2', null, 92]]) {
      o += `<rect x="300" y="${y}" width="250" height="26" rx="4" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.4"/>`;
      o += `<text x="314" y="${y + 18}" font-size="10.5" font-weight="700" fill="currentColor" opacity="0.85">${t}</text>`;
      if (sub) o += label(352, y + 18, sub, 'start', 0.55);
    }
    o += arrow(260, 110, 296, 104, 'gray');
    o += label(280, 98, 'flush', 'middle', 0.7);
    // and the one component that merges them back down
    o += pane(580, 56, 120, 44, 'compaction', 'merges runs', 1);
    o += arrow(578, 78, 554, 78, 'purple');
    return o;
  })()),
};

module.exports['skv-primitives'] = {
  title: 'The three primitives a branch is built out of',
  type: 'svg',
  body: svg('0 0 720 172', (() => {
    let o = '';
    const panel = (x, t, sub) => {
      let s = `<rect x="${x}" y="24" width="213" height="130" rx="9" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.26"/>`;
      s += `<text x="${x + 106}" y="45" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">${t}</text>`;
      if (sub) s += label(x + 106, 62, sub, 'middle', 0.6);
      return s;
    };

    // (a) the number, and it lives inside the key
    o += panel(20, 'a sequence number', null);
    for (const [x, w, t, hot] of [[32, 100, 'user_key', 0], [134, 46, 'seq', 1], [182, 36, 'ts', 0]]) {
      o += `<rect x="${x}" y="98" width="${w}" height="30" rx="5" fill="${hot ? C.purple : 'none'}" stroke="${hot ? INK : 'currentColor'}" stroke-width="${hot ? 1.6 : 1.1}"${hot ? '' : ' opacity="0.4"'}/>`;
      o += `<text x="${x + w / 2}" y="117" text-anchor="middle" font-size="10.5" font-weight="${hot ? 700 : 500}" fill="${hot ? INK : 'currentColor'}"${hot ? '' : ' opacity="0.72"'}>${t}</text>`;
    }

    // (b) visibility is a filter on that number
    o += panel(253, 'visibility', 'a filter on that number');
    for (const [y, t, vis] of [[80, 's31', 0], [102, 's27', 0], [128, 's14', 1]]) {
      o += `<rect x="290" y="${y}" width="58" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="1.1" opacity="${vis ? 0.75 : 0.3}"/>`;
      o += `<text x="319" y="${y + 13}" text-anchor="middle" font-size="10" fill="currentColor" opacity="${vis ? 0.85 : 0.35}">${t}</text>`;
      if (!vis) o += `<line x1="294" y1="${y + 15}" x2="344" y2="${y + 3}" stroke="currentColor" stroke-width="1" opacity="0.35"/>`;
    }
    o += `<rect x="272" y="121" width="136" height="5" rx="2.5" fill="${C.purple}" stroke="${INK}" stroke-width="0.7"/>`;
    o += label(414, 128, 'cap 19', 'start', 0.75);

    // (c) which of the three removes a version
    o += panel(487, 'compaction', 'deletes superseded versions');
    for (const [y, t, hot] of [[78, 'a read', 0], [102, 'a write', 0], [126, 'compaction', 1]]) {
      o += `<rect x="520" y="${y}" width="148" height="20" rx="5" fill="${hot ? C.purple : 'none'}" stroke="${hot ? INK : 'currentColor'}" stroke-width="${hot ? 1.5 : 1}"${hot ? '' : ' opacity="0.32"'}/>`;
      o += `<text x="594" y="${y + 14}" text-anchor="middle" font-size="10" font-weight="${hot ? 700 : 400}" fill="${hot ? INK : 'currentColor'}"${hot ? '' : ' opacity="0.5"'}>${t}</text>`;
    }
    return o;
  })()),
};

module.exports['skv-checkpoint-vs-fork'] = {
  title: 'Two stores after a checkpoint, one store and a view after a fork',
  type: 'svg',
  body: svg('0 0 720 176', (() => {
    let o = '';
    o += label(180, 22, 'a checkpoint', 'middle', 0.88);
    o += label(540, 22, 'a fork', 'middle', 0.88);
    o += `<line x1="360" y1="32" x2="360" y2="164" stroke="currentColor" stroke-width="1" opacity="0.22" stroke-dasharray="4,4"/>`;
    // a store: an outlined box with four file bars in it
    const store = (x, name) => {
      let s = `<rect x="${x}" y="38" width="150" height="98" rx="9" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.45"/>`;
      s += `<text x="${x + 75}" y="58" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">${name}</text>`;
      for (let i = 0; i < 4; i++) {
        s += `<rect x="${x + 16}" y="${68 + i * 16}" width="118" height="11" rx="2" fill="currentColor" opacity="0.18"/>`;
      }
      return s;
    };
    // checkpoint: two whole stores, and no arrow between them
    o += store(20, 'store A');
    o += store(190, 'store B');
    o += label(180, 158, 'fully copied · nothing shared', 'middle', 0.68);
    // fork: one store, plus a view that points into it
    o += store(380, 'main');
    o += `<rect x="560" y="38" width="140" height="34" rx="9" fill="${C.purple}" stroke="${INK}" stroke-width="1.6"/>`;
    o += `<text x="630" y="60" text-anchor="middle" font-size="11.5" font-weight="700" fill="${INK}">feature</text>`;
    o += arrow(558, 55, 534, 55, 'purple');
    o += label(630, 92, 'reads through main', 'middle', 0.7);
    o += label(540, 158, 'one catalog record · nothing copied', 'middle', 0.68);
    return o;
  })()),
};

module.exports['skv-ceiling'] = {
  title: 'A branch as a ceiling on the shared commit sequence',
  type: 'svg',
  body: svg('0 0 720 272', (() => {
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
    o += para(360, 258, 'The child’s own commits draw numbers from the same counter, so they land to the right of 25 — above everything it inherited.', { anchor: 'middle', maxW: 676, op: 0.62 });
    return o;
  })()),
};

module.exports['skv-fork-anchor'] = {
  title: 'The fork anchor: a number on the parent’s clock, and everything above it invisible',
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
    o += para(20, 244, 'A snapshot is released when its reader leaves. An anchor is the branch’s definition: it outlives every reader, survives restart, and can be written on top of.', { anchor: 'start', maxW: 680, op: 0.6 });
    return o;
  })()),
};

module.exports['skv-use-cases'] = {
  title: 'Three things people want a fork for, and what each one needs to be exact about',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Use</th><th>Lifetime</th><th>How many live at once</th><th>What it must be exact about</th><th>What you do today instead</th></tr></thead><tbody>
    <tr><td><b>Agent sandbox</b></td><td>seconds to minutes</td><td>one per task, thrown away</td><td>being <i>undoable</i> — the discard must leave nothing</td><td>copy the directory</td></tr>
    <tr><td><b>Dev / test / preview</b></td><td>hours to days</td><td>tens, concurrently</td><td>being a faithful copy of production data</td><td>restore a dump per environment</td></tr>
    <tr><td><b>Time travel &amp; audit</b></td><td>as long as the retention policy</td><td>read-only, many</td><td>the exact <i>point in time</i></td><td>read a backup, or an audit table you wrote yourself</td></tr>
    </tbody></table>
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">All three share one requirement: <b>the cost of creating a branch must not scale with the size of the store.</b> Their lifetimes differ, so the target is many short-lived branches rather than a few long-lived release lines.</p>`,
};

module.exports['skv-options'] = {
  title: 'Four ways to build a branch on an LSM tree, and where each one puts the cost',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Approach</th><th>What a fork writes</th><th>What it does to compaction</th></tr></thead><tbody>
    <tr><td><b>Put the branch id in every key</b></td><td>nothing</td><td>every branch's rows interleave in one keyspace, so a compaction job can never be scoped to one branch</td></tr>
    <tr><td><b>A separate engine per branch, with a copy</b></td><td>everything</td><td>nothing — each engine is independent</td></tr>
    <tr><td><b>Per-branch roots over a content-addressed tree</b></td><td>one root hash</td><td>replaces it — reachability over digests rather than sequence numbers</td></tr>
    <tr><td><b>A ceiling on a shared sequence counter</b><br><small>what this post describes</small></td><td>one metadata record</td><td>all of the difficulty lands here: compaction must be told which superseded versions are still somebody's current</td></tr>
    </tbody></table>`,
};

module.exports['skv-key-vs-metadata'] = {
  title: 'Where the owner is named',
  type: 'svg',
  body: svg('0 0 720 200', (() => {
    let o = '';
    // the internal key: three fields, and no branch id among them
    o += label(20, 22, 'the internal key', 'start', 0.85);
    for (const [x, w, t] of [[20, 380, 'user_key'], [404, 150, 'trailer'], [558, 142, 'timestamp']]) {
      o += `<rect x="${x}" y="30" width="${w}" height="34" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      o += `<text x="${x + w / 2}" y="52" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">${t}</text>`;
    }
    o += label(360, 80, 'no branch id anywhere', 'middle', 0.66);
    // the components: each one stamped with its owner
    o += label(20, 108, 'component metadata', 'start', 0.85);
    for (const [x, w, t] of [[20, 210, 'memtable'], [254, 210, 'SSTable meta'], [488, 212, 'manifest']]) {
      o += `<rect x="${x}" y="116" width="${w}" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      o += `<text x="${x + w / 2}" y="134" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor">${t}</text>`;
      o += `<rect x="${x + w / 2 - 36}" y="142" width="72" height="17" rx="4" fill="${C.purple}" stroke="${INK}" stroke-width="1.2"/>`;
      o += `<text x="${x + w / 2}" y="155" text-anchor="middle" font-size="10" font-weight="700" fill="${INK}">owner</text>`;
    }
    o += label(360, 188, 'branch identity lives here', 'middle', 0.66);
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
  body: svg('0 0 720 186', (() => {
    let o = '';
    o += label(20, 22, 'walked nearest-first', 'start', 0.85);
    const rows = [['own', null, 'cap 31', 32], ['parent', 'anchor 25', 'cap 25', 82], ['grandparent', 'anchor 33', 'cap 25', 132]];
    for (const [name, anchor, cap, y] of rows) {
      o += `<rect x="20" y="${y}" width="250" height="38" rx="7" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      o += `<text x="145" y="${y + 24}" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">${name}</text>`;
      if (anchor) {
        o += `<rect x="300" y="${y + 6}" width="130" height="26" rx="5" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.4"/>`;
        o += `<text x="365" y="${y + 24}" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.78">${anchor}</text>`;
      }
      o += `<rect x="460" y="${y + 4}" width="120" height="30" rx="6" fill="${C.purple}" stroke="${INK}" stroke-width="1.6"/>`;
      o += `<text x="520" y="${y + 24}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${INK}">${cap}</text>`;
      if (y < 132) o += arrow(520, y + 36, 520, y + 52, 'purple');
    }
    o += label(520, 180, 'narrows, never widens', 'middle', 0.66);
    return o;
  })()),
};

module.exports['skv-cap-before-merge'] = {
  title: 'Why the cap is applied per layer, upstream of the k-way merge',
  type: 'svg',
  body: svg('0 0 720 198', (() => {
    let o = '';
    o += label(180, 22, 'cap before the merge — the row the reader may see', 'middle', 0.88);
    o += label(540, 22, 'cap after the merge — a row from another layer', 'middle', 0.88);
    o += `<line x1="360" y1="30" x2="360" y2="190" stroke="currentColor" stroke-width="1" opacity="0.22" stroke-dasharray="4,4"/>`;
    // the three source layers, identical on both sides
    const layers = [['own ≤31', 0], ['parent ≤19', 1], ['grandpa ≤11', 2]];
    const lane = (x0) => {
      let s = '';
      for (const [t, i] of layers) {
        const x = x0 + i * 106;
        s += `<rect x="${x}" y="32" width="100" height="26" rx="5" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.45"/>`;
        s += `<text x="${x + 50}" y="49" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.8">${t}</text>`;
      }
      return s;
    };
    const merge = (x, y) => {
      let s = `<rect x="${x}" y="${y}" width="160" height="26" rx="5" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`;
      s += `<text x="${x + 80}" y="${y + 18}" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">k-way merge</text>`;
      return s;
    };
    // left: one cap per layer, upstream of the merge
    o += lane(24);
    for (const [, i] of layers) o += `<rect x="${24 + i * 106}" y="78" width="100" height="16" rx="4" fill="${C.purple}" stroke="${INK}" stroke-width="1.3"/>`;
    o += `<text x="180" y="90" text-anchor="middle" font-size="10" font-weight="700" fill="${INK}">≤ cap</text>`;
    o += merge(100, 114);
    for (const [, i] of layers) o += arrow(74 + i * 106, 60, 74 + i * 106, 76, 'gray');
    for (const [, i] of layers) o += arrow(74 + i * 106, 96, 180 + (i - 1) * 50, 112, 'gray');
    o += arrow(180, 142, 180, 158, 'gray');
    o += `<rect x="100" y="160" width="160" height="26" rx="5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.7"/>`;
    o += `<text x="180" y="178" text-anchor="middle" font-size="10.5" font-weight="700" fill="currentColor">yields s8</text>`;
    // right: one cap on the merged stream, and a row that should not exist
    o += lane(384);
    o += merge(460, 78);
    for (const [, i] of layers) o += arrow(434 + i * 106, 60, 540 + (i - 1) * 50, 76, 'gray');
    o += arrow(540, 106, 540, 122, 'gray');
    o += `<rect x="460" y="124" width="160" height="16" rx="4" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.3"/>`;
    o += `<text x="540" y="136" text-anchor="middle" font-size="10" font-weight="700" fill="${C.red}">≤ 31</text>`;
    o += arrow(540, 142, 540, 158, 'red');
    o += `<rect x="460" y="160" width="160" height="26" rx="5" fill="${fade(C.red)}" stroke="${C.red}" stroke-width="1.6"/>`;
    o += `<text x="540" y="178" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.red}">yields s27 — leaked</text>`;
    return o;
  })()),
};

module.exports['skv-shadow'] = {
  title: 'A child’s write sits above the row it inherited',
  type: 'svg',
  body: svg('0 0 720 150', (() => {
    let o = '';
    o += label(20, 22, 'one key, user:7', 'start', 0.85);
    // the child's write and the parent's row it shadows
    o += `<rect x="20" y="34" width="330" height="42" rx="7" fill="${C.purple}" stroke="${INK}" stroke-width="1.7"/>`;
    o += `<text x="185" y="60" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">child · seq 31</text>`;
    o += `<rect x="20" y="90" width="330" height="42" rx="7" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
    o += `<text x="185" y="116" text-anchor="middle" font-size="12" font-weight="700" fill="currentColor">parent · seq 14</text>`;
    // the comparison the read makes
    o += `<rect x="390" y="34" width="310" height="98" rx="9" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
    o += `<text x="545" y="66" text-anchor="middle" font-size="20" font-weight="700" fill="currentColor">31 &gt; 14</text>`;
    o += label(545, 88, 'so the child’s row wins', 'middle', 0.72);
    o += label(545, 112, 'no dirty set, no shadow table', 'middle', 0.55);
    o += arrow(354, 55, 386, 68, 'gray');
    o += arrow(354, 111, 386, 98, 'gray');
    return o;
  })()),
};

module.exports['skv-fork-protocol'] = {
  title: 'The fork protocol: fence, drain, resolve, publish',
  type: 'svg',
  body: svg('0 0 720 136', (() => {
    let o = '';
    // nothing is durable until the publish, so bracket everything upstream of it
    o += `<rect x="12" y="36" width="420" height="68" rx="10" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.28" stroke-dasharray="6,5"/>`;
    o += label(222, 28, 'nothing durable yet', 'middle', 0.65);
    const stages = [['fence', 'store-wide', 0], ['drain', 'the queue', 0], ['resolve', 'fork_seq', 0], ['publish', 'one hard link', 1], ['done', 'nothing copied', 0]];
    stages.forEach(([t, sub, hot], i) => {
      const x = 20 + i * 140;
      o += `<rect x="${x}" y="44" width="120" height="52" rx="9" fill="${hot ? C.purple : 'none'}" stroke="${hot ? INK : 'currentColor'}" stroke-width="${hot ? 1.7 : 1.2}"${hot ? '' : ' opacity="0.5"'}/>`;
      o += `<text x="${x + 60}" y="66" text-anchor="middle" font-size="12" font-weight="700" fill="${hot ? INK : 'currentColor'}">${t}</text>`;
      o += `<text x="${x + 60}" y="82" text-anchor="middle" font-size="10" fill="${hot ? INK : 'currentColor'}" opacity="${hot ? 0.8 : 0.6}">${sub}</text>`;
      if (i < 4) o += arrow(x + 140 - 18, 70, x + 140 - 2, 70, 'gray');
    });
    o += label(500, 122, 'the commit point', 'middle', 0.8);
    return o;
  })()),
};

module.exports['skv-lineages'] = {
  title: 'Three lineages, numbered and immutable',
  type: 'svg',
  body: svg('0 0 720 160', (() => {
    let o = '';
    // the three file paths
    const paths = ['catalog/⟨v⟩.catalog', 'branch/⟨id⟩/⟨v⟩.state', 'root/⟨v⟩.root'];
    paths.forEach((p, i) => {
      const y = 40 + i * 38;
      o += `<rect x="20" y="${y}" width="250" height="30" rx="6" fill="none" stroke="currentColor" stroke-width="${i === 0 ? 1.5 : 1.1}" opacity="${i === 0 ? 0.7 : 0.42}"/>`;
      o += `<text x="145" y="${y + 20}" text-anchor="middle" font-size="10.5" font-weight="${i === 0 ? 700 : 500}" fill="currentColor" opacity="${i === 0 ? 0.95 : 0.75}">${p}</text>`;
    });
    // one lineage's version chain: immutable, numbered, and the next name is the claim
    ['v6', 'v7', 'v8', 'v9'].forEach((v, i) => {
      const x = 282 + i * 36, next = v === 'v9';
      o += `<rect x="${x}" y="44" width="32" height="22" rx="4" fill="none" stroke="currentColor" stroke-width="1.1" opacity="${next ? 0.35 : 0.6}"${next ? ' stroke-dasharray="3,3"' : ''}/>`;
      o += `<text x="${x + 16}" y="${59}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="${next ? 0.45 : 0.8}">${v}</text>`;
    });
    o += label(370, 82, 'newest', 'middle', 0.5);
    o += arrow(410, 68, 436, 80, 'purple');
    // the rule that makes publishing a fork atomic
    o += `<rect x="440" y="36" width="260" height="88" rx="9" fill="${C.purple}" stroke="${INK}" stroke-width="1.7"/>`;
    o += `<text x="570" y="60" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">hard-link the next name</text>`;
    o += `<text x="570" y="82" text-anchor="middle" font-size="10.5" fill="${INK}" opacity="0.85">it already exists → it fails</text>`;
    o += `<text x="570" y="102" text-anchor="middle" font-size="10.5" fill="${INK}" opacity="0.85">so publish is a compare-and-swap</text>`;
    return o;
  })()),
};

module.exports['skv-catalog-lifecycle'] = {
  title: 'Deleting a branch: tombstone, reclaim, remove, retire',
  type: 'svg',
  body: svg('0 0 720 268', (() => {
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
    o += para(360, 152, 'a failure anywhere before step 4 leaves the tombstone in place, so the maintenance pass simply retries', { anchor: 'middle', maxW: 640, size: 11, lh: 14, op: 0.95 });
    o += box(24, 182, 328, 77, C.gray, 'what still fences a reused BranchId', ['branch generations are globally monotone, and a physical', 'owner names its generation — so an old transaction or WAL', 'row stays fenced even if an id is minted again']);
    o += box(376, 182, 320, 77, C.gray, 'what that let go', ['the recovered clock no longer anchors on retired records:', 'their data and authority are already gone, and', 'next_generation alone carries the fencing']);
    return o;
  })()),
};

module.exports['skv-lock-order'] = {
  title: 'Four locks, one order',
  type: 'svg',
  body: svg('0 0 720 172', (() => {
    let o = '';
    o += label(20, 22, 'always taken in this order', 'start', 0.85);
    // a spine marking the direction the order runs in
    o += `<rect x="64" y="34" width="6" height="98" rx="3" fill="${C.purple}" stroke="${INK}" stroke-width="0.8"/>`;
    o += `<path d="M56,132 L78,132 L67,148 Z" fill="${C.purple}" stroke="${INK}" stroke-width="1.1"/>`;
    const tier = (x, y, w, t) => {
      let s = `<rect x="${x}" y="${y}" width="${w}" height="34" rx="7" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      s += `<text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">${t}</text>`;
      return s;
    };
    o += tier(104, 34, 480, 'branch_materialization');
    o += tier(104, 82, 480, 'catalog_publish');
    o += tier(104, 130, 234, 'commit pipeline fence');
    o += tier(350, 130, 234, 'level manifest');
    o += label(600, 152, 'either or both', 'start', 0.6);
    return o;
  })()),
};

module.exports['skv-compaction-conflict'] = {
  title: 'The collision: one version, two claims on it',
  type: 'svg',
  body: svg('0 0 720 158', (() => {
    let o = '';
    o += label(20, 22, 'one key, newest first', 'start', 0.85);
    // the version chain, with the contested version lit
    const chain = [['s33', 34, 0], ['s21', 74, 1], ['s4', 114, 0]];
    for (const [t, y, hot] of chain) {
      o += `<rect x="280" y="${y}" width="160" height="32" rx="6" fill="${hot ? C.purple : 'none'}" stroke="${hot ? INK : 'currentColor'}" stroke-width="${hot ? 1.7 : 1.1}"${hot ? '' : ' opacity="0.35"'}/>`;
      o += `<text x="360" y="${y + 21}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${hot ? INK : 'currentColor'}"${hot ? '' : ' opacity="0.55"'}>${t}</text>`;
    }
    // the two claims that meet on it
    const claim = (x, w, t, sub) => {
      let s = `<rect x="${x}" y="66" width="${w}" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      s += `<text x="${x + w / 2}" y="86" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">${t}</text>`;
      s += label(x + w / 2, 103, sub, 'middle', 0.62);
      return s;
    };
    o += claim(20, 220, 'compaction', 'superseded — drop it');
    o += claim(500, 200, 'a fork anchor', 'still current — keep it');
    o += arrow(244, 90, 276, 90, 'gray');
    o += arrow(496, 90, 444, 90, 'gray');
    return o;
  })()),
};

module.exports['skv-anchor-kinds'] = {
  title: 'Three sources of retention anchors',
  type: 'svg',
  body: svg('0 0 720 172', (() => {
    let o = '';
    o += label(360, 22, 'every cap a durable reader still needs', 'middle', 0.7);
    const src = [[20, 214, 'a child’s fork anchor'], [252, 214, 'an edge’s target head'], [484, 216, 'an edge’s source cursor']];
    for (const [x, w, t] of src) {
      o += `<rect x="${x}" y="34" width="${w}" height="40" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      o += `<text x="${x + w / 2}" y="59" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">${t}</text>`;
      o += arrow(x + w / 2, 76, 360 + (x - 252) * 0.22, 108, 'gray');
    }
    o += `<rect x="230" y="110" width="260" height="46" rx="9" fill="${C.purple}" stroke="${INK}" stroke-width="1.7"/>`;
    o += `<text x="360" y="132" text-anchor="middle" font-size="12.5" font-weight="700" fill="${INK}">RetentionAnchors</text>`;
    o += `<text x="360" y="148" text-anchor="middle" font-size="10" fill="${INK}" opacity="0.8">kept as a set</text>`;
    return o;
  })()),
};

module.exports['skv-anchor-walker'] = {
  title: 'One index, descending: every anchor served in a single pass',
  type: 'svg',
  body: svg('0 0 720 190', (() => {
    let o = '';
    o += label(140, 22, 'anchors, descending', 'middle', 0.8);
    o += label(520, 22, 'versions, newest first', 'middle', 0.8);
    const Y = (i) => 34 + i * 38;
    // both lists sorted the same way, so one pass pairs them
    ['30', '21', '17', '6'].forEach((t, i) => {
      o += `<rect x="80" y="${Y(i)}" width="120" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.42"/>`;
      o += `<text x="140" y="${Y(i) + 19}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.82">${t}</text>`;
    });
    const pairs = [[], [0], [1, 2], [3]];
    ['s33', 's27', 's19', 's4'].forEach((t, i) => {
      const hot = pairs[i].length > 1;
      o += `<rect x="460" y="${Y(i)}" width="120" height="28" rx="5" fill="${hot ? C.purple : 'none'}" stroke="${hot ? INK : 'currentColor'}" stroke-width="${hot ? 1.6 : 1.1}"${hot ? '' : ' opacity="0.42"'}/>`;
      o += `<text x="520" y="${Y(i) + 19}" text-anchor="middle" font-size="11" font-weight="${hot ? 700 : 400}" fill="${hot ? INK : 'currentColor'}"${hot ? '' : ' opacity="0.82"'}>${t}</text>`;
      for (const a of pairs[i]) {
        o += `<line x1="456" y1="${Y(i) + 14}" x2="204" y2="${Y(a) + 14}" stroke="currentColor" stroke-width="${hot ? 1.5 : 1}" opacity="${hot ? 0.75 : 0.35}"/>`;
      }
    });
    o += label(600, 128, 'serves two', 'start', 0.75);
    o += label(360, 182, 'one index, never rewinds', 'middle', 0.62);
    return o;
  })()),
};

module.exports['skv-pin-shapes'] = {
  title: 'Range-pin and per-anchor pin over one version chain',
  type: 'svg',
  body: svg('0 0 720 172', (() => {
    let o = '';
    const cx = (i) => 72 + i * 112;
    // one version chain, with the four anchors that sit on it
    o += label(20, 22, 'anchors', 'start', 0.7);
    for (const i of [2, 3, 4, 5]) o += `<path d="M${cx(i) - 7},14 L${cx(i) + 7},14 L${cx(i)},25 Z" fill="${C.purple}" stroke="${INK}" stroke-width="1"/>`;
    ['s4', 's11', 's19', 's24', 's29', 's35'].forEach((v, i) => {
      o += `<text x="${cx(i)}" y="44" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.8">${v}</text>`;
    });
    // the same chain, retained two ways
    const row = (y, keep, title, note) => {
      let s = label(24, y - 8, title, 'start', 0.85);
      s += label(250, y - 8, note, 'start', 0.6);
      for (let i = 0; i < 6; i++) {
        const k = keep.includes(i), x = cx(i) - 48;
        s += `<rect x="${x}" y="${y}" width="96" height="28" rx="5" fill="currentColor" fill-opacity="${k ? 0.14 : 0}" stroke="currentColor" stroke-width="${k ? 1.3 : 1}" stroke-opacity="${k ? 0.6 : 0.3}"${k ? '' : ' stroke-dasharray="4,3"'}/>`;
        if (!k) s += `<line x1="${x + 6}" y1="${y + 23}" x2="${x + 90}" y2="${y + 5}" stroke="currentColor" stroke-width="1" opacity="0.32"/>`;
      }
      return s;
    };
    o += row(70, [0, 1, 2, 3, 4, 5], 'a versioned parent · 6 kept', 'everything below the highest anchor');
    o += row(134, [2, 3, 4, 5], 'a non-versioned parent · 4 kept', 'one version per anchor');
    return o;
  })()),
};

module.exports['skv-two-bottoms'] = {
  title: 'Two cases where the lowest level is not the bottom',
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
  body: svg('0 0 720 154', (() => {
    let o = '';
    // an anchor lands mid-merge
    o += `<rect x="215" y="20" width="170" height="24" rx="6" fill="${C.purple}" stroke="${INK}" stroke-width="1.5"/>`;
    o += `<text x="300" y="37" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}">anchor 26 appears</text>`;
    o += `<line x1="300" y1="44" x2="300" y2="66" stroke="${INK}" stroke-width="1.6" stroke-dasharray="4,3"/>`;
    const stages = [['sample', 'the anchor set', 0], ['merge', 'versions dropped', 0], ['re-check', 'under the lock', 0], ['refuse', 'output discarded', 1]];
    stages.forEach(([t, sub, bad], i) => {
      const x = 20 + i * 175;
      o += `<rect x="${x}" y="66" width="155" height="52" rx="9" fill="${bad ? fade(C.red) : 'none'}" stroke="${bad ? C.red : 'currentColor'}" stroke-width="${bad ? 1.7 : 1.2}"${bad ? '' : ' opacity="0.48"'}/>`;
      o += `<text x="${x + 77}" y="88" text-anchor="middle" font-size="12" font-weight="700" fill="${bad ? C.red : 'currentColor'}">${t}</text>`;
      o += `<text x="${x + 77}" y="105" text-anchor="middle" font-size="10" fill="${bad ? C.red : 'currentColor'}" opacity="${bad ? 0.85 : 0.6}">${sub}</text>`;
      if (i < 3) o += arrow(x + 157, 92, x + 173, 92, 'gray');
    });
    o += label(600, 140, 'the inputs stay live', 'middle', 0.62);
    return o;
  })()),
};

module.exports['skv-branch-runtimes'] = {
  title: 'What a fork allocates, and when',
  type: 'svg',
  body: svg('0 0 720 180', (() => {
    let o = '';
    const pill = (x, y, w, t) => {
      let s = `<rect x="${x}" y="${y}" width="${w}" height="32" rx="6" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.42"/>`;
      s += `<text x="${x + w / 2}" y="${y + 21}" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.82">${t}</text>`;
      return s;
    };
    // shared, one per store
    o += label(20, 22, 'one per store', 'start', 0.85);
    o += pill(20, 30, 158, 'WAL');
    o += pill(190, 30, 158, 'commit pipeline');
    o += pill(20, 72, 158, 'clock');
    o += pill(190, 72, 158, 'table-id allocator');
    // per branch
    o += label(384, 22, 'one per branch', 'start', 0.85);
    o += pill(384, 30, 316, 'memtable ×N');
    o += pill(384, 72, 316, 'level set ×N');
    o += `<line x1="366" y1="26" x2="366" y2="112" stroke="currentColor" stroke-width="1" opacity="0.22" stroke-dasharray="4,4"/>`;
    // when the per-branch state is allocated
    o += `<rect x="20" y="126" width="680" height="34" rx="8" fill="${C.purple}" stroke="${INK}" stroke-width="1.6"/>`;
    o += `<text x="360" y="148" text-anchor="middle" font-size="12" font-weight="700" fill="${INK}">allocated on the first write, not at the fork</text>`;
    o += label(360, 174, '1,003 branches, 3 runtimes', 'middle', 0.6);
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
    <tr><td>snapshot tracker</td><td>1</td><td>none — one branch's snapshot pins visibility for <i>every</i> owner's compaction</td></tr>
    <tr><td>active memtable</td><td>—</td><td>1, allocated on the branch's <b>first write</b>, never at the fork</td></tr>
    <tr><td>level set</td><td>—</td><td>1; every SSTable belongs to exactly one owner</td></tr>
    <tr><td>catalog entry</td><td>—</td><td>one record in one published catalog version; no data is written</td></tr>
    <tr><td>retained versions in the parent</td><td>—</td><td>one version per anchor per key, for a non-versioned parent</td></tr>
    <tr><td>read amplification</td><td>—</td><td>one more layer in the merge, and one more <code>min</code> in the cap — so it tracks fork <i>depth</i>, not branch count</td></tr>
    </tbody></table>
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">On metrics: <code>pin_retained_versions_total</code> counts versions that completed compactions retained <i>solely</i> because an anchor needed them, cumulatively since the process opened. It measures retention <b>work</b>, not how many extra versions are live on disk right now. <code>wal_pinned_segments</code> counts distinct referenced segments, and <code>timeline_horizon</code> is the range <code>AtTimestamp</code> can still answer inside.</p>`,
};

module.exports['skv-diff'] = {
  title: 'A branch’s own rows, above and below its anchor',
  type: 'svg',
  body: svg('0 0 720 190', (() => {
    let o = '';
    o += label(20, 22, 'the branch’s own components', 'start', 0.85);
    // rows the branch owns, newest first — the anchor is the only thing separating them
    const rows = [['user:3 · s31', 1], ['user:5 · s29', 1], ['user:8 · s27', 1], ['user:9 · s6', 0], ['user:2 · s4', 0]];
    rows.forEach(([t, above], i) => {
      const y = 32 + i * 28 + (above ? 0 : 18);
      o += `<rect x="20" y="${y}" width="300" height="24" rx="5" fill="none" stroke="currentColor" stroke-width="1.1" opacity="${above ? 0.5 : 0.28}"/>`;
      o += `<text x="170" y="${y + 17}" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="${above ? 0.85 : 0.4}">${t}</text>`;
      if (!above) o += `<line x1="26" y1="${y + 20}" x2="314" y2="${y + 4}" stroke="currentColor" stroke-width="1" opacity="0.32"/>`;
    });
    // the filter that tells them apart
    o += `<rect x="14" y="120" width="312" height="5" rx="2.5" fill="${C.purple}" stroke="${INK}" stroke-width="0.7"/>`;
    o += label(334, 127, 'anchor 24', 'start', 0.8);
    o += label(440, 74, 'its own writes', 'start', 0.7);
    o += label(440, 158, 'materialised by detach', 'start', 0.7);
    return o;
  })()),
};

module.exports['skv-merge-base'] = {
  title: 'A base that moves: fork point, source cursor, target edge',
  type: 'svg',
  body: svg('0 0 720 176', (() => {
    let o = '';
    const X = (s) => 130 + (s - 4) * 15;
    // two lanes on the one shared clock
    for (const [y, name, dots] of [[52, 'target', [10, 28, 33, 40]], [108, 'source', [14, 22, 30]]]) {
      o += `<rect x="20" y="${y}" width="92" height="32" rx="7" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      o += `<text x="66" y="${y + 21}" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">${name}</text>`;
      o += `<line x1="122" y1="${y + 16}" x2="700" y2="${y + 16}" stroke="currentColor" stroke-width="0.9" opacity="0.22"/>`;
      for (const s of dots) o += `<circle cx="${X(s)}" cy="${y + 16}" r="6.5" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.3" stroke-opacity="0.5"/>`;
    }
    // three sequences, and only one of them is the base
    const marks = [[8, 'fork_at 8', 'original divergence', 0], [22, 'source_through 22', 'the base', 1], [33, 'target_at 33', 'edge history only', 0]];
    for (const [s, t, note, hot] of marks) {
      o += `<line x1="${X(s)}" y1="44" x2="${X(s)}" y2="148" stroke="${hot ? INK : 'currentColor'}" stroke-width="${hot ? 2.2 : 1.4}"${hot ? '' : ' opacity="0.4" stroke-dasharray="5,4"'}/>`;
      const w = t.length * 6.6 + 16;
      o += `<rect x="${X(s) - w / 2}" y="20" width="${w}" height="22" rx="5" fill="${hot ? C.purple : 'none'}" stroke="${hot ? INK : 'currentColor'}" stroke-width="${hot ? 1.6 : 1.1}"${hot ? '' : ' opacity="0.45"'}/>`;
      o += `<text x="${X(s)}" y="${35}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${hot ? INK : 'currentColor'}">${t}</text>`;
      o += label(X(s), 166, note, 'middle', hot ? 0.85 : 0.6);
    }
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
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">Absence is treated as an ordinary value, so delete-vs-delete <i>resolves</i> and delete-vs-modify <i>conflicts</i> without a special case for either. Strategies: <code>Strict</code> (the default — refuses the whole merge), <code>SourceWins</code>, <code>TargetWins</code>, and <code>Resolve</code> with a caller-supplied resolver that may itself refuse. Every decision routes through one <code>decide</code> call, so no strategy can drift from the classification.</p>`,
};

module.exports['skv-merge-commit-order'] = {
  title: 'Data first, edge second, and a crash between them',
  type: 'svg',
  body: svg('0 0 720 160', (() => {
    let o = '';
    // one crash point, two orders through it
    o += `<line x1="322" y1="34" x2="322" y2="146" stroke="${C.red}" stroke-width="1.8" stroke-dasharray="4,3"/>`;
    o += `<text x="322" y="28" text-anchor="middle" font-size="10.5" font-weight="700" fill="${C.red}">crash</text>`;
    const lane = (y, name, first, second, outcome, ok) => {
      let s = `<text x="20" y="${y + 23}" font-size="11.5" font-weight="700" fill="currentColor" opacity="0.85">${name}</text>`;
      for (const [x, t] of [[110, first], [334, second]]) {
        s += `<rect x="${x}" y="${y}" width="180" height="36" rx="7" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
        s += `<text x="${x + 90}" y="${y + 23}" text-anchor="middle" font-size="11" fill="currentColor" opacity="0.85">${t}</text>`;
      }
      s += `<rect x="536" y="${y}" width="164" height="36" rx="7" fill="${ok ? C.purple : fade(C.red)}" stroke="${ok ? INK : C.red}" stroke-width="1.7"/>`;
      s += `<text x="618" y="${y + 23}" text-anchor="middle" font-size="11" font-weight="700" fill="${ok ? INK : C.red}">${outcome}</text>`;
      s += arrow(296, y + 18, 330, y + 18, 'gray');
      s += arrow(516, y + 18, 532, y + 18, 'gray');
      return s;
    };
    o += lane(40, 'as built', 'commit the data', 'record the edge', 're-offered', 1);
    o += lane(104, 'reversed', 'record the edge', 'commit the data', 'silently lost', 0);
    return o;
  })()),
};

module.exports['skv-detach'] = {
  title: 'Detach: before and after the parent link is cleared',
  type: 'svg',
  body: svg('0 0 720 176', (() => {
    let o = '';
    o += label(180, 22, 'before', 'middle', 0.88);
    o += label(540, 22, 'after detach', 'middle', 0.88);
    o += `<line x1="360" y1="32" x2="360" y2="164" stroke="currentColor" stroke-width="1" opacity="0.22" stroke-dasharray="4,4"/>`;
    // a parent, with or without a pin on it
    const parent = (x, chip, red) => {
      let s = `<rect x="${x}" y="38" width="300" height="46" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      s += `<text x="${x + 74}" y="66" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">parent</text>`;
      s += `<rect x="${x + 160}" y="${52}" width="110" height="20" rx="5" fill="${red ? fade(C.red) : 'none'}" stroke="${red ? C.red : 'currentColor'}" stroke-width="1.2"${red ? '' : ' opacity="0.4"'}/>`;
      s += `<text x="${x + 215}" y="66" text-anchor="middle" font-size="10" font-weight="700" fill="${red ? C.red : 'currentColor'}"${red ? '' : ' opacity="0.6"'}>${chip}</text>`;
      return s;
    };
    o += parent(20, 'pinned', true);
    o += parent(380, 'unpinned', false);
    // the child: a thin view before, a holder of one materialised table after
    o += `<rect x="20" y="108" width="300" height="40" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
    o += `<text x="170" y="133" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">child</text>`;
    o += arrow(170, 106, 170, 90, 'gray');
    o += `<rect x="380" y="108" width="300" height="40" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
    o += `<text x="424" y="133" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">child</text>`;
    o += `<rect x="474" y="118" width="196" height="21" rx="4" fill="${C.purple}" stroke="${INK}" stroke-width="1.5"/>`;
    o += `<text x="572" y="133" text-anchor="middle" font-size="10" font-weight="700" fill="${INK}">one new SSTable</text>`;
    return o;
  })()),
};

module.exports['skv-errors'] = {
  title: 'The refusals, and what each one does not answer',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Refusal</th><th>What it does not answer</th><th>Retryable?</th><th>What you do instead</th></tr></thead><tbody>
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
    <p style="font-size:.82rem;opacity:.72;margin:.7rem 0 0">Three newer refusal paths — a fork sequence before its parent's creation, a detach whose owner was fenced mid-copy, and a checkpoint whose drain timed out — reuse existing variants rather than adding new ones, so this list is the taxonomy and not an exhaustive index of call sites.</p>`,
};

module.exports['skv-decision-log'] = {
  title: 'Every decision, what it rejected, and why',
  type: 'html',
  body: `<table class="cmp"><thead><tr><th>Decision</th><th>What was rejected</th><th>Why</th></tr></thead><tbody>
    <tr><td><b>One global sequence counter; a branch is a ceiling on it</b></td><td>a per-branch clock and head</td><td>two branches' sequences become directly comparable, so an entire view is definable by one integer — which is what lets a fork cost one metadata record</td></tr>
    <tr><td><b>Ownership in component metadata</b></td><td><code>branch_id</code> prefixed into every physical key</td><td>keeps a key's version chain contiguous and every compaction job single-owner; branch deletion becomes component reclamation instead of a range delete over live data</td></tr>
    <tr><td><b>Inherited views are logical</b></td><td>a bounded fork-delta table carrying the parent's unflushed rows</td><td>the child resolves the parent's live memtables under its cap, so every fork point is already exact without copying them</td></tr>
    <tr><td><b>Caps applied per layer, before the k-way merge</b></td><td>one snapshot filter over the merged stream</td><td>once layers interleave, which ceiling applied to which row is gone; a post-merge filter emits rows no reader was allowed to see</td></tr>
    <tr><td><b>Retention anchors are a set</b></td><td>pin the lowest / pin the highest / range-pin to the highest</td><td>the lowest hands a higher fork a version never current at its anchor; the highest starves the lowest; the range makes one fork-at-head retain the parent's whole history</td></tr>
    <tr><td><b>The pin is an additive override</b></td><td>rewriting compaction's retention rules</td><td>with no children, output is byte-identical to a store that never forked — branching cannot regress the unbranched engine by construction rather than by testing</td></tr>
    <tr><td><b>Pins come from the durable catalog only</b></td><td>deriving pins from live snapshots or child state manifests</td><td>otherwise compaction's output depends on who happened to be reading, and a crash could lose a promise that existed only in a reader's memory</td></tr>
    <tr><td><b>Numbered immutable lineages, published by hard link</b></td><td>a rewritten-and-renamed MANIFEST file</td><td>rename is not compare-and-swap; conditional create plus a byte-compare leaves an interrupted retry indistinguishable from a completed one</td></tr>
    <tr><td><b>Deletion tombstones are retired</b></td><td>keeping every tombstone forever</td><td>otherwise lifetime create count, not concurrent live branches, consumes the 4,096-record cap — and monotone generations already fence a reused id</td></tr>
    <tr><td><b>A separate materialization lock</b></td><td>holding <code>catalog_publish</code> across a detach's copy</td><td>an O(dataset) copy must not block unrelated catalog operations</td></tr>
    <tr><td><b>Diff scans owned components and filters by sequence</b></td><td>a commit change journal</td><td>a branch's own components contain only its own writes, so the scan is already proportional to the diff — and detach materialises inherited rows into those tables, so the filter is load-bearing anyway</td></tr>
    <tr><td><b>The merge base is the source snapshot at the consumed cursor</b></td><td>using the previous target head as the base</td><td>merging into a target never mutates the source, so target-only values at that edge were never source history; treating them as a common base silently overwrites the target</td></tr>
    <tr><td><b>Data commits first, edge second</b></td><td>recording the edge first</td><td>a crash between them re-offers applied work, which converges or conflicts; the other order advances past changes never written and loses them silently</td></tr>
    <tr><td><b>Merges go through the ordinary commit path</b></td><td>a privileged bulk-apply path</td><td>conflict detection, WAL and sequence allocation are already on that path, and there is no second write path to keep correct</td></tr>
    <tr><td><b><code>chunks</code> reports how many transactions the merge took</b></td><td>claiming merges are atomic</td><td>the data's size decides, not the call, so the count is returned for the caller to check</td></tr>
    <tr><td><b>Refuse rather than approximate</b></td><td>nearest-match timestamps, invented merge bases, best-effort forks</td><td>an approximate answer does not announce itself, so a caller cannot tell it from an exact one</td></tr>
    <tr><td><b>Registry and level sets keyed by owner in a <code>HashMap</code></b></td><td>a lock-free registry; a <code>Vec</code> scanned linearly</td><td>branch count must not enter a point read's cost; lock-freedom is a recorded optimisation, not a v1 need</td></tr>
    <tr><td><b>Arenas right-sized lazily; the write buffer is a soft limit</b></td><td>chunked arenas; a hard resident-memory cap</td><td>an idle branch should allocate nothing, and rotation cannot release an immutable arena until its flush completes, so the limit is soft rather than a hard cap</td></tr>
    </tbody></table>`,
};

// --- the four designs, read in sequence as alternatives to the same problem -------------------
// One shared box vocabulary and one shared scale, so the four can be compared at a glance.

module.exports['skv-design-prefix'] = {
  title: 'A branch id in every key',
  type: 'svg',
  body: svg('0 0 720 200', (() => {
    let o = '';
    // the design: the id becomes part of the physical key
    o += label(20, 22, 'branch id in every key', 'start', 0.85);
    o += obox(20, 30, 104, 28, 'branch_id', null, { hot: 1 });
    o += obox(130, 30, 210, 28, 'user_key', null, {});
    // one keyspace, so a key's versions sort apart by prefix
    o += label(20, 80, 'one keyspace', 'start', 0.68);
    [['b1 · user:3', 0], ['b1 · user:7', 1], ['b2 · user:3', 0], ['b2 · user:7', 1]].forEach(([t, split], i) => {
      const y = 88 + i * 26;
      o += `<rect x="20" y="${y}" width="220" height="22" rx="5" fill="${split ? fade(C.red) : 'none'}" stroke="${split ? C.red : 'currentColor'}" stroke-width="1.1"${split ? '' : ' opacity="0.4"'}/>`;
      o += `<text x="130" y="${y + 15}" text-anchor="middle" font-size="10.5" fill="${split ? C.red : 'currentColor'}"${split ? '' : ' opacity="0.75"'}>${t}</text>`;
    });
    o += `<path d="M248,125 L256,125 M252,125 L252,177 M248,177 L256,177" stroke="${C.red}" stroke-width="1.3" fill="none"/>`;
    o += `<text x="264" y="155" font-size="10.5" fill="${C.red}">user:7, split</text>`;
    // and one read has to visit each prefix
    o += label(550, 22, 'a read of user:7', 'middle', 0.85);
    o += arrow(545, 32, 470, 84, 'gray');
    o += arrow(555, 32, 630, 84, 'gray');
    o += obox(400, 86, 140, 30, 'seek b1·', null, {});
    o += obox(560, 86, 140, 30, 'seek b2·', null, {});
    o += label(550, 148, 'one seek per prefix', 'middle', 0.68);
    return o;
  })()),
};

module.exports['skv-design-copy'] = {
  title: 'A copy of the store per branch',
  type: 'svg',
  body: svg('0 0 720 196', (() => {
    let o = '';
    o += label(140, 22, 'main · 14,203 rows', 'middle', 0.85);
    o += label(580, 22, 'the fork', 'middle', 0.85);
    // the same rows, twice
    for (const x of [20, 460]) {
      o += `<rect x="${x}" y="34" width="240" height="100" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
      for (let i = 0; i < 5; i++) o += `<rect x="${x + 20}" y="${50 + i * 16}" width="200" height="11" rx="2" fill="currentColor" opacity="0.18"/>`;
    }
    for (let i = 0; i < 5; i++) o += arrow(266, 55.5 + i * 16, 454, 55.5 + i * 16, 'gray');
    // what the fork writes
    o += `<rect x="230" y="156" width="260" height="30" rx="7" fill="${C.purple}" stroke="${INK}" stroke-width="1.7"/>`;
    o += `<text x="360" y="176" text-anchor="middle" font-size="11.5" font-weight="700" fill="${INK}">14,203 rows written at the fork</text>`;
    return o;
  })()),
};

module.exports['skv-design-cat'] = {
  title: 'Per-branch roots over a content-addressed tree',
  type: 'svg',
  body: svg('0 0 720 192', (() => {
    let o = '';
    o += label(20, 22, 'nodes named by content hash', 'start', 0.85);
    // one root pointer per branch
    o += label(134, 48, 'main', 'end', 0.7);
    o += label(324, 48, 'feature', 'end', 0.7);
    o += obox(140, 30, 90, 28, 'a91', null, {});
    o += obox(330, 30, 90, 28, 'c04', null, { hot: 1 });
    o += obox(90, 92, 90, 28, '7f2', null, { dash: 1 });
    o += obox(380, 92, 90, 28, 'b3e', null, {});
    o += obox(290, 154, 90, 28, '2d9', null, { dash: 1 });
    o += obox(470, 154, 90, 28, '9c1', null, {});
    // one write copies the path leaf → root; every untouched subtree is reused
    o += arrow(178, 60, 140, 90, 'gray');
    o += arrow(360, 60, 178, 90, 'gray', true);
    o += arrow(400, 60, 418, 90, 'gray');
    o += arrow(410, 122, 348, 152, 'gray', true);
    o += arrow(440, 122, 500, 152, 'gray');
    o += label(580, 106, 'dashed = shared', 'start', 0.62);
    o += label(580, 124, 'solid = newly written', 'start', 0.62);
    return o;
  })()),
};

module.exports['skv-design-ceiling'] = {
  title: 'A ceiling on one shared counter',
  type: 'svg',
  body: svg('0 0 720 194', (() => {
    let o = '';
    const X = (s) => 200 + (s - 5) * 13;
    o += label(20, 22, 'one commit sequence', 'start', 0.85);
    o += `<line x1="200" y1="48" x2="700" y2="48" stroke="currentColor" stroke-width="1" opacity="0.3"/>`;
    for (const s of [10, 20, 30, 40]) {
      o += `<line x1="${X(s)}" y1="43" x2="${X(s)}" y2="53" stroke="currentColor" stroke-width="1" opacity="0.4"/>`;
      o += `<text x="${X(s)}" y="68" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.65">${s}</text>`;
    }
    // the one number a fork writes
    o += `<line x1="${X(25)}" y1="40" x2="${X(25)}" y2="76" stroke="${INK}" stroke-width="2.2"/>`;
    o += `<rect x="${X(25) - 44}" y="20" width="88" height="20" rx="5" fill="${C.purple}" stroke="${INK}" stroke-width="1.5"/>`;
    o += `<text x="${X(25)}" y="34" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">anchor 25</text>`;
    // the parent retains; the child holds nothing of its own until it writes
    o += `<rect x="20" y="92" width="320" height="70" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
    o += `<text x="180" y="112" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">parent</text>`;
    for (let i = 0; i < 3; i++) o += `<rect x="${44 + i * 100}" y="122" width="84" height="26" rx="4" fill="currentColor" opacity="0.16"/>`;
    o += obox(380, 92, 320, 70, 'child', 'no components yet', { dash: 1 });
    o += arrow(X(25) - 6, 78, 280, 90, 'gray');
    o += arrow(X(25) + 6, 78, 540, 90, 'gray');
    o += label(180, 182, 'retains pinned versions', 'middle', 0.65);
    o += label(540, 182, 'reads under the cap', 'middle', 0.65);
    return o;
  })()),
};

module.exports['skv-architecture-map'] = {
  title: 'The parts of a branch, and how they connect',
  type: 'svg',
  body: svg('0 0 720 348', (() => {
    let o = '';
    const X = (s) => 215 + (s - 5) * 13;
    const A = X(25);
    // the shared counter, and the one number every other part is arranged around
    o += label(20, 30, 'one sequence counter', 'start', 0.85);
    o += `<line x1="215" y1="52" x2="700" y2="52" stroke="currentColor" stroke-width="1" opacity="0.3"/>`;
    for (const s of [10, 20, 30, 40]) {
      o += `<line x1="${X(s)}" y1="47" x2="${X(s)}" y2="57" stroke="currentColor" stroke-width="1" opacity="0.4"/>`;
      o += `<text x="${X(s)}" y="70" text-anchor="middle" font-size="10" fill="currentColor" opacity="0.6">${s}</text>`;
    }
    o += `<rect x="${A - 44}" y="16" width="88" height="20" rx="5" fill="${C.purple}" stroke="${INK}" stroke-width="1.5"/>`;
    o += `<text x="${A}" y="30" text-anchor="middle" font-size="10.5" font-weight="700" fill="${INK}">anchor 25</text>`;
    o += `<line x1="${A}" y1="36" x2="${A}" y2="62" stroke="${INK}" stroke-width="2.2"/>`;
    o += `<line x1="${A}" y1="62" x2="${A}" y2="232" stroke="${INK}" stroke-width="1.6" stroke-dasharray="5,4" opacity="0.75"/>`;
    // the catalog: the durable record, and the only thing a fork writes
    o += label(100, 84, 'what a fork writes', 'middle', 0.62);
    o += `<rect x="20" y="90" width="160" height="94" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
    o += `<text x="100" y="110" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">catalog</text>`;
    ['branches', 'parents', 'anchors · 25'].forEach((t, i) => {
      const y = 118 + i * 21;
      o += `<rect x="32" y="${y}" width="136" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"/>`;
      o += `<text x="100" y="${y + 12}" text-anchor="middle" font-size="9.5" fill="currentColor" opacity="0.72">${t}</text>`;
    });
    // one grid: both branches hold the same two kinds of component, fed by the counter
    o += label(375, 112, 'parent', 'middle', 0.85);
    o += label(575, 112, 'child', 'middle', 0.85);
    o += label(270, 142, 'memtable', 'end', 0.68);
    o += label(270, 174, 'level sets', 'end', 0.68);
    for (const x of [290, 490]) {
      for (const y of [124, 156]) {
        o += `<rect x="${x}" y="${y}" width="170" height="28" rx="6" fill="none" stroke="currentColor" stroke-width="1.1" opacity="0.4"/>`;
      }
    }
    o += arrow(375, 62, 375, 98, 'gray');
    o += arrow(575, 62, 575, 98, 'gray');
    o += label(648, 96, 'every commit', 'middle', 0.6);
    // the read stack: the branch's own layer first, then the parent's under the anchor
    o += label(20, 214, 'the read stack', 'start', 0.85);
    o += label(575, 196, 'only rows it wrote', 'middle', 0.6);
    o += `<rect x="500" y="204" width="180" height="26" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`;
    o += `<text x="590" y="221" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">child layer</text>`;
    o += `<rect x="200" y="250" width="480" height="26" rx="6" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`;
    o += `<text x="440" y="267" text-anchor="middle" font-size="10.5" font-weight="600" fill="currentColor">parent layer · capped at 25</text>`;
    o += arrow(650, 186, 650, 202, 'gray');
    o += arrow(300, 186, 250, 248, 'gray');
    o += arrow(620, 232, 620, 248, 'gray');
    o += arrow(A, 232, A, 248, 'purple');
    // the pin the catalog derives, and the component that has to consult it
    o += `<rect x="200" y="292" width="170" height="44" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
    o += `<text x="285" y="312" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">retention pin</text>`;
    o += label(285, 328, 'versions to keep', 'middle', 0.6);
    o += `<rect x="460" y="292" width="220" height="44" rx="8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.45"/>`;
    o += `<text x="570" y="312" text-anchor="middle" font-size="11.5" font-weight="700" fill="currentColor">compaction</text>`;
    o += label(570, 328, 'consults the pin', 'middle', 0.6);
    o += arrow(100, 186, 204, 294, 'gray');
    o += arrow(372, 314, 458, 314, 'gray');
    return o;
  })()),
};
