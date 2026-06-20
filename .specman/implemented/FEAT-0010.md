---
id: FEAT-0010
title: Multi-note storage layer
status: draft
depends_on: [FEAT-0004]
---

## Intent

Until now the app could hold exactly one note, `start.md`, hardcoded into the
storage layer. M3 is about many notes — but before any list or button can exist,
the data layer has to stop being about a single file. This phase generalizes
reading and writing to operate on a note **by name**, and adds the three
folder-level operations the UI will need: enumerate the notes in a folder, create
a new one, and delete one. It also pins down the one piece of logic where a bug
corrupts the folder — turning a name the user typed into a safe filename — as a
pure, unit-tested function. No UI is built here; this is the contract the M3 UI
sits on. Getting it right (and the conflict guard preserved per note) is what
keeps the folder a set of plain, portable markdown files the user owns.

## Behavior

A note is exactly a `.md` file in the folder root (see `DECISIONS.md` — "A note
is a `.md` file in the folder root"). There is no index file, sidecar, or
database; the folder listing is the source of truth.

**Reading and writing by name.** `readNote` and `saveNote` take the note's
filename instead of assuming `start.md`. `readNote(dir, name)` returns the file's
text and `lastModified`, or empty content with a `null` mtime when the file does
not exist. `saveNote(dir, name, content, knownMtime)` writes the file, creating
it if absent, and keeps the M1 no-silent-clobber guard **per note**: before
overwriting an existing file it compares the on-disk `lastModified` with
`knownMtime`; if they differ (or a file appeared where the caller saw none), it
refuses and reports a conflict instead of overwriting.

**Listing.** `listNotes(dir)` enumerates the folder's entries and returns the
names of the `*.md` files, sorted case-insensitively. Non-`.md` files and
sub-directories are ignored. An empty folder (or one with no markdown) yields an
empty list.

**Creating.** `createNote(dir, name)` creates a new, empty markdown file for the
given name. If a file with that name already exists it does **not** overwrite it
— it reports that the note already exists, so the caller can tell the user rather
than silently clobbering content.

**Deleting.** `deleteNote(dir, name)` removes the note's file from the folder.

**Name handling.** The user types a free-form name (e.g. `Diablo builds`); it
must become a safe filename. A pure function normalizes a typed name to a
filename: it trims surrounding whitespace and ensures exactly one `.md` extension
(adding it when absent; not doubling it when the user already typed `.md`). It
**rejects** a name that is empty/whitespace-only, or that contains a path
separator (`/` or `\`) or other characters unsafe in a filename — rejection is
reported to the caller, never coerced into a surprising filename. Normalization
and validation are independent of the File System Access API so they can be
unit-tested directly.

## Constraints

- A note is a root-level `.md` file; no subfolders, no index/sidecar/metadata
  files (the folder listing is the source of truth).
- The per-note save guard from FEAT-0004 is preserved: no save silently
  overwrites a file whose `lastModified` changed since it was last read/written.
- Name normalization/validation is a pure function with no FSA/DOM dependency.
- `listNotes` returns only `*.md` files, case-insensitively sorted; it ignores
  other files and directories.
- This phase ships **no UI** — only the storage/name functions and their unit
  tests. Wiring a list, switching, and create/delete affordances are later M3
  phases.

## Out of scope

- Any UI (list panel, new-note prompt, delete confirmation) — later M3 phases.
- Choosing/persisting which note is active — FEAT-0011.
- Renaming notes, subfolders/nesting, tags, search — out of M3 (see `ROADMAP.md`).
- External-edit detection / folder watching — M4.

## Acceptance criteria

**AC-1** — Read a note by name.
Given a folder containing a file `<name>.md` with text,
When `readNote(dir, "<name>.md")` is called,
Then it returns that text and the file's `lastModified`.

**AC-2** — A missing note reads as empty.
Given a folder with no file named `<name>.md`,
When `readNote(dir, "<name>.md")` is called,
Then it returns empty content and a `null` `lastModified` (no file is created).

**AC-3** — Write a note by name, creating it when absent.
Given a folder with no file named `<name>.md`,
When `saveNote(dir, "<name>.md", content, null)` is called,
Then `<name>.md` is created containing `content` and the new `lastModified` is
returned.

**AC-4** — The per-note conflict guard is preserved.
Given `<name>.md` whose on-disk `lastModified` differs from the `knownMtime`
passed in,
When `saveNote(dir, "<name>.md", content, knownMtime)` is called,
Then the file is not overwritten and a conflict is reported.

**AC-5** — List the folder's notes, sorted, markdown only.
Given a folder containing several `.md` files, a non-`.md` file, and a
sub-directory,
When `listNotes(dir)` is called,
Then it returns exactly the `.md` filenames, sorted case-insensitively, and omits
the non-`.md` file and the directory.

**AC-6** — An empty folder lists no notes.
Given a folder with no markdown files,
When `listNotes(dir)` is called,
Then it returns an empty list.

**AC-7** — Create a new empty note.
Given a folder with no file named `<name>.md`,
When `createNote(dir, "<name>.md")` is called,
Then an empty `<name>.md` is created in the folder.

**AC-8** — Creating refuses to overwrite an existing note.
Given a folder that already contains `<name>.md` with content,
When `createNote(dir, "<name>.md")` is called,
Then the existing file is left unchanged and an "already exists" outcome is
reported (no clobber).

**AC-9** — Delete a note.
Given a folder containing `<name>.md`,
When `deleteNote(dir, "<name>.md")` is called,
Then `<name>.md` is removed from the folder.

**AC-10** — Normalize a typed name to a `.md` filename.
Given a user-typed name with surrounding whitespace and no extension (e.g.
`"  Diablo builds  "`),
When it is normalized,
Then the result is the trimmed name with a single `.md` extension (e.g.
`"Diablo builds.md"`), and a name already ending in `.md` is not given a second
one.

**AC-11** — Reject an unsafe or empty name.
Given a typed name that is empty/whitespace-only or contains a path separator or
other filename-unsafe character,
When it is normalized,
Then normalization reports the name as invalid rather than producing a filename.
