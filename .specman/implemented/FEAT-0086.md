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
extension's files as a plain, always-visible list. Clicking a file opens it in a
real tab strip; several files may remain open and each tab can be activated or
closed. It supports manifest.json, JavaScript files, and JSON companion files
with safe vault-relative paths. The selected file loads without appearing as a
user edit. The file list, tabs, selection, and diagnostics are rebuilt after
refresh so a second window or an agent can change the same extension. Static
section labels do not use chevrons or other affordances that imply collapsing.

## Acceptance criteria

- AC-1: Given discovered extensions, when the workbench opens, then the active
  extension is selected through one compact dropdown and its manifest, declared
  entry, and supported .js/.json companions are visible in a deterministic file
  list; there is no second extension tree to select from.
- AC-2: Given a selected supported file, when it is clicked, then a tab for that
  path opens or activates and its exact text appears in a JavaScript- or
  JSON-aware CodeMirror editor without a synthetic dirty/change event.
- AC-3: Given several opened files, when the user switches or closes tabs, then
  unsaved text remains associated with its own path and is never silently saved
  into or discarded for another file.
- AC-4: Given an invalid manifest or an unsupported file, when the workbench
  refreshes, then a diagnostic is shown and the remaining file list and open
  tabs stay usable.
- AC-5: Given a missing vault or script permission, when the workbench opens,
  then the file list is replaced by an actionable status and no metadata
  directory is created.
- AC-6: Given the Extensions and Files headings, when they are rendered as
  always-visible sections, then they have no chevron or other collapse control.

## Out of scope

- Arbitrary binary assets, HTML/CSS extension UI, TypeScript, or package imports.
- Multiple editors with simultaneous live cursors.
