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
it must never rest **strictly inside** a hidden markup run. The fix is a
selection-correcting transaction filter that snaps an offending endpoint to the
nearest edge of the run, reusing the renderer's own pure range functions
(`markdownSyntaxRanges`/`blockSyntaxRanges`) so "what is hidden" is computed
exactly once and stays consistent with what's on screen.

This is pure interaction state. Nothing is read from or written to the user's
folder; the on-disk markdown is untouched (the file-fidelity moat).

## Behavior

A transaction filter inspects every transaction that **explicitly sets a
selection** — which is how the Vim layer dispatches its motions. For each
selection endpoint (anchor and head) it computes the hidden markup runs on that
endpoint's line (the same runs the renderer hides) and, if the endpoint falls
**strictly between** a run's start and end, it moves the endpoint to an edge:

- to the run's **end** when the motion moved the endpoint forward (its new
  position is at or after its previous one),
- to the run's **start** when the motion moved it backward.

A position exactly on a run's edge (`from` or `to`) is already valid and is left
as-is — so a heading caret may sit at the line start (before the hidden `#`),
which renders at the same place as the first visible glyph.

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
- **The default caret is unaffected.** CodeMirror already keeps it out of atomic
  ranges, so its selection endpoints are never strictly inside a run and the
  filter is a no-op for it. The correction is thus a shared invariant, not a
  Vim-only special case.

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

**AC-1** — A forward motion skips a hidden heading marker.
Given Vim mode is on and the caret is at the start of a line `# Heading` (the `# `
hidden),
When the user moves the caret right by one character (`l`) from the line start,
Then the caret lands on the first visible heading character (`H`), not inside the
hidden `# ` run.

**AC-2** — Line-start motions land at a run edge, not inside it.
Given Vim mode is on and the caret is somewhere on a `# Heading` line,
When the user presses `0` (start of line),
Then the caret rests at the line start edge (it renders at the first visible
glyph) and never strictly inside the hidden `# ` run.

**AC-3** — A blockquote marker is skipped.
Given Vim mode is on and the caret is on a `> quoted` line,
When the user moves to the first character of the quote (`^` / repeated `l` from
the start),
Then the caret lands on the first visible quote character, not inside the hidden
`> ` run.

**AC-4** — A list marker is skipped.
Given Vim mode is on and the caret is on a `* item` (or `- item`) line,
When the user moves toward the item text from the line start,
Then the caret lands on the first visible item character, not inside the hidden
`* `/`- ` marker run.

**AC-5** — A backward motion snaps to the run's start.
Given Vim mode is on and the caret is on the first visible character after a
hidden line-start run,
When the user moves left across the run (`h` / `b` / `0`),
Then the caret comes to rest at the run's start edge (the line start), never
strictly inside it.

**AC-6** — The default caret and existing commands are unchanged.
Given Vim mode is off,
When the user navigates and edits a document containing headings, blockquotes, and
lists,
Then the caret and every editor command behave exactly as before this phase (the
filter is a no-op for the default caret).

**AC-7** — A click can still reveal a link's markup.
Given a line containing an inline or wikilink with hidden markup,
When the user clicks to place the caret on it,
Then the link reveals its markup as before (FEAT-0026) — the pointer selection is
not snapped away.

**AC-8** — No write to the user's folder.
Given a folder is open and Vim mode is on,
When the user moves the caret across hidden markup,
Then nothing is written to the open folder — only the editor selection changes.
