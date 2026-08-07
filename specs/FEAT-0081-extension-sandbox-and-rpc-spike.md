---
id: FEAT-0081
title: Extension sandbox and RPC spike
status: draft
depends_on: []
---

## Intent

De-risk local JavaScript extensions before Brulion grows a public extension API. The
spike must demonstrate that a script can run in a separate browser context and use
explicit, asynchronous capabilities without receiving Brulion's DOM, editor object,
or File System Access handles. The resulting contract and browser constraints give
the next implementation phase a small boundary to build on without compromising
the file-fidelity moat.

## Behavior

The spike describes and exercises a host/extension RPC boundary. A host creates a
dedicated `MessageChannel`, gives one port to a script running in an iframe with
`sandbox="allow-scripts"` (without `allow-same-origin`), and authenticates the port
with a one-time nonce. Calls carry a method name and JSON-like data; the host only
dispatches methods that were explicitly registered as capabilities. Every call
settles with a result or a structured error, and the host can time out or dispose a
peer so that no later message can mutate application state.

The spike is JavaScript-only and deliberately does not discover scripts, edit files,
mount a settings panel, or integrate with the production command palette. It records
the CSP, Vite, GitHub Pages, and File System Access constraints that the production
design must satisfy.

## Acceptance criteria

- AC-1: Given a host and a script peer with the same one-time nonce, when the peer
  performs the handshake over a dedicated message port, then the host marks the
  peer ready and a registered capability can be called asynchronously with a
  JSON-like result.
- AC-2: Given an unregistered method, a malformed envelope, or a request carrying a
  wrong nonce, when the message reaches the host, then it is rejected with a
  structured error and no capability handler runs.
- AC-3: Given a request or result containing a non-JSON value (including an object
  with a prototype/method such as a File System Access handle), when it crosses the
  boundary, then the RPC rejects it and never exposes a host-owned object or handle
  to the script.
- AC-4: Given an in-flight call whose peer never replies, when the configured
  timeout elapses or the peer is disposed, then the call rejects, listeners and
  pending state are released, and messages arriving afterward are ignored.
- AC-5: Given the static Vite/GitHub Pages deployment, when the spike is reviewed in
  Chromium, then its artifact records the required iframe/CSP policy, the fact that
  opaque-origin frames require `postMessage("*", …)` plus source/nonce checks, and
  the File System Access rule that handles remain host-only. The spike provides a
  runnable protocol test/harness and explicitly marks native picker and permission
  behavior as manual follow-up.

## Out of scope

- Script discovery, manifests, `.brulion/scripts` storage, or enable/disable UI.
- TypeScript transpilation, third-party module imports, arbitrary DOM/UI APIs, or
  network/file capabilities.
- Production wiring into `Action[]`, `note-controller`, or CodeMirror.
