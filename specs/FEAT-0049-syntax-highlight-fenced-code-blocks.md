---
id: FEAT-0049
title: syntax-highlight fenced code blocks
status: draft
depends_on: [FEAT-0016]
---

## Intent

FEAT-0016 renders a closed fenced code block as a box but leaves its contents as
plain, uncolored text. This phase gives that body **syntax colors** for the popular
languages, driven by the fence's info string (```` ```ts ````, ```` ```python ````,
…). It is **editor-only**: the on-disk markdown bytes are never read for this, never
rewritten — purely how the block is painted (the file-fidelity moat is untouched).

The mechanism is CodeMirror's built-in nested-language support for markdown. The
`markdown()` language is given a `codeLanguages` resolver (`@codemirror/language-data`)
so a fenced block whose info string names a known language is parsed by that
language's grammar, producing a sub-tree of language tokens. A `HighlightStyle`
mapped onto those tokens (via `syntaxHighlighting`) paints them in colors tuned for
the editor's light theme.

Language parsers **load lazily**: the dynamic import for a language fires only when a
block of that language first appears, so a note with no code blocks pays nothing, and
the service worker (FEAT-0029) caches each loaded parser chunk cache-first — so after
one online encounter the language also highlights offline. A block with an unknown
info string, or none, stays plain exactly as today (graceful, never an error).

Crucially, the highlight style targets only **programming-token** tags; it does not
style the tags markdown prose carries (headings, emphasis, links, lists), so the
existing decoration-based prose rendering (FEAT-0002 onward) is unchanged.

## Behavior

**Fenced blocks are parsed by their language.** When a closed fenced block's info
string matches a language known to the resolver (by name or alias — e.g. `ts`,
`typescript`; `js`, `javascript`; `py`, `python`; `json`; `html`; `css`; `yaml`; …),
the block body is parsed by that language and its tokens become colored. The fence
lines themselves remain hidden/rendered as the box edges exactly as FEAT-0016
specifies — this phase only adds color inside the box.

**Lazy, cached language loading.** A language's parser is fetched on demand the first
time a block needs it; until it resolves the block shows plain (then repaints when
ready). Loaded parser chunks are same-origin static assets, so the existing service
worker caches them — a language used once online highlights offline thereafter.

**Unknown or absent info strings stay plain.** A fence with no info string, or one
naming a language the resolver doesn't know, renders as today: a plain box with
uncolored text. No error, no console noise.

**Markdown prose styling is unchanged.** The highlight style defines only
programming-language token tags (keyword, string, number, comment, operator,
variable/property/type/class/function names, boolean, null, regexp, escape, meta,
and the like). It does not define the tags markdown content uses for headings,
emphasis, strong, links, or lists, so heading sizes, bold/italic, link styling, and
list rendering are exactly as before.

**Moat untouched.** Nothing about the block's bytes changes; the highlight is purely
a rendering of the parsed tokens. Copy/cut still serialize the raw source
(FEAT-0045), unaffected.

## Constraints

- **Editor-only, no byte changes.** Highlighting is decoration/parse-driven painting;
  the file content is never modified, and the copy path is unaffected.
- **Lazy by default.** Language parsers must not be eagerly bundled into the initial
  load; a code-free note must not pay for any language grammar. Loading is on demand
  via the resolver's dynamic imports.
- **Prose rendering is not disturbed.** The highlight style must not style tags used
  by markdown prose; adding it must leave headings/emphasis/links/lists pixel-stable.
- **Graceful unknowns.** An unrecognized or empty info string yields the current
  plain box — never a thrown error or a broken render.
- **Lean.** Use the off-the-shelf `@codemirror/language-data` resolver rather than
  hand-maintaining a language registry; one small highlight style, no per-language
  custom code.

## Out of scope

- **Highlighting the expanded frontmatter as YAML** — FEAT-0050 (M15 P2), which
  reuses this phase's `HighlightStyle`.
- **A language picker / per-block language override UI** — the info string is the
  only source of the language, as in plain markdown.
- **Theme-aware (light/dark) highlight palettes** — a single light-theme palette here;
  a dark palette is M18's concern when the theme lands.
- **Inline code** (`` `x` ``) coloring — inline code is not a fenced block and stays
  as its current monospace rendering.

## Acceptance criteria

**AC-1** — A fenced block with a known info string is parsed by that language.
Given a closed fenced block whose info string names a supported language (e.g.
`js`),
When the document is parsed,
Then the markdown syntax tree nests that language's sub-tree over the block body (the
body is no longer a single opaque code-text node).

**AC-2** — A supported code block shows colored tokens.
Given a rendered `js`/`ts`/`json`/`python` fenced block with keywords, strings, and
numbers,
When it displays,
Then distinct token categories are painted in distinct colors (multiple highlight
spans appear within the box), not a single uniform color.

**AC-3** — An unknown or absent info string stays plain.
Given a fenced block with no info string, or one naming an unknown language,
When it displays,
Then it renders as a plain code box with uncolored text — no error is raised.

**AC-4** — Markdown prose styling is unchanged.
Given headings, bold/italic text, links, and lists outside any code block,
When the highlight style is active,
Then their rendering (heading sizes, emphasis, link styling, list markers) is
identical to before this phase.

**AC-5** — The on-disk bytes are untouched.
Given a note containing fenced code blocks,
When the blocks are highlighted (and when the note is saved),
Then the file content is byte-identical to what the user wrote — highlighting never
rewrites the source, and copy/cut still yield the raw markdown.
