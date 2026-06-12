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
const themeJs = `document.getElementById('theme').addEventListener('click',function(){var h=document.documentElement;h.setAttribute('data-mode',h.getAttribute('data-mode')==='dark'?'light':'dark');});`;

const POST_CSS = `
  :root{ color-scheme:light dark; --fg:#1f2430; --bg:#fbfbfc; --muted:#5b6472; --rule:rgba(0,0,0,.1);
    --accent:#7c3aed; --code:rgba(124,58,237,.07); --quote:rgba(124,58,237,.06);
    --hl-comment:#8a8f99; --hl-keyword:#9333ea; --hl-type:#b45309; --hl-fn:#2563eb;
    --hl-str:#15803d; --hl-num:#c2410c; --hl-meta:#0e7490; --hl-builtin:#0891b2; }
  html[data-mode=dark]{ --fg:#e6e8ec; --bg:#14151a; --muted:#9aa3b2; --rule:rgba(255,255,255,.12);
    --accent:#a78bfa; --code:rgba(167,139,250,.13); --quote:rgba(167,139,250,.08);
    --hl-comment:#7d8590; --hl-keyword:#d2a8ff; --hl-type:#f0b072; --hl-fn:#79b8ff;
    --hl-str:#7ee787; --hl-num:#ffab70; --hl-meta:#56d4dd; --hl-builtin:#56d4dd; }
  html,body{ background:var(--bg); color:var(--fg); margin:0; }
  body{ font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif; line-height:1.68; }
  .wrap{ max-width:740px; margin:0 auto; padding:0 1.1rem 6rem; }
  header.post{ max-width:740px; margin:0 auto; padding:3rem 1.1rem 1.2rem; }
  .eyebrow{ font:600 .74rem/1 ui-monospace,monospace; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin-bottom:.9rem; }
  h1{ font-size:2.6rem; line-height:1.08; margin:0 0 .6rem; letter-spacing:-.02em; }
  .dek{ font-size:1.16rem; color:var(--muted); margin:0 0 1.1rem; }
  .byline{ font-size:.84rem; color:var(--muted); border-top:1px solid var(--rule); padding-top:.9rem; }
  .toc{ max-width:740px; margin:1.4rem auto 0; padding:1rem 1.1rem; border:1px solid var(--rule); border-radius:12px; }
  .toc h2{ font-size:.74rem; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); margin:.1rem 0 .7rem; border:0; padding:0; }
  .toc ol{ list-style:none; margin:0; padding:0; }
  .toc li{ break-inside:avoid; margin:.22rem 0; font-size:.92rem; }
  .toc-n{ color:var(--accent); font:600 .76rem ui-monospace,monospace; margin-right:.5rem; }
  .toc a{ color:var(--fg); text-decoration:none; } .toc a:hover{ text-decoration:underline; }
  article{ font-size:1.07rem; }
  h2{ font-size:1.6rem; line-height:1.18; margin:2.6rem 0 .9rem; letter-spacing:-.01em; border-top:1px solid var(--rule); padding-top:2rem; }
  .sec:first-of-type h2{ border-top:0; padding-top:.4rem; margin-top:.6rem; }
  h3{ font-size:1.16rem; margin:1.8rem 0 .6rem; }
  p{ margin:0 0 1.05rem; } strong{ font-weight:700; } a{ color:var(--accent); }
  code{ font-family:ui-monospace,'SF Mono','Fira Code',monospace; font-size:.88em; background:var(--code); padding:.1rem .34rem; border-radius:5px; }
  pre{ background:var(--code); border:1px solid var(--rule); border-radius:10px; padding:.9rem 1.05rem; overflow:auto; font-size:.86rem; line-height:1.5; }
  pre code{ background:none; padding:0; }
  .hljs-comment,.hljs-quote{ color:var(--hl-comment); font-style:italic; }
  .hljs-keyword,.hljs-literal,.hljs-selector-tag{ color:var(--hl-keyword); }
  .hljs-type,.hljs-title.class_,.hljs-class .hljs-title{ color:var(--hl-type); }
  .hljs-title,.hljs-title.function_,.hljs-section,.hljs-name{ color:var(--hl-fn); }
  .hljs-string,.hljs-attr,.hljs-symbol,.hljs-meta .hljs-string,.hljs-addition{ color:var(--hl-str); }
  .hljs-number,.hljs-bullet{ color:var(--hl-num); }
  .hljs-meta,.hljs-meta .hljs-keyword{ color:var(--hl-meta); }
  .hljs-built_in,.hljs-builtin-name{ color:var(--hl-builtin); }
  .hljs-deletion{ color:#dc2626; }
  blockquote{ margin:1.3rem 0; padding:.85rem 1.15rem; background:var(--quote); border-left:3px solid var(--accent); border-radius:0 8px 8px 0; }
  ul,ol{ margin:0 0 1.05rem; padding-left:1.3rem; } li{ margin:.3rem 0; }
  .fig{ margin:1.7rem 0; }
  .fig-dgm{ border:1px solid var(--rule); border-radius:12px; padding:1rem; background:var(--code); }
  .dgm-svg{ display:block; width:100%; height:auto; }
  .fig svg text{ font-family:'Space Grotesk',ui-monospace,monospace; }
  .fig figcaption{ font-size:.8rem; color:var(--muted); text-align:center; margin-top:.5rem; }
  table.cmp{ border-collapse:collapse; width:100%; font-size:.85rem; }
  table.cmp th,table.cmp td{ border:1px solid var(--rule); padding:.45rem .6rem; text-align:left; vertical-align:top; }
  table.cmp th{ background:var(--code); font-weight:700; } .cmp-wrap{ overflow-x:auto; }
  .missing{ color:#dc2626; font:600 .85rem ui-monospace,monospace; text-align:center; padding:1rem; border:1px dashed #dc2626; border-radius:8px; }
  .topbar{ position:sticky; top:0; z-index:5; backdrop-filter:blur(8px); background:color-mix(in srgb,var(--bg) 84%,transparent); border-bottom:1px solid var(--rule); }
  .topbar .in{ max-width:740px; margin:0 auto; padding:.5rem 1.1rem; display:flex; justify-content:space-between; align-items:center; font-size:.82rem; }
  .topbar a{ color:var(--muted); text-decoration:none; } .topbar button{ font:inherit; cursor:pointer; background:transparent; border:1px solid var(--rule); color:inherit; border-radius:6px; padding:.25rem .55rem; }`;

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
${FONT}
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
<title>${esc(SITE.title)}</title>${FONT}<style>
  :root{color-scheme:light dark}html[data-mode=dark]{background:#14151a;color:#e6e8ec}html[data-mode=light]{background:#fbfbfc;color:#1f2430}
  body{font-family:'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;max-width:740px;margin:3rem auto;padding:0 1rem;line-height:1.65}
  h1{font-size:1.8rem;margin:0 0 .3rem}.sub{opacity:.65;margin:0 0 1.5rem}
  h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.1em;opacity:.6;margin-top:2.2rem}
  ul{list-style:none;padding:0}li{border:1px solid rgba(127,127,127,.25);border-radius:10px;padding:.85rem 1.05rem;margin-bottom:.65rem}
  li:has(a.post){background:rgba(124,58,237,.06);border-color:rgba(127,127,127,.3)}
  a{color:#7c3aed;font-weight:700;text-decoration:none}a:hover{text-decoration:underline}
  .post b{font-size:1.15rem}.pe{font:600 .66rem/1 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:#7c3aed;opacity:.85;margin-bottom:.35rem}
  .d{font-size:.9rem;opacity:.72;margin-top:.25rem;color:inherit;font-weight:400}.m{font-size:.78rem;opacity:.6;margin-top:.4rem;color:inherit;font-weight:400}
  p.about{font-size:.95rem;opacity:.85}
  button#theme{font:inherit;cursor:pointer;border:1px solid rgba(127,127,127,.4);background:transparent;color:inherit;border-radius:7px;padding:.3rem .6rem;margin-bottom:1.3rem}</style></head>
<body><h1>${esc(SITE.title)}</h1><p class="sub">${esc(SITE.sub)}</p>
<button id="theme">light / dark</button>
<h2>Posts</h2><ul>
${cards}
</ul>
${aboutHtml}<script>${themeJs}</script></body></html>`);
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
