---
id: FEAT-0022
title: Conflict diff view
status: draft
depends_on: [FEAT-0015]
---

## Intent

FEAT-0015 turned the save-time conflict from a dead end into a two-way choice —
keep what you typed, or take what's on disk — but it shows only a message and two
buttons. The user picks blind: "use the version on disk" discards their edits
without ever seeing *what* the disk version differs by, and "keep my version"
overwrites the disk change sight-unseen. That makes the safer recovery path feel
risky, which is the opposite of what a no-silent-clobber moat should feel like.

This phase makes the choice informed: while the conflict stands, show the unsaved
buffer beside the on-disk file with the differences highlighted, so the user can
see exactly what each button will keep or drop before choosing. It is a *view*
only — it reads the buffer and the disk and writes nothing; resolution is still
the unchanged FEAT-0015 path. It deliberately does not add merge or line-level
resolution: the choice stays two-way, it just stops being blind.

## Behavior

**Showing the difference.** When a conflict is raised (proactively by the poll
loop or reactively by a refused save — the one state from FEAT-0015), the modal
shows two read-only panes side by side: the unsaved buffer on the left ("your
version") and the on-disk file on the right ("on disk"), with the lines that
differ highlighted. The order matches the buttons below — left/"your version"
maps to *Keep my version*, right/"on disk" maps to *Use the version on disk* — so
each button's effect is the pane above it. The panes are read-only: the diff is
for seeing, not editing.

**Getting both sides.** To render the diff the controller hands the UI both
versions at the moment it raises the conflict: the buffer's current text, and the
file's current on-disk content. The on-disk content is read fresh at raise time.
If the file was deleted on disk, there is no disk content — the disk side is
shown empty, labelled as deleted, and the diff renders the whole buffer as
removed.

**While the conflict stands.** Everything FEAT-0015 guarantees still holds: the
conflict is modal, the editor is read-only, navigation (switch / create / delete)
is refused, and nothing is written or discarded until the user picks. The diff is
a snapshot taken when the conflict was raised; it does not need to live-update.

**Resolving.** The two buttons keep their exact FEAT-0015 semantics — *Keep my
version* re-bases and writes the buffer (re-creating a deleted file); *Use the
version on disk* loads the disk content or switches off a deleted note. Resolving
either way tears down the diff view and returns the editor to a normal, editable,
autosaving state.

## Constraints

- **Display-only — no new bytes touch the file.** The diff reads the buffer and
  the disk; it never writes. All writing/discarding still goes through the
  FEAT-0015 resolution path on the controller's serialize queue.
- **FEAT-0015 is not regressed.** Modality, the read-only editor, refused
  navigation, and the keep/take semantics (including the deleted-file cases) are
  unchanged; this phase only adds the diff *view* to the existing modal.
- **One conflict state, both entry paths.** The diff is shown the same way
  whether the conflict was raised proactively (poll) or reactively (refused
  save), and for both a changed and a deleted on-disk file.
- **The diff view is built when the conflict is raised and destroyed when it
  resolves** — it does not persist across conflicts, and there is none when no
  conflict stands.

## Out of scope

- **Three-way / line-level merge, per-hunk apply, cherry-pick** — the choice
  stays the two-way keep/take from FEAT-0015; M7 only *shows* the difference.
- **Editing inside the diff** — the panes are read-only; the buffer is edited
  only after resolution, in the normal editor.
- **Live-updating the diff** while the conflict stands — it is a snapshot from
  raise time; a further external change is handled afresh only after resolution.
- **Diffing background (non-open) notes** — only the open note carries unsaved
  local state and can conflict (FEAT-0015 scope).

## Acceptance criteria

**AC-1** — Raising a conflict shows both versions side by side, with differences
highlighted.
Given the open note has unsaved local edits and its file changed on disk,
When the conflict is raised (by the poll loop or a refused save),
Then the modal shows the unsaved buffer and the on-disk content as two read-only
panes with the differing lines highlighted, the buffer on the left ("your
version") and the disk content on the right ("on disk").

**AC-2** — The controller hands the UI both versions when raising the conflict.
Given a conflict is being raised,
When the controller announces it,
Then it provides the buffer's current text and the file's current on-disk content
read at raise time, with the disk content given as `null` when the file was
deleted on disk.

**AC-3** — A note deleted on disk shows the disk side as empty/deleted.
Given the open note has unsaved local edits and its file was deleted on disk,
When the conflict is raised,
Then the disk pane is shown empty under a label marking it deleted on disk, and
the diff renders the buffer's content as removed.

**AC-4** — Resolving tears down the diff view.
Given a conflict is shown with the diff view,
When the user resolves it either way (keep my version / use the version on disk),
Then the diff view is destroyed, the modal is hidden, and the editor returns to a
normal editable state.

**AC-5** — FEAT-0015 modality and semantics are preserved.
Given a conflict is shown with the diff view,
When the user attempts to switch/create/delete a note or edit the buffer,
Then it is refused exactly as in FEAT-0015, and the two buttons keep their exact
keep/take semantics (keep re-bases and writes/re-creates; disk loads/switches
off) — the diff view changes only what the user sees, not what resolution does.

**AC-6** — The diff panes are read-only and write nothing.
Given a conflict is shown with the diff view,
When the user interacts with the panes,
Then neither pane edits the buffer or the file, and no write occurs until a
resolution button is pressed.
