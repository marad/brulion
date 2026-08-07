---
id: FEAT-0083
title: Extension host commands and capability API
status: draft
depends_on: [FEAT-0081, FEAT-0082]
---

## Intent

Turn the FEAT-0081 transport into a narrow host API that an extension runtime can
use without receiving Brulion's DOM, `EditorView`, or File System Access handles.
This phase is transport/host work: it does not discover scripts, create iframes,
or add a settings panel. A later runner will load a validated `.js` file and use
this host for its capabilities.

## Behavior

**Command registration.** An extension calls `commands.register` with a local id,
label, and optional description. The host publishes a namespaced `Action` whose id
is `<scriptId>:<commandId>`. Running that action sends a `commands.invoke` call to
the extension peer. Duplicate local ids, malformed metadata, and command-count
limits are rejected; disposing the host removes all of its actions.

**Editor capabilities.** The host exposes `editor.getText`, `editor.getSelection`,
`editor.replaceSelection`, and `editor.focus` through injected narrow callbacks.
Only strings, numeric positions, and serializable records cross the RPC boundary.

**Note capabilities.** The host exposes `notes.list`, `notes.read`, `notes.create`,
`notes.write`, `notes.delete`, and `notes.move`. Note paths are normalized with the
existing safe `.md` path rules before callbacks run. Writes return `saved` with a
new mtime or `conflict`; the host never receives or returns a raw file handle. Each
handler is gated by the corresponding manifest permission and rejects closed
capabilities before invoking its injected callback.

## Acceptance criteria

**AC-1** — A valid command becomes a namespaced action and invokes remotely.
Given a running host for script `daily-tools`, when its peer registers command
`insert-date`, then the host exposes `daily-tools:insert-date`; running it sends a
`commands.invoke` request containing the local command id.

**AC-2** — Command metadata is bounded and isolated.
Given duplicate ids, malformed ids/labels, or more than the configured command
limit, registration returns an RPC error and does not alter the action registry;
disposing the host removes all actions and revokes the capability handlers.

**AC-3** — Editor calls expose only injected data.
Given editor callbacks, `editor.getText`/`getSelection` return copied text and
positions, `replaceSelection` passes only a string, and `focus` invokes the narrow
callback; no `EditorView` or DOM value is serializable through the peer.

**AC-4** — Note paths are normalized and writes preserve conflicts.
Given note callbacks, valid paths reach the callback in canonical `.md` form;
traversal/unsafe paths are rejected before the callback; `notes.write` returns the
injected `saved`/`conflict` result without bypassing its mtime argument.

**AC-5** — Host lifecycle is explicit and errors are isolated.
Given a disposed or not-ready host, calls fail closed; a handler error becomes a
structured RPC error; disposing one host does not mutate another host's actions.

## Out of scope

- loading source files or creating sandbox iframes;
- TypeScript, imports, network, timers, custom extension UI, or automatic triggers;
- production wiring into `main.ts` and the command palette (a later integration
  phase will compose host actions with built-ins).
