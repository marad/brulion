---
id: FEAT-0006
title: Hidden-syntax rendering
status: draft
depends_on: [FEAT-0005]
---

## Intent

This is the heart of the product and the differentiator over `papier`: the
editor should read as rich content, not as raw markdown. M1 left the markup
visible as plain text. Here we make the markdown markup **invisible** — `# `,
`*`, `**`, `` ` `` are hidden, and the text they wrap renders as a heading, bold,
italic, or inline code. The folder still holds plain markdown the user owns
(the moat): we never change the document text, only how it is *displayed*.

Crucially, syntax stays hidden on **every** line, including the line the caret is
on. Obsidian reveals the raw markers when you enter a node, which flickers; the
explicit goal here is "markup never visible, no flicker". Always-hiding is also
simpler — display rebuilds only when the document or the viewport changes, not on
every cursor move. To keep the caret from snagging on the invisible characters,
hidden runs are treated as atomic, so arrow keys and clicks step over them.

This phase is rendering only: no new way to *create* formatting yet (shortcuts,
slash commands, and the context menu are later phases). You can see the effect by
typing raw markdown and watching it render.

## Behavior

The editor parses the document as markdown (Lezer markdown grammar) and decorates
the visible viewport so that:

- **ATX headings** (`# ` … `###### `): the leading `#` run and the single space
  after it are hidden; the heading text is styled larger/bolder by level (at
  least H1, H2, H3 are visually distinct).
- **Bold** (`**text**` or `__text__`): the surrounding `**`/`__` marks are hidden;
  the inner text renders bold.
- **Italic** (`*text*` or `_text_`): the surrounding `*`/`_` marks are hidden; the
  inner text renders italic.
- **Inline code** (`` `text` ``): the surrounding backticks are hidden; the inner
  text renders in a monospace style.

Hiding applies uniformly whether or not the caret is on the line. The hidden
marker runs are atomic: pressing ← / → or clicking near a hidden marker places
the caret on the visible side of it, never between the invisible characters.
Decorations cover the whole document as the user scrolls (the viewport is
re-decorated), so rendering is correct for long notes, not just the first screen.

The document text is never modified by rendering — saving the note writes exactly
the markdown that was typed, markers included. Loading a note that already
contains markdown immediately shows it rendered.

## Constraints

- **No document mutation.** Decorations only hide/style; the on-disk bytes are
  unchanged. Saving a rendered note round-trips the original markdown verbatim.
- **No reveal-on-cursor.** Markup is hidden on the caret line too — no flicker.
- Markup runs that are hidden must be atomic so the caret cannot land inside them.
- Rendering must be viewport-based (decorate visible ranges) so large notes stay
  responsive.
- Scope is headings + bold + italic + inline code only. Lists, blockquotes,
  links, images, tables, and code fences are out of this phase.

## Out of scope

- Creating/toggling formatting via shortcuts, slash commands, context menu — later
  M2 phases (FEAT-0007+).
- Lists, blockquotes, links, images, tables, fenced code blocks — later, per
  feature.
- Underline — rejected outright (see `DECISIONS.md`).

## Acceptance criteria

**AC-1** — Heading markers are hidden and the heading is styled.
Given the document contains a line `# Title`,
When the editor renders it,
Then the literal `# ` prefix is not present in the rendered text of that line,
and the heading text is styled larger than body text.

**AC-2** — Bold markers are hidden and the text renders bold.
Given the document contains `**bold**` (or `__bold__`),
When the editor renders it,
Then the `**` markers are not present in the rendered text, and the word renders
with bold font weight.

**AC-3** — Italic markers are hidden and the text renders italic.
Given the document contains `*word*` (or `_word_`),
When the editor renders it,
Then the `*` markers are not present in the rendered text, and the word renders
in italic style.

**AC-4** — Inline-code backticks are hidden and the text renders monospace.
Given the document contains `` `code` ``,
When the editor renders it,
Then the backticks are not present in the rendered text, and the span renders in
a monospace font.

**AC-5** — Markup stays hidden on the caret line (no reveal-on-cursor).
Given a line containing `**bold**`,
When the caret is placed on that line,
Then the `**` markers remain hidden (the rendered text of the line does not
contain `**`).

**AC-6** — Rendering does not alter the saved document.
Given a note whose content is `# Title` plus `**bold**` markdown,
When the note is saved to disk,
Then the file contains exactly that markdown, markers included (decorations
changed only the display, not the bytes).

**AC-7** — The caret steps over hidden markers atomically.
Given a line containing `**bold**` with the caret at the line start,
When the user presses the Right arrow into the word,
Then the caret lands on the visible text side of the hidden `**`, never between
the two `*` characters.
