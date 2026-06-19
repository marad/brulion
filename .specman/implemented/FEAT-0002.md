---
id: FEAT-0002
title: Folder access
status: draft
depends_on: [FEAT-0001]
---

## Intent

Brulion's whole premise is that the user's notes are plain files in a folder
they own. The first step toward that is letting the user point the app at a
folder on their disk and see what markdown is already in it. The File System
Access API gates folder access behind a user gesture in a secure context, so
this must start from an explicit click — never on load. This phase establishes
that gateway: pick a folder, read what `.md` files it holds, and show them. It
deliberately stops there — no persistence across reloads (FEAT-0003), and no
opening, reading, or writing of a note's contents (FEAT-0004). The point is to
prove the app can reach into a real folder and enumerate it.

## Behavior

A visible "Open folder" control sits in the app shell. Clicking it — the
required user gesture — calls `showDirectoryPicker({ mode: "readwrite" })`. We
request `readwrite` now (not `read`) even though this phase only reads, so the
same grant carries into later phases that write, avoiding a second permission
prompt.

Once a directory handle is obtained, the app iterates the directory's entries
and keeps the file entries whose name ends in `.md` (case-insensitive),
ignoring sub-directories and non-markdown files; it does not descend into
sub-directories (the folder is flat in the MVP). The resulting names are shown
as a simple list in the shell. An empty folder (no `.md` files) shows an empty
list, not an error.

If the user dismisses the picker, the browser rejects with an `AbortError`;
this is treated as a no-op — no error surfaced, the app left exactly as it was.

## Constraints

- Folder access must originate from a user gesture (a click), never `onload`.
- `showDirectoryPicker` is called with `{ mode: "readwrite" }`.
- Flat listing only — sub-directories are not traversed.
- No persistence of the handle this phase (FEAT-0003) and no file contents read
  or written (FEAT-0004).

## Out of scope

- Persisting the directory handle / restoring it across reloads (FEAT-0003).
- Opening, reading, editing, or saving any note's contents (FEAT-0004).
- Detecting files changed by other tools / conflict handling (M4).
- Creating the default `start` note (FEAT-0004).

## Acceptance criteria

**AC-1** — An explicit control opens the directory picker.
Given the app is loaded,
When the user clicks the "Open folder" control,
Then `showDirectoryPicker` is invoked with `{ mode: "readwrite" }` (the call
originates from the click gesture, not from page load).

**AC-2** — A picked folder's `.md` files are listed, and only those.
Given a directory containing a mix of `.md` files, non-`.md` files, and
sub-directories,
When the user picks that directory,
Then the app shows a list containing exactly the names of the `.md` files
(case-insensitive on the extension), excluding non-markdown files and
sub-directories.

**AC-3** — An empty (no-markdown) folder lists nothing, without error.
Given a directory with no `.md` files,
When the user picks it,
Then the app shows an empty list and surfaces no error.

**AC-4** — Dismissing the picker is a no-op.
Given the user opens and then cancels/dismisses the directory picker,
When the picker rejects with `AbortError`,
Then no error is surfaced and the app state is unchanged from before the click.
