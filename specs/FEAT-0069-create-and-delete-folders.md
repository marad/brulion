---
id: FEAT-0069
title: Create and delete folders
status: draft
depends_on: [FEAT-0023, FEAT-0024]
---

## Intent

A note's identity is a folder-relative path (FEAT-0023) and the sidebar renders
that path as a tree (FEAT-0024), but a folder itself has no lifecycle: it only
ever exists as a side effect of a note living inside it, and disappears the
moment its last note is gone. There is no way to make an empty folder ahead of
time, or to remove one (and everything beneath it) in one action — doing either
today means leaving the app and touching the files by hand. This phase gives
folders the same two verbs notes already have (FEAT-0012): create one, delete
one. Deleting a folder is the one operation in this milestone that can take an
unbounded number of notes with it silently, so — exactly like note deletion —
it asks for confirmation first; the moat is the user's trust that Brulion never
loses their data without their say-so.

## Behavior

> **Trigger surface superseded by FEAT-0071.** The controls below were
> originally always-visible row buttons; the M35 milestone review replaced
> every one of them with a right-click/long-press context menu (FEAT-0071).
> The verbs, validation, and confirmation described here are unchanged —
> only *how* the user reaches "create"/"delete" moved.

**Creating.** Activating "New subfolder…" for a folder (or the tree root's own
entry point) prompts for a name and, on a valid one, creates a
real empty directory at that path — `createFolder(dir, path)` resolves/creates
each path segment via `getDirectoryHandle(name, { create: true })`, the same
segment-walking `normalizeNoteName`-style validation notes already use (no
empty/unsafe/`.`/`..` segments). The new folder appears in the tree immediately,
empty, ready to receive notes. An invalid or duplicate name is refused with a
message; nothing is created.

**Deleting.** Activating "Delete" for a folder always asks for confirmation —
unlike a note, a folder can hold any number of notes beneath it, so there is
no safe one-click path. On
confirmation, `deleteFolder(dir, path)` removes the folder and everything in it
via `removeEntry(name, { recursive: true })` on the resolved parent; the tree
re-renders from a fresh listing. If the active note was inside the deleted
folder, the editor falls back exactly the way a single active-note deletion
does today (FEAT-0012 AC-7): `start.md` if present, else the first remaining
note, else an empty `start` buffer. Declining the confirmation leaves the
folder and its contents untouched.

## Constraints

- Folder paths are validated with the same segment rules `normalizeNoteName`
  already enforces for notes (FEAT-0023) — no empty, unsafe, `.`, or `..`
  segments, and never escaping the picked root.
- `createFolder` never overwrites/merges into an existing folder silently — a
  name that already exists at that path is surfaced as already-existing, not
  silently reused.
- `deleteFolder` is **always** confirmed before anything is removed; declining
  is a no-op. This applies unconditionally — a folder delete is never "quick"
  the way a fresh, still-empty folder's removal might feel like it could be.
- `listNotes`/the sweep (FEAT-0023) are unchanged: they only ever descend into
  folders, never list them as entities, so a freshly-created empty folder
  needs no special-casing to show up as a real (if childless) node in the tree.
- Create/delete mutate the folder directly; the tree re-renders from a fresh
  listing — no separate in-memory folder registry that could drift.

## Out of scope

- Moving a note or a folder into another folder — a separate phase (M35 P2).
- Undo of a folder deletion.
- Renaming a folder (distinct from moving a note/folder — deferred to whenever
  it's separately requested).

## Acceptance criteria

**AC-1** — Create an empty folder at the root.
Given an open folder and the user enters a valid, unused folder name at the
tree root,
When they confirm,
Then a corresponding empty directory is created on disk and appears as an
empty folder node in the tree.

**AC-2** — Create a subfolder inside an existing folder.
Given an existing folder `projects/` and the user invokes its create action
with a valid, unused name `ideas`,
When they confirm,
Then `projects/ideas/` is created on disk and appears as an empty child node
under `projects/` in the tree.

**AC-3** — An invalid folder name is refused with a message.
Given the user enters an empty name or one containing unsafe characters (or
a `.`/`..` segment),
When they try to create it,
Then no directory is created and the user is shown a message explaining the
name is invalid.

**AC-4** — A duplicate folder name is refused with a message.
Given a folder already exists at the target path,
When the user tries to create another folder at that same path,
Then no directory is created or altered and the user is shown a message that
it already exists.

**AC-5** — Deleting a folder asks for confirmation.
Given a folder in the tree (empty or containing notes/subfolders),
When the user invokes its delete action,
Then they are asked to confirm before anything is removed; declining leaves
the folder and everything beneath it unchanged.

**AC-6** — Confirmed deletion removes the folder and everything beneath it.
Given a folder containing notes and/or subfolders,
When the user confirms deleting it,
Then the folder, its notes, and its subfolders are all removed from disk, and
the tree no longer shows any of them.

**AC-7** — Deleting the active note's folder falls back like a single delete.
Given the currently active note lives inside the folder being deleted,
When the deletion is confirmed and completes,
Then the editor switches away exactly as a direct active-note deletion does
(FEAT-0012 AC-7): `start.md` if present, else the first remaining note, else
an empty `start` buffer.

**AC-8** — Deleting a folder that doesn't contain the active note leaves the editor in place.
Given note A (outside the folder being deleted) is active,
When a different folder is deleted (confirmed),
Then the editor still shows A as the active note.
