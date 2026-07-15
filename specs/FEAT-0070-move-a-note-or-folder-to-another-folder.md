---
id: FEAT-0070
title: Move a note or folder to another folder
status: draft
depends_on: [FEAT-0034, FEAT-0040, FEAT-0041, FEAT-0069]
---

## Intent

FEAT-0069 gave folders a create/delete lifecycle, but the only way to relocate
a note or a folder into a different one is still to rename it with a full
path typed by hand — there is no way to *pick* a destination. This phase adds
that: a "Move to…" affordance on a note row and on a folder row, backed by a
picker listing the vault's folders (root included). Moving a note is a thin
UI layer over machinery that already exists and is already proven —
`renameActive` (FEAT-0034) already resolves an arbitrary destination path,
already rebases the moved note's own outbound links (FEAT-0041), and already
rewrites inbound links across the vault (FEAT-0040); a folder move is
genuinely new — it has to do all of that once *per note* in the subtree,
which is the substance of this phase.

A folder move is moat-relevant the same way a rename is: it's a real,
multi-file operation on the user's own folder, so every file it touches goes
through the existing per-note stale-write guard (never clobbering a file
edited from outside mid-move), and a partial failure must not orphan a note
or lose content.

## Behavior

> **Trigger surface superseded by FEAT-0071.** "Move…" was originally always
> a visible row button; the M35 milestone review moved it (and every other
> row action) into a right-click/long-press context menu. The picker
> described below, and everything it does once opened, is unchanged.

**Destination picker.** A "Move to…" overlay (same visual family as the quick
switcher/command palette) lists the vault's folders by path, root included,
for one-click pick — reachable from a note row's own action and a folder
row's own action. Picking a destination for a **note** calls
`renameActive(destination + "/" + currentName)` (root: just `currentName`) —
already-correct behavior top to bottom (flush, move, own-link rebase, inbound
rewrite, active-note follow), so this half of the phase is wiring, not new
logic. `renameActive` only ever operates on the controller's *active* note
(same constraint the existing header rename already has), so a note row's
"Move to…" switches to that note first — exactly like clicking its name
already does — before applying the picked destination; the user never
notices a two-step sequence, it's the existing click-to-open behavior with
the picker riding along. Picking a destination for a **folder** drives the
new `moveFolder` below (which is not active-note-scoped — it moves whichever
folder's row the picker was opened from, regardless of what's open). Neither
path asks for confirmation — a move isn't destructive the way a folder
delete is, matching the existing silent-rename precedent (FEAT-0040).

**Moving a folder.** `NoteController.moveFolder(fromPath, toPath)` relocates
every note in `fromPath`'s subtree to the equivalent path under `toPath`:

