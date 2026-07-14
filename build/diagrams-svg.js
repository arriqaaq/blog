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
    body: svg('0 0 720 250',
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
    title: 'One word, three concepts — at three different consistency levels',
    type: 'svg',
    body: svg('0 0 720 268',
      box(20, 96, 175, 76, C.amber, '“membership”', ['one word — shared with', 'view · epoch · configuration']) +
      box(280, 20, 420, 66, C.blue, 'a liveness view', ['who seems up right now — weak, fleet-wide, always changing', 'failure detection: SWIM · φ-accrual · memberlist']) +
      box(280, 100, 420, 66, C.green, 'an agreed view sequence', ['v1 → v2 → v3, the same order everywhere — needs agreement', 'group membership service · virtual synchrony']) +
      box(280, 180, 420, 66, C.red, 'a quorum configuration', ['the tiny replica set majorities are computed from — safety-critical', 'Raft config · Paxos acceptor set']) +
      arrow(195, 118, 278, 54, 'blue') + arrow(195, 134, 278, 133, 'green') + arrow(195, 150, 278, 212, 'red') +
      label(360, 262, 'three different consistency requirements — the papers use one word for all three', 'middle', 0.6)),
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
    body: svg('0 0 720 258',
      box(90, 20, 360, 62, C.blue, 'soft detection', ['heartbeats · gossip · suspicion — weak and noisy']) +
      box(90, 106, 360, 62, C.purple, 'THE AGREEMENT BOX', ['one agreed, totally-ordered truth']) +
      box(90, 192, 360, 62, C.red, 'quorum configuration', ['what majorities are computed from — safety-critical']) +
      arrow(270, 82, 270, 104, 'blue') + arrow(270, 168, 270, 190, 'purple') +
      label(482, 112, 'where the box can live:', 'start', 0.78) +
      label(482, 132, '· an external store (ZooKeeper, etcd)', 'start', 0.65) +
      label(482, 150, '· the protocol itself (Raft, Matchmaker)', 'start', 0.65) +
      label(482, 168, '· the membership layer (Rapid)', 'start', 0.65) +
      arrow(476, 137, 456, 137, 'gray', true)),
  },

  'mem-tikv': {
    title: 'The composition in production: TiKV',
    type: 'svg',
    body: svg('0 0 720 200',
      box(20, 46, 165, 78, C.blue, 'soft heartbeats', ['every store reports in;', 'weak, constantly changing']) +
      box(245, 46, 185, 78, C.amber, 'Placement Driver', ['policy — decides that a', 'region changes, and to what']) +
      box(490, 46, 210, 78, C.green, 'per-region Raft', ['mechanism — the conf-change', 'commits through the log']) +
      arrow(185, 85, 243, 85, 'blue') + arrow(430, 85, 488, 85, 'amber') +
      label(337, 152, "≈ Rapid's seat: detect + decide", 'middle', 0.7) +
      label(595, 152, "≈ Matchmaker's seat: execute safely", 'middle', 0.7) +
      label(360, 184, 'the soft view never touches quorum math — the agreement box is per-region Raft', 'middle', 0.55)),
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
    body: svg('0 0 720 258',
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
      box(330, 182, 340, 40, C.amber, 'operator → reload cluster config', ['add / remove nodes · one change per view']) +
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

  'mem-surrealds-parts': {
    title: 'SurrealDS uses all three meanings',
    type: 'svg',
    body: svg('0 0 720 264',
      box(40, 20, 640, 58, C.blue, 'Meaning 1 · the liveness view', ['compute-node heartbeats (soft); the store view-change timers handle', 'leader failover and recovery — deliberately not wired to membership']) +
      box(40, 96, 640, 58, C.purple, 'Meaning 2 · the agreed sequence', ['every change is one store transaction / view-change step, so the store', 'serializes them all — its transactions are the agreement box']) +
      box(40, 172, 640, 58, C.red, 'Meaning 3 · the quorum configuration', ['the replica voter set (voters + learners), changed by the single-server', 'overlap rule — an external operator decides what the set should be']) +
      label(360, 252, 'the liveness view never decides the voter set — an operator does, and the store only installs each change safely', 'middle', 0.6)),
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
    body: svg('0 0 720 262',
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
    body: svg('0 0 720 300', (() => {
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
    body: svg('0 0 720 288', (() => {
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
    body: svg('0 0 720 300', (() => {
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
    body: svg('0 0 720 276', (() => {
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
