---
id: FEAT-0076
title: F2 renames the focused sidebar tree row
status: draft
depends_on: [FEAT-0072, FEAT-0075]
---

## Intent

Renaming a note or folder from the sidebar is reachable only through the context
menu — right-click, long-press, or Shift+F10 then picking "Rename…" (FEAT-0072).
A keyboard user navigating the tree (FEAT-0075) who wants to rename the row they
are on has to detour through that menu every time. F2 is the near-universal
file-explorer / IDE convention for "rename the selected thing"; wiring it to the
row that has focus removes the detour and completes the keyboard story for the
one action people reach for most while browsing. It adds no new rename behavior —
it is a second trigger for the flow FEAT-0072 already defines, so there is one
rename path, not two.

## Behavior

While focus is on a tree row (a note's name button or a folder header), pressing
**F2** starts renaming *that* row through the exact flow its context-menu
"Rename…" runs: a note routes to the note-rename entry point, a folder to the
folder-rename entry point (FEAT-0072), which opens the in-app rename prompt
seeded with the current leaf name (FEAT-0073). Committing or cancelling that
prompt behaves identically to having opened it from the menu.

F2 is handled by the same tree keydown handler that owns the other tree keys
(FEAT-0075) and only when focus is on a row, so it never fires while the editor,
a dialog, an overlay, or any other surface holds focus. It is the only key this
feature adds; every other key keeps its FEAT-0075 behavior. The feature performs
no file operation of its own — the only write that can result is the one the
existing rename flow performs when the user commits the prompt.

## Constraints

- F2 reuses the existing rename entry points (a note's `onRenameNote`, a
  folder's `onRenameFolder`) — no second rename code path, no divergent
  validation or conflict handling.
- The key is handled only when focus is within the tree on a row; it is inert
  everywhere else.
- Pressing F2 by itself writes no file; a file changes only if the user then
  commits the rename prompt, exactly as with the menu-triggered rename.
- The roving-tabindex focus model and every other tree key (FEAT-0075) are
  unchanged.

## Out of scope

- Rename triggered from anywhere other than a focused tree row (e.g. the header
  note-identity rename, FEAT-0035, keeps its own affordance).
- In-place/inline editing of the row itself — F2 opens the existing prompt
  dialog (FEAT-0073), it does not turn the row into a text field.
- Any change to how the rename itself validates, moves the file, or rebases
  links — that is FEAT-0072's behavior, reused verbatim.

## Acceptance criteria

**AC-1** — F2 on a focused note row opens its rename prompt.
Given focus is on a note row in the sidebar tree,
When the user presses F2,
Then the same rename flow the note's context-menu "Rename…" runs is invoked for
that note (its `onRenameNote` entry point), opening the in-app rename prompt
seeded with the note's current name.

**AC-2** — F2 on a focused folder header opens its rename prompt.
Given focus is on a folder header in the sidebar tree,
When the user presses F2,
Then the same rename flow the folder's context-menu "Rename…" runs is invoked
for that folder (its `onRenameFolder` entry point), opening the in-app rename
prompt seeded with the folder's current name.

**AC-3** — F2 does nothing when focus is not on a tree row.
Given focus is not on a sidebar tree row (it is in the editor, a dialog, an
overlay, or nowhere in the tree),
When the user presses F2,
Then this feature takes no action — no rename prompt is opened by the tree.

**AC-4** — F2 alone writes no file.
Given focus is on a tree row,
When the user presses F2 and then cancels the rename prompt,
Then no note or folder has been created, moved, renamed, or deleted — the only
write path remains the existing rename flow on commit.

**AC-5** — F2 leaves the other tree keys unchanged.
Given focus is on a tree row,
When the user presses any FEAT-0075 navigation key (Up/Down/Left/Right/Home/End/
Enter/Space),
Then that key behaves exactly as FEAT-0075 specifies — adding F2 changes none of
them.
