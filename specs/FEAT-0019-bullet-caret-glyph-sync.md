---
id: FEAT-0019
title: Bullet caret/glyph sync
status: draft
depends_on: [FEAT-0016]
---

## Intent

FEAT-0016 renders an unordered-list marker by hiding the `*`/`- ` run as an
atomic range and drawing a bullet glyph with a line `::before` (`•  ` for `*`,
`–  ` for `-`). Real use surfaced a rough edge while the marker is *mid-typing*:
the `::before` glyph has its own width and carries trailing spaces the document
doesn't, so the caret and the rendered bullet drift apart. Type a bare `*` and
the caret looks like it already sits one space in, but the document is still just
`*` — so the next character lands *before* the `*`, which pops back into view at
the line start. Conversely, typing the space that completes `* ` barely moves the
caret, because `* ` hides and the `•  ` glyph takes nearly the same width. Net:
caret position and the drawn bullet disagree as the marker is typed.

This phase makes the caret and the bullet agree at every keystroke. It is
rendering only — the bullet still appears in the marker's place and `*`/`-` still
read as distinct glyphs (the FEAT-0016 promise), and the document text is never
modified (the file-fidelity moat). The fix is *how* the bullet is drawn, not
*what* renders.

## Behavior

The bullet is rendered as a **widget that replaces the marker run**, not a glyph
layered over a separately-hidden marker. The completed `*`/`- ` run (marker plus
its single trailing space) is replaced by a single replacement decoration whose
widget draws the bullet glyph at a **fixed width** sized to the marker. Because
the widget occupies exactly the marker's document range, the caret maps around it
the same way it maps around any replaced range — the position the caret draws and
the glyph the user sees stay in sync as the line changes. The replacement is
atomic, so the caret steps over the bullet to the content rather than landing
inside the hidden marker (preserving FEAT-0016 AC-7).

Following the heading precedent (FEAT-0006: a bare `#` with no trailing space
stays visible), the bullet is rendered **only once the marker is completed by a
trailing space**. A bare `*`/`-` with no following space renders as a literal
marker — there is nothing drawn over it, so there is nothing to disagree with
while the marker itself is being typed. The widget appears the moment the
completing space is typed.

`*` and `-` keep distinct glyphs (a filled disc for `*`, an en-dash for `-`), now
carried by the widget instead of the `::before`. The previous line-level
`::before` glyph and its `cm-list-disc`/`cm-list-dash` classes are no longer the
mechanism that draws the bullet.

**Completing a marker is reversible by Backspace (symmetry).** A trailing space is
what turns a bare marker into a rendered construct (a bullet here; the same is true
of the heading and blockquote markers the editor hides). Because the marker run is
atomic, a default Backspace at the run's end deletes the *whole* marker at once,
which is surprising: the user typed a space to complete the marker and expects
Backspace to undo just that space. So when the caret sits immediately after a
completed marker run (`* `/`- `, and likewise `# `…`###### `, `> `), Backspace
deletes only the trailing space, leaving the bare literal marker; a second
Backspace then removes the marker character itself. This is the exact inverse of
typing the space that completed it. (Nested blockquotes are out of scope, per
FEAT-0016.)

## Constraints

- **No document mutation.** The widget only changes display; the on-disk bytes
  are unchanged. A note with a bulleted list round-trips its CommonMark verbatim.
- **No reveal-on-cursor.** The bullet renders the same whether or not the caret is
  on the line — matching FEAT-0006/0016.
- The marker replacement is atomic so the caret cannot land inside the hidden
  marker run (FEAT-0016 AC-7 still holds).
- Reuse the existing block-decoration plumbing (`blockSyntaxRanges` +
  `blockRenderingField`); add a widget, don't introduce a new module.

## Out of scope

- **Nested / multi-level lists** — still FEAT-0016's flat-list scope.
- **Ordered lists, task lists** — unchanged; no marker rendered.
- **Blockquote and fenced-code rendering** — untouched by this phase; only the
  unordered-list marker changes how it is drawn.

## Acceptance criteria

**AC-1** — A completed marker is replaced by a fixed-width bullet widget.
Given a bullet line `* item` (or `- item`),
When the editor renders it,
Then the `*`/`- ` marker run is replaced by a bullet widget occupying the
marker's document range (not hidden-and-then-drawn-over by a line `::before`), and
the line reads as a list item with the bullet in the marker's place.

**AC-2** — A bare marker with no trailing space stays visible.
Given a line containing just `*` or `-` (no following space yet),
When the editor renders it,
Then the marker is rendered as a literal visible character — no bullet widget is
drawn and the marker run is not hidden.

**AC-3** — `*` and `-` render as distinct glyphs.
Given one bullet line uses `*` and another uses `-`,
When the editor renders them,
Then the two lines show distinct bullet glyphs (a filled disc for `*`, an en-dash
for `-`).

**AC-4** — The caret sits at the content, not before the marker.
Given a bullet line `* item` rendered with the bullet widget,
When the caret is placed at the start of the item's text and the user types a
character,
Then the typed character is inserted into the item text (after the marker run),
and the literal `*` does not reappear at the line start.

**AC-5** — Rendering does not alter the saved document.
Given a note containing a bulleted list,
When the note is saved to disk,
Then the file contains exactly that CommonMark, `*`/`- ` markers included (the
widget changed only the display, not the bytes).

**AC-6** — Backspace after a completed bullet marker deletes only the trailing space.
Given a bullet line `* ` (or `- `), optionally followed by text, with the caret
immediately after the marker run,
When the user presses Backspace,
Then only the trailing space is deleted, leaving the bare literal marker (`*`/`-`)
on the line; a second Backspace then deletes the marker character itself.

**AC-7** — The same Backspace symmetry applies to heading and blockquote markers.
Given the caret is immediately after a completed heading marker (`# `…`###### `) or
a blockquote marker (`> `),
When the user presses Backspace,
Then only the trailing space is deleted, leaving the bare literal marker (`#`…
`######`, or `>`), rather than the whole marker being removed at once.
