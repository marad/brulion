---
id: FEAT-0058
title: Customizable action bar and settings pinning
status: draft
depends_on: [FEAT-0057, FEAT-0047, FEAT-0048]
---

## Intent

FEAT-0057 made the app's capabilities first-class **actions** and gave them a
command palette. But every action still lives only behind a keystroke or a buried
menu; there is no way to put the one or two you use constantly where your eye and
mouse already are — the top bar. This phase lets the user **pin** actions to a
header action bar and order them, configured in the M16 settings and persisted in
the vault's `.brulion.json` so the choice travels with the notes.

This is pure UI/UX over the existing action registry (FEAT-0057) and the existing
settings engine (FEAT-0047/0048). The only thing written to disk is the user's own
preference list inside the settings file Brulion already owns — no note bytes are
touched, so the file-fidelity moat is untouched.

## Behavior

**The setting.** `Settings` gains `actionBar: string[]` — an ordered list of pinned
action ids. It is normalized like the rest of the model: non-string entries are
dropped and duplicates removed (first occurrence wins), so a hand-edited file can't
break the bar. The default is an **empty** list — out of the box the header looks
exactly as it did before this phase (no surprise UI; the palette stays the
discoverable entry).

**The bar.** A header action-bar group renders the pinned actions, in order, as
**icon-only** buttons (the icon from the action's Lucide node, FEAT-0057); the label
is exposed as the button's tooltip (`title`) and accessible name (`aria-label`), not
as visible text — keeping the header compact as the pinned set grows. Clicking a
button runs that action. An id in `actionBar` that does not resolve to a registered
action is **ignored** — no button, no error — so a stale or hand-typed id is
harmless. The bar sits alongside the always-present header chrome (the sidebar
toggle, settings gear, Install button), which is untouched.

**Configuring it.** The settings modal gains a distinct **Action bar** section (its
own heading, visually separated from the appearance controls, with its own scrollable
list so a growing action set doesn't crowd the dialog). The user can pin/unpin each
registered action, and **reorder the pinned ones by dragging** them within the list.
Every change reports through the existing settings `onChange` patch, so the host
applies + persists it (writes `.brulion.json`) and the bar re-renders live. Reopening
the app on the same vault (or another machine with that folder) restores the same bar.

## Constraints

- **Reuse the settings engine.** `actionBar` rides the existing `Settings` model,
  `normalizeSettings`, `loadSettings`/`saveSettings`, and the modal's `onChange`
  patch flow — no second persistence path, no idb cache.
- **Reuse the action registry.** The bar and the settings section render from the
  same FEAT-0057 registry the palette uses (one source of truth for id/label/icon);
  the bar runs an action via the same `run()`.
- **Moat: only the preference is written.** Pinning/unpinning/reordering writes only
  `.brulion.json`; no note file is read or written.
- **No behavior change by default.** With the default empty `actionBar`, the header,
  the existing shortcuts, and the palette behave exactly as before this phase.

## Out of scope

- **Per-action keybinding customization** — unchanged from FEAT-0057.
- **A plugin/extension action API** — the registry is still in-app.
- **Removing or reordering the always-present chrome** (sidebar toggle / settings
  gear / Install) — the bar is additive, not a replacement for the fixed controls.
- **Touch drag-reorder** — the drag-to-reorder is desktop pointer drag (native HTML5);
  refining it for touch rides with the broader mobile work (M17).

## Acceptance criteria

**AC-1** — `actionBar` persists as an ordered id list and is normalized.
Given a vault,
When `actionBar` is saved with some pinned action ids,
Then `.brulion.json` holds them in order; and loading a file whose `actionBar`
contains non-string entries or duplicates yields a list with those dropped (strings
only, first occurrence of each id kept).

**AC-2** — Pinned actions render as ordered icon-only buttons that run on click.
Given `actionBar` lists two registered action ids in some order,
When the workspace is shown,
Then the header action bar shows those two as icon-only buttons in that order, each
exposing its action label as tooltip and accessible name, and clicking one runs that
action's `run()`.

**AC-3** — An unknown pinned id is ignored.
Given `actionBar` contains an id that no registered action has,
When the bar renders,
Then no button is shown for that id and nothing errors; resolvable ids still render.

**AC-4** — The settings modal can pin and unpin an action.
Given the settings modal is open on its Action bar section,
When the user pins a previously-unpinned action (and, separately, unpins a pinned
one),
Then `actionBar` gains/loses that id (persisted), and the header bar adds/removes
its button live.

**AC-5** — The settings modal can reorder pinned actions by dragging.
Given two or more actions are pinned,
When the user drags a pinned action to a new position within the pinned list,
Then `actionBar`'s order changes accordingly (persisted) and the header bar reflects
the new order.

**AC-6** — The choice persists across reloads and travels with the vault.
Given the user has pinned/ordered some actions,
When the app reloads on the same folder,
Then the same action bar is restored from `.brulion.json`.

**AC-7** — Default is empty: no behavior change.
Given a vault with no `actionBar` set (or an absent `.brulion.json`),
When the workspace is shown,
Then the header action bar renders no buttons and the rest of the header is
unchanged from before this phase.

**AC-8** — Only the preference is written (moat).
Given a folder is open,
When the user pins, unpins, and reorders actions,
Then only `.brulion.json` is written; no note file is created or modified.
