---
id: FEAT-0012
title: Create and delete notes
status: draft
depends_on: [FEAT-0010, FEAT-0011]
---

## Intent

The app can list notes and switch between them, but the set of notes is still
whatever happened to be in the folder. This phase gives the user the two missing
verbs: make a new note with a name of their choosing, and remove one they no
longer want. These are thin wiring over the FEAT-0010 storage operations
(`createNote`, `deleteNote`, `normalizeNoteName`), but they are the difference
between browsing a folder and actually keeping notes in it. Because deleting a
file is destructive and irreversible from the app, removal asks for confirmation
first — the moat is the user's trust that Brulion won't lose their data.

## Behavior

**Creating.** A "new note" control lets the user type a name and confirm it. The
typed name is normalized to a safe `.md` filename (FEAT-0010): on a valid, unused
name the file is created empty, added to the list, and opened as the active note
(flushing the previously open note first, like any switch). On an invalid name
(empty, or containing unsafe characters) or a name that already exists, no file
is created and the user is shown a clear message explaining why; the editor stays
on the current note.

**Deleting.** Each note in the list has a delete control. Activating it asks the
user to confirm; on confirmation the file is removed from the folder and the list.
If the deleted note was the one open in the editor, the app switches to another
note — `start.md` if present, else the first remaining note, else (the folder is
now empty) an empty `start` buffer, exactly the empty-folder state from
FEAT-0011. Deleting a note that is **not** the active one leaves the editor where
it is. A pending edit to a note being deleted is discarded rather than written
back (deleting then resurrecting the file would be absurd). If the user declines
the confirmation, nothing changes.

## Constraints

- Names are validated/normalized via `normalizeNoteName` (FEAT-0010); the create
  path never writes an unsafe filename and never silently overwrites an existing
  note (it surfaces "already exists").
- Creating a note opens it, flushing the previously open note through the one
  guarded save path (FEAT-0011) — no lost edits.
- Deletion is **confirmed** before the file is removed; declining is a no-op.
- Deleting the active note never resurrects it: its pending edits are dropped, and
  the app falls back to another note (or the empty-folder state).
- Create/delete mutate the folder directly; the list updates from a re-read of the
  folder (no separate in-memory source of truth that could drift).

## Out of scope

- Renaming notes — separable; not in this phase.
- Undo / trash / soft-delete — deletion removes the file; recovery is the user's
  own backup/sync concern (the file was always theirs).
- Detecting notes created/removed by other tools while open — M4 (no polling).
- Bulk operations, subfolders, move-between-folders.

## Acceptance criteria

**AC-1** — Create a named note and open it.
Given an open folder and the user enters a valid, unused note name,
When they confirm the new note,
Then a corresponding empty `.md` file is created, appears in the list, and becomes
the active note shown in the editor.

**AC-2** — Creating flushes the previously open note.
Given note A is open with unsaved edits and the user creates a new note B,
When B is created and opened,
Then A's pending edits are written to A's file before B becomes active (no lost
keystrokes).

**AC-3** — A duplicate name is refused with a message.
Given the folder already contains a note with the same (normalized) name,
When the user tries to create it again,
Then no file is created or overwritten, the editor stays on the current note, and
the user is shown a message that the note already exists.

**AC-4** — An invalid name is refused with a message.
Given the user enters an empty name or one containing unsafe characters (e.g. a
path separator),
When they try to create it,
Then no file is created and the user is shown a message explaining the name is
invalid.

**AC-5** — Delete asks for confirmation.
Given a note in the list,
When the user activates its delete control,
Then they are asked to confirm before anything is removed; declining leaves the
file and the list unchanged.

**AC-6** — Confirmed deletion removes the file and the row.
Given the user confirms deleting a note,
When the deletion completes,
Then the note's file is removed from the folder and its row disappears from the
list.

**AC-7** — Deleting the active note switches to another.
Given the note open in the editor is deleted (and confirmed),
When the deletion completes,
Then the editor switches to another note — `start.md` if present, else the first
remaining note, else an empty `start` buffer when the folder is now empty.

**AC-8** — Deleting a non-active note leaves the editor in place.
Given note A is open and the user deletes a different note B,
When the deletion completes,
Then B is gone from the list and the editor still shows A as the active note.
