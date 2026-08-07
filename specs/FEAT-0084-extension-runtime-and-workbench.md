---
id: FEAT-0084
title: Sandboxed extension runtime and local script workbench
status: draft
depends_on: [FEAT-0081, FEAT-0082, FEAT-0083]
---

## Intent

Make a validated `.brulion/scripts/<id>/main.js` executable as a local ESM
extension and make the source editable from Brulion. Each extension gets an
opaque-origin, `allow-scripts`-only iframe and the FEAT-0083 capability host; a
broken extension is isolated from the vault and from other extensions.

## Behavior

**Runtime.** A runner transfers one nonce-bound `MessagePort` to an opaque-origin
iframe. The child document has a no-network CSP and imports the validated source
from a `Blob`; the module may use the injected global `brulion` API or export a
default activation function. The host waits for an explicit runtime-ready signal.

**Lifecycle.** A vault-scoped registry discovers valid scripts, starts each
extension independently, contributes its namespaced actions, and disposes runners
when the vault changes. Invalid manifests, missing entries, runtime errors, and
timeouts are reported without preventing the editor from opening.

**Workbench.** The Extensions modal lists discovered scripts, keeps new scripts
disabled until the user explicitly enables them for the current vault, opens the
declared JavaScript entry in a reusable CodeMirror editor, saves only with the
source mtime read by the modal, reloads the registry after a successful save, and
recursively deletes only the selected script directory after confirmation.

## Acceptance criteria

**AC-1** — A valid ESM script starts in the sandbox and receives the API.
Given a valid manifest and source, when the runner starts, then the source runs in
an opaque-origin `allow-scripts` iframe, no network source is allowed by its CSP,
and the runner resolves only after `runtime.ready`.

**AC-2** — One broken script cannot break another or the vault.
Given multiple discovered scripts, when one is malformed, missing its entry, times
out, or throws during activation, then its runner is disposed/reported while the
other scripts and the note editor continue to work.

**AC-3** — Extension actions are vault-scoped.
Given a loaded vault, commands registered by its runners appear in the existing
palette/action bar and disappear when the vault registry is disposed or refreshed.

**AC-4** — Workbench saves are mtime-guarded.
Given an open script entry, when the disk mtime differs from the value read by the
modal, save reports a conflict and leaves disk content untouched; a matching mtime
writes the source and reloads the runner.

**AC-5** — Workbench deletion is explicit and path-safe.
Given a selected script id, delete requires confirmation and removes only that
validated script directory; no arbitrary path or neighboring script is touched.

**AC-6** — Execution requires explicit per-vault enablement.
Given a valid discovered script, when it is not listed in the vault's extension
settings, then it contributes no runner or action; when the user enables it in the
workbench, then the registry starts it and persists that choice in `.brulion.json`.

## Out of scope

- TypeScript transpilation, package installation, imports from the network, a
  Brulion timer/trigger API, custom extension UI, or automatic script generation
  by an LLM;
- automatic enablement or execution on discovery/file changes;
- direct access to File System Access handles or Brulion DOM objects.
