---
id: FEAT-0011
title: Note list and switching
status: draft
depends_on: [FEAT-0010, FEAT-0004]
---

## Intent

With the storage layer able to handle many notes (FEAT-0010), the app can finally
show more than one. This phase puts the folder's notes on screen as a list and
lets the user move between them: click a note, edit it, click another. The
quick-capture promise must survive the move — switching away from a note you were
typing in cannot drop the tail of your keystrokes — so a switch flushes the open
note before loading the next, reusing the same guarded save as autosave. And
because reopening the app should feel like returning to your desk, not starting
over, the app remembers which note you were last editing and reopens it. This is
the visible turn from "a notepad" to "your notes".

## Behavior

**The list.** Beside the editor, a panel lists the folder's notes, one per row,
showing each note's name without the `.md` extension (the file on disk keeps it).
The list is built from `listNotes` (FEAT-0010), so it is sorted
case-insensitively and contains only `.md` files. The row for the note currently
open in the editor is visibly marked as active.

**Switching.** Clicking a note row makes it the active note. Before the editor is
re-pointed, the currently open note's pending edits are flushed through the
existing guarded save (so nothing typed is lost and the no-silent-clobber guard
still applies). Then the selected note's content is loaded into the editor and
the save state — last-seen `lastModified`, dirty flag, conflict flag — is reset
to that note. Clicking the already-active note is a no-op. Edits after the switch
autosave to the newly active note, not the previous one.

**Active-note memory.** The active note's filename is persisted (IndexedDB).
When the app reopens a folder (fresh pick or restored handle), it lists the
notes and chooses which to open: the persisted active note if it still exists,
otherwise `start.md` if present, otherwise the first note in the list. Opening
then loads that note and marks its row active.

**Empty folder.** A folder with no notes behaves as in M1: the editor opens an
empty `start` buffer and `start.md` is created on the first capture (autosave or
Ctrl+S), per the FEAT-0004 decision. Once it exists, `start.md` appears in the
list as the active note. Until then the list may be empty (or show nothing
selectable).

## Constraints

- Switching always flushes the previously open note first, through the one
  guarded `save()` path (FEAT-0004) — no second save path, no lost tail of typing.
- The list reflects the notes present at open time and after the app's own
  mutations; it does **not** poll or watch for external changes (that is M4).
- Display names drop the `.md` extension; the on-disk filename is unchanged.
- The active note is persisted across reloads (IndexedDB), separate from the
  folder handle (FEAT-0003).
- Empty-folder behavior (lazy `start.md` on first capture) is preserved exactly.
- No create / delete affordances here — that is FEAT-0012. This phase only lists
  and switches between notes that already exist (plus the lazy `start`).

## Out of scope

- Creating, deleting, or renaming notes — FEAT-0012 (create/delete) and later.
- Detecting external add/remove/change while open (live folder watching) — M4.
- Subfolders, search, tags, manual reordering — out of M3.

## Acceptance criteria

**AC-1** — The folder's notes are listed.
Given a folder containing several `.md` notes,
When the app opens that folder,
Then each note is shown as a row in the list, by name without the `.md`
extension, in case-insensitive order.

**AC-2** — The open note is marked active.
Given the app has opened a folder and loaded a note into the editor,
When the list is displayed,
Then exactly the row for the note shown in the editor is marked active.

**AC-3** — Clicking a note switches the editor to it.
Given two notes A (open) and B in the list,
When the user clicks B's row,
Then the editor shows B's content and B's row becomes the active one.

**AC-4** — Switching flushes the previous note's pending edits.
Given note A is open and has unsaved edits (the autosave debounce has not yet
fired),
When the user switches to note B,
Then A's pending edits are written to A's file before B is loaded (no keystrokes
lost), and B's content then appears in the editor.

**AC-5** — Edits after a switch save to the newly active note.
Given the user has switched from A to B and then types,
When a save fires,
Then the text is written to B's file, not A's.

**AC-6** — The active note is restored on reopen.
Given the user was last editing note B and the app is closed,
When the app reopens the same folder (handle restored),
Then B is the note loaded into the editor and marked active.

**AC-7** — A removed active note falls back gracefully.
Given the persisted active note no longer exists in the folder,
When the app opens the folder,
Then it opens `start.md` if present, otherwise the first note in the list, and
marks that row active.

**AC-8** — An empty folder still seeds `start` lazily.
Given a folder with no notes,
When the app opens it and the user captures text and a save fires,
Then `start.md` is created with that text and appears in the list as the active
note (nothing is written merely by opening the empty folder).
