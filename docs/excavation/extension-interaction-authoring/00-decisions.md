# M46 P4 — Authoring and validation decisions

## Chosen shape

- Keep API v1 additive and stable. FEAT-0106 publishes the interaction
  contract; it does not add runtime methods or permission meanings.
- Bump the deterministic Authoring Kit from `1.2.0` to `1.3.0` because the kit
  gains interaction examples and lifecycle guidance. Existing v1 extensions do
  not need a manifest change.
- Add two examples rather than one all-permission sample:
  `selection-feedback` requests `commands`, `editor:read`,
  `editor:selection`, and `notifications`; `dialog-lifecycle` requests only
  `commands` and `dialogs`. This makes least privilege visible in the files.
- Keep `api-contract.json` as the machine-readable contract and `API.md` as
  human guidance. The declaration file mirrors public types, while tests reject
  drift among all three; no separately hand-maintained API copy is introduced.
- Validate the published surface in Chromium/OPFS by using the same command
  shapes as the kit examples and asserting the note bytes before and after.
  FEAT-0105 remains the owner of the full dialog lifecycle and coded timeout /
  disposal path; P4 checks that an author can discover those rules.

## Deferred / out of scope

- No new API capability, event, permission, package, TypeScript path, or
  automatic example installation.
- No copy-to-vault wizard: the workbench's existing copy/download kit surface
  remains the distribution boundary.
- No separate generated documentation pipeline; Vite's existing public copies
  remain the static publication mechanism.

## Self-Review

I reconsidered one combined interaction example versus two examples. A single
example would be shorter but would require every reader to grant dialogs and
selection/write-adjacent permissions just to see one feature. Two small files
make the least-privilege rule executable and keep each example independently
reviewable, so I kept the split. I also considered adding a new API-docs module;
the existing contract renderer and workbench kit panel already own those
responsibilities, so P4 changes their inputs/tests rather than introducing a
forwarding layer. The scope is documentation, kit data, and browser evidence;
Markdown bytes and runtime capabilities remain outside it.
