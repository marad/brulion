---
id: FEAT-0015
title: Conflict resolution UX
status: draft
depends_on: [FEAT-0013, FEAT-0014]
---

## Intent

This closes M4: the case FEAT-0014 deliberately left alone — an external change
to the open note that collides with **unsaved local edits**. Since M1, Brulion
has *detected* this (the save-time stale-write guard refuses to clobber and
freezes saving) but offered no way out: the conflict was a dead end. That
protects the file but strands the user. This phase turns the dead end into a
clear, reversible choice — keep what you typed, or take what's on disk — so the
no-silent-clobber guarantee (the moat) comes with an actual recovery path, not
just a refusal. Both ways of reaching a conflict (the poller noticing proactively
while you have unsaved edits, and a save being refused reactively) lead to the
same one state and the same one choice.

## Behavior

**Entering the conflict state.** The open note is in conflict when its on-disk
file changed (or was deleted) while the buffer has unsaved local edits. It is
reached two ways, which converge on one state: proactively, when the poll loop
(FEAT-0013/0014) sees the change while edits are pending; or reactively, when an
autosave/flush is refused by the stale-write guard. On entering, Brulion surfaces
the conflict **modally**: a choice the user must make before doing anything else.
While it stands, autosave is suspended, the editor is read-only, and the
navigation that would re-point the editor (switch / create / delete a note) is
refused — so the conflict cannot be dismissed by a stray click that silently
abandons the unsaved buffer. The user's buffer is left exactly as they typed it.

**Resolving — keep my version.** The user chooses to keep their edits. Brulion
writes the buffer to the file, overwriting the on-disk version (re-basing on the
file's current state so the write goes through; if the file was deleted on disk,
this re-creates it). The note returns to a normal, saved, editable state and the
conflict UI clears; the note re-appears in the list if it had been removed.

**Resolving — use the version on disk.** The user chooses the disk's version.
Brulion discards the local edits and loads the on-disk content (adopting its
`lastModified`); if the file was deleted on disk, it switches off the note the
way an external delete with no local edits does (FEAT-0014: `start.md`, else the
first remaining note, else the empty-folder state). The conflict UI clears and
editing resumes.

**After resolution.** Either choice leaves the editor usable again: autosave
works, and a subsequent external change is detected and handled afresh. Neither
choice writes or discards anything until the user picks — both sides are
preserved while the conflict stands.

## Constraints

- One conflict state, reached proactively (poll) or reactively (refused save);
  one resolution UX for both, and for both a changed and a deleted on-disk file.
- No diff or merge view — a two-way keep/take choice only (see `DECISIONS.md` →
  "Conflict UX: two-way choice").
- Nothing is written or discarded until the user chooses: while in conflict the
  buffer and the disk are both left intact; autosave is suspended.
- "Keep my version" must succeed against the current on-disk state (re-base on the
  file's present `lastModified`, or re-create if deleted) — it must not itself be
  refused by the stale-write guard it is resolving.
- Resolution runs on the controller's serialize queue, consistent with every
  other folder/active-note operation, and clears the conflict so editing resumes.

## Out of scope

- Diff / three-way merge / line-level conflict resolution — explicitly rejected
  (see `DECISIONS.md`).
- Conflicts on notes that are not the open one — only one note is open at a time;
  background notes carry no unsaved local state.
- A general undo/history of resolutions — the file is the user's; recovery beyond
  this choice is their backup/sync concern.

## Acceptance criteria

**AC-1** — An external edit colliding with unsaved edits surfaces the conflict.
Given the open note has unsaved local edits and its file is changed on disk by
another tool,
When the poll loop next runs (or a save is attempted),
Then Brulion shows the conflict and offers a choice, without overwriting the disk
or discarding the buffer.

**AC-2** — "Keep my version" writes the buffer to disk.
Given the note is in conflict,
When the user chooses to keep their version,
Then the buffer's content is written to the file (overwriting the on-disk
version), the conflict clears, and the editor returns to a normal saved state.

**AC-3** — "Use the version on disk" loads the disk content and drops local edits.
Given the note is in conflict (the file changed on disk),
When the user chooses the disk version,
Then the editor shows the on-disk content, the local edits are discarded, the
recorded `lastModified` is the disk's, and the conflict clears.

**AC-4** — Editing works again after either resolution.
Given a conflict has just been resolved (either way),
When the user makes a new edit,
Then it autosaves normally and a later external change is detected as usual (the
state is no longer frozen).

**AC-5** — The open note deleted under unsaved edits is the same conflict.
Given the open note has unsaved local edits and its file is deleted on disk,
When the poll loop next runs,
Then Brulion shows the same conflict choice; "keep my version" re-creates the file
from the buffer, and "use the version on disk" switches off the deleted note.

**AC-6** — Nothing is clobbered before the user chooses.
Given the note is in conflict,
When the user has not yet chosen,
Then the on-disk file is unchanged and the buffer is unchanged, and autosave does
not write.

**AC-7** — The conflict is modal until resolved.
Given the note is in conflict,
When the user attempts to switch to another note, create a note, delete a note,
or edit the buffer (rather than choosing keep/take),
Then that action is refused (no note switch/create/delete, no buffer edit) and the
conflict remains, so the only way forward is one of the two resolution choices.
