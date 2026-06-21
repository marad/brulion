# FEAT-0033 — Quick switcher: adversarial signature-fit review

Reviewed against the **actual declared signatures**, not the architecture prose.
The two diverge in load-bearing ways (see Finding A), so every trace below is run
twice where it matters: once against the doc's claimed types, once against what
`note-search.ts` / `quick-switcher.ts` actually declare.

## The signatures as actually declared

```
// note-search.ts
fuzzyScore(query: string, target: string): number | null
searchNotes(query: string, paths: readonly string[]): SearchResult
SearchResult = { matches: string[]; create: string | null }

// quick-switcher.ts
QuickSwitcherDeps = {
  getNotes: () => readonly string[]
  openNote: (path: string) => void                       // sync, fire-and-forget
  createNote: (name: string) => Promise<CreateResult>    // async
}
CreateResult = { ok: boolean; reason?: string }
mountQuickSwitcher(els, deps): QuickSwitcher

// note-controller.ts (host binds switcher deps to these)
switchTo(name: string): Promise<void>
addNote(name: string): Promise<AddNoteResult>
AddNoteResult = { ok: true } | { ok: false; reason: string }

// note-name.ts
normalizeNoteName(input): { ok:true; filename } | { ok:false; reason }
displayName(filename: string): string
```

---

## Scenario 1 — Fuzzy-find an existing note and open it

User has `paths = ["Diablo builds.md", "Daily/2026-06-21.md"]`, types `diab`,
presses ↓ once then Enter.

Trace:
1. `mountQuickSwitcher` input handler → `searchNotes("diab", getNotes())`.
   `getNotes(): readonly string[]` returns `["Diablo builds.md", "Daily/2026-06-21.md"]`.
2. `searchNotes` internally, per path: `fuzzyScore("diab", displayName(path))`
   = `fuzzyScore("diab", "Diablo builds")` → some `number`;
   `fuzzyScore("diab", "Daily/2026-06-21")` → `number | null`.
3. `searchNotes` returns `SearchResult = { matches: ["Diablo builds.md"], create: null }`.
4. Switcher renders rows from `matches: string[]`. Highlight index starts at 0;
   ↓ clamps (one row) → stays 0.
5. Enter on highlighted row → `deps.openNote("Diablo builds.md")` (`void`).
6. Host binds `openNote` → `controller.switchTo("Diablo builds.md")`, which is
   `Promise<void>`. Switcher calls `close()` immediately, ignoring the promise.

Findings:
- **(1.a — async boundary assumed sync) `openNote: (path) => void` wraps
  `switchTo: Promise<void>`.** The fire-and-forget is intentional per the doc
  ("Switcher closes regardless"), but the *signature actively discards the
  promise*. If `switchTo` rejects (folder revoked, read fails mid-switch), the
  rejection becomes an **unhandled promise rejection** at the host's binding
  site — there is no `.catch`, and `void` gives the switcher no way to attach
  one. The doc names note-controller as "failure owner (re-lists on a failed
  switch)", but `switchTo: Promise<void>` exposes neither a success flag nor a
  hook; the "re-list on failure" is asserted, not visible in the type. Nothing
  in these signatures can observe or route a switch failure.
- **(1.b — info loss across the boundary) `matches: string[]` has dropped the
  score.** The architecture declares `Match = { path; score }` and renders
  ranked rows; `fuzzyScore` returns a `number` precisely so rows can be ranked.
  But `SearchResult.matches` is `string[]` — the score is computed inside
  `searchNotes`, used to sort, then **thrown away** at the boundary. The
  switcher cannot show match strength, tie-break differently, or even tell the
  user *why* `Daily/2026-06-21.md` was dropped vs. kept. The whole point of a
  numeric score crossing into a `Match` object (per the doc) is gone; the
  signature reduces fuzzy search to an opaque sorted list.

---

## Scenario 2 — Query names a brand-new note; user creates it

`paths` as above. User types `Grocery list`, presses Enter on the "Create" row.

Trace:
1. input handler → `searchNotes("Grocery list", paths)`.
2. Inside `searchNotes`: each `fuzzyScore("Grocery list", displayName(p))` → `null`
   (no subsequence) ⇒ `matches: []`. Then
   `normalizeNoteName("Grocery list")` → `{ ok:true, filename:"Grocery list.md" }`,
   `"Grocery list.md"` ∉ `paths` ⇒ `create: "Grocery list.md"`.
