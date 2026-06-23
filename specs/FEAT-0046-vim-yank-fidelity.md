---
id: FEAT-0046
title: vim yank fidelity
status: draft
depends_on: [FEAT-0045, FEAT-0021]
---

## Intent

FEAT-0045 fixed copy fidelity for the **system clipboard** path (the DOM
`copy`/`cut` event). It did not touch Vim's yank, which is a *separate* mechanism:
`@replit/codemirror-vim`'s yank operator stores the raw `getSelection()` text in
Vim's own register, never firing a DOM copy event. So a Vim user who selects a
heading's visible text in visual mode and presses `y` yanks `Hello world` without
the leading `# ` (atomic hidden markup snaps the selection past it, exactly as the
clipboard path did before FEAT-0045) — `p` then pastes plain text, not a heading.
Yanking inside a bold span drops the `**`. The defect reported in the M22 review:
copy fidelity is only half-fixed for the Vim workflow.

This phase routes Vim's yank through the **same** boundary-repair serializer
(`serializeCopy`, FEAT-0045) so the Vim register receives the same well-formed
markdown the clipboard does. One source of truth for "what does copying this
selection mean", whether the copy is a Ctrl/Cmd+C or a Vim `y`.

The fix overrides the package's `yank` operator (`Vim.defineOperator`). The vim
package guarantees the live CodeMirror selection matches the operator's input
range, so serializing `view.state.selection.ranges` reproduces exactly what the
operator's own `getSelection()` would have yanked — only repaired. Editor-layer
only; no on-disk bytes change.

## Behavior

**Vim yank serializes the selection like copy does.** When Vim mode is active and a
yank fires — charwise/linewise visual-mode `y`, `Y`, or an operator-motion yank
(`yiw`, `yy`, …) — the text placed into the target register is
`serializeCopy(view.state, view.state.selection.ranges)`: the selected source with
the same boundary repairs FEAT-0045 applies (a partially-selected line's leading
block marker pulled in; inline `**`/`*`/`` ` `` delimiters synthesized around a
fragment; nested delimiters ordered; verbatim). A subsequent `p`/`P` therefore
pastes well-formed markdown that reproduces the visible formatting.

**Register routing and clipboard are unchanged.** The serialized text flows through
the existing register controller exactly as before: the unnamed register, the
numbered `0` yank register, a named register (`"ay`), and the `+` clipboard register
(`"+y`, which writes the text to the system clipboard) all receive the serialized
markdown. Nothing about *which* register is chosen changes — only the text's
fidelity.

**Post-yank cursor is unchanged.** After a visual-mode yank the cursor returns to
the start of the selection, and after an operator-motion yank to the operator's
anchor — identical to the stock operator. Overriding the operator does not change
its returned cursor position.

**Only yank is affected.** The `delete`/`change` operators (`d`, `c`, `x`, …) are
untouched, so deletion and its register contents behave exactly as before. The
system-clipboard copy/cut path (FEAT-0045) is independent and unchanged. With Vim
mode off, nothing in this phase is reachable.

## Constraints

- **One serializer.** Vim yank and clipboard copy both go through the single
  `serializeCopy` from FEAT-0045 — no second re-serialization path. Its purity and
  totality are unchanged.
- **Selection is the operator's input.** The override reads `view.state.selection`,
  which the vim package documents as guaranteed to match the operator's range — so
  the override yanks neither more nor less than the stock operator would.
- **Minimal surface.** Only the `yank` operator is redefined (via the package's
  public `Vim.defineOperator` / `Vim.getRegisterController` API). No fork, no
  patch of package internals, no change to delete/change/paste.
- **Moat: untouched.** Editor/register layer only; nothing is read from or written
  to the folder.
- **Off-vim no-op.** The override installs globally but is only ever invoked while
  Vim mode is active; it adds nothing to the non-Vim path.

## Out of scope

- **Delete/change register fidelity.** `d`/`c` store raw text in their registers as
  today; only yank is repaired here (matching the M22 report). A later phase may
  extend the same treatment to delete if wanted.
- **Paste transformation.** `p`/`P` paste the register text verbatim, as today; this
  phase changes only what yank *stores*, not how paste renders it.
- **Vim caret-on-hidden-markup behavior** — FEAT-0032 already governs where the Vim
  caret may rest; this phase does not change motions or selection bounds, only the
  text serialized from whatever range Vim yanks.
- **The `:yank` ex-command** — the line-oriented `:y` ex-command is left as-is
  (a niche path that yanks whole lines, where there is no boundary to repair).

## Acceptance criteria

**AC-1** — Visual-mode yank of a heading's visible text keeps the marker.
Given Vim mode is on and the caret is on a rendered heading line,
When the user visually selects the heading's visible text and presses `y`, then
pastes with `p`,
Then the pasted text is a heading (`# …`) — the leading marker is preserved.

**AC-2** — Visual-mode yank of a bold fragment keeps its delimiters.
Given Vim mode is on and a bold span is rendered with hidden `**`,
When the user visually selects text inside the bold span and yanks it, then pastes,
Then the pasted text is wrapped in `**…**`.

**AC-3** — The clipboard register receives the serialized markdown.
Given Vim mode is on,
When the user yanks a heading's visible text to the clipboard register (`"+y`),
Then the system clipboard holds the heading marker form (`# …`), consistent with the
FEAT-0045 Ctrl/Cmd+C result.

**AC-4** — A yank whose selection already spans the markers is unchanged.
Given a selection that already includes a construct's markers (a linewise `yy` on a
heading, or a visual selection covering the whole `**bold**`),
When the user yanks it,
Then the register text equals the raw selected source — no marker is doubled (the
`serializeCopy` byte-identity contract).

**AC-5** — Delete/change and the non-Vim clipboard are unaffected.
Given Vim mode is on,
When the user deletes or changes text (`d`/`c`/`x`),
Then the register contents are the raw deleted text as before; and the
system-clipboard copy/cut path (FEAT-0045) continues to behave exactly as specified
there.
