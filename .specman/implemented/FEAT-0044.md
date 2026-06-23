---
id: FEAT-0044
title: Drag-to-resize sidebar width
status: draft
depends_on: [FEAT-0024]
---

## Intent

The note sidebar is a fixed `14rem` wide. In a vault with long names or deep
folders that is too narrow, and on a wide screen it can feel cramped. This phase
lets the user **grab the border between the sidebar and the editor and drag** to
set the sidebar width; the chosen width persists across reloads and replaces the
hard-coded `14rem` as the basis.

The width is **clamped** to a sane minimum and maximum so the drag can neither
shrink the sidebar to nothing (no invisible-but-present sidebar) nor let it
swallow the editor. The resize affordance only exists while the sidebar is
actually on screen — when the sidebar is collapsed (FEAT-0020) or no folder is
open, there is nothing to resize and the handle is gone.

Like the other sidebar-comfort work, this is a browser-local UI preference: the
width lives in the same `brulion:` local storage as the collapse/expand state and
nothing is written to the user's folder.

## Behavior

**A resize handle on the border.** A thin vertical handle sits on the boundary
between the sidebar and the editor, showing a horizontal-resize cursor. It is
present only while the sidebar is visible: hidden before a folder is open and
hidden while the sidebar is collapsed.

**Dragging sets the width live.** Pressing on the handle and moving the pointer
horizontally changes the sidebar width in real time, tracking the pointer
(rightward widens, leftward narrows). The drag uses pointer capture so it keeps
tracking even if the pointer briefly leaves the handle, and it does not select
text while dragging. Releasing ends the drag.

**Clamping (pure).** The applied width is clamped to a fixed `[min, max]` pixel
range: never narrower than the minimum (a comfortably usable sidebar) nor wider
than the maximum (so the editor always keeps the bulk of the width). A pure
function maps a desired pixel width to the clamped width; both the live drag and
the restore-on-load path run through it.

**Persistence.** On drag end the clamped width is saved under a dedicated
browser-local key. On load, a saved width is read and applied as the sidebar's
basis before/at first paint; with no saved width the sidebar uses its default
basis (the former `14rem`).

**The width is the sidebar's flex basis.** The width is applied as a CSS custom
property the sidebar's `flex-basis` reads, so it composes with the existing
`min-width: 0` ellipsis behavior and the collapse rule (a collapsed sidebar is
`display: none` regardless of its width).

## Constraints

- **No document mutation.** The width is browser-local UI state; resizing writes
  nothing to the user's folder.
- The applied width is **always within `[min, max]`** — both during the live drag
  and after restore — so a corrupt or out-of-range stored value cannot produce an
  unusable sidebar.
- The handle is **absent whenever the sidebar is not visible** (no folder open, or
  collapsed) — there is nothing to resize in those states.
- The clamp is a **pure** function of the desired width and the bounds.
- Resizing must not break the existing collapse toggle (FEAT-0020) or the
  ellipsis behavior of long rows (`min-width: 0`).

## Out of scope

- **Keyboard resizing** (arrow keys on the handle) and a double-click-to-reset
  gesture — pointer drag only; keyboard-first affordances are a later concern
  (mobile/keyboard milestones).
- **A settings-modal width control** — M16 owns preferences; this is the direct
  drag affordance only.
- **Touch-specific behavior / mobile layout** — M17 owns mobile; this targets the
  pointer (mouse) drag on a desktop-class viewport.
- **Persisting width per workspace/folder** — a single vault-wide width, like the
  other `brulion:` UI state.

## Acceptance criteria

**AC-1** — A desired width within range is applied unchanged.
Given a desired pixel width between the minimum and maximum,
When the clamp runs,
Then it returns that width unchanged.

**AC-2** — A too-small desired width is clamped up to the minimum.
Given a desired pixel width below the minimum (including zero or negative),
When the clamp runs,
Then it returns the minimum.

**AC-3** — A too-large desired width is clamped down to the maximum.
Given a desired pixel width above the maximum,
When the clamp runs,
Then it returns the maximum.

**AC-4** — Dragging the handle resizes the sidebar live.
Given an open folder with the sidebar visible,
When the user presses the resize handle and drags it to the right,
Then the sidebar becomes wider as the pointer moves (and narrower when dragged
left), staying within the clamp bounds.

**AC-5** — The chosen width persists across a reload.
Given the user dragged the sidebar to a new width,
When the app reloads and the folder auto-restores,
Then the sidebar comes back at the saved width (clamped), not the default
`14rem`.

**AC-6** — The handle is absent when the sidebar is not visible.
Given the sidebar is collapsed (FEAT-0020) or no folder is open,
When the workspace renders,
Then the resize handle is not shown (there is nothing to resize); it reappears
once the sidebar is visible again.

**AC-7** — Resizing writes nothing to the user's folder.
Given an open folder with notes,
When the user drags the sidebar to a new width,
Then no file in the user's folder is created, modified, or deleted.