3. Returns `{ matches: [], create: "Grocery list.md" }`.
4. Switcher renders a create row. Label per doc = `displayName(create)` =
   `displayName("Grocery list.md")` = `"Grocery list"`. **So the switcher must
   re-import and call `displayName` itself just to label the row** — `searchNotes`
   already called `normalizeNoteName`/`displayName` internally and still hands
   back the raw `.md` filename.
5. Enter → `await deps.createNote("Grocery list.md")` → `Promise<CreateResult>`.
6. Host binds `createNote` → `controller.addNote("Grocery list.md")` →
   `Promise<AddNoteResult>`.

Findings:
- **(2.a — needless type repack) `CreateResult` vs `AddNoteResult`.**
  `addNote` returns `AddNoteResult = { ok:true } | { ok:false; reason }` (a
  discriminated union — `reason` is *guaranteed present* on failure and *absent*
  on success). `createNote` is declared to return `CreateResult =
  { ok: boolean; reason?: string }` — a **looser, non-discriminated** shape. The
  host must adapt one to the other for no semantic gain: the union is strictly
  more precise, and flattening it to `{ ok, reason? }` *loses* the guarantee that
  a failure carries a reason. Two structurally near-identical result types for
  the same operation, with the switcher's being the weaker one.
- **(2.b — `create` is a bare string, the doc says `CreateOption`).** Same flatten
  as 1.b. The doc's `CreateOption = { filename }` carried intent ("this is a
  normalized create target"); `create: string | null` is just a string that
  *also* doubles as both the create argument **and** (via a switcher-side
  `displayName` call) the label source. The switcher now owns presentation logic
  (`displayName`) the architecture explicitly assigned to note-search's domain
  ("Label is `displayName(create)`"). The label/arg coupling lives in a comment,
  not the type.
- **(2.c — pass-through host layer).** `createNote(name) → addNote(name)` and
  `openNote(path) → switchTo(path)` are pure forwarders with **identical
  argument shape**. The `QuickSwitcherDeps` indirection exists only to keep the
  switcher off the controller — fine in principle — but `createNote`/`addNote`
  differ *only* in return type (`CreateResult` vs `AddNoteResult`, see 2.a), so
  the layer's sole effect is to **downgrade** the result type. A pass-through
  that loses precision is worse than no layer.

---

## Scenario 3 (error) — User forces a create on an invalid name

User types `..` (or `a:b`), and — per the doc — `create` is `null`, so there is
**no create row**, yet the user presses Enter on an empty result to "force" a
create.

Trace:
1. `searchNotes("..", paths)`: `matches` — `fuzzyScore("..", displayName(p))`
   for each path, likely `null` ⇒ `[]`. `create`: `normalizeNoteName("..")` →
   `{ ok:false, reason:"Name cannot contain . or .. path segments." }` ⇒
   `create: null`.
2. Returns `{ matches: [], create: null }`.
3. Switcher state: no rows, no create option, highlight index has nothing to
   point at. User hits Enter.
4. **Dead end.** The doc says: *"The Switcher only surfaces a validation message
   if the user forces a create on an empty result — and that message comes from
   `createNote`'s `reason`."* But to get a `reason`, the switcher must call
   `createNote("..")` → `addNote("..")` → `normalizeNoteName("..")` **again**,
   re-deriving the very rejection `searchNotes` already computed and discarded.

Findings:
- **(3.a — error with no clear handler / re-derivation).** The rejection reason
  for an invalid name is computed **twice**: once inside `searchNotes` (where it
  is thrown away — `create` collapses to `null`, no reason retained) and again
  inside `addNote` when the switcher force-creates. `SearchResult` has **no
  field for "valid query? if not, why?"** — it cannot distinguish "no create
  offered because the name already exists" from "no create offered because the
  name is illegal". Both are `create: null`. The switcher therefore *cannot*
  decide whether forcing a create is even sensible without a throwaway round-trip
  through `createNote`.
