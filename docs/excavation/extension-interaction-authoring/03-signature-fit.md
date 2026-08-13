# M46 P4 — Contract-fit review

P4 adds no new runtime module or exported capability signature. The existing
signatures that constrain the artifact changes are:

```ts
export const AUTHORING_KIT_VERSION: string
export function listAuthoringKitFiles(): readonly AuthoringKitFile[]
export function getAuthoringKitFile(path: string): AuthoringKitFile | undefined
export function serializeAuthoringKit(): string
export function parseExtensionApiContract(source: string): ExtensionApiContract
export function contractMethods(contract: ExtensionApiContract): readonly ApiContractMethod[]
```

## Scenario traces

### Workbench copies a least-privilege interaction example

`workbench-main.renderKit()` → `listAuthoringKitFiles()` →
`AuthoringKitFile[] { path, content }` → a row's `copyKitFile(path)` →
`getAuthoringKitFile(path)` → clipboard text. The example's manifest and source
are plain file payloads; no workbench code interprets or enables them.

### Static API page renders dialog lifecycle guidance

`api-docs-main` imports raw `api-contract.json` →
`parseExtensionApiContract(source)` → `ExtensionApiContract.namespaces[]` →
`contractMethods()` → method cards. `API.md` remains a separate static human
hand-off. The contract parser owns malformed JSON/schema errors; the page does
not render a partial contract.

### Real example command shows selection feedback

Playwright seeds the example manifest/source in OPFS with the fixed expected
permission array `['commands', 'editor:read', 'editor:selection',
'notifications']` → Brulion discovery reads and validates it through the real
manifest validator → `ExtensionRegistry.load()` creates `ExtensionRunner` →
the opaque bootstrap exposes `api.editor`/`api.notifications` → user invokes
the registered command → host validates permission and message → the existing
editor/notification adapters produce observable UI. The browser assertions
keep the expected grants and visible result independent of the contract JSON;
unit tests separately compare contract/declaration/artifact identity. The test
also checks the original note bytes.

### Kit bundle is published and downloaded

`prebuild` runs the existing `cp extension-kit/API.md public/api.md` (and JSON
and declaration equivalents) → static files are served at the documented URLs.
Separately, `renderKit()` → `listAuthoringKitFiles()` → ordered
`AuthoringKitFile[]` → `serializeAuthoringKit()` produces the complete download
payload. Byte-identity tests own publication drift; workbench tests own the
visible row/download contract.

### Dialog author handles cancellation and lifecycle errors

The kit guide/example calls `api.dialogs.prompt()` → the existing bootstrap
calls `dialogs.prompt` through `ExtensionRpcPeer` → `ExtensionHost.prompt()`
validates `PromptOptions` and returns `string | null` → the existing dialog
adapter owns focus/queue/disposal. The example catches `timeout`/`disposed`; the
kit does not wrap or reinterpret those errors.

## Findings

- `AuthoringKitFile` is intentionally the only kit payload type; adding a
  separate `Example` abstraction would duplicate path/content and force the
  workbench to understand content categories it does not need.
- Contract method errors are prose arrays, so P4 can document lifecycle claims
  without changing the runtime parser or adding a second error enum. Runtime
  coded values remain `timeout` and `disposed` at the existing RPC boundary.
- The static public copies cannot be imported by the workbench; `prebuild` is
  the publication edge, `api-docs.test.ts` is the byte-identity guard, and the
  browser test uses fixed acceptance expectations rather than deriving its
  pass/fail values from the contract.
- The browser example is deliberately a source fixture rather than an
  installation helper. Adding a copy-to-vault operation would create a new
  product boundary outside this phase.

## Self-Review

I traced one success and one error path through each existing boundary and did
not find a pure forwarding layer that P4 should introduce. The only data
repacking is the existing raw-contract parse and ordered kit file mapping; both
have independent consumers. Optional prompt outcomes remain `string | null`,
not a boolean or exception convention. No new mutable state, I/O retry, or
sync/async boundary is hidden by the documentation changes.
