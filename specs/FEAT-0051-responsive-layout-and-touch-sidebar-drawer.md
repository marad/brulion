---
id: FEAT-0051
title: responsive layout and touch sidebar drawer
status: draft
depends_on: [FEAT-0020, FEAT-0044]
---

## Intent

On a narrow viewport (a phone, or a tablet/convertible held narrow) the sidebar and
editor sitting side by side don't both fit: the sidebar (14rem) plus the editor's
20rem minimum overflow a ~375px screen. This phase makes the layout **responsive** —
below a narrow breakpoint the sidebar becomes a **slide-over drawer** over a
full-width editor, dismissable by tapping a backdrop, with the drag-resize handle
hidden (it's meaningless on touch) and the header controls kept tappable and
non-overflowing. At desktop widths nothing changes.

The drawer **reuses the existing sidebar-collapsed state** (FEAT-0020) rather than
inventing a second mechanism: "not collapsed" renders the drawer open (overlaid on
the editor), "collapsed" renders it closed/off-screen. So the ☰ toggle and its
`Ctrl/Cmd+\` shortcut drive the drawer with no change. Two small behaviors are added
*only* in the narrow layout, both matching how drawers are expected to work: tapping
the backdrop closes the drawer, and selecting a note closes it (you came to read that
note). Desktop keeps the inline sidebar with no backdrop and no close-on-select.

Layout/UI only — no change to file behavior, storage, or the note model; the
file-fidelity moat is untouched.

## Behavior

**Narrow viewport → drawer.** Below the breakpoint, the sidebar is taken out of the
flex row and rendered as a fixed-position panel overlaying the left of the editor
(the editor spans the full width beneath it), with a dimmed backdrop over the rest.
When the sidebar is collapsed the drawer and backdrop are off-screen/hidden and the
editor is unobstructed.

**The ☰ toggle opens/closes the drawer.** Because the drawer is driven by the
collapsed state, the existing header toggle (and `Ctrl/Cmd+\`) opens and closes it
unchanged. Its pressed state still reflects collapsed-vs-open.

**Backdrop tap closes it.** In the narrow layout a tap on the backdrop (the dimmed
area outside the drawer) collapses the sidebar, dismissing the drawer. On desktop
there is no backdrop.

**Selecting a note closes it (narrow only).** Tapping a note row in the drawer
switches to that note and then closes the drawer, so the reader lands on the note.
At desktop widths selecting a note leaves the (inline) sidebar as is.

**The resize handle is hidden when narrow.** Drag-to-resize (FEAT-0044) is a
pointer-precise desktop affordance; below the breakpoint the handle is not shown and
the drawer uses a fixed, viewport-relative width.

**Header fits.** The header controls (wordmark, open-note identity, ☰, gear, switch
folder, install) remain visible and tappable on a narrow screen without overflowing
or pushing controls off-screen; the open-note identity truncates as needed.

**Desktop unchanged.** At or above the breakpoint the layout, the inline sidebar, the
resize handle, and all behaviors are exactly as before — no backdrop, no
close-on-select, no overlay.

## Constraints

- **One state, two renderings.** The drawer is the same `sidebar-collapsed` state
  (FEAT-0020) rendered differently by a media query — no second toggle, no separate
  persisted flag. *Why:* one source of truth; the ☰ button keeps working as-is.
- **Additive, breakpoint-scoped behaviors.** Backdrop-tap-close and
  close-on-select fire only in the narrow layout (guarded by the same breakpoint),
  so desktop interaction is untouched.
- **CSS-driven layout.** The overlay/full-width/hidden-resizer switch is a media
  query; the JS only adds the backdrop element and the two close behaviors.
- **Moat untouched.** No change to storage, the note list contents, or file
  behavior — purely how the existing sidebar and editor are arranged and dismissed.
- **No regression to the collapse preference.** The persisted collapsed state still
  loads and is honored; the drawer just reinterprets it visually when narrow.

## Out of scope

- **A non-FSA storage fallback for phone browsers** — the File System Access API
  gates where the app runs at all; this phase makes the UI usable where FSA exists,
  not everywhere. The no-folder state still shows the welcome screen.
- **Touch formatting** — FEAT-0052 (M17 P2).
- **A swipe-to-open gesture** for the drawer — the ☰ button (and backdrop to close)
  is the affordance; edge-swipe is deferred unless asked for.
- **Per-device collapse defaults** — the single persisted collapsed state is reused
  as-is; no separate mobile default.

## Acceptance criteria

**AC-1** — Narrow viewport renders the sidebar as an overlay drawer.
Given a narrow viewport with a folder open and the sidebar not collapsed,
When the workspace is shown,
Then the sidebar overlays the editor as a drawer (it does not take layout width from
the editor, which spans the full width) and a dimmed backdrop covers the rest.

**AC-2** — The ☰ toggle opens and closes the drawer.
Given the narrow layout,
When the user taps the ☰ toggle,
Then the drawer opens when it was closed and closes when it was open (the
sidebar-collapsed state flips), and its pressed state reflects the new state.

**AC-3** — Tapping the backdrop closes the drawer.
Given the narrow layout with the drawer open,
When the user taps the backdrop outside the drawer,
Then the drawer closes (the sidebar collapses) and the editor is unobstructed.

**AC-4** — Selecting a note closes the drawer (narrow only).
Given the narrow layout with the drawer open,
When the user taps a note row,
Then the app switches to that note and the drawer closes.

**AC-5** — The resize handle is hidden when narrow.
Given the narrow layout,
When the workspace is shown,
Then the drag-resize handle is not displayed.

**AC-6** — Desktop layout and behavior are unchanged.
Given a desktop-width viewport,
When a folder is open,
Then the sidebar sits inline beside the editor (taking layout width), the resize
handle is present, there is no backdrop, and selecting a note leaves the sidebar
open — exactly as before this phase.