- **(3.b — Enter-on-empty has no defined call).** The signatures give the
  switcher `getNotes`, `openNote(path)`, `createNote(name)`. With `create: null`
  and `matches: []`, **what string does Enter pass to `createNote`?** The raw
  query (`".."`)? There is no `create` value to pass. The doc's "force a create"
  path requires the switcher to fall back to the **raw, un-normalized query**,
  which means `createNote`/`addNote` receives `".."` and the discriminated-union
  `reason` is the only thing that saves it. The contract for what Enter does on
  an empty/`create:null` state is unspecified by any signature — it lives purely
  in prose, and the prose contradicts itself ("create is null ⇒ nothing to
  offer" vs "the user forces a create on an empty result").

---

## Scenario 4 (the ambiguous one) — Query fuzzy-matches an existing note AND is a valid new name

`paths = ["Diablo builds.md"]`. User types `Diablo` (a subsequence of "Diablo
builds", and `normalizeNoteName("Diablo")` → `{ ok:true, filename:"Diablo.md" }`,
and `"Diablo.md"` ∉ `paths`).

Trace:
1. `searchNotes("Diablo", ["Diablo builds.md"])`:
   - `matches`: `fuzzyScore("Diablo", "Diablo builds")` → `number` ⇒
     `matches: ["Diablo builds.md"]`.
   - `create`: trimmed non-empty ✓; `normalizeNoteName("Diablo")` ok, filename
     `"Diablo.md"`; `"Diablo.md"` ∉ paths ✓ ⇒ `create: "Diablo.md"`.
2. Returns `{ matches: ["Diablo builds.md"], create: "Diablo.md" }`.
3. Switcher renders the match row **and** a "Create «Diablo»" row
   (`displayName("Diablo.md")`).
4. User presses Enter. **Which row?**

Findings:
- **(4.a — the central ambiguity is not encoded anywhere).** This is the headline
  case and the signatures do nothing to resolve it. `SearchResult` is a flat
  `{ matches, create }` with **no ordering relationship between the two**. The
  switcher must invent a policy — does the create row sit above or below matches?
  Is it the highlighted default or not? — entirely in UI code, with no type-level
  guidance. The architecture's rule ("`create` present iff normalized filename ∉
  paths") *guarantees* this both-present state is reachable for any prefix of an
  existing note, so it is common, not a corner case. The unified result object
  was the doc's stated reason for one pure module ("the Switcher does no matching
  logic of its own") — yet the **most consequential decision** (what Enter
  selects when both exist) is precisely matching/selection logic the switcher is
  now forced to own.
- **(4.b — highlight index has no stable referent across two heterogeneous
  lists).** Highlight is "an index" per the state table, but the rendered list is
  `matches` (strings) **plus** an optional `create` (string) of a *different
  meaning*. A single integer index over a concatenation of two semantically
  distinct collections forces the switcher to track "is index N a match or the
  create slot?" by position arithmetic. Nothing in `SearchResult` models "the
  selectable rows" as one list; the switcher must synthesize it, and the
  match/create distinction it must preserve is exactly the distinction the flat
  `string`s erased (1.b, 2.b).

---

## Scenario 5 — Pre-folder open (empty workspace) and the empty-query open

User presses Ctrl+K before granting a folder, OR opens the switcher and types
nothing.

Trace:
1. Host's Ctrl+K → `switcher.open()` (doc: guarded by `workspaceShown`; the
   *guard lives in the host*, not in `open()` — `open()` itself has no parameter
   to know whether a folder exists).
2. `open()` → `searchNotes("", getNotes())`. Pre-folder, `getNotes()` returns `[]`
   ("returns `[]` pre-folder" per doc).
3. `searchNotes("", [])`: empty query ⇒ "all paths in name order" = `[]`;
   `create`: trimmed query empty ⇒ `create: null`.
4. Returns `{ matches: [], create: null }`. Empty modal.

Findings:
- **(5.a — the pre-folder guard is invisible to the switcher).** `open()` takes no
  args and `getNotes` cannot distinguish "no folder" from "folder with zero
  notes" — both yield `[]`. The switcher cannot render a meaningful empty state
  ("grant a folder first" vs "no notes yet, type to create") because the
  signatures collapse both worlds to `[]`. The doc pushes the guard up to the
  host (`workspaceShown`), but then `open()`'s contract ("Show the overlay") and
  the host's "don't show before folder" live in two places with no shared type.
- **(5.b — empty-query create suppression duplicates the empty check).**
  `searchNotes("")` returns `create: null` for empty query, and
  `normalizeNoteName("")` *also* returns `{ ok:false, "Name cannot be empty." }`.
  Two independent empty-string gates (one in `searchNotes`'s trim check, one in
  `normalizeNoteName`) that must stay in agreement; the signature doesn't let
  `searchNotes` reuse the validator's verdict — it re-trims and re-checks.

