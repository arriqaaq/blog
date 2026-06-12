#!/usr/bin/env node
/* Multi-post Markdown builder for the blog.
 *
 * Authoring: one Markdown file per post in content/<slug>.md, with a `---` frontmatter block
 * (title, dek, eyebrow, slug, date, byline, draft) and a Markdown body. In the body:
 *   • prose is plain Markdown; Rust goes in ```rust fences;
 *   • reusable visuals are referenced by a token on its own line: [[WIDGET:name]] / [[SVG:name]]
 *     (widget JS in assets/js/dst/<name>.js + build/widgets.json; SVGs in build/diagrams-svg.js);
 *   • one-off visuals: paste raw <svg class="dgm-svg">…</svg> or <table class="cmp">… inline.
 *
 * Output: posts/<slug>.html for every post, regenerated widgets/<name>.html demo pages, and a
 * multi-post index.html. Run: node build/build.js   (or: npm run build)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { markedHighlight } = require('marked-highlight');
const hljs = require('highlight.js');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const POSTS_DIR = path.join(ROOT, 'posts');
const WIDGETS_DIR = path.join(ROOT, 'widgets');

const SVG = require(path.join(ROOT, 'build/diagrams-svg.js'));
const WIDGETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/widgets.json'), 'utf8'));

const SITE = (() => {
  const def = { title: 'Build logs', sub: 'Notes and build logs on distributed systems, written as living documents.' };
  try { return Object.assign(def, JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'site.json'), 'utf8'))); }
  catch { return def; }
})();

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- build-time syntax highlighting (highlight.js → token <span>s; no client JS) ----------
// Tagged fences (```rust, ```bash) are highlighted; untagged fences render as escaped plain text.
marked.use(markedHighlight({
  emptyLangClass: 'hljs',
  langPrefix: 'hljs language-',
  highlight(code, lang) {
    return (lang && hljs.getLanguage(lang))
      ? hljs.highlight(code, { language: lang }).value
      : esc(code);
  },
}));

// ---------- frontmatter (simple key: value; no YAML dependency) ----------
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    data[mm[1]] = v;
  }
  return { data, body: raw.slice(m[0].length) };
}

// ---------- heading ids: `## H {#slug}` -> <h2 id="slug">H</h2>, else slugify ----------
function addHeadingIds(html) {
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, lvl, inner) => {
    let id, text = inner.trim();
    const idm = text.match(/\s*\{#([A-Za-z0-9_-]+)\}\s*$/);
    if (idm) { id = idm[1]; text = text.slice(0, idm.index).trim(); }
    else { id = slugify(text); }
    return `<h${lvl} id="${id}">${text}</h${lvl}>`;
  });
}

// ---------- placeholder resolution: [[WIDGET:x]] / [[SVG:x]] -> figures ----------
function makeResolver(state) {
  function widgetMount(name) {
    const w = WIDGETS[name];
    if (!w) { state.warnings.push('unknown widget: ' + name); return `<div class="missing">[widget: ${name}]</div>`; }
    state.counts[name] = (state.counts[name] || 0) + 1;
    const id = `w-${name}-${state.counts[name]}`;
    state.usedWidgets.add(name); state.mounts.push({ name, id });
    return `\n<figure class="fig"><div class="dst-mount" id="${id}"></div>
  <figcaption>Interactive — step, play, scrub the seed. <a href="../widgets/${name}.html" target="_blank" rel="noopener">open standalone ↗</a></figcaption></figure>\n`;
  }
  function svgFig(name) {
    const d = SVG[name];
    if (!d) { state.warnings.push('unknown SVG diagram: ' + name); return `<div class="missing">[diagram: ${name}]</div>`; }
    state.usedSvgs.add(name);
    const body = d.type === 'html' ? `<div class="cmp-wrap">${d.body}</div>` : d.body;
    return `\n<figure class="fig fig-dgm">${body}<figcaption>${d.title}</figcaption></figure>\n`;
  }
  return (html) => html
    .replace(/<p>\s*(\[\[(?:WIDGET|SVG):[a-z0-9-]+\]\])\s*<\/p>/g, '$1')
    .replace(/\[\[WIDGET:([a-z0-9-]+)\]\]/g, (_, n) => widgetMount(n))
    .replace(/\[\[SVG:([a-z0-9-]+)\]\]/g, (_, n) => svgFig(n));
}

// ---------- split rendered body into <section class="sec"> at each <h2>, build TOC ----------
function buildArticle(bodyHtml, resolve) {
  const toc = [];
  const chunks = bodyHtml.split(/(?=<h2[ >])/);
  const sections = chunks.map((ch) => {
    if (!ch.trim()) return '';
    const hm = ch.match(/<h2[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/);
    if (hm) toc.push({ id: hm[1], heading: hm[2].replace(/<[^>]+>/g, '').trim() });
    return `<section class="sec">\n${resolve(ch)}\n</section>`;
  }).filter(Boolean).join('\n\n');
  return { sections, toc };
}

const countWords = (html) => html
  .replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<svg[\s\S]*?<\/svg>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;

// ---------- shared template chrome (identical look to the legacy build) ----------
const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">';
// Post pages: Geist (headings) + Source Serif 4 (body — open-source stand-in for Tiempos) + JetBrains Mono (code).
const POST_FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">';
const themeJs = `document.getElementById('theme').addEventListener('click',function(){var h=document.documentElement;h.setAttribute('data-mode',h.getAttribute('data-mode')==='dark'?'light':'dark');});`;

const POST_CSS = `
  :root{ color-scheme:light dark;
    --primary:#7c5cfc; --secondary:#c471f5; --grad:linear-gradient(135deg,#7c5cfc,#c471f5);
    --bg:#f6f4f9; --surface:#ffffff; --fg:#0a1320; --muted:#5b6478;
    --rule:rgba(18,14,45,.1); --shadow:rgba(124,92,252,.18);
    --code:rgba(124,92,252,.06); --quote:rgba(196,113,245,.07);
    --mesh-a:rgba(124,92,252,.13); --mesh-b:rgba(196,113,245,.1);
    --hl-kw:#7c3aed; --hl-fn:#2563eb; --hl-type:#0e7490; --hl-str:#0a7d4f; --hl-num:#b45309; --hl-com:#8b93a7; --hl-meta:#9333ea;
    /* swap --font-body to a licensed 'Tiempos Text' here if you ever buy a Klim web licence */
    --font-head:'Geist','Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    --font-body:'Source Serif 4',Georgia,Cambria,'Times New Roman',serif;
    --font-mono:'JetBrains Mono',ui-monospace,'SF Mono','Fira Code',monospace; }
  html[data-mode=dark]{ --bg:#0e0f16; --surface:#181a26; --fg:#ecedf5; --muted:#9aa3b6;
    --rule:rgba(255,255,255,.1); --shadow:rgba(124,92,252,.32);
    --code:rgba(167,139,250,.12); --quote:rgba(196,113,245,.1);
    --mesh-a:rgba(124,92,252,.17); --mesh-b:rgba(196,113,245,.12);
    --hl-kw:#c4a7ff; --hl-fn:#82aaff; --hl-type:#56d4dd; --hl-str:#7ee787; --hl-num:#ffb86c; --hl-com:#6b7686; --hl-meta:#d6a3ff; }
  *{ box-sizing:border-box; }
  html,body{ background:var(--bg); color:var(--fg); margin:0; }
  body{ font-family:var(--font-body); line-height:1.72; -webkit-font-smoothing:antialiased;
    background:
      radial-gradient(48rem 40rem at 50% -14rem,var(--mesh-a),transparent 70%),
      radial-gradient(34rem 30rem at 112% -6rem,var(--mesh-b),transparent 66%),
      var(--bg);
    background-attachment:fixed; }
  .wrap{ max-width:720px; margin:0 auto; padding:0 1.15rem 6rem; }
  header.post{ max-width:720px; margin:0 auto; padding:3.2rem 1.15rem 1.4rem; }
  .eyebrow{ font:600 .72rem/1 var(--font-mono); letter-spacing:.16em; text-transform:uppercase; margin-bottom:1rem;
    background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent; width:fit-content; }
  h1{ font-family:var(--font-head); font-size:clamp(2.1rem,5vw,2.9rem); font-weight:700; line-height:1.08; letter-spacing:-.025em;
    margin:0 0 .7rem; width:fit-content; max-width:100%;
    background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .dek{ font-size:1.24rem; color:var(--muted); margin:0 0 1.2rem; font-style:italic; }
  .byline{ font-family:var(--font-head); font-size:.82rem; color:var(--muted); border-top:1px solid var(--rule); padding-top:1rem; }
  .toc{ max-width:720px; margin:1.6rem auto 0; padding:1.1rem 1.25rem; border:1px solid var(--rule); border-radius:14px;
    background:var(--surface); box-shadow:0 1px 2px rgba(10,12,30,.04); }
  .toc h2{ font-family:var(--font-head); font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.16em; color:var(--muted); margin:.1rem 0 .8rem; border:0; padding:0; }
  .toc ol{ list-style:none; margin:0; padding:0; }
  .toc li{ break-inside:avoid; margin:.28rem 0; font-family:var(--font-head); font-size:.94rem; }
  .toc-n{ font:600 .76rem var(--font-mono); margin-right:.55rem;
    background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .toc a{ color:var(--fg); text-decoration:none; } .toc a:hover{ color:var(--primary); }
  article{ font-size:1.12rem; }
  h2{ font-family:var(--font-head); font-size:1.65rem; font-weight:700; line-height:1.18; margin:3rem 0 1rem; letter-spacing:-.015em; border-top:1px solid var(--rule); padding-top:2.2rem; }
  .sec:first-of-type h2{ border-top:0; padding-top:.4rem; margin-top:.6rem; }
  h3{ font-family:var(--font-head); font-size:1.2rem; font-weight:600; margin:2rem 0 .6rem; }
  p{ margin:0 0 1.1rem; } strong{ font-weight:600; }
  a{ color:var(--primary); text-decoration:none; }
  a:hover{ color:var(--secondary); }
  article p a,article li a{ border-bottom:1px solid rgba(124,92,252,.32); }
  article p a:hover,article li a:hover{ color:var(--primary); border-bottom-color:var(--primary); }
  code{ font-family:var(--font-mono); font-size:.85em; background:var(--code); padding:.12rem .36rem; border-radius:5px; }
  pre{ font-family:var(--font-mono); background:var(--surface); border:1px solid var(--rule); border-radius:12px; padding:1rem 1.15rem; overflow:auto; font-size:.85rem; line-height:1.55; box-shadow:0 1px 2px rgba(10,12,30,.04); }
  pre code{ background:none; padding:0; }
  .hljs-keyword{ color:var(--hl-kw); font-weight:600; }
  .hljs-title,.hljs-title.function_,.hljs-section{ color:var(--hl-fn); }
  .hljs-built_in,.hljs-type,.hljs-title.class_,.hljs-class .hljs-title{ color:var(--hl-type); }
  .hljs-string,.hljs-symbol,.hljs-char.escape_,.hljs-regexp,.hljs-bullet{ color:var(--hl-str); }
  .hljs-number,.hljs-literal{ color:var(--hl-num); }
  .hljs-comment,.hljs-quote{ color:var(--hl-com); font-style:italic; }
  .hljs-meta,.hljs-attr,.hljs-attribute,.hljs-name,.hljs-tag{ color:var(--hl-meta); }
  .hljs-operator,.hljs-punctuation{ color:var(--muted); }
  .hljs-variable,.hljs-property,.hljs-params{ color:var(--fg); }
  .hljs-deletion{ color:#dc2626; } .hljs-addition{ color:var(--hl-str); }
  .hljs-emphasis{ font-style:italic; } .hljs-strong{ font-weight:700; }
  blockquote{ margin:1.5rem 0; padding:.95rem 1.25rem; background:var(--quote); border-left:3px solid var(--primary); border-radius:0 10px 10px 0; font-style:italic; }
  ul,ol{ margin:0 0 1.1rem; padding-left:1.35rem; } li{ margin:.35rem 0; }
  .fig{ margin:1.9rem 0; }
  .fig-dgm{ border:1px solid var(--rule); border-radius:14px; padding:1.1rem; background:var(--surface); box-shadow:0 1px 2px rgba(10,12,30,.04); }
  .dgm-svg{ display:block; width:100%; height:auto; }
  .fig svg text{ font-family:var(--font-head); }
  .fig figcaption{ font-family:var(--font-head); font-size:.8rem; color:var(--muted); text-align:center; margin-top:.6rem; }
  .fig figcaption a{ border:0; }
  table.cmp{ border-collapse:collapse; width:100%; font-family:var(--font-head); font-size:.85rem; }
  table.cmp th,table.cmp td{ border:1px solid var(--rule); padding:.5rem .65rem; text-align:left; vertical-align:top; }
  table.cmp th{ background:var(--code); font-weight:600; } .cmp-wrap{ overflow-x:auto; }
  .missing{ color:#dc2626; font:600 .85rem var(--font-mono); text-align:center; padding:1rem; border:1px dashed #dc2626; border-radius:8px; }
  .topbar{ position:sticky; top:0; z-index:5; backdrop-filter:blur(10px); background:color-mix(in srgb,var(--bg) 82%,transparent); border-bottom:1px solid var(--rule); }
  .topbar .in{ max-width:720px; margin:0 auto; padding:.55rem 1.15rem; display:flex; justify-content:space-between; align-items:center; gap:1rem; font-family:var(--font-head); font-size:.82rem; }
  .topbar a{ color:var(--muted); text-decoration:none; } .topbar a:hover{ color:var(--fg); }
  .topbar span{ color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .topbar button{ font:inherit; cursor:pointer; background:var(--surface); border:1px solid var(--rule); color:var(--muted); border-radius:999px; padding:.28rem .7rem; transition:border-color .2s,color .2s; }
  .topbar button:hover{ border-color:var(--primary); color:var(--fg); }`;

// ---------- render one post ----------
function renderPost(srcFile) {
  const raw = fs.readFileSync(srcFile, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  const slug = data.slug || path.basename(srcFile, '.md');
  if (data.draft === 'true' || data.draft === true) return null;
  if (!data.title) throw new Error(`${path.basename(srcFile)}: frontmatter is missing a required "title:"`);

  const state = { usedWidgets: new Set(), usedSvgs: new Set(), mounts: [], counts: {}, warnings: [] };
  const resolve = makeResolver(state);

  const html = addHeadingIds(marked.parse(body));
  const { sections, toc } = buildArticle(html, resolve);

  const words = countWords(sections);
  const tocHtml = toc.map((t, i) => `<li><span class="toc-n">${String(i + 1).padStart(2, '0')}</span><a href="#${t.id}">${esc(t.heading)}</a></li>`).join('\n');
  const scripts = [...state.usedWidgets].sort().map((n) => `<script src="../assets/js/dst/${n}.js"></script>`).join('\n');
  const inits = state.mounts.map((m) => `    try { if(window.${WIDGETS[m.name].g}) ${WIDGETS[m.name].g}.init('${m.id}'); } catch (e) { console.error('${m.name} (${m.id}) failed:', e); }`).join('\n');

  const eyebrow = data.eyebrow ? `<div class="eyebrow">${esc(data.eyebrow)}</div>` : '';
  const dek = data.dek ? `<p class="dek">${esc(data.dek)}</p>` : '';
  const byline = `${data.byline ? esc(data.byline) + ' ' : ''}~${words.toLocaleString()} words · ${state.mounts.length} interactive widgets · ${state.usedSvgs.size} diagrams`;

  const post = `<!doctype html>
<html lang="en" data-mode="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.dek || data.title)}">
${POST_FONT}
<style>${POST_CSS}</style></head>
<body>
<div class="topbar"><div class="in"><a href="../index.html">← all posts</a><span>${esc(data.title)}</span><button id="theme">light / dark</button></div></div>
<header class="post">
  ${eyebrow}
  <h1>${esc(data.title)}</h1>
  ${dek}
  <p class="byline">${byline}</p>
</header>
<nav class="toc"><h2>Contents</h2><ol>
${tocHtml}
</ol></nav>
<div class="wrap"><article>
${sections}
</article></div>
<script src="../assets/vendor/anime.min.js"></script>
<script src="../assets/js/dst/dst-kit.js"></script>
${scripts}
<script>
  document.addEventListener('DOMContentLoaded', function () {
${inits}
  });
  ${themeJs}
</script>
</body></html>`;

  fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(POSTS_DIR, slug + '.html'), post);

  const leftovers = sections.match(/\[\[[^\]]+\]\]/g) || [];
  return { slug, title: data.title, dek: data.dek || '', eyebrow: data.eyebrow || '',
    date: data.date || '', order: data.order ? Number(data.order) : 0,
    words, mounts: state.mounts.length, diagrams: state.usedSvgs.size,
    warnings: state.warnings, leftovers };
}

// ---------- regenerate widget demo pages (identical to legacy) ----------
function writeWidgetDemos() {
  fs.mkdirSync(WIDGETS_DIR, { recursive: true });
  for (const [name, w] of Object.entries(WIDGETS)) {
    fs.writeFileSync(path.join(WIDGETS_DIR, name + '.html'), `<!doctype html>
<html lang="en" data-mode="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DST · ${w.t}</title>${FONT}<style>
  :root{color-scheme:light dark}html[data-mode=dark]{background:#14151a;color:#e6e8ec}html[data-mode=light]{background:#fbfbfc;color:#1f2430}
  body{font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;max-width:900px;margin:2.4rem auto;padding:0 1rem;line-height:1.6}
  h1{font-size:1.5rem;margin:0 0 .15rem}.sub{opacity:.65;margin:0 0 1.1rem}.tb{margin-bottom:1rem;display:flex;gap:.5rem}
  .tb a,.tb button{font:inherit;cursor:pointer;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;border-radius:7px;padding:.35rem .7rem;text-decoration:none}</style></head>
<body><h1>${w.t}</h1><p class="sub">${w.s}</p>
<div class="tb"><a href="../index.html">← all widgets</a><button id="theme">light / dark</button></div>
<div id="dst-w"></div>
<script src="../assets/vendor/anime.min.js"></script><script src="../assets/js/dst/dst-kit.js"></script><script src="../assets/js/dst/${name}.js"></script>
<script>(function(){function go(){if(window.${w.g})${w.g}.init('dst-w');}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();${themeJs}})();</script>
</body></html>`);
  }
}

// ---------- multi-post index ----------
function writeIndex(posts) {
  const sorted = posts.slice().sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || (a.order - b.order) || a.title.localeCompare(b.title));
  const cards = sorted.map((p) => `    <li><a class="post" href="posts/${p.slug}.html">
      ${p.eyebrow ? `<div class="pe">${esc(p.eyebrow)}</div>` : ''}<b>${esc(p.title)} →</b>
      ${p.dek ? `<div class="d">${esc(p.dek)}</div>` : ''}
      <div class="m">~${p.words.toLocaleString()} words · ${p.mounts} interactive widgets · ${p.diagrams} diagrams</div></a></li>`).join('\n');
  const aboutHtml = (SITE.role || SITE.github) ? `<h2>About</h2>
<p class="about">${SITE.role ? esc(SITE.role) + '. ' : ''}${SITE.github ? `Find me on <a href="${esc(SITE.github)}" target="_blank" rel="noopener">GitHub ↗</a>.` : ''}</p>
` : '';

  fs.writeFileSync(path.join(ROOT, 'index.html'), `<!doctype html>
<html lang="en" data-mode="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(SITE.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet"><style>
  *{box-sizing:border-box}
  :root{ color-scheme:light dark;
    --primary:#7c5cfc; --secondary:#c471f5; --grad:linear-gradient(135deg,#7c5cfc,#c471f5);
    --canvas:#f6f4f9; --surface:#ffffff; --ink:#0a1320; --muted:#5b6478;
    --rule:rgba(18,14,45,.1); --shadow:rgba(124,92,252,.18);
    --mesh-a:rgba(124,92,252,.16); --mesh-b:rgba(196,113,245,.12); }
  html[data-mode=dark]{ --canvas:#0e0f16; --surface:#181a26; --ink:#ecedf5; --muted:#9aa3b6;
    --rule:rgba(255,255,255,.1); --shadow:rgba(124,92,252,.34);
    --mesh-a:rgba(124,92,252,.2); --mesh-b:rgba(196,113,245,.14); }
  html,body{margin:0}
  body{ font-family:'Geist','Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    color:var(--ink); line-height:1.65; min-height:100vh; -webkit-font-smoothing:antialiased;
    background:
      radial-gradient(42rem 36rem at -6rem -10rem,var(--mesh-a),transparent 70%),
      radial-gradient(34rem 30rem at 108% 2rem,var(--mesh-b),transparent 66%),
      var(--canvas);
    background-attachment:fixed; }
  .wrap{ position:relative; max-width:760px; margin:0 auto; padding:3.6rem 1.3rem 6rem; }
  .hero{ margin-bottom:1rem; }
  h1{ font-size:clamp(2.4rem,6vw,3.1rem); font-weight:700; letter-spacing:-.035em; line-height:1.04;
    margin:0 0 .55rem; width:fit-content; max-width:100%;
    background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .sub{ font-size:1.1rem; color:var(--muted); margin:0; max-width:36rem; }
  h2{ font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.18em; color:var(--muted); margin:2.8rem 0 1.1rem; }
  ul{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.85rem; }
  li{ margin:0; }
  a.post{ display:block; position:relative; overflow:hidden; text-decoration:none; color:inherit;
    background:var(--surface); border:1px solid var(--rule); border-radius:16px; padding:1.2rem 1.35rem;
    box-shadow:0 1px 2px rgba(10,12,30,.05);
    transition:transform .16s ease, box-shadow .28s ease, border-color .28s ease; }
  a.post::before{ content:""; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
    background:linear-gradient(115deg,rgba(255,255,255,.07),transparent 44%); }
  a.post::after{ content:""; position:absolute; left:0; top:0; bottom:0; width:3px;
    background:var(--grad); opacity:0; transition:opacity .28s ease; }
  a.post:hover{ transform:translateY(-2px); border-color:transparent; box-shadow:0 14px 34px var(--shadow); }
  a.post:hover::after{ opacity:1; }
  .post b{ display:block; font-size:1.22rem; font-weight:600; letter-spacing:-.012em; margin:.1rem 0; }
  .pe{ display:inline-block; font:600 .66rem/1 ui-monospace,monospace; letter-spacing:.16em; text-transform:uppercase;
    margin-bottom:.5rem; background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .d{ font-size:.95rem; color:var(--muted); margin-top:.35rem; font-weight:400; }
  .m{ font-size:.76rem; color:var(--muted); opacity:.78; margin-top:.6rem; font-family:ui-monospace,monospace; }
  p.about{ font-size:.98rem; color:var(--muted); max-width:36rem; }
  a{ color:var(--primary); font-weight:600; text-decoration:none; }
  a:not(.post):hover{ text-decoration:underline; }
  button#theme{ position:absolute; top:1.5rem; right:1.3rem; font:inherit; font-size:.78rem; cursor:pointer;
    color:var(--muted); background:var(--surface); border:1px solid var(--rule); border-radius:999px; padding:.34rem .8rem;
    transition:border-color .2s ease, color .2s ease, box-shadow .2s ease; }
  button#theme:hover{ border-color:var(--primary); color:var(--ink); box-shadow:0 4px 14px var(--shadow); }</style></head>
<body>
<main class="wrap">
  <button id="theme">light / dark</button>
  <header class="hero">
    <h1>${esc(SITE.title)}</h1>
    <p class="sub">${esc(SITE.sub)}</p>
  </header>
  <h2>Posts</h2>
  <ul>
${cards}
  </ul>
  ${aboutHtml}</main>
<script>${themeJs}</script>
</body></html>`);
}

// ---------- main ----------
function main() {
  if (!fs.existsSync(CONTENT_DIR)) { console.error('No content/ directory — create content/<slug>.md first.'); process.exit(1); }
  // Posts are content/<slug>.md. Skip README.md and _-prefixed files (notes/scratch, not posts).
  const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md' && !f.startsWith('_')).sort();
  if (!files.length) { console.error('No content/*.md posts found.'); process.exit(1); }

  const posts = [];
  let warnings = [], leftovers = [];
  for (const f of files) {
    const r = renderPost(path.join(CONTENT_DIR, f));
    if (!r) { console.log('· skipped draft:', f); continue; }
    posts.push(r);
    warnings = warnings.concat(r.warnings.map((w) => `${r.slug}: ${w}`));
    leftovers = leftovers.concat(r.leftovers.map((l) => `${r.slug}: ${l}`));
    console.log(`✓ ${r.slug} — ~${r.words} words · ${r.mounts} widgets · ${r.diagrams} diagrams`);
  }

  writeWidgetDemos();
  writeIndex(posts);

  console.log('---');
  console.log(`posts: ${posts.length} · widget demo pages: ${Object.keys(WIDGETS).length} · svg diagrams: ${Object.keys(SVG).length}`);
  console.log('leftover placeholders:', leftovers.length ? leftovers.join(', ') : 'none');
  console.log(warnings.length ? 'WARNINGS:\n - ' + warnings.join('\n - ') : 'warnings: none');
  if (warnings.length || leftovers.length) process.exit(1);
}

main();
