# FEAT-0057 — Signature-fit trace

The palette's signatures deliberately mirror the proven `quick-switcher.ts`
contract (same deps-object + handle shape). Traced 5 scenarios against the actual
declared types in `src/command-palette.ts`.

1. **Open → type → Enter runs.** `open()` → `deps.getActions(): readonly Action[]`
   → `rankActions("", actions): Action[]` (all, registry order) → render rows. Type
   `"vim"` → `onInput` → `rankActions("vim", actions)` → `[{label:"Toggle Vim
   mode",…}]` → render. Enter → highlighted `items[i].run` → `close()` then
   `action.run()`. Types fit at every edge; no repacking.

2. **Click runs.** Row `<button>` click bound to the *same* `run` closure as Enter
   → one code path (close + `action.run()`). No second adaptation.

3. **Esc / backdrop closes, no run.** Esc/backdrop → `close()` →
   `backdrop.hidden = true` + `restoreFocus?.focus?.()`. No `run` reached. Matches
   AC-5 (focus restored).

4. **Empty action list (error/edge).** `getActions()` → `[]` → `rankActions(q, [])`
   → `[]` → empty list; Enter → `items[highlight]?.run()` optional-chains to a
   no-op. No crash (same robustness as the switcher's empty-result path).

5. **Icon present vs absent (AC-7).** `render()` branches on `action.icon`:
   present → `createElement(icon, …)` prepended; absent → label-only. The `icon?`
   optional on `Action` carries the branch; no separate type needed.

**Findings:** none. No pass-through layers (the host registry → palette → ranking
chain each does distinct work), no God type (actions are opaque `{id,label,icon?,run}`),
no swallowed errors (palette is fire-and-forget by contract; the action owns its own
failures). No async boundary assumed sync — `run` is declared `() => void` and the
palette never awaits it.

## Self-Review

- **Round 1/2:** Reconsidered whether `getActions()` should be read once at open vs
  per keystroke. Per-keystroke (the switcher's choice) costs nothing for ~5 actions
  and keeps the list live; kept. No regeneration.
- **Round 3:** No redundant steps across the traces. `rankActions` and the render
  loop are the only logic; neither is removable. Nothing fetched twice.
