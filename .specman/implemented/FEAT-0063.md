---
id: FEAT-0063
title: Table rendering
status: draft
depends_on: [FEAT-0016, FEAT-0056]
---

## Intent

A pipe-delimited markdown table (`| a | b |` + a `|---|---|` separator row) currently
shows as raw pipes and dashes — unreadable next to the rest of the rendered prose.
This phase renders a contiguous table block as a real aligned table (header, body,
column borders, per-column alignment), the same spirit as M5 (rendering gaps), M15
(code highlighting), and M28 (Mermaid): **visual only**. It is moat-critical that the
document stays plain pipe-delimited markdown — we decorate how it paints, never touch
the bytes.

## Behavior

**Detection.** A table block is a **separator row** — a line of `|`-separated cells
each matching optional-colon dashes (`:---`, `:--:`, `---:`, `---`) — with a non-blank
**header row** on the line directly above, followed by zero or more **body rows**
(contiguous lines, until a blank line or the end of the document). Outer pipes are
optional (GFM-style: both `| a | b |` and `a | b` parse). Detection scans the
document's lines (the base markdown grammar doesn't parse GFM tables), and **skips
lines inside fenced code blocks** so a `|` in code is never mistaken for a table.

**Rendering.** A detected block is replaced by a rendered `<table>`: the header row as
a header, the body rows as cells, with each column's text alignment taken from the
separator (`:---`→left, `:--:`→center, `---:`→right, plain `---`→default/left). Column
count is the separator's; a body row with fewer cells pads with empties, with more is
truncated (GFM leniency). Cell text is shown as-is (plain text — inline markdown inside
cells is not re-rendered in this phase). The on-disk bytes are unchanged.

**Editing (reveal on selection).** When the selection/caret is inside the table block,
the raw pipe source is shown for editing; moving out re-renders — the same
reveal-on-overlap pattern as fenced code (FEAT-0016) and Mermaid (FEAT-0056). A plain
click on the rendered table places the caret inside the block to reveal its source.

## Constraints

- **Visual only; bytes untouched (the moat).** Rendering is a `Decoration.replace`
  block widget over the existing range; no document change, no parse-and-reserialize.
- **Parse-independent detection.** The block is found by a line scan (header +
  separator + body), not the syntax tree — so it works without the GFM table grammar
  and regardless of incremental-parse progress.
- **Coexists with the other block decorations.** Like Mermaid, the field is a
  whole-doc `StateField` registered alongside `markdownRendering`; a table block's
  replace hides the underlying lines.
- **Reveal-on-selection.** Consistent with FEAT-0016/0056 — the active block shows raw
  source; the rest render.

## Out of scope

- **Inline markdown inside cells** (bold/links rendered within a rendered cell) —
  cells show plain text for now.
- **Editing cells in place** in the rendered table (tab between cells, auto-format) —
  editing is done on the revealed raw source.
- **GFM tables grammar / a markdown extension dependency** — detection is a line scan;
  no new parser extension is pulled in.

## Acceptance criteria

**AC-1** — A header + separator + body renders as a table.
Given a note with `| a | b |`, then `| --- | --- |`, then `| 1 | 2 |`,
When it is not being edited,
Then those three lines render as one `<table>` with a header row (a, b) and a body row
(1, 2), not raw pipes/dashes.

**AC-2** — Column alignment follows the separator.
Given a separator `| :--- | :--: | ---: |`,
When the table renders,
Then the three columns are left-, center-, and right-aligned respectively.

**AC-3** — Outer pipes are optional.
Given a table written without leading/trailing pipes (`a | b` / `--- | ---` / `1 | 2`),
When it renders,
Then it produces the same two-column table.

**AC-4** — A `|` inside a fenced code block is not treated as a table.
Given a fenced code block whose lines contain `|` and a `---|---`-looking line,
When the document renders,
Then no table is rendered from inside the code block (the code block renders as code).

**AC-5** — Selecting inside the table reveals the raw source.
Given a rendered table,
When the selection/caret moves inside the block,
Then the raw pipe-delimited lines are shown (editable); moving out re-renders the
table.

**AC-6** — A header with no separator row does not render as a table.
Given a line `| a | b |` followed by a normal paragraph (no separator row),
When the document renders,
Then it is not turned into a table (a separator row is required).

**AC-7** — Ragged body rows are padded/truncated to the column count.
Given a 2-column table whose a body row has 1 cell and another has 3,
When it renders,
Then the short row gets an empty trailing cell and the long row is truncated to 2
cells (no crash, no extra column).

**AC-8** — The document bytes are unchanged.
Given a note containing a table,
When it renders and re-renders (selection in/out),
Then the on-disk markdown is byte-for-byte the original pipe-delimited text.
