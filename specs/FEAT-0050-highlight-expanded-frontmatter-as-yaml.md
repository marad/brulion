---
id: FEAT-0050
title: highlight expanded frontmatter as yaml
status: draft
depends_on: [FEAT-0042, FEAT-0049]
---

## Intent

FEAT-0042 renders a leading `---…---` frontmatter block as a collapsible "metadata"
region; expanded, its raw lines are shown plain. This phase — the follow-up agreed in
the M23 review — paints that **expanded** region as **YAML**, reusing the M15 P1
highlight infrastructure (the `tok-*` token palette), so frontmatter reads with the
same syntax colors as a fenced ```` ```yaml ```` block.

It is **decoration-only and opaque**, exactly the M23 stance: it colors YAML *tokens*
(keys, strings, numbers, booleans, comments), it never *interprets* fields (no
`title`/`tags`/`aliases` meaning), and it never reads-and-rewrites or otherwise
touches the bytes. Because the frontmatter block is detected structurally (FEAT-0042),
not by the markdown grammar, the region's inner text is parsed on its own with the
YAML parser and the resulting token ranges become `tok-*` mark decorations — the same
classes (and CSS palette) M15 P1 uses for code blocks.

Highlighting applies **only while the region is expanded**: collapsed, the block is
replaced by the chip and there is nothing to color. It tracks the collapse state and
document edits through the existing frontmatter state field — no new field, no atomic
ranges, nothing hidden.

## Behavior

**Expanded frontmatter shows YAML token colors.** When the metadata region is
expanded, its inner lines (between the opening `---` and the closing `---`/`...`) are
parsed as YAML and their tokens are colored consistently with code blocks: keys, string
and number values, booleans, and `#` comments each get their token color from the
shared `tok-*` palette (FEAT-0049).

**Collapsed shows nothing to color.** While collapsed, the region is the chip
(FEAT-0042); no YAML marks are emitted. Expanding paints them; collapsing removes them.

**Opaque — tokens only, never fields.** The highlight is purely lexical: it does not
parse or act on `title`, `tags`, `aliases`, or any field; it does not change how the
note is identified or rendered elsewhere. It only assigns colors to YAML token ranges.

**Bytes untouched.** Nothing is hidden, replaced, or made atomic by this phase, and
the document is never rewritten — the frontmatter text the user owns is byte-identical
before and after (the M23/FEAT-0042 moat stance is kept). Editing the raw YAML works
exactly as in FEAT-0042; the colors re-track on each edit.

**Degrades safely.** A frontmatter body that is not valid YAML still renders (the
parser is error-tolerant); whatever tokens it recognizes get colored and the rest
shows plain — never an error, never a broken region.

## Constraints

- **Reuse the M15 P1 palette.** The marks carry the same `tok-*` classes as code
  blocks and are colored by the same CSS — one source of truth for token colors, so
  frontmatter and code look consistent (and both pick up a future theme together).
- **Expanded-only, decoration-only.** Marks are emitted only when the region is
  expanded; nothing is hidden or made atomic, and no document write occurs.
- **Opaque.** Lexical coloring only — no field interpretation, no parse-and-reserialize
  (consistent with FEAT-0042's deliberate opacity).
- **Self-contained parse.** The frontmatter inner text is parsed with the YAML parser
  directly (the block is not part of the markdown grammar), offset back to absolute
  document positions; pure and synchronous (frontmatter is small).
- **Moat untouched.** The bytes are never read for rewriting nor modified; only
  rendering changes.

## Out of scope

- **Field interpretation** (`title`/`tags`/`aliases` semantics) — deferred exactly as
  in FEAT-0042; this phase is lexical only.
- **Highlighting an unclosed/!-leading non-frontmatter `---`** — the FEAT-0042
  detection rules are unchanged; only a recognized, closed leading block is colored.
- **A dark palette** — shares M15 P1's single light palette; a dark variant is M18.
- **Collapsed-chip styling changes** — the chip is unchanged.

## Acceptance criteria

**AC-1** — An expanded frontmatter block shows YAML token colors.
Given a note with a leading `---…---` block containing keys with string and number
values,
When the metadata region is expanded,
Then its tokens are colored as YAML (keys, strings, and numbers get distinct token
colors from the shared palette), consistent with a fenced `yaml` code block.

**AC-2** — A collapsed region is not colored.
Given the same note with the region collapsed (the default),
When it displays,
Then it is the metadata chip with no YAML token marks behind it.

**AC-3** — Highlighting is decoration-only; the bytes are untouched.
Given a note with frontmatter,
When the region is expanded and highlighted (and when the note is saved),
Then nothing is hidden or made atomic by the highlight and the file content is
byte-identical to what the user wrote.

**AC-4** — Colors track edits and collapse state.
Given an expanded, highlighted frontmatter block,
When the user edits a value, then collapses and re-expands the region,
Then the colors re-track the edited text and reappear on expand — no stale marks, none
while collapsed.

**AC-5** — Invalid YAML still renders.
Given a frontmatter body that is not well-formed YAML,
When the region is expanded,
Then it still renders (recognized tokens colored, the rest plain) without raising an
error.
