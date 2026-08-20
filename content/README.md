# Authoring posts (Markdown)

Posts are written in Markdown, one file per post, in this `content/` folder. The build turns each
`content/<slug>.md` into `posts/<slug>.html` and regenerates `index.html` (the post list + widget
gallery) and the `widgets/*.html` demo pages.

## Build

```bash
npm install        # once, installs `marked` + `highlight.js`
npm run build      # or: node build/build.js
```

The build prints a per-post summary and fails (non-zero exit) if any `[[WIDGET:…]]`/`[[SVG:…]]`
token points at something that doesn't exist, so typos are caught.

## A post file

````markdown
---
title: The Seed Contract          # required
dek: One-line subtitle under the H1.
eyebrow: Deterministic Simulation Testing   # small label above the H1 (optional)
slug: the-seed-contract           # optional; defaults to the filename
date: 2026-06-09                  # optional; newest sorts first on the index
byline: A build log on …          # optional; the build appends "~N words · M widgets · K diagrams"
made: assisted                    # required; AI-disclosure badge — `assisted` or `hand`
draft: true                       # optional; if true, the post is skipped
---

## First section {#what-is-dst}

Prose is plain Markdown — **bold**, *italic*, `inline code`, [links](https://example.com),
> blockquotes,
and `-` / `1.` lists.

Rust (or any language) goes in a fenced block:

```rust
fn build_runtime() -> Result<Runtime, Error> { … }
```

The fence's language tag (`` ```rust ``, `` ```bash ``, …) is syntax-highlighted at build time by
`highlight.js` — no client-side JS, and it adapts to light/dark. Use a real language name so it's
recognised; an unknown or omitted tag just renders as plain (uncoloured) monospace.

### A subsection {#some-anchor}

Use `##` for the post's top-level sections (these become the table of contents) and `###` for
subsections. The `{#slug}` after a heading sets its anchor id; omit it to auto-generate one from
the text.
````

> Note on frontmatter: values are simple `key: value` strings. If a value contains a colon, wrap it
> in quotes (`title: "DST: a build log"`).

## Visuals — three ways

1. **Reusable interactive widget** — a token on its own line. The JS lives in
   `assets/js/dst/<name>.js` and is registered in `build/widgets.json`:
   ```
   [[WIDGET:tick-loop]]
   ```
2. **Reusable diagram** — a token on its own line. The SVG lives in `build/diagrams-svg.js`:
   ```
   [[SVG:lineage]]
   ```
3. **One-off custom visual** — just paste raw HTML/SVG into the Markdown; it passes through verbatim.
   For the framed look the `[[SVG:…]]` tokens get, wrap it yourself:
   ```html
   <figure class="fig fig-dgm">
     <svg class="dgm-svg" viewBox="0 0 240 80">…</svg>
     <figcaption>my one-off diagram</figcaption>
   </figure>
   ```

## Adding a NEW reusable asset

- **New widget:** write `assets/js/dst/<name>.js` (IIFE exposing `window.<Global>.init(id)`, built on
  the `window.DSTKit` helpers + anime v4 — copy the shape of `assets/js/dst/paused-clock.js`), then add
  an entry to `build/widgets.json`: `"<name>": { "g": "<Global>", "t": "Title", "s": "subtitle" }`.
  Reference it with `[[WIDGET:<name>]]`.
- **New diagram:** add an entry to `build/diagrams-svg.js` (`<name>: { title, type: 'svg', body }`),
  then reference it with `[[SVG:<name>]]`.

## Site title / list

`content/site.json` (`{ "title", "sub" }`) sets the heading on `index.html`.

## What's in `build/`

Just three files: `build.js` (the builder), `diagrams-svg.js` (the SVG registry), and `widgets.json`
(the widget registry). The canonical build command is **`node build/build.js`** (`npm run build`).
