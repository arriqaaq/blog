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
const hljs = require('highlight.js');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const POSTS_DIR = path.join(ROOT, 'posts');
const WIDGETS_DIR = path.join(ROOT, 'widgets');
const OG_DIR = path.join(ROOT, 'assets', 'og');

const SVG = require(path.join(ROOT, 'build/diagrams-svg.js'));
const WIDGETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/widgets.json'), 'utf8'));
const { renderOgCard } = require('./og-image.js');

const SITE = (() => {
  const def = { title: 'Build logs', sub: 'Notes and build logs on distributed systems, written as living documents.' };
  try { return Object.assign(def, JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, 'site.json'), 'utf8'))); }
  catch { return def; }
})();
// Absolute base URL for canonical / og:* links (og:image must be absolute for LinkedIn etc.).
const SITE_URL = String(SITE.url || '').replace(/\/+$/, '');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- social preview: pick the diagram for a post's card, and build og/twitter meta ----------
const isSvgDiagram = (n) => SVG[n] && SVG[n].type !== 'html';
// Explicit `ogImage:` frontmatter wins; otherwise a slug-seeded pick from the post's own svg
// diagrams — deterministic so the preview is stable across builds (no needless re-scrapes).
function pickOgDiagram(slug, data, usedSvgs) {
  if (data.ogImage && isSvgDiagram(data.ogImage)) return data.ogImage;
  const pool = [...usedSvgs].filter(isSvgDiagram).sort();
  if (!pool.length) return null;
  let seed = 7;
  for (const ch of slug) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[seed % pool.length];
}
function ogMeta({ type, title, description, url, image, siteName }) {
  const t = [`<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="${type}">`];
  if (siteName) t.push(`<meta property="og:site_name" content="${esc(siteName)}">`);
  t.push(`<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`);
  if (image) t.push(`<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(title)}">`);
  t.push(`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`);
  if (image) t.push(`<meta name="twitter:image" content="${esc(image)}">`);
  return t.join('\n');
}

// ---------- syntax highlighting: ```lang fences -> hljs token spans at build time ----------
// Highlighting happens here, in Node, so pages ship zero JS for it (no flash, no CDN). The
// emitted `hljs-*` spans are coloured by the theme in POST_CSS; unknown langs degrade to plain.
marked.use({
  renderer: {
    code(code, infostring) {
      const lang = (infostring || '').trim().split(/\s+/)[0];
      const known = lang && hljs.getLanguage(lang);
      const body = known ? hljs.highlight(code, { language: lang }).value : esc(code);
      const cls = 'hljs' + (lang ? ' language-' + lang : '');
      return `<pre><code class="${cls}">${body}</code></pre>\n`;
    },
  },
});

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
    const cls = d.type === 'html' ? 'fig fig-cmp' : 'fig fig-dgm';
    return `\n<figure class="${cls}">${body}<figcaption>${d.title}</figcaption></figure>\n`;
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
const FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&family=JetBrains+Mono:wght@100..800&display=swap" rel="stylesheet">';

