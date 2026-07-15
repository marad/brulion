---
id: FEAT-0072
title: "New note in folder, rename, and drag-and-drop for the tree"
status: draft
depends_on: [FEAT-0033, FEAT-0034, FEAT-0069, FEAT-0070, FEAT-0071]
---

## Intent

The milestone review that produced FEAT-0071's context menu surfaced three
more gaps once the menu was live in front of the user: there's still no way
to seed a new note directly inside a given folder (creation is always
root-relative unless you type the folder prefix by hand), no way to rename a
note or folder in place without re-typing its whole destination through the
"Move…" picker, and no fast mouse path for a move at all — everything goes
through the picker's extra click. This phase closes all three, each by
composing existing, already-proven machinery rather than adding a new one:
quick-switcher creation, `renameActive`/`moveFolder`, and the picker's own
move calls.

## Behavior

**New note in a folder.** A folder row's context menu gains "New note…".
Choosing it opens the quick switcher (FEAT-0033) with its input pre-filled
`<folderpath>/` (cursor at the end) instead of empty — the user types the
leaf name and Enter creates it exactly as the switcher's existing no-match
Create path already does. No new creation logic; only how the switcher is
opened changes (an optional seed query).

**Rename.** Both a note row's and a folder row's context menu gain
"Rename…", prompting for a bare name (no folder segments — same shape as
"New subfolder…"'s prompt) and changing only the item's own leaf segment,
keeping its parent folder. For a folder, the target is `parentOf(path) +
"/" + newName` (or just `newName` at the root), passed to `moveFolder`. For
a note, the same active-note constraint "Move…" already works around
applies: the controller switches to it first, then calls `renameActive`
with `parentOf(path) + "/" + newName`. An invalid name, or one that collides
with an existing sibling, is refused with a message and nothing changes —
the same failure surfacing "Move…"/"New subfolder…" already have.

**Drag-and-drop.** Dragging a note or folder row and dropping it onto a
folder row (or a root drop zone at the top of the tree) moves it there —
additive to the "Move…" picker, not a replacement; the picker (and its
keyboard/touch reachability) is unchanged. A drop calls the exact same move
`renameActive`-after-switch (for a note) or `moveFolder` (for a folder) the
picker's own pick already calls, just with the drop target as the
destination instead of a picker choice. Dropping a folder onto itself or
one of its own descendants is refused the same way the picker already
refuses it (`moveFolder`'s existing guard) — dragging that combination shows
no valid-drop indicator and, if forced, changes nothing. Dragging is a
mouse-only affordance; touch keeps reaching every move through the picker
(via long-press → "Move…", FEAT-0071).

Dropping onto a *note* row (rather than a folder header) targets that note's
own containing folder — a note isn't a container, but its row is by far the
easiest target to hit when the intent is "put this alongside that note,"
exactly the way dropping on the empty root zone already targets the vault
root rather than requiring an empty patch of the tree. The self-nest refusal
above still applies against the retargeted destination.

## Constraints

- No new file-system primitive: "New note…" reuses the existing quick-
  switcher create path; "Rename…" reuses `renameActive`/`moveFolder` with a
  same-parent target; a drop reuses the exact call a picker pick would have
  made.
- Rename validates through the same `normalizeNoteName`/`normalizeFolderPath`
  already used elsewhere — no second, divergent name validator.
- A folder drop-target is refused (no valid-drop indicator, and the drop is
  a no-op if forced) when the dragged folder is the target itself or one of
  its own descendants — the same self-nest guard "Move…" already enforces.
- Drag-and-drop is additive: every action it exposes is already reachable
  through the context menu (mouse) or long-press (touch); DnD never becomes
  the *only* way to do something.

## Out of scope

- Reordering siblings within a folder (the tree has no manual ordering
  concept at all — notes/folders are always alphabetical).
- A touch equivalent for drag-and-drop (long-press already opens the picker,
  which covers the same ground on touch).
- Renaming to a name that also changes the note/folder's parent — that's
  "Move…"; "Rename…" only ever changes the leaf segment.

## Acceptance criteria

**AC-1** — A folder's "New note…" opens the switcher pre-filled with its path.
Given a folder `projects` in the tree,
When the user picks "New note…" from its context menu,
Then the quick switcher opens with its input containing `projects/` and the
cursor at the end.

**AC-2** — Completing the pre-filled query creates the note inside that folder.
Given the switcher is open with `projects/` pre-filled (AC-1),
When the user types a name and presses Enter,
Then a note is created at `projects/<name>.md` and opened, exactly as an
ordinary switcher creation would.

**AC-3** — Renaming a folder changes only its own name.
Given a folder `archive/projects` containing notes,
When the user picks "Rename…" and enters `work`,
Then the folder (and everything in it) ends up at `archive/work`, and an
invalid or colliding name is refused with a message, nothing changed.

**AC-4** — Renaming a note changes only its own name, wherever it is.
Given a note `projects/a.md` that is not the currently active note,
When the user picks "Rename…" on its row and enters `b`,
Then the note ends up at `projects/b.md` with its content intact (switching
to it first, transparently, the same way "Move…" already does).

**AC-5** — Dragging a note onto a folder moves it there.
Given a note at the root and an existing folder `projects`,
When the user drags the note's row and drops it on the folder's row,
Then the note's file ends up at `projects/<name>.md` — the same result
picking `projects` in the "Move…" picker would give.

**AC-6** — Dragging a folder onto another folder moves it and its contents.
Given folders `projects` (with notes) and `archive`,
When the user drags `projects`'s row and drops it on `archive`'s row,
Then `projects` and everything in it end up under `archive/projects` — the
same result "Move…" would give.

**AC-7** — A folder cannot be dropped into itself or its own descendant.
Given a folder `projects` containing a subfolder `projects/ideas`,
When the user drags `projects`'s row and drops it on itself or on
`projects/ideas`'s row,
Then nothing moves — the same refusal the picker already gives for that
combination.

**AC-8** — Drag-and-drop is additive; the picker still works for every action.
Given the tree after this phase ships,
When the user opens any row's context menu without ever dragging anything,
Then "Move…" (and its picker) still works exactly as FEAT-0070/0071 left it.

**AC-9** — Dropping onto a note row targets that note's containing folder.
Given a note at `a/b/c.md`,
When another note or folder is dragged and dropped onto `c.md`'s row,
Then the dragged item moves into `a/b` — the same destination dropping it
directly on `b`'s folder header would give — refused the same way a drop on
`b`'s header would be refused (e.g. a dragged folder that would nest into
itself via that destination).
