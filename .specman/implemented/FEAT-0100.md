---
id: FEAT-0100
title: Compact heading hierarchy
status: draft
depends_on: [FEAT-0006, FEAT-0047, FEAT-0065]
---

## Intent

The rich editor currently scales every Markdown heading far above body text,
which makes quick-capture notes feel more like slide decks than a calm notepad.
Keep heading semantics and the decoration-only rendering model, but make the
hierarchy quiet: H1 and H2 are modestly larger, while H3 through H6 use body
size with bold weight.

## Behavior

The heading decorations keep their existing `cm-h1` through `cm-h6` classes and
continue to hide only Markdown syntax. H1 renders at approximately `1.35em`, H2
at approximately `1.15em`, and H3–H6 at `1em` with the heading's bold weight.
The sizes remain relative to the editor's base `--editor-font-size`, so the
existing text-size setting scales the entire hierarchy. No heading color,
indentation, automatic margins, or Markdown serialization is added; the same
rules apply under both light and dark themes.

## Acceptance criteria

- AC-1: Given a rendered note containing ATX headings from H1 through H6, when
  the editor paints them, then H1 is about `1.35em`, H2 about `1.15em`, and
  H3–H6 are body-sized (`1em`) with bold heading weight; no heading is rendered
  at the former oversized scale.
- AC-2: Given the user's base text-size setting changes, when the same heading
  is rendered, then its computed pixel size scales with the body size while
  preserving the relative hierarchy.
- AC-3: Given light and dark editor themes, when headings are rendered, then the
  compact size/weight hierarchy remains the same and no custom heading color or
  indentation is introduced.
- AC-4: Given a note containing headings and inline bold text, when the editor
  renders or the user changes heading size/theme settings, then the original
  Markdown bytes remain unchanged and heading/inline decorations remain
  separate.

## Out of scope

- New heading syntax, a table of contents, outline/navigation UI, or heading
  margins/indentation.
- Per-heading colors or theme-specific hierarchy values.
- A typography redesign outside the existing heading classes and base text-size
  variable.
