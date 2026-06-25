---
id: FEAT-0064
title: Reveal code-fence markers on edit
status: draft
depends_on: [FEAT-0016, FEAT-0026]
---

## Intent

Since M5 (FEAT-0016) a closed fenced code block hides its fence lines always — the
opening ```` ```lang ```` and the closing ```` ``` ```` render as empty styled rows
(the code box's padding). That makes the fence and its info string **uneditable in
place**: a typo like ```` ```mermiad ```` or changing ```` ```js ```` → ```` ```ts ````
can't be fixed without deleting the whole block. (Surfaced in the M28 review.) This
phase reveals the fence lines for editing **when the selection is inside the block**,
re-hiding them when the caret leaves — the same reveal-on-selection pattern links
already use (FEAT-0026). Editor-only; no file-behavior change.

## Behavior

When the selection/caret is **inside** a closed fenced code block, the fence lines
are shown raw (the backticks + info string visible and editable); when the selection
is outside, they are hidden as today. The code-box line styling (`cm-code-block`,
rounded top/bottom) stays in both states, so the block still reads as a code box —
the reveal only un-hides the fence *text*, it doesn't drop the box. The reveal uses
the same strict-overlap rule as the other reveals: a caret resting exactly on a block
boundary does not reveal, so a note that opens on a code block still renders it
fenceless.

This applies to **all** fenced blocks. A Mermaid block (FEAT-0056) already reveals its
raw source when the selection is inside it; with this change that revealed source now
also shows its ```` ```mermaid ```` fence, so the info string is editable there too.

## Constraints

- **Editor-only; bytes untouched (the moat).** Revealing is purely a matter of which
  decorations are emitted; no document change.
- **Reuse the existing block field.** The change lives in `blockSyntaxRanges` /
  `blockRenderingField` (`markdown-render.ts`): skip the fence-hide ranges for a block
  the selection overlaps, and rebuild the block field on selection change (it
  currently rebuilds only on document change) — consistent with the link/Mermaid
  reveal layers that already rebuild on selection.
- **Only closed blocks.** An unclosed fence (still being typed) stays fully visible as
  today (FEAT-0016) — unaffected.
- **Caret consistency.** A revealed fence's text is no longer in the hidden/atomic set,
  so the caret rests on it normally (and the Vim caret guard, which reads the same
  `blockSyntaxRanges`, lets the caret onto the now-visible fence).

## Out of scope

- **Revealing inline code** (`` `x` ``) markers — this is about fenced *blocks*.
- **Any change to how the code body or its syntax highlighting renders** — only the
  fence lines' visibility changes.

## Acceptance criteria

**AC-1** — A caret inside a fenced block reveals its fences.
Given a closed fenced block ```` ```js ```` … ```` ``` ````,
When the caret is inside the block (on the info-string line or a body line),
Then the opening ```` ```js ```` and closing ```` ``` ```` lines are shown raw
(editable), not hidden.

**AC-2** — Leaving the block re-hides the fences.
Given the fences are revealed because the caret is inside,
When the caret moves outside the block,
Then the fence lines are hidden again (the code box renders as before).

**AC-3** — The info string is editable in place.
Given the caret is on a revealed ```` ```js ```` line,
When the user edits the info string (e.g. to ```` ```ts ````),
Then the edit applies to the document and, on leaving, the block re-renders — no need
to delete the block.

**AC-4** — The code-box styling persists while revealed.
Given a revealed fenced block,
When it is shown,
Then its lines still carry the code-box styling (it reads as a code block, just with
the fence text visible).

**AC-5** — A block the selection is outside renders fenceless (unchanged).
Given a closed fenced block the caret is not inside,
When it renders,
Then its fence lines are hidden as before (no regression to FEAT-0016).

**AC-6** — A Mermaid block's fence is revealed with its source.
Given a ```` ```mermaid ```` block,
When the caret is inside it (so its raw source is shown, FEAT-0056),
Then the ```` ```mermaid ```` fence line is visible and editable too.

**AC-7** — Bytes are unchanged by reveal/hide.
Given a note with a fenced block,
When the caret enters and leaves it (reveal then hide),
Then the on-disk markdown is byte-for-byte unchanged.
