# FEAT-0033 — Quick switcher: architecture

## Goal & non-goals

**Goal**
- A `Ctrl+K` / `Cmd+K` modal that fuzzy-finds an existing note and opens it.
- Create-on-miss: a query that names a *new* note offers "Create «query»", which
  creates + opens it through the existing validated, non-clobbering create path.
- Replace the sidebar inline-create textbox; the switcher is the one create surface.

**Non-goals**
- Full-text / body search (names & paths only).
- A general command palette (rename/delete/settings).
- Recency/frecency ordering, or any new persisted state.

## Modules (logical)

| Module | Responsibility |
|--------|----------------|
| **note-search** | Pure & total: given a query and the current note paths, return the ranked existing matches **and** whether the query is a valid *new* name to offer for creation. Owns fuzzy scoring, the match/no-match predicate, and the query→filename normalization decision. No DOM, no state. |
| **Switcher** | The modal overlay. Owns transient UI state (open, query, highlight). Renders whatever note-search returns; maps keyboard/mouse to open / create / close. Reads notes and invokes open/create via injected callbacks. |

The host (`main.ts`, existing) is **not** a new module: it already owns the note
list/active (via note-controller), supplies the DOM nodes and the `Ctrl+K`
listener, and binds the Switcher's callbacks to `controller.switchTo` / `addNote`.

### Why one pure module, not two (Ranker + a separate normalizer)

The "show Create?" decision and the "rank matches" decision both depend on the
same inputs (query + paths) and must agree (a query is a *create* candidate
exactly when its normalized filename isn't already a note). Splitting them invites
the Switcher to re-derive the predicate and drift. So note-search returns **one**
result object and the Switcher does no matching logic of its own.

## Diagram

```mermaid
flowchart TD
  KB[Ctrl/Cmd+K keydown - capture phase] -->|open| SW[Switcher]
  SW -->|search query, paths| NS[note-search - pure]
  NS -->|SearchResult: matches[], create?| SW
  SW -->|getNotes| HOST[main.ts host]
  SW -->|openNote path| HOST
  SW -->|createNote name => Result| HOST
  HOST -->|switchTo path| NC[note-controller - existing]
  HOST -->|addNote name => Result| NC
```

## Edge annotation table

| From | To | Payload (type) | Sync/Async | Failure owner | Retry |
|------|----|----|----|----|----|
| keydown | Switcher | event → `open()` (guarded by `workspaceShown`; no-op if already open) | sync | host | none |
| Switcher | note-search | `query: string, paths: readonly string[]` | sync | n/a (pure, total — never throws) | none |
| note-search | Switcher | `SearchResult` = `{ matches: Match[]; create: CreateOption \| null }` | sync | n/a | none |
| Switcher | host | `getNotes(): readonly string[]` (snapshot, read at open + each keystroke) | sync | host (returns `[]` pre-folder) | none |
| Switcher | host | `openNote(path: string): void` | sync, fire-and-forget | note-controller (re-lists on a failed switch); Switcher closes regardless — matches the existing sidebar click | none |
| Switcher | host | `createNote(name: string): Promise<{ ok: boolean; reason?: string }>` | async | Switcher (on `!ok`, shows `reason` inline and stays open) | none |
| host | note-controller | `switchTo(path)` / `addNote(name)` | async | note-controller (existing) | existing |

## Types crossing the boundary

```
Match        = { path: string; score: number }   // path includes ".md"
CreateOption = { filename: string }              // normalized create target; label = displayName(filename), create arg = filename
SearchResult = { matches: Match[]; create: CreateOption | null }
```

## The match / create rule (owned by note-search)

- `matches`: each path's **display form** (strip `.md`) fuzzy-scored against the
  query; non-matches dropped; sorted by score desc, then path asc (stable, total).
  Empty/whitespace query ⇒ all paths, name order, every score equal.
- `create`: present **iff** the trimmed query is non-empty **and**
  `normalizeNoteName(query).ok` **and** the normalized `filename` is **not**
  already in `paths`. So:
  - query normalizes to an existing note ⇒ `create = null` (that note is already in
    `matches`; we never offer to "create" what exists). This also covers the
    *normalized-collision* case the raw fuzzy text would miss.
  - query is an invalid name (e.g. `..`, illegal chars) ⇒ `create = null` (nothing
    to offer). The Switcher only surfaces a validation message if the user forces a
    create on an empty result — and that message comes from `createNote`'s `reason`.
  - query is a valid, new name ⇒ `create = { filename }`. The Switcher renders the
    label as `displayName(filename)` and passes `filename` to `createNote`.

`normalizeNoteName` is the **same** pure validator note creation already uses
(note-name.ts), so the display decision and the actual `addNote` create can never
disagree.

## State ownership

| State | Owner | Boundary |
|-------|-------|----------|
| open/closed, query, highlight index | Switcher | transient, in-memory; reset on each `open()`; `open()` while open is a no-op refocus. Never persisted. |
| note paths, active note | note-controller (existing) | unchanged; Switcher reads a snapshot via `getNotes()`. A note deleted externally between snapshot and open is the controller's concern (it re-lists). |
| disk (note files) | note-controller / fs (existing) | unchanged; the only write the switcher can cause is one `addNote` the user explicitly triggers. |

## Removal of the inline-create textbox

- Delete `<form id="new-note">` + `#new-note-input` from the sidebar markup.
- Delete `wireNewNote` (ui.ts) and its unit test; remove the `wireNewNote(...)`
  block + `#new-note*` queries from main.ts.
- `#status` (a `<p>` that only ever showed new-note validation errors) becomes
  dead — remove it and its `statusEl`/`clearStatus` glue **after** confirming no
  other caller references it. Create errors now render in the switcher's own
  `#switcher-error`.

## Open questions

None load-bearing.
- Highlight on ↑/↓: **clamp, no wrap** (simpler; fine for a short list).
- `Ctrl+K` while the switcher is open: **no-op** (refocus the input), not a toggle —
  avoids the capture-phase listener fighting the focused input.
