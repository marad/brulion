# Extension workbench signature-fit review

This review traces the implemented boundaries against the architecture artifact.
It was completed in degraded mode because the current tool surface does not
provide a cold-context subagent.

## Scenario traces

### Separate-window launch and attach

`src/main.ts:openExtensionWorkbench` computes the effective workspace string and
passes it to `src/workbench.ts:createWorkbenchUrl`. The new document reads that
reference and calls `src/workbench-main.ts:start`, which calls
`attachWorkbenchVault(reference)`. Attachment resolves exactly one persisted
`Vault`, checks/request permissions for its `FileSystemDirectoryHandle`, and
returns either `WorkbenchAttachment` or a typed failure. A successful start then
passes the handle to `listScripts`, so the workbench has no dependency on the
notes window's in-memory state.

### Guarded multi-file save

`selectFile` obtains a `ScriptFileRecord { path, text, lastModified }` from
`readScriptFile`. The editor keeps the record's mtime beside the local draft.
`saveFile` validates `manifest.json` where applicable and passes the exact mtime
to `writeScriptFile`. If another writer changed the file, the storage boundary
returns `{ status: "conflict" }`; the workbench reports the diagnostic and does
not replace disk bytes.

### Explicit enablement across windows

`toggleExtension` changes only the `extensions` field and persists it with
`saveSettings`. When the notes window regains focus,
`refreshExtensionsFromDisk` rereads that field and calls `reloadExtensions`.
The existing registry then loads only explicitly enabled ids and isolates runner
failures. No window-to-window message is part of this path.

### Authoring-kit distribution

The workbench asks `listAuthoringKitFiles` for the deterministic catalog and uses
`getAuthoringKitFile` for exact copy/download bytes. `serializeAuthoringKit`
provides a single portable download without introducing a filesystem or network
boundary.

## Findings and decisions

- The launcher carries only a workspace string; directory handles stay inside the
  window that owns them.
- File path and mtime validation live in `script-storage.ts`, independently of
  DOM and CodeMirror state, so stale writes cannot be hidden by the view.
- The workbench view/session is intentionally one module for this MVP. Splitting
  a separate view-model service would add a pass-through boundary without a
  second consumer; the storage and attachment contracts remain independently
  testable.
- Manifest and declared entry files cannot be renamed or deleted from the file
  editor because those operations would invalidate the extension contract.
- Refresh is generation-aware and polling-based. A refresh is a reread request,
  not an authority to overwrite an unsaved draft or another writer's bytes.

## Self-review

Round 1 was a fresh reread of the architecture and the actual exported
signatures; the main risk was accidental coupling between the workbench window
and the notes window. The trace confirms that the only shared correctness state
is the persisted vault/filesystem data. Round 2 compared a generic workbench
service against the current session/store split and retained the split because
mtime/path safety needs DOM-free tests. Round 3 removed no boundary: each
remaining boundary owns a distinct failure or consistency rule.
