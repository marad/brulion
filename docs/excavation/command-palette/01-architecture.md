# FEAT-0057 — Action registry & command palette: architecture

## Goal & non-goals

**Goal**
- A `Ctrl/Cmd+Shift+K` modal that fuzzy-finds an *action* by label and runs it.
- A first-class `Action { id, label, icon?, run() }` model; the host builds a
  registry of the app's existing capabilities (go to note, switch folder, toggle
  Vim, toggle note list, open settings).
- Folder-switch and the Vim toggle become registered actions (M30 bullet 3).

**Non-goals**
- The customizable action bar / pinning (P2, FEAT-0058).
- Per-action keybinding customization; a plugin action API.
- Note find/create (stays the switcher's job; "Go to note…" just opens it).

## Modules (logical)

| Module | Responsibility |
|--------|----------------|
| **action-ranking** | Pure & total: given a query and an action list, return the actions whose label fuzzily matches, best first, stable on ties. Owns the label-scoring decision only. No DOM, no state. Reuses `fuzzyScore`. |
| **CommandPalette** | The modal overlay. Owns transient UI state (open, query, highlight, focus-restore). Renders whatever action-ranking returns (icon + label rows); maps keyboard/mouse to run / close. Reads the action list via an injected `getActions()`; runs an action by closing then calling its `run()`. Knows nothing of what any action does. |

The host (`main.ts`, existing) is **not** a new module: it owns the action
**registry** (binding each `Action.run` to an existing capability), supplies the
DOM nodes and the `Ctrl/Cmd+Shift+K` listener (with the gating), and passes
`getActions` to the palette.

### Why action-ranking is not just `searchNotes`

`searchNotes` is note-specific: it returns a `create` candidate, ranks by recency,
and matches `displayName(path)`. A palette over actions has none of that — it ranks
opaque `{label}` records with no create, no recency. Reusing `searchNotes` would
mean threading dead parameters and ignoring half its result. Both share the *one*
thing worth sharing — `fuzzyScore` (already a standalone pure fn) — so
action-ranking is a thin, separate sort over labels. (Mirrors the switcher's split:
pure ranking module + stateful overlay.)

### Why the registry lives in the host, not the palette

Each action's `run()` closes over host state (the switcher handle, the open-folder
flow, `toggleVim`, the sidebar toggle, the settings modal). Only `main.ts` has all
of those in scope. Keeping the registry there — and the palette purely a renderer of
an opaque list — means the palette has zero coupling to app capabilities and is
unit-testable with fake actions. (Same contract the switcher uses with its deps.)

## Diagram

```mermaid
flowchart TD
  KB[Ctrl/Cmd+Shift+K keydown - capture phase, gated] -->|open| CP[CommandPalette]
  CP -->|rank query, actions| AR[action-ranking - pure]
  AR -->|Action[] ordered| CP
  CP -->|getActions| HOST[main.ts host + registry]
  CP -->|action.run| HOST
  HOST -->|switcher.open| SW[quick-switcher - existing]
  HOST -->|openFolder| UI[ui.openFolder - existing]
  HOST -->|toggleVim / sidebar.toggle / settingsModal.open| CAP[existing capabilities]
```

## Edge annotation table

| From | To | Payload (type) | Sync/Async | Failure owner | Retry |
|------|----|----|----|----|----|
| keydown | CommandPalette | event → `open()` (guarded by workspaceShown + conflict-hidden + no other modal + not already open) | sync | host | none |
| CommandPalette | action-ranking | `query: string, actions: readonly Action[]` | sync | n/a (pure, total — never throws) | none |
| action-ranking | CommandPalette | `Action[]` (ordered subset) | sync | n/a | none |
| CommandPalette | host | `getActions(): readonly Action[]` (snapshot, read at open + each keystroke) | sync | host (returns `[]` pre-folder) | none |
| CommandPalette | host | `action.run(): void` — palette closes *first*, then calls it | sync, fire-and-forget | the action itself (palette is done once it calls `run`) | none |

## State ownership

- **CommandPalette** owns all transient UI state: `open` flag, `highlight` index,
  the rendered `items[]`, and `restoreFocus`. None persists; nothing crosses to disk.
- **Host** owns the action registry array (built once; `run` closures reference live
  host state). The palette never mutates it.
- No new persisted/IndexedDB/disk state in this phase. (P2 adds `Settings.actionBar`.)

## Open questions

- None load-bearing. Icon set: reuse M27 Lucide nodes where one fits; actions
  without an obvious icon render label-only (AC-7 covers both).

## Self-Review

**Round 1 (fresh re-read).** Cold-read flags considered: (a) "action-ranking" vs
"CommandPalette" naming — both describe responsibilities, not nouns-as-things; kept.
(b) Is a separate ranking module over-decomposition for a one-line sort? See Round 3.

**Round 2 (reconsider/regenerate).** Considered folding ranking into the palette
(no separate module) vs keeping it separate. The switcher precedent keeps the pure
ranking testable without DOM, and the project values pure cores beside their glue.
But here the "ranking" is genuinely one sort over `fuzzyScore` — much thinner than
`searchNotes`. Decision: keep `rankActions` as an **exported pure function in
`command-palette.ts`** (not a separate module/file) — testable in isolation, no new
module boundary for a one-function concern. Regenerated the module table to reflect
"action-ranking" as a logical concern realized as an exported fn, not a file.

**Round 3 (simplify).** Dropped any notion of a `Match`/score wrapper type in the
result (the switcher returns bare paths; the palette returns bare `Action[]`). No
recency, no create, no persisted state — nothing to subtract further. The palette is
deliberately a near-clone of the switcher's mechanics; resisting a premature "shared
overlay base class" is the right call at two instances (rule of three).
