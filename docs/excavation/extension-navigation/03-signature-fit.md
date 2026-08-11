# M43 extension navigation — signature-fit review

## Cold-context findings

The fresh review found four issues in the first signature draft:

1. The public result union existed, but there was no declared async operation
   signature for `openNote`; the architecture promised a serialized path that a
   caller could not type-check.
2. `ActiveNote` represented a value but not the async `getActiveNote` callback,
   leaving the null/no-active mapping implicit.
3. `ResolveLinkOptions.from` could be omitted while the context had no active
   note; the result for a relative or same-note target was not stated.
4. Fresh-listing failure was an adapter failure rather than a semantic resolver
   result, but the boundary was only described in prose.

## Fixes applied

`src/extension-navigation.ts` now declares `ExtensionNavigationCapabilities`:

```ts
interface ExtensionNavigationCapabilities {
  getActiveNote: () => Promise<ActiveNote | null>
  openNote: (path: string, options?: OpenNoteOptions) => Promise<OpenNoteResult>
  resolveLink: (target: string, options: ResolveLinkOptions) => Promise<LinkResolution>
}
```

The existing controller contract now declares a separate serialized
`ControllerOpenNoteResult` without anchor presentation fields:

```ts
type ControllerOpenNoteResult =
  | { status: "opened" | "already-open"; path: string }
  | { status: "missing"; path: string }
  | { status: "conflict"; path: string }
```

The application adapter will map that result to the public `OpenNoteResult` and
perform heading scrolling. A resolver call with no active note and no explicit
valid source returns semantic `invalid`; a fresh filesystem/listing failure is
an exceptional capability failure and is reported by the host RPC boundary.

The controller method is currently a compile-checked stub for the excavation
signature layer. Its body is intentionally deferred until the P1 tests are
written.

## Scenario traces

### Active note read

`extension.navigation.getActiveNote()` → sandbox RPC `navigation.getActiveNote`
→ host permission check → injected `getActiveNote(): Promise<ActiveNote | null>`
→ JSON-like `ActiveNote | null`. `null` is an ordinary no-active result, not an
error.

### Existing open with dirty conflict

`extension.navigation.openNote("archive/today")` → sandbox RPC → host
`navigation:write` check/path normalization → adapter `openNote(canonical)` →
controller `openNote(path): Promise<ControllerOpenNoteResult>` on its serialize
queue → guarded flush → `conflict` or load/active notification → adapter adds
anchor status → public `OpenNoteResult`.

### Missing link resolution

`extension.navigation.resolveLink("../tasks/today.md", {kind: "markdown", from:
"journal/week.md"})` → sandbox RPC → host validates options → adapter reads a
fresh note-path listing → pure `resolveNavigationLink(target, options, context)`
→ `{status: "missing", path, anchor}`. No controller or filesystem write edge
is involved after the listing read.

## Self-Review

### Round 1 — fresh re-read

The revised signatures now expose each async boundary used by the architecture.
The controller/public result split is explicit, and the adapter is the only
place where anchor presentation is added. No caller must unpack a broad service
object merely to perform one operation.

### Round 2 — reconsideration

A single `OpenNoteResult` type for both controller and public API was considered
and rejected: the controller cannot report anchor scrolling, while the adapter
must. A synchronous callback union was also considered, but all public
capabilities are promise-based and vault/FSA reads are asynchronous, so the
promise-only callback contract is clearer.

### Round 3 — simplify

`NavigationResolutionContext` remains the smallest pure-resolver input: an active
path and one fresh set of note paths. No resolver-owned cache, controller handle,
or error class was added. The adapter's exceptional I/O failure intentionally
uses the existing RPC handler-error channel rather than inventing a fourth public
resolution status.
