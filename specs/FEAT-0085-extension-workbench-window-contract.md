---
id: FEAT-0085
title: Separate-window extension workbench contract
status: draft
depends_on: [FEAT-0084, FEAT-0059]
---

## Intent

M39's extension editor is embedded in the notes window and assumes one source
file. M41 needs a separate authoring surface without making a second window
depend on in-memory state from the first one. The workbench therefore owns its
own vault attachment and treats the shared filesystem and persisted vault
handles as the only correctness boundary.

## Behavior

The notes window opens the workbench in a new browser window carrying the
effective workspace reference. The workbench restores a granted vault from the
same persisted vault set, requests read/write permission when necessary, and
shows an actionable missing-permission state instead of silently opening another
vault. It can be reloaded or closed independently. No window-to-window
postMessage or other message is required for data correctness; both windows
reconcile by rereading the vault.

## Constraints

- The URL carries only the workspace reference; no file handle or note content
  crosses the window boundary.
- A workbench write uses the same filesystem mtime guard as the notes window.
- A missing or denied permission never falls back to a different granted vault.

## Acceptance criteria

- AC-1: Given an attached vault, when the user invokes the extension workbench,
  then a separate browser window opens with the effective workspace reference.
- AC-2: Given a workbench window with a matching persisted vault and permission,
  when it loads, then it attaches independently and lists that vault's scripts
  without requiring the notes window to remain open.
- AC-3: Given a missing or denied vault permission, when the workbench loads, then
  it shows a clear permission/reselect action and never opens a different vault
  because the requested reference was unavailable.
- AC-4: Given two open windows for one vault, when either window changes a
  filesystem-backed extension file, then correctness depends only on a later
  filesystem reread; no inter-window message is required or treated as
  authoritative.
- AC-5: Given the workbench is closed and reopened or reloaded, then its selected
  script/file state is reconstructed from the filesystem and not from window
  memory.

## Out of scope

- Cross-window IPC, shared in-memory editor state, or live cursor mirroring.
- Automatic permission granting or bypassing the native folder picker.
