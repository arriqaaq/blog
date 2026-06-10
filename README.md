# arriqaaq — build logs

A static blog of build logs and notes on distributed systems — written in **Markdown**, built by a
small zero-framework Node script, with interactive animated widgets and SVG diagrams. The flagship post
is *The Seed Contract*, a deterministic-simulation-testing (DST) build log.

## Quick start

```bash
npm install                                   # once — installs `marked`
npm run build                                 # build all posts → posts/, widgets/, index.html
python3 -m http.server 8000 --bind 127.0.0.1  # serve it
# open http://127.0.0.1:8000/
```

A clean build prints `leftover placeholders: none` and `warnings: none`. Re-run `npm run build` after any
edit and refresh the browser. (Opening the HTML files directly via `file://` mostly works, but a local
server is recommended because widgets load their JS via relative paths.)

## Write a new post

Create `content/<slug>.md`:

````markdown
---
title: My new post
dek: One-line subtitle.
eyebrow: Topic label
date: 2026-06-10
---

## First section {#first}

Prose is plain Markdown — **bold**, `code`, [links](https://example.com), > quotes, and lists.

```rust
fn main() { println!("hi"); }
```

Drop a reusable widget or diagram by name (each on its own line):

[[WIDGET:tick-loop]]
[[SVG:lineage]]
````

Then `npm run build` → `posts/my-new-post.html`, and a card is added to `index.html` automatically.

- `##` headings become the table of contents; `###` are subsections. `{#slug}` after a heading sets its
  anchor (optional).
- For a **one-off** diagram, paste raw `<svg class="dgm-svg">…</svg>` straight into the Markdown.
- **Full authoring reference:** [`content/README.md`](content/README.md).
- **Agent/maintainer guide:** [`CLAUDE.md`](CLAUDE.md).

## Adding reusable widgets / diagrams

- **Widget:** add `assets/js/dst/<name>.js` (built on the `DSTKit` + anime helpers — copy
  `assets/js/dst/paused-clock.js`), register it in `build/widgets.json`, reference with `[[WIDGET:<name>]]`.
- **Diagram:** add an entry to `build/diagrams-svg.js`, reference with `[[SVG:<name>]]`.

See [`CLAUDE.md`](CLAUDE.md) for the exact widget contract and conventions.

## Layout

| Path | What | Edit? |
|------|------|-------|
| `content/*.md` | posts (source of truth) | ✅ |
| `content/site.json` | blog title/subtitle on the index | ✅ |
| `build/build.js` | the builder (`npm run build`) | rarely |
| `build/widgets.json` | widget registry (name → global/title/subtitle) | ✅ to register a widget |
| `build/diagrams-svg.js` | SVG diagram registry | ✅ to add a diagram |
| `assets/js/dst/*.js` | widget code + shared `dst-kit.js` | ✅ |
| `posts/*.html`, `index.html`, `widgets/*.html` | **generated output** | ❌ never (overwritten each build) |