const POST_CSS = `
  :root{ color-scheme:light; --fg:#1a1a1a; --bg:#f2f1eb; --alt:#f8f8f5; --muted:#5f6152; --rule:#e0ded3;
    --neon:#d9f400; --neon-dim:#c2db00; --warm:#ffa440; --olive:#657220; --accent:#657220;
    --code:rgba(26,26,26,.05); --quote:rgba(101,114,32,.09);
    --hl-comment:#8b8d7a; --hl-keyword:#4d7c0f; --hl-type:#b45309; --hl-fn:#2563eb;
    --hl-str:#a16207; --hl-num:#c2410c; --hl-meta:#0e7490; --hl-builtin:#0891b2; }
  *{ box-sizing:border-box; }
  html,body{ background:var(--bg); color:var(--fg); margin:0; }
  body{ font-family:'Inter',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; line-height:1.68;
    -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; font-feature-settings:'cv11','ss01'; }
  ::selection{ background:var(--neon); color:var(--fg); }
  .wrap{ max-width:1000px; margin:0 auto; padding:0 1.2rem 6rem; }
  header.post{ position:relative; max-width:740px; margin:0 auto; padding:3.4rem 1.1rem 1.4rem; overflow:hidden; }
  header.post::before{ content:''; position:absolute; inset:-45% -12% auto -12%; height:360px; z-index:0; pointer-events:none;
    background:radial-gradient(520px 300px at 78% 18%,rgba(217,244,0,.30),transparent 62%),radial-gradient(460px 300px at 10% 72%,rgba(255,164,64,.16),transparent 60%);
    filter:blur(38px); }
  header.post>*{ position:relative; z-index:1; }
  .eyebrow{ font-family:'JetBrains Mono',ui-monospace,monospace; font-weight:600; font-size:.72rem; line-height:1;
    letter-spacing:.14em; text-transform:uppercase; color:var(--olive); margin-bottom:1rem;
    display:inline-flex; align-items:center; gap:.6rem; }
  .eyebrow::before{ content:''; width:8px; height:8px; border-radius:50%; background:var(--neon);
    box-shadow:0 0 0 4px rgba(217,244,0,.2); animation:dotpulse 2.4s ease-in-out infinite; }
  @keyframes dotpulse{ 0%,100%{ box-shadow:0 0 0 4px rgba(217,244,0,.2); } 50%{ box-shadow:0 0 0 8px rgba(217,244,0,.04); } }
  h1{ font-family:'Inter',system-ui,sans-serif; font-weight:800; font-size:2.7rem; line-height:1.04; margin:0 0 .7rem; letter-spacing:-.03em; }
  .dek{ font-size:1.16rem; color:var(--muted); margin:0 0 1.1rem; max-width:60ch; }
  .byline{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:.76rem; letter-spacing:.02em; color:var(--muted); border-top:1px solid var(--rule); padding-top:.9rem; }
  .toc{ max-width:740px; margin:1.4rem auto 0; padding:1rem 1.1rem; background:var(--alt); border:1px solid var(--rule); border-radius:12px; }
  .toc h2{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:.68rem; text-transform:uppercase; letter-spacing:.14em; color:var(--olive); margin:.1rem 0 .7rem; border:0; padding:0; }
  .toc ol{ list-style:none; margin:0; padding:0; }
  .toc li{ break-inside:avoid; margin:.22rem 0; font-size:.92rem; }
  .toc-n{ color:var(--olive); font:600 .74rem 'JetBrains Mono',ui-monospace,monospace; margin-right:.55rem; }
  .toc a{ color:var(--fg); text-decoration:none; } .toc a:hover{ background:var(--neon); }
  article{ font-size:1.07rem; }
  /* Prose keeps a ~740px reading measure, centered; figures (.fig) span the full 1000px wrap. */
  .sec > :not(.fig){ max-width:740px; margin-left:auto; margin-right:auto; }
  h2{ font-family:'Inter',system-ui,sans-serif; font-weight:700; font-size:1.62rem; line-height:1.16; margin:2.6rem 0 .9rem; letter-spacing:-.02em; border-top:1px solid var(--rule); padding-top:2rem; }
  .sec:first-of-type h2{ border-top:0; padding-top:.4rem; margin-top:.6rem; }
  h3{ font-family:'Inter',system-ui,sans-serif; font-weight:700; font-size:1.18rem; margin:1.8rem 0 .6rem; letter-spacing:-.01em; }
  p{ margin:0 0 1.05rem; } strong{ font-weight:700; }
  a{ color:var(--fg); text-decoration:underline; text-decoration-color:var(--neon-dim); text-decoration-thickness:2px; text-underline-offset:2px; }
  a:hover{ background:var(--neon); text-decoration-color:transparent; }
  code{ font-family:'JetBrains Mono',ui-monospace,'SF Mono',monospace; font-size:.85em; background:var(--code); padding:.1rem .34rem; border-radius:5px; }
  pre{ background:var(--alt); border:1px solid var(--rule); border-left:3px solid var(--neon-dim); border-radius:10px; padding:.9rem 1.05rem; overflow:auto; font-size:.86rem; line-height:1.55; }
  pre code{ background:none; padding:0; font-size:1em; }
  .hljs-comment,.hljs-quote{ color:var(--hl-comment); font-style:italic; }
  .hljs-keyword,.hljs-literal,.hljs-selector-tag{ color:var(--hl-keyword); }
  .hljs-type,.hljs-title.class_,.hljs-class .hljs-title{ color:var(--hl-type); }
  .hljs-title,.hljs-title.function_,.hljs-section,.hljs-name{ color:var(--hl-fn); }
  .hljs-string,.hljs-attr,.hljs-symbol,.hljs-meta .hljs-string,.hljs-addition{ color:var(--hl-str); }
  .hljs-number,.hljs-bullet{ color:var(--hl-num); }
  .hljs-meta,.hljs-meta .hljs-keyword{ color:var(--hl-meta); }
  .hljs-built_in,.hljs-builtin-name{ color:var(--hl-builtin); }
  .hljs-deletion{ color:#dc2626; }
  blockquote{ margin:1.3rem 0; padding:.85rem 1.15rem; background:var(--quote); border-left:3px solid var(--neon-dim); border-radius:0 8px 8px 0; }
  ul,ol{ margin:0 0 1.05rem; padding-left:1.3rem; } li{ margin:.3rem 0; } li::marker{ color:var(--olive); }
  /* Figures span the full wrap so dense diagrams/widgets stay legible; centered via margin auto. */
  .fig{ width:100%; margin:2rem auto; }
  .fig-dgm,.fig-cmp{ border:1px solid var(--rule); border-radius:12px; padding:1.1rem; background:var(--alt); }
  .dgm-svg{ display:block; width:100%; height:auto; }
  .fig svg text{ font-family:'Inter',ui-monospace,monospace; }
  .fig figcaption{ font-family:'JetBrains Mono',ui-monospace,monospace; font-size:.72rem; letter-spacing:.04em; color:var(--muted); text-align:center; margin-top:.6rem; }
  table.cmp{ border-collapse:collapse; width:100%; font-size:.85rem; }
  table.cmp th,table.cmp td{ border:1px solid var(--rule); padding:.45rem .6rem; text-align:left; vertical-align:top; }
  table.cmp th{ background:var(--alt); font-family:'JetBrains Mono',ui-monospace,monospace; font-weight:600; font-size:.74rem; text-transform:uppercase; letter-spacing:.04em; color:var(--olive); } .cmp-wrap{ overflow-x:auto; }
  .missing{ color:#dc2626; font:600 .85rem 'JetBrains Mono',monospace; text-align:center; padding:1rem; border:1px dashed #dc2626; border-radius:8px; }
  .topbar{ position:sticky; top:0; z-index:5; backdrop-filter:saturate(140%) blur(10px); background:rgba(242,241,235,.82); border-bottom:1px solid var(--rule); }
  .topbar .in{ max-width:740px; margin:0 auto; padding:.55rem 1.1rem; display:flex; justify-content:space-between; align-items:center; font-family:'JetBrains Mono',ui-monospace,monospace; font-size:.76rem; letter-spacing:.02em; }
  .topbar a{ color:var(--olive); text-decoration:none; } .topbar a:hover{ color:var(--fg); } .topbar span{ color:var(--muted); }`;

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

  // social preview card (og:image) + meta tags — needs the absolute base URL
  const ogDiagram = pickOgDiagram(slug, data, state.usedSvgs);
  const canonical = SITE_URL ? `${SITE_URL}/posts/${slug}.html` : '';
  const ogImageUrl = SITE_URL && ogDiagram ? `${SITE_URL}/assets/og/${slug}.png` : '';
  const ogTags = SITE_URL
    ? '\n' + ogMeta({ type: 'article', title: data.title, description: data.dek || data.title,
        url: canonical, image: ogImageUrl, siteName: SITE.title })
    : '';

  const words = countWords(sections);
  // t.heading is inner HTML from marked with tags stripped, so it is already
  // entity-escaped — esc() here would double-escape an apostrophe or ampersand.
  const tocHtml = toc.map((t, i) => `<li><span class="toc-n">${String(i + 1).padStart(2, '0')}</span><a href="#${t.id}">${t.heading}</a></li>`).join('\n');
  const scripts = [...state.usedWidgets].sort().map((n) => `<script src="../assets/js/dst/${n}.js"></script>`).join('\n');
  const inits = state.mounts.map((m) => `    try { if(window.${WIDGETS[m.name].g}) ${WIDGETS[m.name].g}.init('${m.id}'); } catch (e) { console.error('${m.name} (${m.id}) failed:', e); }`).join('\n');

  const eyebrow = data.eyebrow ? `<div class="eyebrow">${esc(data.eyebrow)}</div>` : '';
  const dek = data.dek ? `<p class="dek">${esc(data.dek)}</p>` : '';
  const byline = `${data.byline ? esc(data.byline) + ' ' : ''}~${words.toLocaleString()} words · ${state.mounts.length} interactive widgets · ${state.usedSvgs.size} diagrams`;

  const post = `<!doctype html>
<html lang="en" data-mode="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.dek || data.title)}">${ogTags}
${FONT}
<style>${POST_CSS}</style></head>
<body>
<div class="topbar"><div class="in"><a href="../index.html">← all posts</a><span>${esc(data.title)}</span></div></div>
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
</script>
</body></html>`;

  fs.mkdirSync(POSTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(POSTS_DIR, slug + '.html'), post);

  const leftovers = sections.match(/\[\[[^\]]+\]\]/g) || [];
  return { slug, title: data.title, dek: data.dek || '', eyebrow: data.eyebrow || '',
    date: data.date || '', order: data.order ? Number(data.order) : 0,
    words, mounts: state.mounts.length, diagrams: state.usedSvgs.size, ogDiagram,
    warnings: state.warnings, leftovers };
}

