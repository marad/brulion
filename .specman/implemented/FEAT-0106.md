---
id: FEAT-0106
title: Extension interaction authoring kit and browser validation
status: draft
depends_on: [FEAT-0105, FEAT-0083, FEAT-0084]
---

## Intent

An extension can now read and move the primary editor selection, show safe
formatted feedback, and ask bounded host-owned dialogs, but a person or LLM
agent still needs a complete, reviewable way to discover and use that API. Make
the versioned Authoring Kit, its machine-readable contract, declarations,
human guide, examples, and static browser reference agree on the interaction
surface. Validate that the published kit teaches least-privilege permissions,
raw Markdown fidelity, and lifecycle/error handling without adding a runtime
capability or weakening the sandbox.

## Behavior

The Authoring Kit remains a deterministic collection of ordinary files. Its
version advances for the interaction documentation release and includes
least-privilege examples for direction-aware selection/notification feedback
and for alert/confirm/prompt lifecycle handling. Examples remain disabled until
the user explicitly enables them, use JavaScript ESM only, and do not access
DOM, CodeMirror, FSA handles, storage, network, packages, or timers.

The declaration file and `api-contract.json` are the machine-readable source
for API v1. They describe every permission, method, shared message/selection
type, bound, return value, cancellation distinction, FIFO/modal behavior,
source-scoped `disposed` cleanup, coded `timeout`, stale-vault rejection, and
unchanged-Markdown consequence. The API guide and agent-facing files explain
how to choose the smallest permission set, preserve mtime/file fidelity, catch
interactive errors, and review before explicit enablement. Existing API v1
manifests and method names remain valid.

The browser reference continues to work as a progressive enhancement: its
static hand-off exposes `api.md`, `api-contract.json`, and
`brulion-extension.d.ts` without JavaScript, while the generated reference and
workbench kit panel expose the same interaction examples and contract. Unit
and Chromium/OPFS checks compare the kit/contract/static artifacts and exercise
an example through the real enabled-extension path without changing note bytes.

## Acceptance criteria

- AC-1: Given the released Authoring Kit, when it is listed or downloaded, then
  it contains deterministic selection/notification and dialog lifecycle
  examples with manifests declaring only the permissions they use, alongside
  the template, declarations, contract, API guide, and agent-facing files; the
  examples are not enabled implicitly.
- AC-2: Given the declarations and machine-readable contract, when contract
  tests parse them, then every v1 method and permission has matching signatures,
  types, bounds, examples, and errors, including `{ anchor, head, text }`,
  `MessageContent`, prompt `string | null` versus accepted `""`, FIFO host
  modal behavior, `disposed`/`timeout`, and stale-vault rejection; old v1
  manifests remain accepted and no obsolete selection or prompt labels appear.
- AC-3: Given a person or LLM agent reading the kit, when they follow its guide
  and examples, then it states JavaScript ESM/explicit enablement, least
  privilege, no DOM/CodeMirror/FSA/network/package/timer escape hatches,
  mtime-guarded Markdown writes, safe formatted rendering, and how to handle
  confirmation, cancellation, disposal, timeout, and unchanged-file behavior.
- AC-4: Given JavaScript is disabled or the workbench/API reference is opened,
  when an author looks for the contract, declarations, guide, or interaction
  methods, then the static links, generated method cards, shared types, kit
  listing, and downloadable bundle all expose the same versioned content and
  include the interaction examples without drift.
- AC-5: Given a real Chromium/OPFS vault with an explicitly enabled example,
  when its user-invoked command exercises selection/feedback or a dialog and
  the author opens the workbench/API reference, then the real iframe/RPC path,
  least-privilege manifest, rendered result, lifecycle error guidance, and
  static kit surfaces are observable while the active Markdown bytes remain
  unchanged.
- AC-6: Given the complete FEAT-0106 artifact set, when targeted tests, full
  Vitest, `specman verify`, build, and browser validation run, then they pass
  with a clean source worktree and all M46 specs are `in-sync`; no production
  API capability, permission meaning, or file-format behavior changes.

## Out of scope

- New runtime capabilities, API version changes, permission semantics, or
  extension triggers.
- TypeScript execution, package installation, network imports, timers,
  background work, custom extension UI, DOM/FSA access, system notifications,
  or changes to user-owned Markdown bytes.
- Replacing the static contract with a separately maintained documentation
  copy; generated/static artifacts must remain derived from the kit sources.
