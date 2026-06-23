---
id: FEAT-0034
title: Move a note on disk and rename the active note
status: draft
depends_on: [FEAT-0023]
---

## Intent

A note's identity is its folder-relative path (FEAT-0023), but until now that
path is fixed at creation — there is no way to rename a note or move it to
another folder without leaving the app and touching the files by hand. M14 gives
the open note a renamable identity. This phase builds the file-fidelity core
underneath it: a storage operation that moves a note's file from one path to
another, and a controller operation that renames the *active* note by driving
that move and then following the file to its new path.

The move is moat-critical — a rename is a real file operation on the user's own
folder, so it must preserve the note's bytes exactly and must never clobber a
different note that already lives at the destination. The browser gives us an
atomic primitive for exactly this (`FileSystemFileHandle.move()`), so we move the
file rather than read-write-delete it: no copy, no rewrite, no window where the
content exists in neither place. No UI is built here — the header affordance is
FEAT-0035.

## Behavior

**Moving a note.** `moveNote(dir, from, to)` relocates the note at the relative
path `from` to the relative path `to` within the picked folder tree. It resolves
the destination's parent folder, materializing intermediate folders the same way
`saveNote`/`createNote` do (so `a.md` → `projects/a.md` creates `projects/`), and
moves the existing file handle into it with the native
`FileSystemFileHandle.move()` — preserving the file's bytes exactly, with no
read, rewrite, or intermediate copy. Where the engine does not implement `move()`
or **refuses** it (e.g. Android Chrome rejects moving a handle it considers stale
with "state changed since it was read from disk"), it falls back to
copy-then-delete: read the source fresh, write the destination as a brand-new
file (so no stale-state guard applies), then delete the source — **write before
delete**, so a failure mid-way leaves a duplicate at worst, never lost content.
It reports:

- `moved` when the file is relocated (including a pure rename in the same folder,
  and a move that also changes folders);
- `exists` when a file already lives at `to` — the move is refused so a rename can
  never overwrite a different note (the moat). The source is left untouched;
- `missing` when no file exists at `from` — there is nothing to move.

A `from` equal to `to` is treated as a `moved` no-op (the note is already there).
The on-disk byte content is identical before and after a successful move.

**Renaming the active note.** `NoteController.renameActive(name)` renames the
currently open note to the user-typed `name`:

1. The `name` is normalized with the existing `normalizeNoteName` (FEAT-0023) —
   so a rename obeys the same path rules as a create (folder segments allowed, a
   single `.md` enforced, root-escaping/empty/unsafe segments rejected).
2. Pending edits to the open note are flushed first, so the moved file carries
   the latest content (a rename never silently drops unsaved keystrokes).
3. The file is moved from the active path to the normalized path via `moveNote`.
4. On success the controller adopts the new path as the active note — re-reading
   its `lastModified` so the next save bases off the moved file — persists it as
   the active note, refreshes the note list, and announces the change so the UI
   (sidebar, link context, header) tracks the new identity.

It reports the same shape as `addNote` — `{ ok: true }` or
`{ ok: false, reason }` — and refuses without moving anything when:

- there is no open folder, or a conflict is standing (modal — resolve it first);
- the normalized name is invalid (the reason is surfaced);
- a different note already exists at the destination path;
- the new path equals the current one (a no-op rename — reported ok, nothing
  written).

The rename runs inside the controller's serialize queue, so it cannot interleave
with a switch, a save, or a disk poll: by the time the next poll runs, the
controller already knows the note's new path, so the move is not misread as an
external delete-plus-create.

## Constraints

- The move prefers `FileSystemFileHandle.move()` (atomic, bytes preserved exactly,
  no rewrite). Where the engine lacks or refuses it, the copy-then-delete fallback
  writes the new file before deleting the old, so the worst case is a duplicate,
  never content lost in neither location (the file-fidelity moat holds either way).
- A move never overwrites an existing destination file — on the native or the
  fallback path; the source is left intact when the destination is occupied.
- Destination folders are materialized like `saveNote`/`createNote`; the path is
  the folder-relative POSIX path used everywhere else (FEAT-0023).
