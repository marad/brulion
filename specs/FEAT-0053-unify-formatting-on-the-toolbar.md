---
id: FEAT-0053
title: unify formatting on the toolbar
status: draft
depends_on: [FEAT-0009, FEAT-0052]
---

## Intent

The M17 review surfaced that two surfaces offer the *same* formatting — the touch
selection toolbar (FEAT-0052) and the right-click context menu (FEAT-0009) — and on
touch a long-press (which is how you select) fired the context menu *on top of* the
toolbar: a duplicate formatting popup. Rather than just suppress the menu on touch,
this phase makes the **selection toolbar the single formatting surface everywhere**
(desktop and touch), and reduces the right-click menu to its one thing the toolbar
can't do: the **wikilink-form toggle**.

So: the toolbar drops its touch/narrow gate and appears on any non-empty selection;
the right-click menu opens **only** when the click lands on a wikilink (showing just
the form toggle), and on plain text right-click falls through to the browser's native
menu. The duplicate popup disappears by construction (the menu no longer carries
formatting), and formatting is one consistent affordance.

To keep desktop pleasant, the toolbar appears only once the selection **settles** —
after a pointer-drag ends — so drag-selecting text doesn't make it flicker mid-drag.

UI only; formatting still routes through the same FEAT-0007 transforms (`FORMAT_ITEMS`),
so the on-disk markdown is unchanged. This reconciles FEAT-0009, whose formatting role
moves to the toolbar.

## Behavior

**The toolbar is the formatting surface everywhere.** On a non-empty selection — on
desktop *and* touch — the floating formatting toolbar appears (bold, italic, code,
H1–H3, clear), applying the same transforms as before. The previous touch/narrow gate
is removed.

**Desktop: appear on settle, not mid-drag.** When the user drag-selects with a
pointer, the toolbar does not flash during the drag; it appears once the drag ends
(pointer up). A keyboard selection (Shift+arrows) or a touch handle selection shows it
as the selection changes, as before.

**Right-click is wikilink-only.** Right-clicking (or long-pressing) shows the custom
menu **only** when the position is on a wikilink that has a form toggle (a nested-note
link with a unique basename); the menu then shows just that one toggle item. On plain
text — or any position with no wikilink toggle — no custom menu opens and the browser's
native context menu is left to appear. Formatting is never in this menu anymore.

**No more duplicate popup.** Because the menu carries no formatting, a touch
long-press over text no longer stacks a formatting menu on top of the toolbar — the
toolbar is the only formatting UI.

**The wikilink toggle is unchanged in effect.** When shown and chosen, it switches the
link between its full-path and name-only forms exactly as the FEAT-0009 menu did
(same `computeWikilinkToggle`); its dismiss mechanics (Esc / outside click) are
unchanged.

**Moat untouched.** All formatting still goes through the shared `FORMAT_ITEMS`
transforms; the on-disk markdown is identical to before, whichever surface is used.

## Constraints

- **One formatting surface.** The toolbar is the only place formatting actions live
  for selections; the right-click menu hosts only the wikilink toggle. No duplication.
- **Settle before showing (pointer).** A pointer-drag selection must not flicker the
  toolbar; it shows on drag end. Non-pointer selections are unaffected.
- **Native menu on plain text.** When there is no wikilink toggle at the click, the
  app does not preventDefault the context menu — the browser's native menu shows.
- **Shared transforms, unchanged bytes.** Formatting routes through the same
  `FORMAT_ITEMS`/FEAT-0007 transforms; no new markdown behavior.
- **Reconcile, don't fork.** FEAT-0009's formatting role is removed (moved here); its
  spec is updated to the wikilink-toggle-only menu rather than left contradicting.

## Out of scope

- **Adding the wikilink toggle to the toolbar** — considered and declined in review;
  it stays a (slim) right-click menu, since it is position-based, not selection-based.
- **New formatting actions** — the toolbar set is unchanged (the seven `FORMAT_ITEMS`).
- **A touch affordance for the wikilink toggle** — it remains a right-click/long-press
  menu; a touch path for it is deferred (niche).
- **Removing the `Ctrl+B/I/E` shortcuts** — unchanged; they remain a third way in.

## Acceptance criteria

**AC-1** — Selecting text shows the toolbar on desktop too.
Given a desktop-width viewport with a fine pointer and text in the editor,
When the user selects a non-empty range and the selection settles,
Then the floating formatting toolbar appears (it is no longer touch/narrow-only).

**AC-2** — A pointer drag doesn't flicker the toolbar mid-drag.
Given a desktop pointer drag-selecting text,
When the drag is in progress,
Then the toolbar is not shown; it appears once the drag ends.

**AC-3** — Toolbar formatting is unchanged.
Given the toolbar shown over a selection,
When the user taps Bold (or H2),
Then the result is the same markdown the menu/shortcut produced (`**…**` / `## …`).

**AC-4** — Right-clicking plain text shows no custom menu.
Given the caret/selection on plain (non-wikilink) text,
When the user right-clicks,
Then no custom formatting menu opens (the browser's native menu is left to appear);
formatting is reached via the toolbar or `Ctrl` shortcuts instead.

**AC-5** — Right-clicking a wikilink shows the one-item form toggle.
Given a wikilink whose form can be toggled (a nested-note link with a unique
basename),
When the user right-clicks it,
Then a one-item menu appears offering the form toggle, and choosing it switches the
link form exactly as before — with no formatting items in the menu.

**AC-6** — No duplicate popup on touch.
Given a touch/narrow context,
When the user long-presses to select plain text,
Then only the formatting toolbar appears — there is no second formatting menu stacked
on it.
