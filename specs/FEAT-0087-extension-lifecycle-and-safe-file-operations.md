---
id: FEAT-0087
title: Extension lifecycle and safe file operations
status: draft
depends_on: [FEAT-0086, FEAT-0083, FEAT-0084]
---

## Intent

Users and agents need to create and maintain a complete extension without
manually constructing .brulion/scripts or risking data loss. M41 extends the
M39 storage layer with a safe disabled scaffold, validated file operations, and
per-file conflict guards.

## Behavior

Creating an extension validates its id and creates manifest.json plus main.js as
one disabled scaffold. Files may be created, read, saved, renamed, and deleted
only under the selected validated script directory and only for supported
JavaScript/JSON paths. A save compares the caller's last-seen mtime; on mismatch
it returns a conflict and leaves disk bytes unchanged. Extension enablement
remains a separate explicit settings choice. Diagnostics report invalid
manifests, unsafe paths, conflicts, load failures, and reload status.

## Acceptance criteria

- AC-1: Given a valid new extension id, when the user creates it, then a
  validated manifest and main.js are written, the extension is disabled, and an
  existing id is never overwritten.
- AC-2: Given an extension file path, when it is created, read, renamed, or
  deleted, then the operation accepts only a safe relative .js or .json path and
  cannot escape the selected script directory.
- AC-3: Given an open file and its last-seen mtime, when the disk mtime differs,
  then save reports a conflict and leaves the file content untouched; when it
  matches, then save writes the new text and returns the new mtime.
- AC-4: Given an extension directory rename or delete, when the operation
  completes, then only the validated selected extension subtree is affected and
  the selected extension's enablement is removed on delete.
- AC-5: Given an invalid manifest, missing entry, source load error, or failed
  reload, when the workbench refreshes, then it reports a diagnostic and does not
  disable or crash unrelated extensions or the notes editor.
- AC-6: Given a newly created or edited extension, when the user has not enabled
  it, then no runner or command is started; explicit enablement persists in the
  vault settings and is preserved across workbench refreshes.

## Constraints

- No last-writer-wins behavior; mtime guards remain mandatory.
- The extension folder is ordinary user-owned filesystem state.

## Out of scope

- Undo, transactions across multiple files, arbitrary file formats, or package
  installation.
