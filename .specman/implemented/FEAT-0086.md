---
id: FEAT-0086
title: Multi-file extension workbench
status: draft
depends_on: [FEAT-0085, FEAT-0082, FEAT-0084]
---

## Intent

An extension is a small file tree, not only the entry source. The workbench
must make the manifest, entry, and supported JavaScript/JSON companions
discoverable and editable while keeping the existing CodeMirror editing
experience and explicit enablement rules.

## Behavior

The workbench selects one extension from a compact dropdown and presents that
extension's files as a plain, always-visible list. The tab strip is visually
attached to the editor and has a trailing `+` that creates an active empty tab
slot. Clicking a file loads it into the active slot; if that path is already
open in another slot, the existing tab is activated instead. Double-click has
no additional behavior. Several files may remain open and each tab can be
activated or closed. It supports manifest.json, JavaScript files, and JSON
companion files with safe vault-relative paths. The selected file loads without appearing as a
user edit. The file list, tabs, selection, and diagnostics are rebuilt after
refresh so a second window or an agent can change the same extension. Static
section labels do not use chevrons or other affordances that imply collapsing.

## Acceptance criteria

- AC-1: Given discovered extensions, when the workbench opens, then the active
  extension is selected through one compact dropdown and its manifest, declared
  entry, and supported .js/.json companions are visible in a deterministic file
  list; there is no second extension tree to select from.
- AC-2: Given an active tab slot, when a supported file is clicked once in the
  sidebar, then that slot displays the file's exact text in a JavaScript- or
  JSON-aware CodeMirror editor without a synthetic dirty/change event; a
  double-click produces no second action.
- AC-3: Given the clicked path is already open in another tab, when it is chosen
  in the sidebar, then the existing tab is activated instead of replacing the
  active slot. Given it is not open, the active slot is reused rather than
  growing the tab strip.
- AC-4: Given the trailing tab-strip `+`, when it is invoked, then one empty
  active slot is added and invites the user to choose a file. Given several
  opened slots, when the user switches or closes tabs, then unsaved text remains
  associated with its own path and is never silently saved into or discarded
  for another file.
- AC-5: Given an invalid manifest or an unsupported file, when the workbench
  refreshes, then a diagnostic is shown and the remaining file list and open
  tabs stay usable.
- AC-6: Given a missing vault or script permission, when the workbench opens,
  then the file list is replaced by an actionable status and no metadata
  directory is created.
- AC-7: Given the Extensions and Files headings, when they are rendered as
  always-visible sections, then they have no chevron or other collapse control.
  The tabs have enough padding and share a continuous border/background with the
  editor so they do not appear to float above it.

## Out of scope

- Arbitrary binary assets, HTML/CSS extension UI, TypeScript, or package imports.
- Multiple editors with simultaneous live cursors.
