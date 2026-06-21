---
id: FEAT-0023
title: Path-addressed storage layer
status: draft
depends_on: [FEAT-0010]
---

## Intent

M3 fixed a note's identity as a bare filename in the folder **root** — the
storage layer (`note.ts`) enumerates only the root via `dir.values()`, and the
name normalizer (`note-name.ts`) rejects path separators outright. M8 lifts the
root-only restriction: a note becomes any `.md` file anywhere in the picked
folder tree, identified by its **folder-relative POSIX path** (`projects/diablo.md`).
This phase moves the data layer to paths before any tree UI (FEAT-0024) or links
(FEAT-0025) can exist. The moat is unchanged — the folder *tree* is the single
source of truth, no index or sidecar — so the one place a bug corrupts the
folder, turning a typed name into a safe path, stays a pure, unit-tested
function, now hardened against escaping the granted root. No UI is built here.

## Behavior

A note is a `.md` file anywhere in the picked folder tree, addressed by its
folder-relative path with `/` separators regardless of OS (see `DECISIONS.md` —
"A note's identity is its folder-relative POSIX path"). There is still no index
file, sidecar, or database; the folder tree is the source of truth.

**Traversal.** Every storage operation resolves a relative path by walking the
directory tree one segment at a time. `readNote`/`statNote` walk with
`getDirectoryHandle` (no create) and treat a missing intermediate folder the same
as a missing file (empty content / `null` mtime). `saveNote`/`createNote`
materialize intermediate folders with `getDirectoryHandle(seg, { create: true })`
so writing `projects/diablo.md` into a folder that has no `projects/` yet creates
it. `deleteNote` removes the leaf file from its parent folder; an already-absent
path (including a missing intermediate folder) is a no-op, as before.

**Reading and writing by path.** `readNote(dir, path)` returns the file's text
and `lastModified`, or empty content with a `null` mtime when the file (or any
folder on the way to it) does not exist. `saveNote(dir, path, content, knownMtime)`
writes the file, creating it and its folders if absent, and keeps the
no-silent-clobber guard **per note**: before overwriting an existing file it
compares the on-disk `lastModified` with `knownMtime` and refuses on a mismatch.

**Listing.** `listNotes(dir)` recurses the whole tree and returns the
folder-relative paths of every `*.md` file, `/`-separated, sorted
case-insensitively by full path. Non-`.md` files are ignored; directories are
descended into, not listed themselves. An empty tree yields an empty list.

**Creating and deleting.** `createNote(dir, path)` creates a new, empty markdown
file at the path (and its folders), refusing to overwrite an existing file
(reports "exists"). `deleteNote(dir, path)` removes the note's file.

**Name handling.** The user types a free-form name that may now include folder
segments (e.g. `projects/Diablo builds`). A pure function normalizes it to a
relative path: it splits on `/`, trims and validates **each** segment with the
existing rules (non-empty, no filename-unsafe character or control char), ensures
exactly one `.md` extension on the **last** segment only, and re-joins with `/`.
It **rejects** the input when any segment is empty (so `a//b`, a leading or
trailing `/` all fail) or is `.`/`..` (no escaping or re-anchoring the granted
root — the moat must never let a note write outside the folder the user picked).
A bare name with no `/` behaves exactly as in FEAT-0010. Normalization is
independent of the File System Access API so it is unit-tested directly.

## Constraints

- A note is a `.md` file anywhere in the tree; no index/sidecar/metadata files
  (the folder tree is the source of truth).
- Paths are always `/`-separated in the app, independent of the host OS.
- The per-note save guard from FEAT-0004/0010 is preserved unchanged.
- Path normalization/validation is a pure function with no FSA/DOM dependency,
  and rejects any `.`/`..` segment or empty segment — a normalized path can never
  escape the root.
- `listNotes` returns only `*.md` files as relative paths, case-insensitively
  sorted by full path.
- This phase ships **no UI** — only the storage/name functions and their unit
  tests. The controller continues to treat the active note as an opaque string
  (now a path), so its existing behavior is preserved.

## Out of scope

- The folder tree UI, collapsing, and creating-into-a-subfolder affordance —
  FEAT-0024.
- Links between notes — FEAT-0025.
- Renaming/moving notes between folders; deleting now-empty folders as an explicit
  action (an emptied folder simply stops appearing in the listing).

## Acceptance criteria

**AC-1** — Read a note by nested path.
Given a folder containing `sub/<name>.md` with text,
When `readNote(dir, "sub/<name>.md")` is called,
Then it returns that text and the file's `lastModified`.

**AC-2** — A missing nested note (or missing folder) reads as empty.
Given a folder with no `sub/` directory,
When `readNote(dir, "sub/<name>.md")` is called,
Then it returns empty content and a `null` `lastModified`, and no file or folder
is created.

**AC-3** — Write a nested note, creating intermediate folders.
Given a folder with no `sub/` directory,
When `saveNote(dir, "sub/<name>.md", content, null)` is called,
Then `sub/` is created, `sub/<name>.md` is created containing `content`, and the
new `lastModified` is returned.

**AC-4** — The per-note conflict guard is preserved for nested notes.
Given `sub/<name>.md` whose on-disk `lastModified` differs from the `knownMtime`
passed in,
When `saveNote(dir, "sub/<name>.md", content, knownMtime)` is called,
Then the file is not overwritten and a conflict is reported.

**AC-5** — List recurses the tree and returns sorted relative paths.
Given a folder containing `a.md`, `sub/b.md`, `sub/deep/c.md`, a non-`.md` file,
and an empty directory,
When `listNotes(dir)` is called,
Then it returns exactly `["a.md", "sub/b.md", "sub/deep/c.md"]` (case-insensitively
sorted by full path), omitting the non-`.md` file and not listing directories
themselves.

**AC-6** — Create a nested note, materializing its folders.
Given a folder with no `sub/` directory,
When `createNote(dir, "sub/<name>.md")` is called,
Then `sub/` and an empty `sub/<name>.md` are created.

**AC-7** — Creating refuses to overwrite an existing nested note.
Given a folder that already contains `sub/<name>.md` with content,
When `createNote(dir, "sub/<name>.md")` is called,
Then the existing file is left unchanged and an "already exists" outcome is
reported.

**AC-8** — Delete a nested note.
Given a folder containing `sub/<name>.md`,
When `deleteNote(dir, "sub/<name>.md")` is called,
Then `sub/<name>.md` is removed (the `sub/` folder may remain).

**AC-9** — Normalize a pathed name to a relative `.md` path.
Given a typed name with folder segments and surrounding whitespace (e.g.
`"  projects/Diablo builds  "`),
When it is normalized,
Then the result is the trimmed, per-segment-trimmed path with a single `.md` on
the last segment (e.g. `"projects/Diablo builds.md"`), and a bare name with no
`/` behaves exactly as in FEAT-0010.

**AC-10** — Reject root-escaping, empty, or unsafe segments.
Given a typed name with a `.`/`..` segment, an empty segment (leading/trailing/
doubled `/`), or a segment containing a filename-unsafe or control character,
When it is normalized,
Then normalization reports the name as invalid rather than producing a path.
