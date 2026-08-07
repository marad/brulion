# FEAT-0081 — extension sandbox and RPC spike

Status: Phase 0 evidence and boundary proposal (not production extension support)

## Result

The protocol test in `src/extension-rpc.test.ts` exercises a nonce-authenticated
handshake, allow-listed asynchronous calls, malformed/wrong-nonce rejection,
JSON-like value enforcement, request timeout, and disposal. The browser harness at
`/brulion/spikes/extension-sandbox.html` is a deliberately small real-iframe check;
open it from `npm run dev` or `npm run preview` and inspect the result rows and
console while running Chromium.

The spike is a **go** for the boundary, with two conditions before production use:

1. the host must retain source identity and nonce checks for the bootstrap message,
   because a sandboxed frame has an opaque origin (`event.origin === "null"`); and
2. the extension document must carry a restrictive CSP and never receive a
   `FileSystemHandle`, `EditorView`, DOM node, or other host-owned object.

It is a **no-go** for treating `sandbox="allow-scripts"` as a complete security
boundary on its own. Sandbox does not make an extension trusted, does not guarantee
that it cannot consume CPU/memory, and does not by itself disable all network or
navigation behavior. The host must expose no secrets and use CSP/resource limits as
defense in depth.

## Browser findings

### iframe and messaging

- `sandbox="allow-scripts"` runs JavaScript but, without `allow-same-origin`, assigns
  the frame a unique opaque origin. The child cannot read `window.parent.document`;
  the parent also cannot use same-origin DOM APIs on the child.
- An opaque origin cannot be named in a fixed `targetOrigin`. The bootstrap therefore
  uses `window.postMessage(message, "*", [port])` **only** after selecting the exact
  `iframe.contentWindow` and carrying a fresh nonce. The `message` listener checks
  `event.source === iframe.contentWindow`, the envelope type/version, and the nonce;
  `event.origin` is informational (`"null"`), not an authorization check.
- After the port transfer, all calls use the dedicated `MessagePort`; there is no
  reason to keep a broad `window` message listener for RPC traffic. Disposing the
  peer closes the port and removes the listener.
- `MessagePort` uses structured clone. Structured clone can transfer
  `FileSystemHandle` objects, so “we did not include a transfer list” is not a
  sufficient capability boundary. The protocol accepts only finite primitives,
  arrays, and plain records (the JSON-like guard in the spike).

### loading local JavaScript

- The browser cannot execute a file picked through the File System Access API by
  handing a `FileSystemFileHandle` to an iframe. The host must read text, validate
  the manifest/source, and load a generated `Blob` URL (or a static bootstrap that
  evaluates a separately loaded source in the sandbox). The spike harness uses an
  inline script for determinism; production must avoid `eval`/`new Function` in the
  host and should prefer a script/module `Blob` URL inside the sandbox document.
- A `Blob` URL created by the host does not make the script same-origin once the
  iframe's sandbox omits `allow-same-origin`; the sandboxed document remains opaque.
- JavaScript is the MVP language. TypeScript requires a browser-side transpiler or
  a precompiled artifact and is intentionally deferred; adding a compiler increases
  the trusted code and CSP surface.

### CSP and static hosting

The child document needs its own restrictive policy. A starting point for a later
header/meta policy is:

```text
default-src 'none';
base-uri 'none';
object-src 'none';
script-src blob:;
connect-src 'none';
img-src 'none';
media-src 'none';
font-src 'none';
worker-src 'none';
frame-src 'none';
form-action 'none';
```

The parent policy must allow exactly the frame source selected by the implementation
(for example `frame-src blob:`) and must not accidentally broaden `connect-src`.
The policy is defense in depth, not a replacement for the RPC allow-list. In
particular, a sandboxed script can still burn resources, and navigation/exfiltration
behavior must be tested against the target Chromium versions.

GitHub Pages serves static files and this repository does not control response
headers. A `<meta http-equiv="Content-Security-Policy">` can constrain the static
harness, but it is not equivalent to a response header for every directive and can
be changed with the file. Before shipping, choose one of:

- a static child document with a carefully reviewed meta policy plus strict RPC
  limits (smallest GitHub Pages-compatible option), or
- a separate origin/edge that can set response headers and resource isolation.

Vite serves `public/spikes/extension-sandbox.html` as a static asset. GitHub Pages
serves it under `/brulion/spikes/...`; the harness uses a relative URL so it works
with the configured `/brulion/` base.

### File System Access

File System Access is secure-context-only and handles are transferable/cloneable.
Keep the granted directory and file handles in host-owned closures. Extension
methods should receive path strings or other narrow data and return copied text or
metadata; they must not return handles. Native folder-picking and permission prompts
cannot be covered by this harness and remain a manual live-app check.

## Threat model and deferred checks

The script is treated as potentially buggy or hostile. The host protects the app by
using a dedicated opaque-origin frame, source/nonce authentication, capability
allow-list, JSON-like wire values, timeouts, and disposal. The design does **not**
promise protection from denial of service, browser vulnerabilities, user-approved
capabilities, or a malicious browser extension with its own privileges.

Before the storage/UI phase, add Chromium checks for:

- child reads/writes of parent DOM, `localStorage`, IndexedDB, and FSA handles;
- `fetch`, WebSocket, image, worker, popup, and top-navigation attempts under the
  selected CSP/sandbox policy;
- a late response after timeout/dispose and a second iframe using the same nonce;
- source spoofing on the bootstrap `window` message.

These checks are intentionally not production extension features; they are the
acceptance gate for the isolation policy.

## Sources consulted

- MDN [`<iframe>` sandbox tokens and opaque origins](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
- MDN [Content-Security-Policy directives](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)
- MDN [File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
- MDN [FileSystemHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle)
