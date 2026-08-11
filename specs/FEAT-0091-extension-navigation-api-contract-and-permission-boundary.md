---
id: FEAT-0091
title: Extension navigation API contract and permission boundary
status: draft
depends_on: [FEAT-0083, FEAT-0084, FEAT-0088, FEAT-0089]
---

## Intent

Local extensions can currently edit the active buffer and operate on files, but
there is no host-owned way to inspect or navigate the notes view. Add the
navigation surface as an additive API v1 contract while keeping the sandbox
least-privilege: navigation is a separate namespace, new permissions fail
closed, and no browser, DOM, editor, or File System Access object crosses the
RPC boundary.

## Behavior

The public `brulion.navigation` namespace contains `getActiveNote()`,
`openNote(path, options?)`, and `resolveLink(target, options)`. Its declarations,
machine-readable contract, API reference, and host method inventory describe the
same types and permissions. Note paths are canonical folder-relative POSIX paths
with `.md`; callers may use the existing optional-suffix convention where the
host normalizes a note path.

`navigation:read` grants only `getActiveNote` and `resolveLink`; navigation:write
alone grants neither read method, and `openNote` requires navigation:write.
Existing manifests without either permission continue to work. The sandbox
bootstrap exposes only the documented JSON-like navigation methods, and the host
validates permissions and arguments before invoking injected application
callbacks. Unsafe paths, malformed options, and unknown link kinds reject with
an actionable capability error and do not call the application.

## Acceptance criteria

- AC-1: Given the checked-in API v1 contract, declarations, API reference, and
  host method inventory, when their navigation surface is enumerated, then all
  three contain `navigation.getActiveNote`, `navigation.openNote`, and
  `navigation.resolveLink` with matching result/type names and no undocumented
  navigation RPC method.
- AC-2: Given a manifest requesting `navigation:read`, when an extension calls
  `getActiveNote` or `resolveLink`, then the host permits those calls and does
  not grant `openNote`; given a manifest requesting `navigation:write`, when it
  calls `openNote`, then the host permits it; omitted permissions reject before
  the injected callback runs.
- AC-3: Given an existing v1 manifest that requests no navigation permission,
  when it is parsed and activated, then it remains valid and its previously
  granted commands, editor, and notes capabilities behave unchanged.
- AC-4: Given a navigation call with traversal, a reserved `.brulion` path,
  unsafe path characters, an invalid anchor/options shape, or an unknown link
  kind, when it crosses the host boundary, then it rejects with a bounded
  validation error and no application callback is invoked.
- AC-5: Given the sandbox bootstrap, when its public `brulion` object is
  inspected, then navigation methods are available only through the documented
  namespace and return/reject JSON-like values without exposing DOM, URL,
  CodeMirror, or File System Access handles.
- AC-6: Given navigation method metadata, when the contract is rendered or
  downloaded, then it documents least-privilege permissions, canonical paths,
  discriminated results, and the fact that navigation never implicitly creates
  or mutates a note.

## Out of scope

- Implementing filesystem-backed active-note switching or link resolution.
- Automatic extension triggers, browser history APIs, external navigation, or
  custom extension UI.
- Changing the extension API version or requiring navigation permissions from
  existing extensions.
