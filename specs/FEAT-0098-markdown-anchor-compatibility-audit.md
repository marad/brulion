---
id: FEAT-0098
title: Markdown anchor compatibility audit
status: draft
depends_on: [FEAT-0061]
---

## Intent

M32 already owns section anchors in local Markdown links, but a daily-use report
requires the exact standard forms to remain compatible after later link and
navigation work. Reproduce the `.md`-qualified cross-note form, the same-note
fragment form, and an external URL fragment through the existing follow path.
Only a real regression is allowed to change production code; the audit must not
create a second resolver or reinterpret external URLs.

## Behavior

The browser-level link-follow path is exercised with `[text](note.md#section)`
and `[text](#section)`. A matching heading receives the existing scroll behavior,
while a missing heading leaves navigation successful without an error. A
successful local anchor navigation also becomes a browser-history route: the
note path and anchor are represented together, and Back/Forward can restore the
previous position or requested heading. An `http(s)` link containing `#fragment`
remains an external URL and is passed to the browser unchanged. The checks use
existing notes and do not write or rewrite any Markdown bytes.

## Acceptance criteria

- AC-1: Given an existing `other.md` with a heading below the fold and an open
  note containing `[go](other.md#section-title)`, when the user follows the
  link, then the existing M32 path opens `other.md` and scrolls to the matching
  heading.
- AC-2: Given an open note containing `[jump](#section-title)` and a matching
  heading later in that same note, when the user follows the link, then the
  current note stays open and the editor scrolls to that heading.
- AC-3: Given an existing target note without the requested heading, when the
  user follows `[go](other.md#missing-section)`, then the target still opens,
  no error is shown, and no heading scroll is performed.
- AC-4: Given `[site](https://example.test/page#fragment)`, when the user follows
  it, then the browser receives the complete external URL including
  `#fragment`, with no in-app note resolution or editor scroll.
- AC-5: Given any of the anchored navigation cases above, when the browser
  completes the interaction, then the set and bytes of the existing `.md` files
  are unchanged and no new note is created.
- AC-6: Given a successful local same-note or cross-note anchor navigation, when
  the user uses browser Back and Forward, then the route records the local note
  path and anchor, Back restores the prior note/scroll position, and Forward
  restores the anchored heading without changing any Markdown bytes.

## Out of scope

- A new anchor parser, resolver, heading-slug rule, or link interaction model.
- Wikilink behavior already covered by FEAT-0061 and its existing regression suite.
- Anchors in external URLs being interpreted as local note fragments.
- A new history stack separate from the browser's own History API.
