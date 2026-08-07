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

The workbench presents a script tree and one editor tab at a time. It supports
manifest.json, JavaScript files, and JSON companion files with safe
vault-relative paths. The selected file loads without appearing as a user edit.
The tree, tabs, selection, and diagnostics are rebuilt after refresh so a
second window or an agent can change the same extension.

## Acceptance criteria

- AC-1: Given a valid extension, when the workbench opens it, then
  manifest.json, the declared entry, and every supported .js/.json companion are
  visible in a deterministic file tree.
- AC-2: Given a selected supported file, when it is opened, then its exact text
  appears in a JavaScript- or JSON-aware CodeMirror editor without a synthetic
  dirty/change event.
- AC-3: Given a file with unsaved editor text, when the user switches files,
  then the workbench preserves the unsaved state or explicitly warns before
  discarding it; it never silently saves a different file.
- AC-4: Given an invalid manifest or an unsupported file, when the workbench
  refreshes, then a diagnostic is shown and the rest of the script tree remains
  usable.
- AC-5: Given a missing vault or script permission, when the workbench opens,
  then the file tree is replaced by an actionable status and no metadata
  directory is created.

## Out of scope

- Arbitrary binary assets, HTML/CSS extension UI, TypeScript, or package imports.
- Multiple editors with simultaneous live cursors.
