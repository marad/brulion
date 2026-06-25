---
id: FEAT-0067
title: Preserve scroll and caret on external refresh
status: draft
depends_on: [FEAT-0011, FEAT-0022]
---

## Intent

When the M4 poller notices the open note changed on disk (another tool edited it,
a sync landed) it reloads the buffer by replacing the **whole** document
(`setEditorText`: `changes {from:0, to:len}`). CodeMirror maps every position onto
that wholesale replace, so the caret jumps to the end and the view snaps to the top —
the reader loses their place on every external refresh, even when the change was a
one-character edit far from where they were reading. This phase reloads via a
**minimal change** so the caret and the scroll position survive, while keeping the
existing conflict guards (unsaved local edits still raise a conflict, never a silent
clobber).

## Behavior

**Minimal-diff reload.** Computing the difference between the current buffer and the
new disk content as the **longest common prefix + longest common suffix**, only the
differing middle span is replaced — a single contiguous CodeMirror change
`{from, to, insert}` (no diff library; identical content is a no-op, dispatching
nothing). This is the only change to how an external refresh updates the buffer.

**Caret preservation.** The reload dispatches just the `changes` (no explicit
selection), so CodeMirror maps the existing selection through them: a caret before the
changed span stays put, a caret after it shifts by the edit's length delta — it no
longer collapses to the document end.

**Scroll preservation.** Before dispatching, the document position at the top of the
viewport is captured; it is mapped through the change and scrolled back to the top
(`scrollIntoView`, `y: "start"`) so the same text stays under the reader's eyes — even
when the edit landed above the viewport and shifted everything down.

**Guards unchanged.** The conflict / clobber-prevention logic in `refreshFromDisk`
(skip while own save in flight, raise a conflict on unsaved edits, re-check after the
read) is untouched; only the safe reload call swaps `setEditorText` for the minimal
reload. Initial note load and programmatic note-switch keep using the wholesale set —
this is specifically the *external-refresh of the already-open note* path.

## Constraints

- **No diff library.** A hand-written prefix/suffix scan, per the lean ethos.
- **One contiguous change.** Prefix+suffix yields a single middle replace, which is
  enough to preserve position; a full LCS/multi-hunk diff is out of scope.
- **No note bytes change (the moat).** The reload is read-only into the editor; this
  phase writes no `.md`.
- **The programmatic-load annotation still rides the reload** so it doesn't trip
  autosave (the buffer matches disk after it).

## Out of scope

- **A multi-hunk / line diff** or sharing a diff structure back into the M7 conflict
  view (MergeView computes its own).
- **Exact sub-line scroll restoration** — restoring the top line is enough; pixel-exact
  intra-line offset is not required.
- **Preserving scroll/caret across a *conflict* resolution** — that path is unchanged.

## Acceptance criteria

**AC-1** — An external edit no longer jumps the view to the top.
Given the open note is scrolled down with the caret mid-document,
When another tool changes a line *above* the viewport and the poller reloads it,
Then the same text the reader was looking at stays in view (the viewport is not reset
to the top).

**AC-2** — The caret survives an external reload.
Given the caret is at a position in the open note,
When the poller reloads an external change that does not touch the caret's surroundings,
Then the caret stays at the same logical position (it does not collapse to the end).

**AC-3** — The reload replaces only the differing span.
Given a buffer and new disk content sharing a common prefix and suffix,
When the minimal-diff is computed,
Then it is a single `{from, to, insert}` covering only the middle that differs (and is
a no-op when the content is identical).

**AC-4** — The conflict guard is preserved.
Given unsaved local edits to the open note,
When the same note also changed on disk,
Then a conflict is raised (as before) — the minimal reload never silently overwrites
local edits.

**AC-5** — No note bytes change.
Given any external refresh,
When the buffer is caught up to disk,
Then no `.md` file is written by the reload.
