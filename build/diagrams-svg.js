/* Bespoke static SVG diagrams for the post (replaces mermaid). Kit color language; text uses
 * currentColor so they adapt to light/dark. Each entry: { title, type:'svg'|'html', body }. */
'use strict';
const C = { green: '#16a34a', blue: '#2563eb', purple: '#7c3aed', amber: '#d97706', red: '#dc2626', pink: '#db2777', gray: '#64748b' };
const fade = (hex) => hex + '20'; // ~12% alpha

function svg(vb, body, extraDefs) {
  const markers = Object.entries(C).map(([n, c]) =>
    `<marker id="m-${n}" markerWidth="9" markerHeight="7" refX="7.5" refY="3.5" orient="auto"><path d="M0,0 L9,3.5 L0,7 Z" fill="${c}"/></marker>`).join('');
  return `<svg class="dgm-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg"><defs>${markers}${extraDefs || ''}</defs>${body}</svg>`;
}
function box(x, y, w, h, accent, title, lines) {
  const t = `<text x="${x + w / 2}" y="${y + 20}" text-anchor="middle" font-size="13" font-weight="700" fill="${accent}">${title}</text>`;
  const ls = (lines || []).map((l, i) =>
    `<text x="${x + w / 2}" y="${y + 38 + i * 15}" text-anchor="middle" font-size="10.5" fill="currentColor" opacity="0.78">${l}</text>`).join('');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${fade(accent)}" stroke="${accent}" stroke-width="1.6"/>${t}${ls}`;
}
function arrow(x1, y1, x2, y2, name, dash) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C[name]}" stroke-width="1.8" marker-end="url(#m-${name})"${dash ? ' stroke-dasharray="5,4"' : ''}/>`;
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
        return `<circle cx="${px(x)}" cy="${py(y)}" r="${big ? 8 : 5.5}" fill="${col}"${big ? ' filter="url(#dgm-glow)"' : ''}/>
          <text x="${px(x) + (x > 0.6 ? -10 : 12)}" y="${py(y) + 4}" text-anchor="${x > 0.6 ? 'end' : 'start'}" font-size="${big ? 12.5 : 11}" font-weight="${big ? 700 : 500}" fill="${big ? C.purple : 'currentColor'}" opacity="${big ? 1 : 0.82}">${n}</text>`;
      }).join('');
      return axes + pts;
    })(), '<filter id="dgm-glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'),
  },

  lineage: {
    title: 'The lineage we read our way into',
    type: 'svg',
    body: svg('0 0 720 150',
      box(20, 40, 180, 78, C.blue, 'FoundationDB', ['built the simulator', 'before the database']) +
      box(270, 40, 180, 78, C.green, 'Turmoil + madsim', ['host/client + paused', 'clock; libc interposition']) +
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
      box(20, 18, 200, 64, C.green, 'Tokio', ['paused clock + LocalSet']) +
      box(20, 100, 200, 64, C.blue, 'Turmoil', ['host/client + step loop']) +
      box(20, 182, 200, 64, C.amber, 'madsim', ['libc interposition']) +
      box(500, 100, 200, 64, C.pink, 'FoundationDB', ['swizzle-clog + sim-first']) +
      box(290, 90, 140, 84, C.purple, 'dst', ['our core']) +
      arrow(220, 50, 288, 110, 'green') + arrow(220, 132, 288, 132, 'blue') +
      arrow(220, 214, 288, 154, 'amber') + arrow(500, 132, 432, 132, 'pink')),
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
      <tr><td>Turmoil</td><td>low, but network-only</td><td>partial — leaks via <code>std::time</code> / syscalls</td><td>some</td></tr>
      <tr><td>Antithesis</td><td>package into Docker, pay</td><td>total (hypervisor)</td><td>no</td></tr>
      <tr><td><strong>from scratch (this)</strong></td><td>build it yourself</td><td>high, with known boundaries</td><td>that was the point</td></tr>
      </tbody></table>`,
  },
};

module.exports["layers-plan"] = { title: "The build plan: layers over a seed", type: "svg", body: "<svg class=\"dgm-svg\" viewBox=\"0 0 720 300\" xmlns=\"http://www.w3.org/2000/svg\"><defs><marker id=\"lp-green\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#16a34a\"/></marker><marker id=\"lp-amber\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#d97706\"/></marker><marker id=\"lp-purple\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#7c3aed\"/></marker></defs><rect x=\"250\" y=\"262\" width=\"160\" height=\"30\" rx=\"9\" fill=\"#d9770620\" stroke=\"#d97706\" stroke-width=\"1.6\"/><text x=\"330\" y=\"282\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#d97706\">seed : u64</text><line x1=\"330\" y1=\"262\" x2=\"330\" y2=\"244\" stroke=\"#d97706\" stroke-width=\"1.8\" marker-end=\"url(#lp-amber)\"/><rect x=\"110\" y=\"206\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#64748b20\" stroke=\"#64748b\" stroke-width=\"1.6\"/><text x=\"360\" y=\"223\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#64748b\">single-threaded driver</text><text x=\"360\" y=\"237\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">one thread steps the whole world, in order</text><rect x=\"110\" y=\"162\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"360\" y=\"179\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#16a34a\">paused Tokio runtimes</text><text x=\"360\" y=\"193\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">time advances only when we say so</text><rect x=\"110\" y=\"118\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#7c3aed20\" stroke=\"#7c3aed\" stroke-width=\"1.6\"/><text x=\"360\" y=\"135\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#7c3aed\">seeded PRNG</text><text x=\"360\" y=\"149\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">ChaCha8 + SHA-256 domain separation</text><rect x=\"110\" y=\"74\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#2563eb20\" stroke=\"#2563eb\" stroke-width=\"1.6\"/><text x=\"360\" y=\"91\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#2563eb\">OS interposition</text><text x=\"360\" y=\"105\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">clock_gettime / getrandom routed through the sim</text><rect x=\"110\" y=\"30\" width=\"500\" height=\"36\" rx=\"9\" fill=\"#db277720\" stroke=\"#db2777\" stroke-width=\"1.6\"/><text x=\"360\" y=\"47\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#db2777\">network substrate</text><text x=\"360\" y=\"61\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">fault patterns + history hash</text><line x1=\"95\" y1=\"244\" x2=\"95\" y2=\"40\" stroke=\"#16a34a\" stroke-width=\"1.8\" marker-end=\"url(#lp-green)\"/><text x=\"78\" y=\"150\" transform=\"rotate(-90 78 150)\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.65\">each layer strangles one more source of nondeterminism</text></svg>" };

module.exports["sim-first"] = { title: "Simulation first: the whole cluster in one process, time compressed", type: "svg", body: "<svg class=\"dgm-svg\" viewBox=\"0 0 720 250\" xmlns=\"http://www.w3.org/2000/svg\"><defs><marker id=\"m-green\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#16a34a\"/></marker><marker id=\"m-blue\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#2563eb\"/></marker><marker id=\"m-purple\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#7c3aed\"/></marker><marker id=\"m-amber\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#d97706\"/></marker><marker id=\"m-gray\" markerWidth=\"9\" markerHeight=\"7\" refX=\"7.5\" refY=\"3.5\" orient=\"auto\"><path d=\"M0,0 L9,3.5 L0,7 Z\" fill=\"#64748b\"/></marker></defs><rect x=\"20\" y=\"20\" width=\"470\" height=\"210\" rx=\"9\" fill=\"#2563eb20\" stroke=\"#2563eb\" stroke-width=\"1.6\"/><text x=\"36\" y=\"42\" font-size=\"13\" font-weight=\"700\" fill=\"#2563eb\">one OS process</text><rect x=\"40\" y=\"60\" width=\"110\" height=\"58\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"95\" y=\"80\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#16a34a\">n0</text><text x=\"95\" y=\"98\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">node task</text><rect x=\"165\" y=\"60\" width=\"110\" height=\"58\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"220\" y=\"80\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#16a34a\">n1</text><text x=\"220\" y=\"98\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">node task</text><rect x=\"290\" y=\"60\" width=\"110\" height=\"58\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"345\" y=\"80\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#16a34a\">n2</text><text x=\"345\" y=\"98\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.78\">node task</text><rect x=\"40\" y=\"134\" width=\"360\" height=\"40\" rx=\"9\" fill=\"#7c3aed20\" stroke=\"#7c3aed\" stroke-width=\"1.6\"/><text x=\"220\" y=\"159\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#7c3aed\">network backplane</text><line x1=\"95\" y1=\"118\" x2=\"105\" y2=\"132\" stroke=\"#7c3aed\" stroke-width=\"1.8\" marker-end=\"url(#m-purple)\"/><line x1=\"220\" y1=\"118\" x2=\"220\" y2=\"132\" stroke=\"#7c3aed\" stroke-width=\"1.8\" marker-end=\"url(#m-purple)\"/><line x1=\"345\" y1=\"118\" x2=\"335\" y2=\"132\" stroke=\"#7c3aed\" stroke-width=\"1.8\" marker-end=\"url(#m-purple)\"/><rect x=\"40\" y=\"186\" width=\"230\" height=\"34\" rx=\"9\" fill=\"#d9770620\" stroke=\"#d97706\" stroke-width=\"1.6\"/><text x=\"155\" y=\"208\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#d97706\">driver + clock</text><rect x=\"286\" y=\"186\" width=\"114\" height=\"34\" rx=\"9\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"343\" y=\"208\" text-anchor=\"middle\" font-size=\"12.5\" font-weight=\"700\" fill=\"#16a34a\">seed -&gt; RNG</text><line x1=\"220\" y1=\"174\" x2=\"170\" y2=\"184\" stroke=\"#d97706\" stroke-width=\"1.8\" marker-end=\"url(#m-amber)\"/><line x1=\"270\" y1=\"203\" x2=\"284\" y2=\"203\" stroke=\"#16a34a\" stroke-width=\"1.8\" marker-end=\"url(#m-green)\"/><text x=\"255\" y=\"50\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.6\">entire cluster, one driver</text><line x1=\"490\" y1=\"125\" x2=\"516\" y2=\"125\" stroke=\"#64748b\" stroke-width=\"1.8\" marker-end=\"url(#m-gray)\" stroke-dasharray=\"5,4\"/><text x=\"610\" y=\"42\" text-anchor=\"middle\" font-size=\"13\" font-weight=\"700\" fill=\"#64748b\">time compression</text><rect x=\"540\" y=\"60\" width=\"40\" height=\"150\" rx=\"6\" fill=\"none\" stroke=\"#64748b\" stroke-width=\"1.4\"/><rect x=\"540\" y=\"196\" width=\"40\" height=\"14\" rx=\"5\" fill=\"#64748b20\" stroke=\"#64748b\" stroke-width=\"1.4\"/><text x=\"560\" y=\"228\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.7\">wall clock</text><rect x=\"640\" y=\"60\" width=\"40\" height=\"150\" rx=\"6\" fill=\"none\" stroke=\"#16a34a\" stroke-width=\"1.4\"/><rect x=\"640\" y=\"66\" width=\"40\" height=\"144\" rx=\"5\" fill=\"#16a34a20\" stroke=\"#16a34a\" stroke-width=\"1.6\"/><text x=\"660\" y=\"228\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.7\">sim time</text><line x1=\"586\" y1=\"100\" x2=\"634\" y2=\"100\" stroke=\"#16a34a\" stroke-width=\"1.8\" marker-end=\"url(#m-green)\"/><text x=\"610\" y=\"92\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"currentColor\" opacity=\"0.65\">month -&gt; hour</text></svg>" };
