---
id: FEAT-0035
title: Open-note identity in the header and inline rename
status: draft
depends_on: [FEAT-0034]
---

## Intent

Until now the header never says *which* note is open — the only cue is the
highlighted row in the sidebar, which is gone the moment the sidebar is
collapsed. And there is no way to rename the open note from the UI, even though
the controller can now move it (FEAT-0034). M14 pairs these: the header shows the
open note's identity, and that same identity is the affordance to rename it in
place. Showing the path also makes the note's location in the tree legible at a
glance, which matters once notes live in subfolders.

## Behavior

**Showing the open note's identity.** The header displays the open note's
identity once a folder is open: its folder path (if any) and its name (without
the `.md` extension). A root-level note shows just its name; a nested note shows
its folder path and name together (e.g. `projects/` + `diablo`). The identity
tracks the active note — switching notes, creating, or an external change that
moves the active note all update what the header shows. Before a folder is open,
no identity is shown (consistent with the other header controls, FEAT-0031).

**Renaming in place.** Activating the header identity (clicking it, or keyboard
activation) turns it into an inline text editor pre-filled with the open note's
**full folder-relative path without `.md`** — so the edit can rename the note and
also move it between folders, the same surface the create flow uses. Committing
(Enter, **or the field losing focus**) renames the note via
`NoteController.renameActive` (FEAT-0034); Esc cancels and reverts to the display
with no change. Losing focus commits rather than cancels — matching Finder / VS
Code's rename, and because on touch tapping away is the natural "done" gesture
(the soft keyboard's Go button blurs rather than sending a clean Enter). A
blur-commit of an unchanged value is a no-op (FEAT-0034 reports the
rename-to-current-path as success without moving anything).

On a **successful** rename the editor returns to the display mode and the header,
sidebar, and editor all reflect the new path (driven by the controller's existing
active-note announcement). On a **rejected** rename — an invalid name, a name
already taken, or any other refusal reported by `renameActive` — the inline
editor stays open, shows the reason, and the note is not renamed, so the user can
correct the name without losing what they typed.

The rename reuses `normalizeNoteName` (via `renameActive`) — there is no second
validator — and the file move is the moat-safe native move from FEAT-0034. This
phase is pure UI on top of FEAT-0034; it introduces no new file behavior of its
own.

## Constraints

- The identity display and the inline editor live in the header; no new module
  is introduced (the existing header/shell UI module owns them).
- The editable value is the note's full folder-relative path without `.md`;
  rename and validation go through `renameActive`/`normalizeNoteName` — no
  divergent path logic.
- A rejected rename never loses the user's typed text and never moves the file;
  the reason is surfaced inline.
- Esc cancels and reverts to the display with no file operation; losing focus
  commits (a blur-commit of an unchanged value is a no-op).
- The identity is hidden before a folder is open, like the other in-note header
  controls (FEAT-0031).

## Out of scope

- The storage move and the controller rename themselves (FEAT-0034).
- Rewriting inbound links in other notes on rename (deliberately not done —
  FEAT-0034).
- Renaming a note from the sidebar tree (the header is the single rename surface
  this phase); a sidebar context-menu rename can come later.
- Renaming a brand-new note that was never saved to disk (FEAT-0034 reports this
  as a refusal; the inline editor surfaces that reason like any other).

## Acceptance criteria

**AC-1** — The header shows the open note's name.
Given a folder is open with a root-level note `diablo.md` active,
When the workspace is shown,
Then the header displays `diablo` (without the `.md`).

**AC-2** — The header shows a nested note's path and name.
Given the active note is `projects/diablo.md`,
When the header identity is shown,
Then it conveys both the `projects` folder path and the name `diablo`.

**AC-3** — No identity before a folder is open.
Given no folder has been opened yet,
When the first-run screen is shown,
Then the header shows no note identity.

**AC-4** — The identity tracks the active note.
Given `a.md` is active and shown in the header,
When the user switches to `b.md`,
Then the header updates to show `b`.

**AC-5** — Activating the identity opens an inline editor pre-filled with the path.
Given the active note is `projects/diablo.md` shown in the header,
When the user activates the identity,
Then an inline text field appears containing `projects/diablo` (the full path,
no `.md`), ready to edit.

**AC-6** — Committing a valid new name renames the note.
Given the inline editor is open on `a.md` with the value changed to `renamed`,
When the user presses Enter,
Then `a.md` is moved to `renamed.md` on disk, the editor returns to the display,
and the header shows `renamed`.

**AC-7** — A rejected rename keeps the editor open and shows the reason.
Given the inline editor is open on `a.md` and an existing `b.md`, with the value
changed to `b`,
When the user presses Enter,
Then `a.md` is not moved, the inline editor stays open showing a reason that the
name is taken, and the typed text is preserved.

**AC-8** — Esc cancels without renaming.
Given the inline editor is open on `a.md` with the value changed,
When the user presses Esc,
Then no rename happens, the header returns to showing `a`, and the focus-away
that follows closing the editor does not trigger a rename.

**AC-9** — Losing focus commits the rename.
Given the inline editor is open on `a.md` with the value changed to `changed`,
When the field loses focus (the user taps/clicks away),
Then the rename is committed via `renameActive` (not cancelled), so `changed`
takes effect the same as pressing Enter would.