1. Refuse (without moving anything) when `toPath` is `fromPath` itself, or is
   `fromPath` or a descendant of it (moving a folder into itself or one of its
   own children would orphan it — there's no path left for it to land at).
2. Enumerate the subtree via `listNotes`/the existing path-prefix convention:
   every note whose path starts with `fromPath + "/"`.
3. For each, compute its new path (the `fromPath` prefix swapped for
   `toPath`) and move it — reusing `moveNote` for the file relocation and the
   same per-note outbound-rebase / inbound-rewrite passes `renameActive`
   already runs for a single note, so every relocated note's own relative
   links stay correct and every *other* note's links to it follow, exactly as
   a rename would.
4. If the active note was inside the moved folder, the editor follows it to
   its new path (same as a rename); otherwise it's left alone.
5. Refreshes the note list and the folder listing (an empty folder inside the
   moved subtree moves too) once the whole subtree has relocated.

A per-note write that hits the stale-write guard (changed on disk mid-move)
is skipped for that file only — the file is left where it started rather
than losing content or duplicating it, and the rest of the subtree still
moves. The folder itself (and any empty subfolders in it) is only considered
moved once every note beneath it has relocated.

## Constraints

- Moving a note is `renameActive` called with a path that changes folder
  segments, not filename — no new note-level primitive, no divergent
  validation (still `normalizeNoteName`/`normalizeFolderPath`).
- `moveFolder` refuses moving a folder into itself or a descendant of itself;
  nothing is touched when refused.
- Every file write in a folder move goes through the existing per-note
  stale-write guard (`saveNote`'s `knownLastModified` check via `moveNote`'s
  own no-clobber guard) — a conflicting file is skipped, never overwritten,
  and never blocks the rest of the subtree from moving.
- Outbound-link rebase and inbound-link rewrite reuse the exact FEAT-0040/
  FEAT-0041 pure cores (`rewriteLinksForRename`, `rebaseOutboundLinks`) per
  relocated note — no second, divergent link-rewrite implementation.
- No confirmation prompt for a move (destructive-only precedent stays with
  delete); the destination picker itself is the deliberate step.

## Out of scope

- Filtering the destination picker's folder list to exclude invalid targets
  (a folder's own subtree) up front — the operation is refused with a message
  if picked anyway, same pattern as an invalid/duplicate folder name.
- Drag-and-drop (decided against in the M35 scope note — a picker instead).
- Undo of a move.
- Moving multiple notes/folders at once (one at a time only).

## Acceptance criteria

**AC-1** — Move a note to another folder via the picker.
Given a note at the root and an existing folder `projects`,
When the user opens its "Move to…" picker and picks `projects`,
Then the note's file is now at `projects/<name>.md` with its content
unchanged, and the picker's move is a call to `renameActive` with that
destination.

**AC-2** — Move a note back to the root.
Given a note at `projects/<name>.md`,
When the user picks the root as the destination,
Then the note's file is now at `<name>.md`.

**AC-3** — Move a folder to another folder, taking its notes with it.
Given `projects/` containing `a.md` and `projects/ideas/` containing `b.md`,
and an existing folder `archive`,
When `moveFolder("projects", "archive/projects")` is called,
Then `archive/projects/a.md` and `archive/projects/ideas/b.md` exist with
their original content, and nothing remains at the old `projects/` paths.

**AC-4** — A folder move refuses moving into itself.
Given a folder `projects`,
When `moveFolder("projects", "projects")` is called,
Then nothing is moved and the operation reports failure.

**AC-5** — A folder move refuses moving into its own descendant.
Given `projects/` containing a subfolder `projects/ideas/`,
When `moveFolder("projects", "projects/ideas")` is called,
Then nothing is moved and the operation reports failure.

**AC-6** — Moving a folder rebases each relocated note's own outbound links.
Given `projects/a.md` containing a relative link to `projects/b.md`, both
inside the folder being moved,
When the folder moves to `archive/projects`,
Then `archive/projects/a.md`'s link still resolves to `archive/projects/b.md`
after the move (rebased if the relative path changed, untouched if the pair's
relative position didn't).

**AC-7** — Moving a folder rewrites inbound links from notes outside it.
Given a note `n.md` outside the folder linking to `projects/a.md`,
When `projects` moves to `archive/projects`,
Then `n.md`'s link now points at `archive/projects/a.md`.

**AC-8** — The active note follows when its folder moves.
Given the active note is `projects/a.md`,
When `projects` moves to `archive/projects`,
Then the active note becomes `archive/projects/a.md` and the editor still
shows its content.

**AC-9** — An occupied destination skips only that file.
Given `projects/a.md` and `projects/b.md`, and another writer has already
created a conflicting `archive/projects/a.md` before the move reaches that
file (`moveNote`'s existing no-clobber guard),
When `projects` moves to `archive/projects`,
Then `b.md` relocates to `archive/projects/b.md` normally, `a.md` is left at
its original path with its own content intact (the conflicting destination
file is not overwritten), and the move is not
reported as a failure of the whole operation.

**AC-10** — Moving a folder that no longer exists refuses cleanly.
Given a folder `gone` that has already been deleted or moved away (a stale
sidebar row, or a second concurrent move of the same folder),
When `moveFolder("gone", "archive/gone")` is called,
Then the operation reports failure with a reason, and no folder is created
at the destination — a folder never actually there is not silently
fabricated as an empty one.

**AC-11** — An occupied destination leaves an emptied (sub)folder in place, never destroys it.
Given a folder (or one of its emptied subfolders) is being moved, and a
like-named file or folder already occupies the exact destination path,
When the move reaches that (sub)folder,
Then it is left at its original path — never deleted — the same "skip,
don't destroy" outcome AC-9 already gives an occupied note.