// ---------- regenerate widget demo pages (identical to legacy) ----------
function writeWidgetDemos() {
  fs.mkdirSync(WIDGETS_DIR, { recursive: true });
  for (const [name, w] of Object.entries(WIDGETS)) {
    fs.writeFileSync(path.join(WIDGETS_DIR, name + '.html'), `<!doctype html>
<html lang="en" data-mode="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DST · ${w.t}</title>${FONT}<style>
  :root{color-scheme:light;--bg:#f2f1eb;--fg:#1a1a1a;--muted:#5f6152;--rule:#e0ded3;--neon:#d9f400;--olive:#657220}
  *{box-sizing:border-box}html,body{background:var(--bg);color:var(--fg)}
  body{font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;max-width:900px;margin:2.6rem auto;padding:0 1rem;line-height:1.6;-webkit-font-smoothing:antialiased;font-feature-settings:'cv11','ss01'}
  ::selection{background:var(--neon);color:var(--fg)}
  h1{font-weight:800;font-size:1.55rem;letter-spacing:-.02em;margin:0 0 .15rem}.sub{color:var(--muted);margin:0 0 1.2rem}.tb{margin-bottom:1rem;display:flex;gap:.5rem;align-items:center}
  .tb a{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.76rem;cursor:pointer;border:1px solid var(--rule);background:var(--bg);color:var(--olive);border-radius:8px;padding:.35rem .7rem;text-decoration:none}
  .tb a:hover{background:var(--neon);color:var(--fg);border-color:var(--fg)}</style></head>
<body><h1>${w.t}</h1><p class="sub">${w.s}</p>
<div class="tb"><a href="../index.html">← all widgets</a></div>
<div id="dst-w"></div>
<script src="../assets/vendor/anime.min.js"></script><script src="../assets/js/dst/dst-kit.js"></script><script src="../assets/js/dst/${name}.js"></script>
<script>(function(){function go(){if(window.${w.g})${w.g}.init('dst-w');}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',go);else go();})();</script>
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
<meta name="description" content="${esc(SITE.sub)}">${SITE_URL ? '\n' + ogMeta({ type: 'website', title: SITE.title, description: SITE.sub, url: SITE_URL + '/', image: SITE_URL + '/assets/og/home.png', siteName: SITE.title }) : ''}
${FONT}<style>
  :root{color-scheme:light;--bg:#f2f1eb;--alt:#f8f8f5;--fg:#1a1a1a;--muted:#5f6152;--rule:#e0ded3;--neon:#d9f400;--neon-dim:#c2db00;--olive:#657220}
  *{box-sizing:border-box}html,body{background:var(--bg);color:var(--fg)}
  body{font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;max-width:760px;margin:0 auto;padding:3.6rem 1.1rem 5rem;line-height:1.65;-webkit-font-smoothing:antialiased;font-feature-settings:'cv11','ss01'}
  ::selection{background:var(--neon);color:var(--fg)}
  .eyebrow{font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:600;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--olive);display:inline-flex;align-items:center;gap:.6rem;margin-bottom:1rem}
  .eyebrow::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--neon);box-shadow:0 0 0 4px rgba(217,244,0,.2);animation:dotpulse 2.4s ease-in-out infinite}
  @keyframes dotpulse{0%,100%{box-shadow:0 0 0 4px rgba(217,244,0,.2)}50%{box-shadow:0 0 0 8px rgba(217,244,0,.04)}}
  h1{font-weight:800;font-size:2.1rem;letter-spacing:-.03em;margin:0 0 .4rem}.sub{color:var(--muted);margin:0 0 2rem;max-width:62ch}
  h2{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.7rem;text-transform:uppercase;letter-spacing:.14em;color:var(--olive);margin:2.4rem 0 1rem}
  ul{list-style:none;padding:0;margin:0}
  li{background:var(--alt);border:1px solid var(--rule);border-radius:12px;padding:1rem 1.15rem;margin-bottom:.8rem;transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease}
  li:hover{transform:translate(-2px,-2px);box-shadow:4px 4px 0 var(--neon-dim);border-color:var(--fg)}
  a{color:var(--fg);text-decoration:none}a.post{display:block}
  .post b{font-size:1.2rem;font-weight:700;letter-spacing:-.02em}
  .pe{font-family:'JetBrains Mono',ui-monospace,monospace;font-weight:600;font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--olive);margin-bottom:.4rem}
  .d{font-size:.95rem;color:var(--muted);margin-top:.3rem}
  .m{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.72rem;color:var(--muted);margin-top:.5rem}
  p.about{font-size:.95rem;color:var(--muted)}
  p.about a{text-decoration:underline;text-decoration-color:var(--neon-dim);text-decoration-thickness:2px;text-underline-offset:2px}p.about a:hover{background:var(--neon);color:var(--fg)}</style></head>
<body><div class="eyebrow">Build logs</div><h1>${esc(SITE.title)}</h1><p class="sub">${esc(SITE.sub)}</p>
<h2>Posts</h2><ul>
${cards}
</ul>
${aboutHtml}</body></html>`);
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

  // social preview cards (og:image). Requires an absolute base URL (content/site.json "url").
  let ogNote = 'skipped (set content/site.json "url")';
  if (SITE_URL) {
    fs.mkdirSync(OG_DIR, { recursive: true });
    let n = 0;
    for (const p of posts) {
      if (!p.ogDiagram) { console.log(`  · ${p.slug}: no svg diagram — no og:image`); continue; }
      renderOgCard({ siteName: SITE.title, eyebrow: p.eyebrow, title: p.title,
        diagramBody: SVG[p.ogDiagram].body, outPath: path.join(OG_DIR, p.slug + '.png') });
      console.log(`  · og card: ${p.slug}.png (${p.ogDiagram})`);
      n++;
    }
    renderOgCard({ siteName: SITE.title, eyebrow: 'Build logs', title: SITE.sub, titleSize: 40,
      diagramBody: SVG['mem-timeline'] ? SVG['mem-timeline'].body : null, outPath: path.join(OG_DIR, 'home.png') });
    n++;
    ogNote = `${n} card(s) → assets/og/`;
  }

  console.log('---');
  console.log(`posts: ${posts.length} · widget demo pages: ${Object.keys(WIDGETS).length} · svg diagrams: ${Object.keys(SVG).length}`);
  console.log('og images:', ogNote);
  console.log('leftover placeholders:', leftovers.length ? leftovers.join(', ') : 'none');
  console.log(warnings.length ? 'WARNINGS:\n - ' + warnings.join('\n - ') : 'warnings: none');
  if (warnings.length || leftovers.length) process.exit(1);
}

main();
