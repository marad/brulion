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
one disabled scaffold. The extension and file `+` actions open a focused modal
with one input instead of revealing inline sidebar fields; validation and create
failures remain visible beside that input until corrected or dismissed. Files
may be created, read, saved, renamed, and deleted only under the selected
validated script directory and only for supported JavaScript/JSON paths. A save
compares the caller's last-seen mtime; on mismatch it returns a conflict and
leaves disk bytes unchanged. Extension enablement remains in the separate extension manager. The authoring
workbench does not restore the old "Extension options" section, but it does
provide a compact delete action beside each Extensions/Files `+`; destructive
actions require a clear in-app confirmation. Diagnostics report invalid manifests, unsafe paths,
conflicts, load failures, and reload status.

## Acceptance criteria

- AC-1: Given the new-extension `+` action, when it is invoked, then a modal
  requests the id; a valid id creates a validated manifest and main.js in a
  disabled extension, while an invalid or existing id leaves the modal open with
  a prominent local error and never overwrites existing files.
- AC-2: Given the new-file `+` action for a selected extension, when it is
  invoked, then a modal requests the path; create/read/rename/delete accept only
  a safe relative .js or .json path and cannot escape the selected script
  directory, and create errors remain in the modal. Given the adjacent delete
  action, it confirms and removes only the selected deletable file with its mtime
  guard; required manifest/entry files remain protected.
- AC-3: Given an open file and its last-seen mtime, when the disk mtime differs,
  then save reports a conflict and leaves the file content untouched; when it
  matches, then save writes the new text and returns the new mtime.
- AC-4: Given the authoring workbench sidebar, when an extension is selected,
  then it does not show a separate "Extension options" section. A compact delete
  action beside `+` opens an in-app confirmation and deletes only that selected
  extension subtree; if enabled, its id is also removed from settings.
  Enable/disable remains owned by the existing extension manager.
- AC-5: Given an invalid manifest, missing entry, source load error, or failed
  reload, when the workbench refreshes, then it reports a diagnostic and does not
  disable or crash unrelated extensions or the notes editor.
- AC-6: Given a newly created or edited extension, when the user has not enabled
  it in the extension manager, then no runner or command is started.

## Constraints

- No last-writer-wins behavior; mtime guards remain mandatory.
- The extension folder is ordinary user-owned filesystem state.

## Out of scope

- Undo, transactions across multiple files, arbitrary file formats, or package
  installation.
