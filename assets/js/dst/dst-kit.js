/**
 * dst-kit — shared design system for the DST blog animations.
 *
 * Replicates the aalhour.github.io animation idiom (lsm-tree / skiplist / fsync):
 *   • one global stylesheet of .dstk-* chrome (Space Grotesk, colored toolbar, bordered SVG
 *     stage, stat cards, color-coded activity log) — injected once;
 *   • an SVG <defs> factory: per-zone gradient fills, a glow filter, arrow markers;
 *   • a theme-aware zone palette (green=driver/SUT, blue=network, purple=runtime/kernel,
 *     amber=time/holds, red=faults/drops);
 *   • helpers: el(), delay(), rng() (mulberry32), addLog(), lock(), and a Rust syntax
 *     highlighter for inline code snippets.
 *
 * Every widget builds its own bespoke scene but draws with these primitives, so the whole post
 * shares one polished, consistent look. Exposes window.DSTKit.
 */
(function () {
  'use strict';
  const SVGNS = 'http://www.w3.org/2000/svg';

  const isDark = () => {
    const m = document.documentElement.getAttribute('data-mode');
    if (m) return m === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  };

  // Concrete colors for SVG (attributes can't read CSS vars). Widgets recompute on theme change.
  // Neon accent lives in FILLS (see defs() — the 'purple'/accent zone paints as a solid neon fill).
  // As a stroke/text value the accent must read on the cream page, so c.purple = ink. Other zones
  // keep their hue for strokes/text (legible on cream).
  const NEON = '#d9f400';
  const INK = '#1a1a1a';
  const ZONES_LIGHT = { green: '#16a34a', blue: '#2563eb', purple: INK, amber: '#e0850f',
    red: '#dc2626', pink: '#db2777', gray: '#64748b' };

  function palette() {
    const z = ZONES_LIGHT;
    return Object.assign({}, z, {
      dark: false,
      text: INK,
      muted: '#5f6152',
      stage: 'rgba(26,26,26,0.02)',
      separator: 'rgba(26,26,26,0.12)',
      accent: INK,
      // syntax colors for code snippets (cream-legible; no muddy green/purple)
      codeKw: '#c2410c', codeStr: '#a16207', codeNum: '#2563eb', codeCom: '#8b8d7a',
    });
  }

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // SVG <defs>: gradient per zone color + glow filter + an arrow marker per zone. `uid` namespaces
  // ids so multiple widgets on one page don't collide.
  function defs(colors, uid) {
    const grads = Object.keys(ZONES_LIGHT).map((name) => {
      const c = colors[name];
      // The accent zone ('purple') paints as a solid neon fill (with ink stroke/text); the
      // others keep a soft translucent tint of their own hue.
      const neon = name === 'purple';
      const hue = neon ? NEON : c;
      const o1 = neon ? 0.96 : 0.20, o2 = neon ? 0.82 : 0.05;
      return `<linearGradient id="${uid}-g-${name}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${hue}" stop-opacity="${o1}"/>
        <stop offset="100%" stop-color="${hue}" stop-opacity="${o2}"/></linearGradient>
      <marker id="${uid}-arr-${name}" markerWidth="9" markerHeight="7" refX="7.5" refY="3.5" orient="auto">
        <path d="M0,0 L9,3.5 L0,7 Z" fill="${c}"/></marker>`;
    }).join('');
    return `<defs>${grads}
      <filter id="${uid}-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.2" result="b"/><feMerge>
        <feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  }
  const grad = (uid, name) => `url(#${uid}-g-${name})`;
  const glow = (uid) => `url(#${uid}-glow)`;
  const arrow = (uid, name) => `url(#${uid}-arr-${name})`;

  // The one global stylesheet (injected once). Theme via [data-mode] on <html>.
  function ensureStyle() {
    if (document.getElementById('dstk-style')) return;
    const s = document.createElement('style');
    s.id = 'dstk-style';
    s.textContent = `
    .dstk{ --fg:#1a1a1a; --muted:#5f6152; --bd:#e0ded3; --sep:rgba(26,26,26,.12);
      --stage:rgba(26,26,26,.02); --chip:rgba(26,26,26,.035); --accent:#1a1a1a; --code:rgba(26,26,26,.05);
      font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif; color:var(--fg);
      border:1px solid var(--bd); border-radius:12px; padding:1rem 1.05rem 1.05rem; max-width:100%;
      background:#f8f8f5; }
    html[data-mode=dark] .dstk{ --fg:#e8eaed; --muted:#9ca3af; --bd:rgba(255,255,255,.12);
      --sep:rgba(255,255,255,.14); --stage:rgba(0,0,0,.28); --chip:rgba(255,255,255,.05);
      --accent:#a78bfa; --code:rgba(0,0,0,.38); }
    .dstk-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:.55rem; }
    .dstk-title{ font-size:1.02rem; font-weight:700; }
    .dstk-sub{ font-size:.72rem; color:var(--muted); }
    .dstk-toolbar{ display:flex; flex-wrap:wrap; gap:.45rem; align-items:center; padding:.5rem;
      background:var(--chip); border-radius:7px; margin-bottom:.6rem; }
    .dstk-tgroup{ display:flex; gap:.3rem; align-items:center; }
    .dstk-tlabel{ font-size:.62rem; font-weight:600; color:var(--muted); text-transform:uppercase;
      letter-spacing:.05em; margin-right:.15rem; }
    .dstk-tdiv{ width:1px; height:22px; background:var(--sep); margin:0 .25rem; }
    .dstk-sp{ flex:1 1 auto; }
    .dstk-toolbar input,.dstk-toolbar select{ font:inherit; font-size:.75rem; color:var(--fg);
      background:transparent; border:1px solid var(--sep); border-radius:5px; padding:.3rem .4rem; width:4.2rem; }
    .dstk-toolbar input:focus,.dstk-toolbar select:focus{ outline:none; border-color:var(--accent); }
    .dstk-btn{ font:inherit; font-size:.72rem; font-weight:600; cursor:pointer; border:none;
      border-radius:5px; padding:.36rem .62rem; color:#fff; transition:filter .15s,opacity .15s; line-height:1; }
    .dstk-btn:hover:not(:disabled){ filter:brightness(1.12); }
    .dstk-btn:disabled{ opacity:.38; cursor:not-allowed; }
    .dstk-btn--green{ background:#16a34a; } .dstk-btn--blue{ background:#2563eb; }
    .dstk-btn--purple{ background:#d9f400; color:#1a1a1a; } .dstk-btn--amber{ background:#e0850f; }
    .dstk-btn--red{ background:#dc2626; } .dstk-btn--pink{ background:#db2777; }
    .dstk-btn--ghost{ background:transparent; color:var(--fg); border:1px solid var(--sep); }
    html[data-mode=dark] .dstk-btn--green{ background:#15803d; } html[data-mode=dark] .dstk-btn--blue{ background:#1d4ed8; }
    .dstk-stage{ background:var(--stage); border:1px solid var(--sep); border-radius:8px; overflow:hidden; }
    .dstk-svg{ display:block; width:100%; height:auto; }
    .dstk-foot{ display:flex; gap:.5rem; margin-top:.6rem; align-items:stretch; }
    .dstk-stats{ display:grid; grid-auto-flow:column; gap:.35rem; }
    .dstk-stat{ background:var(--chip); border:1px solid var(--sep); border-radius:6px;
      padding:.3rem .55rem; text-align:center; min-width:62px; }
    .dstk-stat-v{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:.95rem; font-weight:700; font-variant-numeric:tabular-nums; }
    .dstk-stat-l{ font-size:.56rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
    /* min-width:0 lets this flex item shrink below its content width, which is what makes the
       rows' text-overflow:ellipsis engage instead of widening the page. */
    .dstk-log{ flex:1; min-width:0; background:var(--chip); border:1px solid var(--sep); border-radius:6px; padding:.4rem .55rem; min-height:62px; }
    .dstk-log-title{ font-size:.58rem; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:.2rem; }
    .dstk-log-body{ font-size:.72rem; line-height:1.5; }
    .dstk-log-row{ color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .dstk-log-row:last-child{ color:var(--fg); }
    .dstk-log-row.ok{ color:#16a34a; } .dstk-log-row.warn{ color:#c2410c; } .dstk-log-row.err{ color:#dc2626; }
    .dstk-log-row.hl{ color:var(--accent); }
    .dstk-code{ font-family:'JetBrains Mono',ui-monospace,'SF Mono','Fira Code',monospace; font-size:.74rem; line-height:1.55;
      background:var(--code); border:1px solid var(--sep); border-radius:6px; padding:.5rem .65rem; margin:0; overflow:auto; }
    .dstk-code .k{ color:#c2410c; } .dstk-code .s{ color:#a16207; } .dstk-code .n{ color:#2563eb; } .dstk-code .c{ color:#8b8d7a; }
    html[data-mode=dark] .dstk-code .k{ color:#c084fc; } html[data-mode=dark] .dstk-code .s{ color:#fbbf24; }
    html[data-mode=dark] .dstk-code .n{ color:#60a5fa; } html[data-mode=dark] .dstk-code .c{ color:#6b7280; }
    .dstk-cap{ font-size:.72rem; color:var(--muted); margin-top:.45rem; }
    @media (max-width:640px){ .dstk-toolbar{ flex-direction:column; align-items:flex-start; } .dstk-foot{ flex-direction:column; } }`;
    document.head.appendChild(s);
  }

  // Minimal Rust highlighter → HTML for a <pre class="dstk-code">.
  const RUST_KW = new Set(('let mut fn pub async await struct impl for in if else match loop while ' +
    'self Self use mod return move dyn ref as where const static unsafe trait enum type true false').split(' '));
  function highlightRust(src) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const out = src.split('\n').map((line) => {
      // comments
      const ci = line.indexOf('//');
      let code = ci >= 0 ? line.slice(0, ci) : line;
      const com = ci >= 0 ? line.slice(ci) : '';
      // strings
      code = esc(code).replace(/(&quot;|").*?(\1)/g, (m) => `<span class="s">${m}</span>`)
        .replace(/"([^"]*)"/g, '<span class="s">"$1"</span>');
      // numbers + identifiers/keywords (operate on already-escaped text, token by token)
      code = code.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (w) =>
        RUST_KW.has(w) ? `<span class="k">${w}</span>` : w)
        .replace(/\b(\d[\d_]*)\b/g, '<span class="n">$1</span>');
      return code + (com ? `<span class="c">${esc(com)}</span>` : '');
    }).join('\n');
    return `<pre class="dstk-code">${out}</pre>`;
  }

  // Build the full container HTML. opts: { title, sub?, controls(html), viewBox, uid, stats?[{id,label}], log? }
  function container(opts) {
    ensureStyle();
    const colors = palette();
    const stats = (opts.stats || []).map((s) =>
      `<div class="dstk-stat"><div class="dstk-stat-v" id="${opts.uid}-stat-${s.id}">0</div><div class="dstk-stat-l">${s.label}</div></div>`).join('');
    const foot = (opts.stats || opts.log)
      ? `<div class="dstk-foot">${stats ? `<div class="dstk-stats">${stats}</div>` : ''}${opts.log !== false ? `<div class="dstk-log"><div class="dstk-log-title">activity</div><div class="dstk-log-body"></div></div>` : ''}</div>`
      : '';
    return `<div class="dstk">
      <div class="dstk-head"><span class="dstk-title">${opts.title || ''}</span><span class="dstk-sub">${opts.sub || ''}</span></div>
      <div class="dstk-toolbar">${opts.controls || ''}</div>
      <div class="dstk-stage"><svg class="dstk-svg" viewBox="${opts.viewBox}" role="img" aria-label="${opts.title || ''}">${defs(colors, opts.uid)}<g class="static"></g><g class="content"></g><g class="anim"></g></svg></div>
      ${foot}${opts.cap ? `<div class="dstk-cap">${opts.cap}</div>` : ''}</div>`;
  }

  function addLog(bodyEl, msg, cls, cap) {
    if (!bodyEl) return;
    const d = document.createElement('div');
    d.className = 'dstk-log-row' + (cls ? ' ' + cls : '');
    d.textContent = msg;
    bodyEl.appendChild(d);
    while (bodyEl.children.length > (cap || 3)) bodyEl.removeChild(bodyEl.firstChild);
  }
  function lock(root, selectors, b) { selectors.forEach((s) => { const e = root.querySelector(s); if (e) e.disabled = b; }); }

  window.DSTKit = { palette, el, delay, rng, defs, grad, glow, arrow, ensureStyle, container, addLog, lock, highlightRust };
})();
