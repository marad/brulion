---
id: FEAT-0052
title: touch selection formatting toolbar
status: draft
depends_on: [FEAT-0007, FEAT-0008]
---

## Intent

Formatting today is reachable only via the right-click context menu (FEAT-0008) or
the `Ctrl+B`/`I`/`E` shortcuts (FEAT-0007) — neither exists on a touch device with no
mouse and no keyboard. This phase adds a small **floating toolbar that appears over a
non-empty selection**, offering the same core format actions (bold, italic, code,
H1–H3, clear), so a touch user can format selected text by tapping.

It **reuses the exact FEAT-0007 transforms** the context menu and shortcuts already
use — extracted into one shared action list — so the on-disk result is identical
clean markdown, whichever surface invokes it (one source of truth). It **complements**
the right-click menu rather than replacing it; the menu and the `Ctrl` shortcuts are
untouched.

The toolbar is shown only in a **touch / narrow context** — `(pointer: coarse)` or a
narrow viewport (the M17 breakpoint) — so a desktop mouse user's existing flow
(select → right-click or `Ctrl+B`) is not disturbed by a new always-on toolbar. UI
only; the file-fidelity moat is untouched.

## Behavior

**A non-empty selection shows the toolbar (touch/narrow only).** When the editor has
a non-empty selection and the device is touch/narrow, a compact floating toolbar
appears near the selection with the format actions. With an empty selection (a plain
caret) there is no toolbar. On a desktop mouse at a wide viewport the toolbar never
appears (the right-click menu and shortcuts remain the formatting path there).

**Tapping an action formats the selection.** Each toolbar action applies the same
transform as the matching context-menu item / shortcut: bold/italic/code toggle the
inline span around the selection; H1–H3 set the heading level of the selected
line(s); clear removes formatting. After applying, the selection/caret and the
resulting markdown are exactly what the existing transform produces, and the editor
keeps focus (the tap does not blur and collapse the selection before it acts).

**It tracks the selection.** The toolbar repositions as the selection changes and
disappears when the selection becomes empty or the editor loses focus. It is a single
element — selecting elsewhere moves it, it never stacks.

**It does not fight other surfaces.** With an empty caret (e.g. typing `/` for the
slash menu) there is no selection, so the toolbar is absent and cannot collide with
the slash menu. The right-click context menu still opens independently; the toolbar
and the menu never depend on each other.

**Moat untouched.** The toolbar only invokes existing transforms; nothing about the
file format, storage, or note model changes, and copy/cut are unaffected.

## Constraints

- **One shared action list.** The format actions (bold, italic, code, H1, H2, H3,
  clear) live in a single module reused by both the context menu and this toolbar —
  no second definition of what each action does. *Why:* identical markdown from every
  surface; no drift.
- **Touch/narrow-gated.** The toolbar is shown only when `(pointer: coarse)` or the
  narrow breakpoint matches, so desktop mouse interaction is unchanged. *Why:* the
  goal is a touch affordance, not a new desktop behavior.
- **Selection-driven, single element.** Shown only for a non-empty selection; a
  single toolbar element that repositions, never stacks; torn down with the view.
- **Selection survives the tap.** Pressing a toolbar control must not blur the editor
  / collapse the selection before the transform runs (same discipline as the menu).
- **Moat untouched.** No file/storage/model change; only existing transforms invoked.

## Out of scope

- **New format actions** beyond the existing seven — this mirrors the context-menu
  set exactly.
- **A desktop always-on selection toolbar** — deliberately gated to touch/narrow; the
  desktop path stays right-click + shortcuts.
- **Rich-text / link insertion UI** — not part of the touch formatting set here.
- **Replacing the right-click menu** — it remains for mouse users.

## Acceptance criteria

**AC-1** — A non-empty selection shows the toolbar in a touch/narrow context.
Given a touch/narrow context with a folder open and text in the editor,
When the user selects a non-empty range,
Then a floating formatting toolbar appears near the selection; when the selection
becomes empty, the toolbar disappears.

**AC-2** — Tapping bold wraps the selection and yields the same markdown as the menu.
Given a non-empty selection and the toolbar shown,
When the user taps Bold,
Then the selected text is wrapped to `**…**` (the FEAT-0007 transform), identical to
the context-menu Bold result, and the file reflects it.

**AC-3** — Tapping a heading sets the line's heading level.
Given the caret/selection on a line and the toolbar shown,
When the user taps H2,
Then the line becomes a level-2 heading (`## …`), the same as the menu's Heading 2.

**AC-4** — The toolbar is absent on a desktop mouse at a wide viewport.
Given a wide desktop viewport with a fine pointer,
When the user selects text,
Then no floating toolbar appears (the right-click menu and `Ctrl` shortcuts remain
the formatting path); and selecting text still works normally.

**AC-5** — The action list is shared with the context menu.
Given the context menu and the toolbar,
When their format actions are compared,
Then both invoke the same shared transforms (bold/italic/code/H1–H3/clear) — there is
a single definition of each action's behavior.

**AC-6** — The toolbar does not change the file format or fight the slash menu.
Given the editor,
When the caret is empty (e.g. typing `/` to open the slash menu),
Then no toolbar is shown; and the toolbar's actions only ever produce the same clean
markdown the existing transforms produce (bytes otherwise untouched).
