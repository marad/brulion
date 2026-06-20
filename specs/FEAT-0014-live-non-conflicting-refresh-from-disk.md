---
id: FEAT-0014
title: Live non-conflicting refresh from disk
status: draft
depends_on: [FEAT-0013]
---

## Intent

FEAT-0013 gave Brulion the ability to *notice* what changed on disk; this phase
makes it *act* on the common, safe case — the one where reflecting the disk loses
nothing. While Brulion is open, another tool (an AI session, a CLI, vinote) may
add a note, remove a note, or edit the very note you're looking at. When that
happens and you have no unsaved local edits in flight, Brulion should simply
track the disk: the list updates and the open note's content refreshes on its
own, no reload and no prompt. That is what "the app is one view, not the owner"
means in practice (see `DECISIONS.md` → "Brulion is a view"). The only case this
phase deliberately leaves alone is a collision with *unsaved local edits* — that
is a conflict, handled in FEAT-0015.

## Behavior

**The poll loop.** When a folder is open, Brulion polls it on an interval
(FEAT-0013's poller driving the controller's disk check). The loop targets the
currently open folder; re-picking a folder keeps a single live loop pointed at
the new one. The loop does nothing while no folder is open and skips a beat while
the app's own save is in flight.

**External list change.** When the folder's set of `*.md` files changes on disk
(a note added or removed by another tool), the note list refreshes to match,
keeping the current note active and the editor untouched. A note that newly
appears becomes selectable; one that disappeared (and is not the open note) drops
out of the list.

**External edit to the open note, no local edits.** When the open note's content
changed on disk and the buffer has **no unsaved local edits** (and is not already
in a conflict), the editor reloads the note's content from disk and updates the
record of its `lastModified`, so subsequent saves base off the new version. No
prompt; the view simply catches up to the disk.

**Open note deleted externally, no local edits.** When the open note's file is
removed on disk and the buffer has no unsaved local edits, Brulion switches off
it the same way an in-app delete of the active note does (FEAT-0012): to
`start.md` if present, else the first remaining note, else the empty-folder state
(an empty `start` buffer). The list reflects the removal.

**Local edits present.** When an external change to the open note collides with
**unsaved local edits**, this phase does not silently overwrite or discard
either side — that is the conflict case, owned by FEAT-0015. (Until then the
existing save-time stale-write guard still prevents silent clobber.)

## Constraints

- The refresh path is **non-destructive to unsaved work**: it only reloads or
  switches when there are no unsaved local edits and no active conflict. With
  unsaved edits it leaves the buffer and disk untouched (deferred to FEAT-0015).
- Detection reuses FEAT-0013 (`checkDisk`'s classification); the refresh applies
  its result. Detection and application happen atomically on the controller's
  serialize queue so a switch/create/delete cannot interleave between them.
- A silent content reload adopts the new on-disk `lastModified`, so the next save
  does not falsely trip the conflict guard against the change just absorbed.
- One poll loop is active at a time; it follows the currently open folder.
- The loop is paused (its beat is a no-op) while a save is in flight, so the
  app's own writes are never mistaken for external changes.

## Out of scope

- Conflict resolution when local unsaved edits collide with an external change
  (or an external delete of the note being edited) — FEAT-0015.
- Preserving caret/scroll precisely across a silent reload — the reload replaces
  the buffer; this path only runs when the user is not mid-edit on unsaved
  changes, so a reset is acceptable. (Revisit if it bites.)
- Watching subfolders / nested notes — root-only (M3).
- Configurable poll interval / pause-when-hidden tuning — a sensible fixed
  interval is enough for now.

## Acceptance criteria

**AC-1** — An externally added note appears in the list.
Given a folder is open and another tool creates a new `.md` file in it,
When the poll loop next runs,
Then the new note appears in the list and the open note stays active with the
editor unchanged.

**AC-2** — An externally removed (non-open) note disappears from the list.
Given a folder is open and another tool deletes a `.md` file that is not the
currently open note,
When the poll loop next runs,
Then that note drops out of the list and the editor stays on the current note.

**AC-3** — The open note's external edit is reflected, with no local edits.
Given the open note has no unsaved local edits and its file is changed on disk by
another tool,
When the poll loop next runs,
Then the editor shows the new on-disk content and the recorded `lastModified` is
updated so a later save does not report a false conflict.

**AC-4** — A silent reload does not happen when there are unsaved local edits.
Given the open note has unsaved local edits and its file is changed on disk,
When the poll loop next runs,
Then the editor's content and the disk file are both left unchanged (no silent
overwrite of either side); resolution is deferred to FEAT-0015.

**AC-5** — The open note deleted externally switches to another, with no local edits.
Given the open note has no unsaved local edits and its file is deleted on disk,
When the poll loop next runs,
Then Brulion switches to another note (`start.md`, else the first remaining note,
else an empty `start` buffer when the folder is now empty) and the list reflects
the removal.

**AC-6** — The poll loop is a no-op without a folder and while saving.
Given no folder is open, or a save is currently in flight,
When a poll beat fires,
Then it performs no read-driven refresh and changes nothing.
