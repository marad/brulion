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
extension's files as a plain, always-visible list beside one editor. Clicking a
file loads it directly into that editor; there is no tab strip or separate
open-file state, and double-click has no additional behavior. It supports
manifest.json, JavaScript files, and JSON companion files with safe
vault-relative paths. The selected file loads without appearing as a user edit.
Unsaved text remains keyed to its extension and path while the user browses
other files. The file list, selection, and diagnostics are rebuilt after refresh
so a second window or an agent can change the same extension. Static section
labels do not use chevrons or other affordances that imply collapsing.

## Acceptance criteria

- AC-1: Given discovered extensions, when the workbench opens, then the active
  extension is selected through one compact dropdown and its manifest, declared
  entry, and supported .js/.json companions are visible in a deterministic file
  list; there is no second extension tree to select from.
- AC-2: Given a supported file, when it is clicked once in the sidebar, then the
  single editor displays that file's exact text with JavaScript- or JSON-aware
  CodeMirror support and without a synthetic dirty/change event; a double-click
  produces no second action.
- AC-3: Given unsaved text for one file, when the user selects another file and
  later returns, then the draft remains associated with its original extension
  and path and is never silently saved into or discarded for another file.
- AC-4: Given the workbench editor, when files are browsed, then only the selected
  file is represented in the editor and no tab strip, new-tab action, close-tab
  action, or separate open-file state is rendered.
- AC-5: Given an invalid manifest or an unsupported file, when the workbench
  refreshes, then a diagnostic is shown and the remaining file list and editor
  stay usable.
- AC-6: Given a missing vault or script permission, when the workbench opens,
  then the file list is replaced by an actionable status and no metadata
  directory is created.
- AC-7: Given the Extensions and Files headings, when they are rendered as
  always-visible sections, then they have no chevron or other collapse control.

## Out of scope

- Arbitrary binary assets, HTML/CSS extension UI, TypeScript, or package imports.
- Multiple editors with simultaneous live cursors.
