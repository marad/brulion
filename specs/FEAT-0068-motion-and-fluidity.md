---
id: FEAT-0068
title: Motion and fluidity
status: draft
depends_on: [FEAT-0020, FEAT-0031, FEAT-0044, FEAT-0051, FEAT-0052, FEAT-0065]
---

## Intent

Brulion has no real motion: overlays pop in and out (`hidden` toggling
`display:none`), the sidebar snaps shut, the folder tree appears instantly, and the
light/dark theme flips in a single frame. The app works but reads as abrupt. This
milestone adds a small, cohesive motion system so state changes feel smooth and calm —
a perception-of-quality win, not a new capability.

It is **pure presentation**. No `.md` bytes change and the moat is untouched. Motion
stays on the *chrome* — overlays, the sidebar, buttons, the tree, the theme — and
deliberately never touches CodeMirror *content* (text, caret, decorations, scrolling),
which is the heart of the product and the easiest surface to make feel janky.

The system is **token-driven** (durations/easings as CSS custom properties, tuned in one
place) and **double-gated**: the tokens resolve to ~0s until a first-paint
`html.motion-ready` class is set (so nothing animates on load — no welcome or theme
flash), and `prefers-reduced-motion: reduce` forces them back to ~0s even when ready.
Overlays animate enter *and* leave purely in CSS (`@starting-style` +
`transition-behavior: allow-discrete`), so their show/hide JS is unchanged. Chromium-only
CSS is acceptable — Brulion is already Chromium-only (the File System Access API).

## Acceptance criteria

**AC-1** — Motion is driven by shared tokens.
Given the stylesheet,
When any chrome transition or enter/leave animation runs,
Then its duration and easing come from `:root` custom properties (`--motion-fast`,
`--motion-medium`, `--motion-slow`, `--ease`, `--ease-out`) — not hard-coded literals —
so the whole app's tempo is tunable in one place.

**AC-2** — Nothing animates on first paint.
Given a fresh load (loading overlay → welcome or restored workspace, plus the async
theme apply),
When the page first renders,
Then no transition runs, because the motion tokens are ~0s until `html.motion-ready` is
added after the first paint (two chained `requestAnimationFrame`s in `main.ts`).

**AC-3** — Reduced motion removes all motion.
Given the OS sets `prefers-reduced-motion: reduce`,
When any state change that would otherwise animate occurs,
Then it is effectively instant — the media query forces the motion tokens to ~0s even
under `motion-ready`, so every transition and `@starting-style` becomes a no-op in one
place.

**AC-4** — Overlays fade + rise on open and fade on close, JS unchanged.
Given the command palette, quick switcher, settings modal, conflict modal, or welcome
screen,
When it is shown or hidden by toggling its `hidden` attribute (the existing JS),
Then its backdrop cross-fades and its dialog fades with a subtle rise/scale on enter and
fades out on leave — implemented with `@starting-style` + `allow-discrete`, with no change
to the show/hide JS.

**AC-5** — Dynamically-created surfaces animate in.
Given the right-click context menu and the CodeMirror autocomplete / slash popup (created
on demand),
When they appear,
Then they fade/rise in via `@starting-style` (enter animation only is acceptable, since
they are removed on dismiss).

**AC-6** — The mobile sidebar drawer slides.
Given the narrow (drawer) layout,
When the sidebar is opened or closed,
Then it slides in/out horizontally (`translateX`) while its backdrop cross-fades, rather
than snapping.

**AC-7** — The desktop sidebar collapse animates and never lags the resize drag.
Given the desktop layout,
When the sidebar is collapsed/expanded (Ctrl+\, the ☰),
Then it animates its `flex-basis` (and opacity) so the editor reflows smoothly;
And given the user is dragging the resize divider,
When `--sidebar-width` updates on each pointer move,
Then the width tracks the cursor with no transition lag, because `wireSidebarResize` adds a
`resizing` class to `#sidebar` for the duration of the drag and `#sidebar.resizing` sets
`transition: none`.

**AC-8** — The folder tree reveal is intentionally instant.
Given the note tree is rebuilt wholesale on every render (`onListChanged` → `renderNoteList`,
which fires on every note switch to re-expand the active note's ancestors),
When a folder is expanded,
Then its children appear instantly — an enter animation is deliberately *not* added,
because keying it off DOM insertion (`@starting-style`) would re-fire on every list
re-render and flicker the whole expanded tree on each note switch. (Recorded in
DECISIONS.md.)

**AC-9** — Hover/active states transition.
Given buttons, note rows, folder headers, the delete-X, and the active-note highlight,
When their background/colour state changes (hover, active, selection),
Then the change eases rather than snapping.

**AC-10** — The theme swap cross-fades, without a load flash.
Given the light/dark theme is changed in settings,
When the `data-theme` attribute flips,
Then the chrome colours (background/text/border) cross-fade smoothly;
And given the initial async theme apply on load,
When it runs before `motion-ready`,
Then it does not animate (no flash).

**AC-11** — The selection toolbar animates like the other overlays.
Given the touch selection formatting toolbar,
When it is shown or hidden,
Then it toggles the `hidden` attribute (not inline `style.display`) so `@starting-style`
fades it in on each show; its behaviour is otherwise unchanged.

**AC-12** — The moat and the editor are untouched.
Given the whole milestone,
When any animation runs,
Then no `.md` file is written and no CodeMirror *content* (text, caret, decorations) is
animated — motion is confined to the chrome.
