---
id: FEAT-0030
title: Install prompt UX
status: draft
depends_on: [FEAT-0028, FEAT-0029]
---

## Intent

With the manifest (FEAT-0028) and the offline service worker (FEAT-0029) in
place, Chromium considers the app installable and fires `beforeinstallprompt`.
This phase turns that into a discoverable, in-app **Install** affordance instead
of relying only on the browser's address-bar default: capture the event, reveal a
header button, and on click fire the native install prompt. The button is hidden
until the app is actually installable, and never appears when the app is already
running installed.

## Behavior

**Capture.** A `beforeinstallprompt` listener calls `preventDefault()` (suppressing
the browser's default mini-infobar) and stashes the event. Revealing the affordance
is gated: if the app is already running standalone (installed), the event is
ignored and nothing shows.

**Affordance.** A header **Install** button, hidden by default (like the other
header controls), is revealed when a `beforeinstallprompt` has been captured. It
sits in the header so it is reachable regardless of folder/sidebar state.

**Trigger.** Clicking the button calls the stashed event's `prompt()`. The
deferred event is single-use, so after a click the stash is cleared and the button
hides (regardless of whether the user accepts or dismisses the OS dialog).

**Installed / done.** An `appinstalled` event (or a completed click) clears the
stashed event and hides the button. While running in `display-mode: standalone`
the button never shows.

**Shape.** The capture/show/clear logic is a small pure controller
(`createInstallPrompt(isStandalone, setVisible)` returning the three event
handlers), with the DOM/event listeners in `main.ts` as a thin adapter — mirroring
the FEAT-0020/0021 toggle pattern. Unrelated to the service worker: this wiring is
not production-gated (the synthesized-event path is testable in any build), only
the SW registration was.

## Constraints

- **Moat untouched.** Pure UI wiring around a browser event; no files, no storage,
  nothing touching the user's notes.
- **Lean.** One small pure unit + a few listeners + one HTML button reusing the
  existing `header button` styling (no new CSS). No persisted state.
- **No regression.** The new button is `hidden` by default and only the new
  listeners are added; existing header controls and shortcuts are unchanged.

## Out of scope

- iOS install instructions (Safari has no `beforeinstallprompt`; the manifest +
  apple-touch-icon already make manual "Add to Home Screen" work).
- Remembering a dismissal to re-surface the prompt later, install analytics, or a
  custom multi-step install dialog.

## Acceptance criteria

**AC-1** — A captured `beforeinstallprompt` reveals the button and suppresses the default.
Given the app is not running standalone and the Install button is hidden,
When `onBeforeInstallPrompt(event)` runs,
Then `event.preventDefault()` is called, the event is stashed, and the button is
made visible.

**AC-2** — Already installed (standalone) never shows the button.
Given `isStandalone` is true,
When `onBeforeInstallPrompt(event)` runs,
Then the button stays hidden and the event is not stashed.

**AC-3** — Clicking Install fires the native prompt once, then hides.
Given a stashed event and a visible button,
When the install click handler runs,
Then the stashed event's `prompt()` is called and the button is hidden; a second
click does nothing (the event was single-use and cleared).

**AC-4** — `appinstalled` clears and hides.
Given a stashed event and a visible button,
When `onInstalled()` runs,
Then the button is hidden and the stash is cleared (a later click prompts nothing).

**AC-5** — End to end: the button is absent before the event and shown after it.
Given the running app (dev build),
When the page loads with no `beforeinstallprompt` and then a `beforeinstallprompt`
is dispatched,
Then the Install button is hidden initially and visible after the event.
