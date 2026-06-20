---
id: FEAT-0016
title: Block-construct rendering
status: draft
depends_on: [FEAT-0006]
---

## Intent

M2 (FEAT-0006) made the editor read as rich content by hiding inline markup —
headings, bold, italic, inline code. But it deliberately scoped out the
block-level constructs, leaving three of them showing their raw markers on
screen: fenced code blocks still display the literal ```` ``` ````, blockquotes
show a leading `>`, and unordered lists show a literal `*`/`-`. Real use surfaced
this as a broken promise — the product claims markup is never visible, yet these
common constructs leak it.

This phase keeps that promise for the three reported gaps. It is rendering only:
no new way to *create* these constructs (the user types CommonMark; Clear
Formatting and any creation shortcuts are separate). As with FEAT-0006, the
document text is never modified — the folder keeps the exact CommonMark the user
typed (the file-fidelity moat); only the *display* changes. Markup stays hidden
on every line including the caret line (the no-flicker rule), exactly like inline
marks.

## Behavior

The editor already parses the document with the Lezer markdown grammar and
decorates the visible viewport. This phase extends the same hide-and-style layer
to three block constructs:

- **Fenced code blocks** (`FencedCode`): the opening fence line (the ```` ``` ````
  run plus an optional language info string, plus the newline that ends that
  line) is collapsed, and the closing fence line (its preceding newline plus the
  closing ```` ``` ````) is collapsed, so neither fence shows on screen. The code
  body between them renders as a monospace block with a subtle background spanning
  the block's lines. The bytes — fences, language tag, indentation, blank lines —
  stay on disk verbatim.
- **Blockquotes** (`Blockquote`): every `>` quote marker on every quoted line
  (including continuation lines of the same quote) is hidden together with the
  single space that follows it, and the quoted lines render with a quote
  treatment (a left border / muted text) so they read as a quotation.
- **Unordered lists** (`BulletList` / `ListItem`): the literal `*` or `-` list
  marker and its trailing space are hidden, and a real bullet glyph is rendered in
  the marker's place so the line reads as a list item. Ordered lists are out of
  scope (no raw-marker complaint; `1.` reads fine).

To express block-level styling that a span decoration cannot — a code block's
background across its lines, a quote's left border, a list item's bullet — the
decoration layer gains **line decorations** alongside the existing replace
(hide) and mark (style) decorations. The pure range-computation function returns
them and the view plugin applies them. The function stays pure (no document
mutation) and range-scoped to the viewport, exactly as today.

Hiding is uniform whether or not the caret is on the line (no reveal-on-cursor),
and hidden marker runs remain atomic so the caret steps over them rather than
landing inside the invisible characters. Decorations follow the viewport so long
notes stay responsive.

## Constraints

- **No document mutation.** Decorations only hide/style; the on-disk bytes are
  unchanged. Saving a note with a code block, quote, or list round-trips the
  original CommonMark verbatim.
- **No reveal-on-cursor.** Block markup is hidden on the caret line too — no
  flicker, matching FEAT-0006.
- Hidden marker runs are atomic so the caret cannot land inside them.
- Rendering is viewport-based (decorate visible ranges) so large notes stay
  responsive.
- The pure range function remains pure and accepts a `[from, to)` scope, matching
  the FEAT-0006 contract — the view plugin is the only stateful piece.

## Out of scope

- **Creating** these constructs via shortcut / slash command / menu — not part of
  this rendering phase.
- **Ordered lists, task lists, tables, images, links** — no reported raw-marker
  complaint; links are M8.
- **Nested / multi-level lists** — render the flat case; deep nesting is not a
  reported pain.
- **Syntax highlighting inside fenced code** — the body renders as a plain
  monospace block; per-language coloring is polish, not a missing promise.
- **Clear Formatting stripping these markers** — that is FEAT-0017 (M5 Phase 2).

## Acceptance criteria

**AC-1** — Fenced-code fence lines are hidden and the body renders as a code block.
Given the document contains a fenced code block (```` ``` ```` … ```` ``` ````,
optionally with a language tag),
When the editor renders it,
Then neither the opening fence line (```` ``` ```` + language) nor the closing
fence line is present in the rendered text, and the code body between them is
styled as a monospace block.

**AC-2** — Blockquote markers are hidden and the content renders as a quote.
Given the document contains a blockquote line `> quoted`,
When the editor renders it,
Then the leading `> ` is not present in the rendered text of that line, and the
quoted text is styled as a quotation (visually set off from body text).

**AC-3** — Every quote marker is hidden across a multi-line blockquote.
Given a blockquote spanning two lines (each beginning with `> `),
When the editor renders it,
Then no `>` marker is present in the rendered text of either line.

**AC-4** — Unordered-list markers are hidden and a bullet is rendered.
Given the document contains a bullet line `* item` (or `- item`),
When the editor renders it,
Then the literal `* `/`- ` marker is not present in the rendered text, and the
line reads as a list item with a bullet glyph in the marker's place.

**AC-5** — Block markup stays hidden on the caret line (no reveal-on-cursor).
Given the caret is placed on a fenced-code fence line, a blockquote line, or a
bullet line,
When the editor renders it,
Then the construct's markers remain hidden (the rendered text of the line does
not contain the raw ```` ``` ````, `>`, or `*`/`-` marker).

**AC-6** — Rendering does not alter the saved document.
Given a note whose content includes a fenced code block, a blockquote, and a
bulleted list,
When the note is saved to disk,
Then the file contains exactly that CommonMark, all markers included (decorations
changed only the display, not the bytes).

**AC-7** — Hidden block markers are atomic to the caret.
Given a bullet line `* item` with the caret at the line start,
When the user presses the Right arrow toward the text,
Then the caret lands on the visible text side of the hidden `* ` marker, never
between the marker and its space.

**AC-8** — Plain prose and out-of-scope constructs are untouched.
Given a paragraph of plain text, or an ordered-list line `1. item`,
When the editor renders it,
Then nothing is hidden or restyled for that line (this phase touches only fenced
code, blockquotes, and unordered lists).