- Renaming reuses `normalizeNoteName` — no second, divergent validator.
- A rename flushes pending edits before moving, so no unsaved content is lost.
- Links **to** the renamed note in *other* notes are deliberately **not**
  rewritten (see "Out of scope"); only the active note's own identity and the
  in-app state follow the move.
- This phase ships **no UI** — only `moveNote`, `renameActive`, and their unit
  tests.

## Out of scope

- The header note-identity display and the inline click-to-rename editor —
  FEAT-0035.
- Rewriting link references in other notes that point at the renamed note. A
  rename moves one file only; dangling links are left to the existing
  missing-target handling (FEAT-0025/0027). Rewriting references across the vault
  would be a multi-file byte mutation, which the moat forbids us from doing
  silently.
- Deleting a folder left empty by moving its last note out (an emptied folder
  simply stops appearing in the listing, as in FEAT-0023).
- Conflict-diff or undo for a rename.

## Acceptance criteria

**AC-1** — Move (rename) a note within the same folder, preserving content.
Given a folder containing `<name>.md` with text,
When `moveNote(dir, "<name>.md", "<other>.md")` is called,
Then `<other>.md` exists with the identical text, `<name>.md` no longer exists,
and the result is `moved`.

**AC-2** — Move a note into another folder, materializing it.
Given a folder containing `a.md` and no `projects/` directory,
When `moveNote(dir, "a.md", "projects/a.md")` is called,
Then `projects/` is created, `projects/a.md` exists with the original content,
`a.md` no longer exists, and the result is `moved`.

**AC-3** — A move never clobbers an existing destination.
Given a folder containing both `a.md` and `b.md` with different content,
When `moveNote(dir, "a.md", "b.md")` is called,
Then neither file is changed (`b.md` keeps its content, `a.md` still exists) and
the result is `exists`.

**AC-4** — Moving a missing source reports missing.
Given a folder with no `ghost.md`,
When `moveNote(dir, "ghost.md", "x.md")` is called,
Then no file is created and the result is `missing`.

**AC-5** — Moving a note onto itself is a no-op.
Given a folder containing `a.md` with text,
When `moveNote(dir, "a.md", "a.md")` is called,
Then `a.md` is unchanged with the same content and the result is `moved`.

**AC-6** — Rename the active note: the file moves and the open note follows.
Given an open folder with `a.md` active and listed,
When `renameActive("b")` is called,
Then `a.md` is moved to `b.md` on disk, the active note becomes `b.md`, the note
list reflects `b.md` (not `a.md`), the change is announced, and the result is
`{ ok: true }`.

**AC-7** — Renaming flushes pending edits first.
Given the open note `a.md` has unsaved edits in the buffer,
When `renameActive("b")` is called,
Then `b.md` on disk contains those edits (no keystroke is lost in the move).

**AC-8** — Renaming to an existing note's path is refused.
Given an open folder with `a.md` active and an existing `b.md`,
When `renameActive("b")` is called,
Then no file is moved, `a.md` stays active, and the result is `{ ok: false }`
with a reason that the name is taken.

**AC-9** — An invalid name is rejected without moving.
Given an open folder with `a.md` active,
When `renameActive("../escape")` (or any `normalizeNoteName`-invalid input) is
called,
Then nothing is moved and the result is `{ ok: false }` with the validator's
reason.

**AC-10** — Renaming is refused while a conflict stands.
Given the open note is in a standing conflict,
When `renameActive("b")` is called,
Then nothing is moved and the result is `{ ok: false }`.

**AC-11** — Renaming to the current path is a no-op success.
Given an open folder with `a.md` active,
When `renameActive("a")` is called,
Then no move is attempted, `a.md` stays active and unchanged, and the result is
`{ ok: true }`.

**AC-12** — Falls back to copy-then-delete when native move is unavailable or refused.
Given a folder with `a.md` on an engine whose `FileSystemFileHandle.move()` is
absent or rejects (e.g. Android Chrome's "state changed since read" refusal),
When `moveNote(dir, "a.md", "b.md")` is called,
Then `b.md` exists with `a.md`'s content, `a.md` is gone, the result is `moved`,
and the no-clobber guard still holds (an occupied `b.md` yields `exists` without
touching either file).
