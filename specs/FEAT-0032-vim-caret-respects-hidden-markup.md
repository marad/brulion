---
id: FEAT-0032
title: vim caret respects hidden markup
status: draft
depends_on: [FEAT-0016, FEAT-0021]
---

## Intent

With Vim mode on (FEAT-0021), the Vim caret can come to rest on characters that
are visually hidden — a heading's line-start `#`, a blockquote's `>`, an unordered
list's `*`/`-` marker. The editor hides those runs (FEAT-0006/FEAT-0016) and marks
them atomic so the **default** caret steps over them; but the Vim plugin computes
its motions by raw character offset (`cur.ch ± n`) and never consults the editor's
atomic ranges, so `h`/`l`/`0`/`w`/… can land the caret inside a run the user
can't see. The caret then appears to stop on "nothing", and edits made from there
act on hidden markup.

This phase makes the Vim caret obey the same rule the default caret already does:
it must never rest where the user can't see it — neither **strictly inside** a
hidden markup run nor **before a line's leading hidden run** (the line-start `#`,
`>`, or list marker). The latter matters because a hidden run is zero-width: the
line-start position and the position just after the marker render at the *same*
spot, so a `0`/`^`/`I` that lands before the marker silently inserts ahead of it
(`foo# test` instead of `# foo test`). The fix is a selection-correcting
transaction filter that snaps an offending endpoint — forward past a leading
hidden run to the first visible character, or to the nearest edge of an interior
run — reusing the renderer's own pure range functions
(`markdownSyntaxRanges`/`blockSyntaxRanges`) so "what is hidden" is computed
exactly once and stays consistent with what's on screen.

This is pure interaction state. Nothing is read from or written to the user's
folder; the on-disk markdown is untouched (the file-fidelity moat).

## Behavior

A transaction filter inspects every transaction that **explicitly sets a
selection** — which is how the Vim layer dispatches its motions. For each
selection endpoint (anchor and head) it computes the hidden markup runs on that
endpoint's line (the same runs the renderer hides) and corrects the endpoint:

- **Leading hidden run.** If everything from the line start up to the endpoint is
  hidden (the endpoint is within, or exactly at the start edge of, the run that
  begins the line — chaining through adjacent runs like nested `> > `), the
  endpoint snaps **forward to the first visible character**. So `0`/`^`/`I` and a
  leftward motion all land on the first visible glyph, never before the marker.
- **Interior run.** Otherwise, if the endpoint falls **strictly between** a run's
  start and end, it snaps to the run's **end** when the motion moved forward (the
  new position is at or after its previous one), or the run's **start** when it
  moved backward.

A position on an interior run's edge, or anywhere with visible content before it
on the line, is already valid and left as-is.

Scope and safety:

- **Pointer selections are exempt.** A transaction carrying the
  `select.pointer` user event (a mouse click) is returned untouched, so clicking
  to place the caret inside a link still reveals its markup (FEAT-0026).
- **Only selection-only transactions are corrected** (no document change). Vim
  motions carry no edit; skipping transactions that change the document avoids
  re-mapping appended selections and keeps the filter off the typing path.
- **The hidden runs are recomputed from the post-transaction state**, so a link
  the new selection reveals (and which therefore is no longer hidden) does not
  trap the caret.
- **The default caret is unaffected.** The filter lives in the Vim compartment and
  is installed only while Vim is on; the default caret is governed by CodeMirror's
  atomic ranges and is never touched by it.

The hidden runs considered are the inline/heading markup runs from
`markdownSyntaxRanges` and the block markup runs plus the list-marker (bullet)
runs from `blockSyntaxRanges` — i.e. exactly the ranges the editor renders as
atomic.

## Constraints

- **Reuse the renderer's range functions.** No second way of deciding what markup
  is hidden — call `markdownSyntaxRanges`/`blockSyntaxRanges` (scoped to the
  endpoint's line for cheapness).
- **No file writes.** The filter only corrects the editor selection; it never
  touches the document text or the user's folder.
- **No regression to existing editor behavior.** Default caret, link
  caret-reveal, slash/format/Enter commands, visual-mode selection, and
  block/inline rendering all keep working.
- **Lean.** One small extension wired into the editor; no new dependency, no
  remount.

## Out of scope

- **Reveal-on-cursor for hidden markup** — the markup stays hidden under the Vim
  caret (no Obsidian-style reveal); the caret simply doesn't sit inside it.
- **Redefining Vim operators/edits over hidden runs** (`d`/`c`/`x` trimming
  markup precisely) — this phase governs the caret's *resting* position only.
- **Vertical-motion column handling** (`j`/`k` preferred column landing inside a
  run) beyond the same per-endpoint snap — the snap applies wherever an endpoint
  lands, but the ACs target horizontal motions where the defect was reported.

## Acceptance criteria

**AC-1** — A line-start motion skips a hidden heading marker.
Given Vim mode is on and the caret is somewhere on a `# Heading` line (the `# `
hidden),
When the user presses `0` (start of line),
Then the caret lands on the first visible heading character (`H`), not before or
inside the hidden `# ` run.

**AC-2** — Insert-at-line-start inserts after the hidden marker.
Given Vim mode is on, a line is `# test`, and the caret is in it,
When the user presses `I` (insert at the first non-blank) and types `foo `,
Then the line becomes `# foo test` — the text is inserted after the hidden `# `
marker, not before it (`foo# test`).

**AC-3** — A blockquote marker is skipped.
Given Vim mode is on and the caret is on a `> quoted` line,
When the user moves to the start of the line (`0` / `^`),
Then the caret lands on the first visible quote character, not before or inside
the hidden `> ` run.

**AC-4** — A list marker is skipped.
Given Vim mode is on and the caret is on a `* item` (or `- item`) line,
When the user moves to the start of the line (`0` / `^`),
Then the caret lands on the first visible item character, not before or inside the
hidden `* `/`- ` marker run.

**AC-5** — A backward motion cannot enter the leading marker.
Given Vim mode is on and the caret is on the first visible character after a
hidden line-start run,
When the user moves left (`h` / `0`),
Then the caret stays on the first visible character — it never moves before or
into the hidden marker.

**AC-6** — The default caret and existing commands are unchanged.
Given Vim mode is off,
When the user navigates and edits a document containing headings, blockquotes, and
lists,
Then the caret and every editor command behave exactly as before this phase (the
guard is installed only with Vim).

**AC-7** — A click can still reveal a link's markup.
Given a line containing an inline or wikilink with hidden markup,
When the user clicks to place the caret on it,
Then the link reveals its markup as before (FEAT-0026) — the pointer selection is
not snapped away.

**AC-8** — No write to the user's folder.
Given a folder is open and Vim mode is on,
When the user moves the caret across hidden markup,
Then nothing is written to the open folder — only the editor selection changes.
