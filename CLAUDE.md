# CLAUDE.md — working in this repo

This is a **static blog**, authored in **Markdown**, built by a small bespoke Node script (no framework).
The flagship post is a deterministic-simulation-testing (DST) build log with interactive animated widgets.

## Build & run

```bash
npm install            # once — installs `marked` (the only dependency)
npm run build          # = node build/build.js   → regenerates posts/, widgets/, index.html
python3 -m http.server 8000 --bind 127.0.0.1   # then open http://127.0.0.1:8000/
```

A successful build ends with **`leftover placeholders: none`** and **`warnings: none`**. If it prints
warnings or a non-zero exit, a `[[WIDGET:…]]`/`[[SVG:…]]` token points at something unregistered — fix it.

## Source of truth vs generated (do NOT hand-edit generated files)

- **Edit:** `content/*.md` (posts), `content/site.json` (index title), `assets/js/dst/*.js` (widgets),
  `build/diagrams-svg.js` (SVGs), `build/widgets.json` (widget registry).
- **Generated — never edit by hand, they are overwritten every build:** `posts/*.html`, `index.html`,
  `widgets/*.html`.

## Authoring a post (see `content/README.md` for the full reference)

One file per post: `content/<slug>.md`, with a `---` frontmatter block (`title` required; optional
`dek`, `eyebrow`, `slug`, `date`, `byline`, `draft`) then a Markdown body. In the body:

- **Prose** is plain Markdown. `##` = top-level sections (these become the table of contents); `###` =
  subsections. `## Heading {#slug}` sets a stable anchor id (omit `{#…}` to auto-slugify). Code in
  ` ```rust ` fences.
- **Reusable visuals** are referenced by a token on its own line:
  - `[[WIDGET:name]]` → interactive widget (`assets/js/dst/<name>.js`, registered in `build/widgets.json`).
  - `[[SVG:name]]` → diagram (`build/diagrams-svg.js`).
- **One-off visuals**: paste raw `<svg class="dgm-svg">…</svg>` / `<table class="cmp">…` directly into the
  Markdown — `marked` passes raw HTML through. Wrap in `<figure class="fig fig-dgm">…<figcaption>…</figcaption></figure>` for the framed look.

`content/README.md` and `_`-prefixed `.md` files are ignored by the build (not treated as posts).

## Adding a NEW reusable asset

- **Widget:** write `assets/js/dst/<name>.js`, then add `"<name>": { "g": "<Global>", "t": "Title", "s": "subtitle" }`
  to `build/widgets.json`. Reference with `[[WIDGET:<name>]]`. Widget JS contract (copy
  `assets/js/dst/paused-clock.js`): a `"use strict"` IIFE; guard `anime` (v4 — `anime.animate`) and
  `window.DSTKit`; build the scene with `K.container(...)`; **all randomness via `K.rng(seed)` — never the
  built-in JS random API or the system clock** (determinism comes from the seed); re-`build()` on a
  `documentElement` `data-mode` MutationObserver; expose `window.<Global> = { init }` where `init(id)`
  renders into `document.getElementById(id)`. Verify with `node --check assets/js/dst/<name>.js`.
- **Diagram:** add `<name>: { title, type: 'svg', body }` to `build/diagrams-svg.js`
  (self-contained `<svg class="dgm-svg" …>`, text `fill="currentColor"` so it adapts to light/dark).
  Reference with `[[SVG:<name>]]`.

## Layout

```
content/        *.md posts (+ README.md authoring guide, site.json)  ← edit
build/          build.js (builder) · diagrams-svg.js (SVGs) · widgets.json (widget registry)
assets/         js/dst/*.js (widgets + dst-kit.js) · vendor/anime.min.js · css/
posts/          generated post pages          ← do not edit
widgets/        generated per-widget demo pages ← do not edit
index.html      generated blog index           ← do not edit
```

## Gotchas

- Widgets need `anime` v4 + `dst-kit.js`; both are injected by the build. Test pages live at
  `widgets/<name>.html`.
- `node --check` validates widget JS *syntax* only; it does not catch runtime errors — load the widget
  page in a browser to confirm it animates.
- The build only verifies that placeholder tokens resolve; it does not validate inline raw HTML you paste.
