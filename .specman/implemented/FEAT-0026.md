---
id: FEAT-0026
title: Link interaction and editing
status: draft
depends_on: [FEAT-0025]
---

## Intent

FEAT-0025 shipped only the link *mechanism* — `[text](url)` rendered, and
Ctrl/Cmd+click to follow. The M8 review found that too thin: a typed bare URL
wasn't clickable at all, following needed an undiscoverable modifier (a plain
click did nothing), and a link was near-impossible to edit because its URL is
hidden. This phase makes links usable: **plain click follows** (modifier-click
becomes the edit escape hatch), **bare web URLs autolink**, a link **reveals its
markup for editing when the caret is in it**, and a **hover tooltip shows the
target**. All display/interaction — no on-disk bytes change.

## Behavior

**Click model.** A plain click on a link **follows** it: an internal link
switches to its note (creating it first if the target is missing and the user
confirms), an external link opens in a new browser tab. A **Ctrl/Cmd+click**
does *not* follow — it places the caret in the link (the only way to get the
caret there, since a plain click now navigates), which is how editing begins.
The cursor reflects the mode: `pointer` over a link normally, a text caret while
Ctrl/Cmd is held.

**Following reliably.** An external link opens in a real new tab — via a
programmatic anchor click (`target=_blank`, `rel=noopener`), not
`window.open(url, "_blank", "noopener")` whose features string opens a popup
window in some browsers.

**Bare autolinks.** A typed bare URL — `http(s)://…` or `www.…` — renders as a
clickable external link (no surrounding `[]()`), carrying its URL; `www.` opens
as `https://www.…`. Bare email addresses are recognized by the parser but left
as plain text (not turned into `mailto:` links).

**Reveal for editing.** When the caret is within a link's span, that link is
**not** hidden/styled — its raw markdown (`[text](url)`) shows so the URL can be
read and edited; moving the caret out re-renders it. This is a deliberate,
scoped exception to the "always hide" rule (FEAT-0006): a link's hidden part is
content, not noise. Other markup (bold, headings) is unaffected — it never
reveals on the caret.

**Hover preview.** Hovering a link shows its target (a native `title` tooltip):
the URL for an external link, the resolved note path for an internal one.

## Constraints

- Display/interaction only — no bytes change (the moat). Following routes through
  the existing controller (`switchTo`/`addNote`).
- The caret-reveal exception applies to **links only**; bold/italic/code/headings
  keep always-hiding (FEAT-0006). The reveal is driven by the caret position.
- Autolinking reuses the parser (the GFM Autolink extension) rather than a
  hand-rolled URL scanner; only web URLs are decorated, emails are not.
- Plain-click-follow must not break normal caret placement on non-link text, text
  selection, or Vim.

## Out of scope

- Wikilinks (`[[note]]`) — FEAT-0027.
- A popup/form link editor — caret-reveal is the editing affordance for now.
- Rendering link *titles* (`[t](u "title")`), images, or reference links.

## Acceptance criteria

**AC-1** — Plain click on an internal link switches to its note.
Given an open note with a link to an existing note `sub/b.md`,
When the link's text is plain-clicked (no modifier),
Then the editor switches to `sub/b.md`.

**AC-2** — Plain click on an external link opens a new tab, not in-app nav.
Given an open note containing `[site](https://example.com)`,
When the link is plain-clicked,
Then it opens in a new browser tab (via an anchor, `rel=noopener`) and the editor
does not change notes.

**AC-3** — Plain click on a missing internal link offers to create it.
Given an open note with a link to `new.md` that does not exist,
When the link is plain-clicked and the prompt confirmed,
Then `new.md` is created and opened.

**AC-4** — Ctrl/Cmd+click places the caret without following.
Given an open note with a link to an existing note,
When the link is Ctrl/Cmd+clicked,
Then the editor does not switch notes and the caret is placed in the link.

**AC-5** — The cursor shape reflects the modifier.
Given a link is rendered,
When the pointer is over it, the cursor is `pointer`; and while Ctrl/Cmd is held
down the cursor over it is a text caret (signalling caret placement, not follow).

**AC-6** — A bare web URL renders as a clickable external link.
Given the document `visit https://example.com today`,
When the inline rendering runs,
Then `https://example.com` is styled as a link carrying that URL, and a typed
`www.example.com` likewise (opening as `https://www.example.com`).

**AC-7** — A bare email is not turned into a link.
Given the document `mail me at a@b.com`,
When the inline rendering runs,
Then `a@b.com` is left as plain text (no link styling, not clickable).

**AC-8** — A link reveals its raw markup while the caret is within it.
Given the document `see [the note](sub/b.md)`,
When the caret is placed inside the link's span,
Then the `[`/`](sub/b.md)` markup is shown (not hidden) so it can be edited; and
when the caret leaves, the link renders again with the markup hidden.

**AC-9** — Hovering a link shows its target.
Given a rendered internal link to `sub/b.md` and an external link to
`https://example.com`,
When each is hovered,
Then a tooltip shows the target (`sub/b.md` resp. `https://example.com`).
