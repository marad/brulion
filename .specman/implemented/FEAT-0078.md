---
id: FEAT-0078
title: Multi-select and batch delete/move in the sidebar tree
status: draft
depends_on: [FEAT-0070, FEAT-0071, FEAT-0075]
---

## Intent

The sidebar tree acts on one row at a time: to delete or move several notes you
repeat the action once per note, and there is no way to say "these five, move
them together". This adds a selection — a set of rows the user builds up by
keyboard or pointer — and two batch operations over it, **Delete** and **Move**.
Selection is not built as decoration: it exists precisely so those two
multi-item operations become one gesture; without them it would be dead UI.
The operations reuse the existing per-item primitives (and their existence /
conflict guards), so a batch is exactly "the single-row action, applied to each
selected row", never a new bulk path that could bypass the safety checks.

## Behavior

**The selection** is a set of tree rows (notes and/or folders), held as UI state
alongside the expanded-folders set (FEAT-0043) — it is rebuilt into the render,
not written to disk, and does not survive a reload. The tree is marked
`aria-multiselectable`; each selected row carries `aria-selected="true"` and a
visible selected style. A **selection anchor** (the row a range extends from) is
remembered while a selection is being built.

**Building the selection:**
- **Ctrl/Cmd+Space** toggles the focused row in or out of the selection; focus
  does not move, and the toggled row becomes the anchor.
- **Shift+ArrowUp / Shift+ArrowDown** move focus to the adjacent visible row
  (like the plain arrows, FEAT-0075) *and* select the contiguous range of visible
  rows from the anchor to the new focus. With no anchor yet, the row focus starts
  on becomes the anchor.
- **Ctrl/Cmd+click** on a row toggles it in the selection (the pointer
  equivalent of Ctrl/Cmd+Space).
- Once a selection is **active** (non-empty), a plain click / tap on a row
  toggles that row too — a touch-reachable "selection mode" — instead of opening
  it. With **no** active selection, a plain click opens the note exactly as
  before (FEAT-0024), so ordinary single-note use is unchanged.
- **Escape** clears the selection.

**Plain movement never changes the selection:** the plain arrows, Home/End,
Enter/Space activation (FEAT-0075) and typeahead (FEAT-0077) move focus and
open/toggle rows but leave the selection untouched. Only Shift+arrows,
Ctrl/Cmd+Space, and clicks (as above) change it.

**Batch actions** operate on the whole selection:
- **Delete** — the **Delete** key, or a **"Delete N"** entry in the context menu
  of a selected row, removes every selected item. It goes through the existing
  per-item delete primitives (a note via the note-delete path, a folder via the
  recursive folder-delete path, FEAT-0069), after **one** confirmation that names
  the count. Folders in the selection take their contents with them, as a
  single-folder delete does.
- **Move** — a **"Move N…"** entry in the context menu of a selected row opens
  the existing "Move to…" picker (FEAT-0070); choosing a destination moves every
  selected item there through the existing per-item move primitives, each keeping
  its own existence / conflict guard.

After a batch action runs, the selection is cleared. The context menu of a row
that is **not** part of an active multi-selection is the ordinary single-row menu
(FEAT-0071), unchanged.

## Constraints

- Batch Delete and Move reuse the existing per-item primitives
  (`removeNote`/`removeFolder`/`moveNote`/`moveFolder`) with their existence and
  stale-write/conflict guards — no new bulk file-system path that bypasses them.
- One item failing or having vanished (its guard refusing) does not abort the
  rest of the batch; it is handled exactly as the single-row action handles that
  case.
- A batch **Delete** always requires confirmation (it can destroy several notes,
  and whole folders) — consistent with the mandatory single-folder-delete
  confirmation (FEAT-0069).
- Selection is transient UI state (like the expanded set): not persisted, gone on
  reload.
- The FEAT-0075 movement/activation keys and FEAT-0077 typeahead keep their
  behavior; Shift+arrows extend the selection additionally, plain keys never
  touch it.

## Out of scope

- A range that reaches into collapsed (hidden) rows — range selection is over the
  *visible* rows only (FEAT-0075's visible set).
- Batch rename (rename stays single-row, FEAT-0076/FEAT-0072).
- A select-all shortcut.
- Dragging a multi-selection (single-item drag-and-drop, FEAT-0072, is
  unchanged; dragging the whole selection is not added here).
- Persisting the selection across reloads.

## Acceptance criteria

**AC-1** — Ctrl/Cmd+Space toggles the focused row's selection.
Given focus is on a tree row,
When the user presses Ctrl+Space (or Cmd+Space),
Then that row's selection state flips (selected ↔ not), focus stays on it, and it
becomes the selection anchor.

**AC-2** — Shift+Arrow extends a contiguous range and moves focus.
Given focus is on a row that is the selection anchor,
When the user presses Shift+ArrowDown (or Shift+ArrowUp) one or more times,
Then focus moves to the adjacent visible row each press and every visible row
between the anchor and the focused row (inclusive) is selected.

**AC-3** — Ctrl/Cmd+click toggles a row's selection.
Given the tree is rendered,
When the user Ctrl-clicks (or Cmd-clicks) a row,
Then that row's selection state flips, without opening the note.

**AC-4** — Plain click toggles when a selection is active, opens otherwise.
Given a selection is active (at least one row selected),
When the user plainly clicks a row,
Then that row is toggled in the selection and the note is not opened; but given
**no** selection is active, a plain click opens the note as before.

**AC-5** — Escape clears the selection.
Given one or more rows are selected,
When the user presses Escape with focus in the tree,
Then the selection becomes empty and no row is marked selected.

**AC-6** — Selected rows are visually and semantically marked.
Given rows are selected,
Then each selected row carries `aria-selected="true"` (and the tree is
`aria-multiselectable`), and unselected rows do not.

**AC-7** — Batch delete removes every selected item after one confirmation.
Given several rows are selected,
When the user triggers Delete (the Delete key or the "Delete N" menu entry) and
confirms the single confirmation prompt,
Then every selected item is removed through the existing per-item delete
primitive (notes via note-delete, folders recursively), and the selection is
cleared.

**AC-8** — Batch move relocates every selected item to the chosen destination.
Given several rows are selected,
When the user picks "Move N…", chooses a destination folder in the picker,
Then every selected item is moved there through the existing per-item move
primitive, and the selection is cleared.

**AC-9** — A batch reuses the per-item guards and does not abort on one failure.
Given a selection in which one item has been removed externally (or would
conflict),
When a batch delete or move runs,
Then that item is handled exactly as the single-row action handles it (its guard
refusing / reporting), and the remaining selected items are still processed.

**AC-10** — Plain movement and typeahead never change the selection.
Given one or more rows are selected,
When the user presses a plain arrow, Home/End, Enter/Space, or types a typeahead
character,
Then focus/expansion/activation behave per FEAT-0075/FEAT-0077 and the selection
set is unchanged.

**AC-11** — The single-row menu is unchanged outside a multi-selection.
Given a row that is not part of an active multi-selection,
When its context menu is opened,
Then it is the ordinary single-row menu (Rename/Move/Delete, FEAT-0071) with no
batch entries.
