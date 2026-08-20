# STYLE.md — how posts on this blog are written

Written down after a long editing pass on `content/branching-lsm.md`, where the same mistakes
were made and corrected repeatedly. Read this before writing or editing a post, a diagram title,
or a widget caption. It applies to **every author-facing string**: prose, `##` headings, diagram
titles, HTML-table cells and footers, widget titles/subtitles/captions, and widget activity-log
messages.

The reference the blog is calibrated against is Cursor's
[Git at any scale](https://cursor.com/blog/git-at-any-scale), plus this blog's own
`content/dst.md`.

---

## 0. Corrections to an earlier version of this file

The first version of this guide over-corrected into stiffness, and banned several things the
reference post does well. Fixed here:

- **Metaphor is allowed** when it is vivid and technical — "trading bandwidth for CPU", "pets, not
  cattle", "a warm cache on disk". What is banned is *stock consultant* metaphor: "moving parts",
  "cost shapes", "under the hood", "at its core".
- **Scaffolding about the material is allowed.** "Before we can talk about how Spokes uses 3PC, we
  need to understand how a Git push works" is fine, because it is about the subject's dependency
  order. "This post is about…" and "the next four sections" are not, because they are about the
  document.
- **There is no diagram label cap.** See §6.

## 1. Tone: humble and informative

State what the thing is, how it works, and what it costs. Report what was learned. Do not build
a case, do not tell the reader what to be impressed by, and do not assert significance.

Where something is untested, unmeasured, or uncertain, say so plainly and move on.

### The single most common failure: the terminal claim

A sentence reports mechanism accurately, then pivots — usually after an em-dash, or in a final
sentence — to assert what the mechanism *means*. **Truncating at the pivot fixes it.**

> Every branch's own commits sit to the right of its own anchor, ~~which is why a child's write
> always outranks anything it inherited without a flag or a shadow table~~.

> Nothing is overwritten in place. Put the same key twice and the first version is still on disk.
> ~~That one property is what the rest of this post builds on.~~

Before shipping any sentence, check whether it ends by explaining why the preceding clause was
clever. If it does, cut from the pivot.

## 2. Banned constructions

Each of these was written, objected to, and removed at least once.

| Pattern | Example that was rejected | Instead |
|---|---|---|
| `X is Y, not Z` | "Copy-on-write shadowing is arithmetic, not bookkeeping" | Describe what happens: a child's sequence exceeds what it inherited, so its row wins |
| "for free" / "come for free" | "conflict detection, the WAL and sequence allocation come for free" | "…are handled by the ordinary commit path" |
| Totalising phrases | "the entire mechanism", "the whole point", "the one that actually grows", "the only thing that…" | Name the mechanism and stop |
| Telling the reader what matters | "The knock-on is worth noticing", "the interesting anchors sit between two of them" | State the fact; let the reader rank it |
| Talking about the artifact | "This post is about…", "This section names all three…", "the next four sections", "Where this stands, plainly." | Open straight into the subject |
| Reader instructions | "If you already know LSM internals, skim to the last paragraph" | Delete |
| Deferred payloads | "Two properties stop it short of a branch." (then a new paragraph) | Name both in the sentence that delivers the first |
| Riddles instead of nouns | "the component whose job is to forget things" | "compaction" |
| Invented claims about people | "nobody does it", "teams share a staging instance and coordinate in Slack" | Only what you can support |
| Snark | "copy the directory, or hope" | "copy the directory" |
| Internal trivia | "SSTables in a format it calls `LSMV3`" | Drop it; format version labels mean nothing to a reader |
| Internal changelog | "used to be a `Vec`", "two metric names changed meaning recently" | State the present tense only |
| Thesis-then-evidence openings | "Branching a database is expensive." → then the argument | Say what the work is for |

Also: **no `> Recap:` blockquotes.** If a point needs restating, the section's own last sentence
should carry it.

## 2b. The sentence-level tells that actually matter

The stock LLM vocabulary is easy to grep and was already clean when this post still read as
machine-written. What actually gave it away was **structural repetition** — the same six sentence
shapes cycled for 7,000 words. Watch for:

| Tell | Count found in one draft | Fix |
|---|---|---|
| `X rather than Y` | **32** | Say X. Drop the contrast, or make it a second sentence. |
| Em-dash asides | **92**, one per 80 words | Budget roughly one per 3–4 paragraphs. Most become a full stop. |
| Sentences that only announce a count | **~25** | Deliver in the same sentence: "A Git push has two components: a *packfile* and a *reference transaction*." |
| `which is what/why …` appositive tails | **13** | End the sentence. |
| `X, not Y` bare apposition | **9** | Keep at most a couple in a whole post. |
| Three-item runs for rhythm | many | Use three only when there are exactly three. "durably, deterministically, and without slowing down a store that has no branches" is two adverbs and a clause wearing an adverb's coat. |
| `deliberately`, `obvious`, `ordinary`, `natural` | 5–9 each | Filler, or virtue-signalling about the design. Cut. |
| Templated strings across files | 9 of 10 widgets shared `same X, same Y, same Z` | Write each one for its own widget. |
| Widget captions duplicating post prose | 4 pairs, near-verbatim | The reader sees both on one page. Say it once. |

**Voice.** Address the reader as **you** ("your push", "the branch you're working on"), and the work
as **I** or **we** as appropriate. A post with zero second person reads like documentation generated
about a system rather than someone explaining their own work. Vary sentence length deliberately:
the reference post ranges from 7 words to 40. Informality and humour are welcome.

## 3. Intro

Open with what the work is for and why it matters now, then the concrete cases. No thesis, no
rhetorical contrast, no roadmap of the post, no instructions about the widgets.

The intro of `branching-lsm.md` was rewritten four times before landing on: agents need somewhere
to work that they can break → this is an experiment in adding git-style branching to an LSM
key-value store, on my fork of SurrealKV, to find out what it takes → the three cases that want it.

Housekeeping (not released, names may move, mechanisms named with their real type and file) goes
in one short paragraph at the end of the intro, not the beginning.

## 4. Structure

- **Architecture before components.** Name the whole system once — every component, in one figure —
  then drill into each. Cursor names its core primitive ("a write-ahead log, which we store in
  S3-compatible object storage") and only then opens subsections for Consensus, Replication,
  Compaction, Scale. Without this, a section like "Where the promise is stored" arrives with
  nothing to attach to.
- **Group related concerns under one parent.** Four sections that all deal with compaction should
  be one `##` with four `###` children. `build/build.js` builds the TOC from `<h2>` only, and gives
  **every** heading level an id, so demoting a section to `###` shortens the TOC while keeping its
  `{#anchor}` and every inbound link.
- **Aim for about six `##` sections in a 10,000-word post.** The reference post is ~10,200 words in
  six: `What's hard about Git?` · `Git without packfiles` · `GitHub and filesystems` · `Spokes and
  Consistency` · `Continuity` · `Origin`. Exactly one is nested — `Continuity`, their own design,
  ~4,200 words (40%) with five `###` children. Twenty-one flat `##` sections is the failure mode: a
  127-word overview then carries the same TOC weight as an 870-word primer. Background-to-design runs
  about 55/45.
- **The design section opens by naming its primitive, not by announcing itself.** `Continuity` spends
  a paragraph on "a write-ahead log, which we store in S3-compatible object storage" before its first
  child. That is what an `##` lead is for; "this section covers…" is not.
- **No standalone retrospective, appendix or limitations section.** The reference has none. A
  trade-off goes where its mechanism is described ("trading bandwidth for CPU"). A section called
  `What I got wrong` or `What the database gave me` should be dissolved into the sections that own
  each fact. Dissolving is not deleting: every real caveat lands somewhere (see the last bullet).
  The exception is an item that is only an *absence* — "no live queries", "no vector search" — which
  is cut, because it carries no lesson.
- **Sections open straight into their subject.** No bridge sentence describing what the section
  will do. In `content/dst.md`, 7 of 8 sampled section openings go straight in.
- **One idea per section, and give the interesting failure room.** When several designs are being
  compared, each gets its own subsection and its own figure — not a clause in a run-on paragraph.
  The instructive failure deserves the most space.
- **Never delete a caveat to make the post flow.** If a limitation is real, keep it.

### Headings

**Bare nouns, one to four words.** The reference's are `Consensus` · `Replication` · `Compaction` ·
`Scale` · `WAL as truth`. Name what a reader is hunting for and stop.

Four patterns to write out of existence, all of them found in one post's twenty-one headings:

| Pattern | Rejected | Instead |
|---|---|---|
| Colon-explainer | `Crash consistency: why journals exist` | `Journals` |
| Appositive tail | `Path resolution, rebuilt` · `Inode numbers, demoted to presentation` | `The walk` · `Inode numbers` |
| Sentence-as-heading | `History is a chain of names` · `One root names the whole state` | `Commits` · `The state root` |
| Riddle | `The four structures, and the one that holds no name` · `Where the branch is not` | `Inodes and directory entries` |

Also: **prefer the plain word to the abstract one.** `Who wrote this byte` beats `Provenance` even
though the section is about provenance — the plain phrasing is what a reader would have asked. And
`actually`/`really` in a heading is a tic: `What an LSM tree actually is` became `How an LSM tree
works`.

A heading with a count in it has to match the body. `Four surfaces` over a section that says "three
translations" three times is a bug; either fix the count or drop it (`The surfaces`).

## 5. Numbers

Use concrete quantities wherever they honestly exist — structural constants count, and they land
harder than adjectives: `MAX_VIEW_DEPTH = 64` means 64 layers in one merge; the catalog caps at
4,096 records; `SCAN_PROBE_THRESHOLD = 256` keys; 56 bits of sequence and 8 of kind.

Never invent or imply a measurement. If nothing is benchmarked, say so once, plainly, and describe
cost *shapes* instead.

## 6. Diagrams

- **One idea per figure.** This is the actual rule. There is **no label budget** — Cursor's packfile
  figure carries 60+ labels and works, because it makes one point. An earlier pass here imposed
  "≤15 labels"; that was invented, not observed.
- **Sentences belong in the prose, not inside the SVG.** Figures that grew past ~700 characters of
  text were paragraphs rendered as SVG. The prose can say it better.
- **Neutral titles.** A title names what the figure shows: `The fork protocol: fence, drain,
  resolve, publish`, `Three lineages, numbered and immutable`, `Where the owner is named`. Not
  `Detach: the opposite trade from forking`.
- **One accent per figure**, marking the thing that matters. Red only for genuine wrongness.
- **Shared component vocabulary.** The same component looks the same in every figure it appears in —
  this is how Cursor's S3 box recurs across four diagrams and the reader accumulates one model.
  Twenty-six unrelated pictures do not add up to a mental model.
- **Placement rhythm:** state the problem → show the figure → one sentence reading what it implies.
  Never stack two figures back to back; never end a section on an unread figure.
- **No tables.** The reference post contains none. A comparison table is usually four subsections
  wearing a disguise. (Truth tables of a classification are the one defensible exception.)

## 7. Widgets

Widgets are for mechanics that are genuinely hard to see. They are the blog's main advantage over
the reference, so use them where a static picture would under-explain.

- **Step through named stages**, with `◀ Back` / `Pause` / `Next ▶`, the way Cursor's figures do:
  `PUSH → INDEX → UPLOAD → GET → LOCK → PUT REF TXN`. Support stepping backward by recomputing
  state at stage N, not by reversing animations.
- **Offer the failure as a toggle.** Cursor has "Drop the UDP gossip datagram". Letting the reader
  pick the broken configuration and watch it produce a wrong answer is worth more than a paragraph
  asserting that it would.
- **Show, don't assert.** A "no branches" toggle that produces identical output *demonstrates* the
  byte-identical property. The prose then does not have to claim it.
- **Determinism is the contract.** All randomness through `K.rng(seed)` — never the built-in random
  API and never the clock. Same seed, same run.
- Captions, subtitles and activity-log messages obey §1 and §2. The log reports what happened; it
  does not editorialise. `a delete is a write, not an erase` is a banned construction even in a log
  line.
- Mechanics of the contract (IIFE, `anime` v4 + `DSTKit` guards, `K.container`, `data-mode`
  MutationObserver, `window.<Global> = { init }`) are in `CLAUDE.md`.

## 8. Code and references

- Quote real code, and name every mechanism with its real type and the file it lives in, so a
  reader can check it. Keep quoted doc-comments **byte-identical** — aphorisms inside real source
  comments stay, because they are evidence, not authorial voice.
- Reference blurbs describe the source, not its relationship to your post ("a good place to check
  the primer against" → "the best single survey of LSM variants").

## 9. Checklist before shipping

```bash
npm run build     # must end: leftover placeholders: none / warnings: none
```

Then grep the post, the diagram titles, `build/widgets.json`, and the widget `cap`/`sub`/log
strings for: `this post`, `this section`, `the next `, `Note that`, `worth noticing`, `for free`,
`the entire`, `the whole point`, `the only thing`, `is what makes`, `, not ` (the X-is-Y-not-Z
tell), `used to be`, `nobody`, `everyone`.

And read it once from the top asking: does every component named in the overview get picked up by
the section that owns it, and does any sentence end by explaining why the previous clause was
clever?