---

## Cross-cutting findings

- **A. The stubs contradict the architecture's own type contract.** The doc's
  "Types crossing the boundary" section declares `Match = { path; score }`,
  `CreateOption = { filename }`, `SearchResult = { matches: Match[]; create:
  CreateOption | null }`. The implemented `SearchResult` is
  `{ matches: string[]; create: string | null }`. **Every typed object the
  architecture promised has been flattened to a bare string.** Score, the
  `CreateOption` wrapper, and the match/create type distinction are all gone.
  This is the root of findings 1.b, 2.b, 3.a, 4.a, 4.b. The signature-fit review
  exists to catch exactly this: the contract was weakened during stubbing and
  the prose was never updated to match.

- **B. Result-type proliferation for one operation.** `AddNoteResult`
  (discriminated union, controller) → `CreateResult` (`{ok, reason?}`, switcher
  deps). Same outcome, two types, the switcher's strictly weaker. `displayName`
  is owned by note-name, asserted as note-search's responsibility by the doc
  ("Label is `displayName(create)`"), but actually re-invoked by the switcher
  because note-search hands back the raw filename.

- **C. The one async dep (`createNote`) and the one sync-but-actually-async dep
  (`openNote`) sit in the same interface with no signal of the difference beyond
  the return type.** `openNote: (path) => void` silently drops a `Promise<void>`;
  `createNote: (name) => Promise<CreateResult>` is awaited. A reader of
  `QuickSwitcherDeps` cannot see that *both* underlying controller calls are
  async — one was deliberately de-promised at the boundary, and that decision
  (and its unhandled-rejection consequence, 1.a) is encoded only by the absence
  of `Promise` in one of the two signatures.

- **D. `searchNotes(query, paths)` recomputes per keystroke (doc: "read at open +
  each keystroke") with no incremental contract.** `paths: readonly string[]` is
  re-passed whole and re-scored every keystroke; `fuzzyScore` is re-run over the
  full list each time. Acceptable for a short list (the doc says so), but the
  signature offers no way to memoize scored results across keystrokes — every
  call is from scratch, including the `displayName(path)` strip for every path on
  every keystroke.

---

## Resolution (main agent)

- **A — doc/stub type divergence:** real (introduced by a Phase-2 simplification
  that flattened `Match`/`CreateOption` to bare strings without updating the doc).
  Fixed: the architecture doc's "Types crossing the boundary" + rule sections now
  match the stubs (`matches: string[]`, `create: string | null`).
- **AC-7 reachability / double-normalization (findings 3):** real and important.
  Changed `create` to mean *the trimmed query to attempt* (present for any
  non-empty query that doesn't name an existing note, incl. invalid names), instead
  of a pre-validated filename. note-search normalizes only to test existence; the
  single real validation happens in `createNote`/`addNote`, which returns the
  `reason` shown inline. This both makes AC-7 reachable (invalid name → Create row →
  attempt → error) and removes the duplicated reason computation.
- **Headline case + single highlight (finding 4):** clarified ownership — the
  Switcher renders one ordered list `[...matches, create?]` with a single clamped
  highlight (default first row); Enter defaults to the top match. Documented under
  "Selection (owned by the Switcher)". note-search still owns *what* matches/create
  are, so the "no matching logic in the Switcher" rationale holds.
- **openNote unhandled rejection (finding 1):** kept fire-and-forget — identical to
  the existing sidebar `void controller.switchTo(name)`; switchTo owns its own
  errors (re-lists). Not special-cased.
- **CreateResult vs AddNoteResult (finding 2):** kept the structural
  `{ ok; reason? }` — `AddNoteResult` is assignable to it, so the host binding
  `createNote: n => controller.addNote(n)` needs zero adaptation while the switcher
  stays decoupled from note-controller's types. The create-row label uses
  `displayName` (a shared pure helper) — a rendering call, not a matching leak.
- **getNotes []: no-folder vs empty (finding 5):** irrelevant to the switcher —
  `open()` is host-guarded by `workspaceShown`, so `[]` always means an empty open
  folder; both render an empty match list.
- **Sync/async asymmetry (C) & per-keystroke memoization (D):** intentional /
  premature respectively. Create must be awaited for ok/reason; open is
  fire-and-forget. Note counts are tens — scoring all per keystroke is trivial; no
  memoization.
