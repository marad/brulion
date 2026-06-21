# Excavation — Quick switcher (FEAT-0033)

Top-down design artifacts for the `Ctrl+K` / `Cmd+K` quick switcher.

- [`01-architecture.md`](01-architecture.md) — modules, diagram, edge table, the
  match/create rule, state ownership.
- [`03-signature-fit.md`](03-signature-fit.md) — adversarial signature-fit trace +
  the resolutions (made AC-7 reachable, removed double-validation, clarified
  switcher-owned selection).

Implementation:
- `src/note-search.ts` (+ `.test.ts`) — pure `fuzzyScore` + `searchNotes`
  (ranking + create-eligibility).
- `src/quick-switcher.ts` (+ `.test.ts`) — the modal overlay.
- Wiring: `src/main.ts` (mount, `Ctrl/Cmd+K`, sidebar find-or-create button),
  `index.html`, `src/styles.css`. The old `#new-note` textbox + `wireNewNote` were
  removed.
- E2E: `e2e/quick-switcher.spec.ts`; create flows in `note-crud`/`links`/
  `wikilinks`/`subfolders`/`link-interaction` migrated to the switcher.

Spec: `specs/FEAT-0033-quick-switcher-and-note-creation.md`. Decision record: see
`DECISIONS.md` → the FEAT-0033 entry.

## Self-review (phase boundaries)

- **Phase 1:** a cold-context critique flagged the unowned normalization/match
  boundary. Regenerated the design to fold ranking + create-eligibility +
  normalization into one pure module (`note-search`); simplified the boundary types
  to bare strings.
- **Phase 3:** signature-fit caught that AC-7 was unreachable (a `null` create for
  invalid names meant no Create row to trigger the error) and a double-normalize.
  `SearchResult.create` became "the query to attempt", validated once in
  `createNote`.
- **Phase 5 / code-review:** fixed three issues — Ctrl+K opening over the conflict
  modal, a stale async create after reopen (generation token), and focus not being
  restored on close.

## Deferred / out of scope
- Full-text body search, a general command palette, recency ordering — see the
  milestone (`milestones/M12.md`) and spec "Out of scope".
