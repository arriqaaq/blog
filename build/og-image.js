'use strict';
/* Open Graph / social preview cards.
 *
 * Renders a 1200x630 branded PNG per post: neon eyebrow (site name + section) + the post title,
 * with a chosen diagram scaled in below, on the cream ground. Diagrams come from diagrams-svg.js
 * (their descriptive text uses `currentColor`, which we resolve to ink for standalone raster).
 * Rasterized with @resvg/resvg-js using the committed Inter TTFs so cards match the site and render
 * identically on the Linux CI runner (no system fonts). Exposes renderOgCard(...).
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const FONT_DIR = path.join(__dirname, 'fonts');
const FONT_FILES = fs.existsSync(FONT_DIR)
  ? fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(FONT_DIR, f))
  : [];

const CREAM = '#f8f8f5', INK = '#1a1a1a', NEON = '#d9f400', RULE = '#e0ded3', OLIVE = '#657220';
const W = 1200, H = 630, PAD = 80;

const escXml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text, max) {
  const words = String(text).trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines;
}

// Embed a diagram body (its own <svg class="dgm-svg" viewBox=...>) into a target rect, resolving
// `currentColor` to ink so the descriptive text is legible on cream.
function embedDiagram(body, x, y, w, h) {
  return body
    .replace(/currentColor/g, INK)
    .replace(/<svg\b/, `<svg x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"`);
}

function cardSvg({ siteName, eyebrow, title, diagramBody, titleSize = 54 }) {
  const eb = [siteName, eyebrow].filter(Boolean).join('    ·    ').toUpperCase();
  const maxChars = Math.max(16, Math.floor((W - PAD * 2) / (titleSize * 0.56)));
  const lines = wrap(title, maxChars).slice(0, 3);
  const lh = Math.round(titleSize * 1.16);
  const ty = 172;
  const titleText = lines
    .map((ln, i) => `<text x="${PAD}" y="${ty + i * lh}" font-size="${titleSize}" font-weight="700" fill="${INK}">${escXml(ln)}</text>`)
    .join('');
  const titleBottom = ty + (lines.length - 1) * lh;
  const dgY = Math.max(300, titleBottom + 54);
  const dgH = H - dgY - 58;
  const diagram = diagramBody ? embedDiagram(diagramBody, PAD, dgY, W - PAD * 2, dgH) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Inter">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="20" fill="none" stroke="${RULE}" stroke-width="2"/>
  <circle cx="${PAD + 8}" cy="94" r="8" fill="${NEON}"/>
  <text x="${PAD + 28}" y="101" font-size="23" font-weight="600" letter-spacing="3.5" fill="${OLIVE}">${escXml(eb)}</text>
  ${titleText}
  <rect x="${PAD}" y="${dgY - 24}" width="120" height="6" rx="3" fill="${NEON}"/>
  ${diagram}
</svg>`;
}

function renderOgCard(opts) {
  const svg = cardSvg(opts);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    background: CREAM,
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  const png = resvg.render().asPng();
  fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
  fs.writeFileSync(opts.outPath, png);
  return opts.outPath;
}

module.exports = { renderOgCard };
