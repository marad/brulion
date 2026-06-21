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
// note-search → Switcher
SearchResult = { matches: string[]; create: string | null }
//   matches: existing note paths (with ".md"), best match first
//   create:  the trimmed query to offer for creation, or null

// Switcher → host (deps)
getNotes()         : readonly string[]
openNote(path)     : void                       // fire-and-forget
createNote(name)   : Promise<{ ok: boolean; reason?: string }>   // structurally accepts AddNoteResult
```

The boundary objects are deliberately flat (bare strings, not `{path,score}` /
`{filename}` wrappers): the Switcher needs the *order* of matches, not their
scores, and the create row is one string it shows and forwards. `fuzzyScore` is
still exported for unit tests, but its number never crosses into the Switcher.

## The match / create rule (owned by note-search)

- `matches`: each path's **display form** (strip `.md`) fuzzy-scored against the
  query; non-matches dropped; sorted by score desc, then path asc (stable, total).
  Empty/whitespace query ⇒ all paths, name order.
- `create`: the **trimmed query** when it is non-empty and does not name an
  existing note, else `null`:
  - query normalizes to an existing note ⇒ `create = null` (that note is already in
    `matches`; never offer to "create" what exists — this also covers the
    *normalized-collision* the raw fuzzy text would miss).
  - query is invalid (`normalizeNoteName` rejects) ⇒ it names no existing note, so
    `create = <query>` is still offered. Activating it calls `createNote`, which
    re-validates and returns `{ ok:false, reason }` → the Switcher shows the
    message inline (this is how AC-7 is reachable).
  - query is a valid, new name ⇒ `create = <query>`; activating it creates + opens.

`normalizeNoteName` is the **same** pure validator note creation already uses
(note-name.ts), used here only to test existence; the actual validation+create
happens once, in `createNote`/`addNote`, so the two never disagree and the reason
is computed only at the point of creation.

## Selection (owned by the Switcher)

note-search owns *what* the matches and create candidate are; the Switcher owns
how they're presented and chosen. It renders one ordered list of rows —
`[...matches, create?]` — with a single highlight index (clamped, default = first
row). Enter activates the highlighted row: a match row → `openNote`; the create
row → `createNote`. So with both present, Enter defaults to the top match, and the
user arrows down to reach Create. This is presentation, not matching logic.

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
