---
id: FEAT-0061
title: Link section anchors
status: draft
depends_on: [FEAT-0025, FEAT-0026, FEAT-0027, FEAT-0036]
---

## Intent

Notes link to each other (M8), but only ever to a note's *top* — you can't point at
a specific section. In a long note that means the reader lands at the start and has
to hunt for the heading you meant. This phase adds a **section anchor** to a note
link: `[text](note#section)` and the wikilink `[[note#section]]` resolve to the note
*and* scroll to the matching heading; a same-note `[text](#section)` jumps within the
open note (a lightweight in-note table-of-contents link).

It extends M8's links — same resolvers, same follow interaction — adding only anchor
parsing and a scroll-to-heading step. Moat-neutral: the link is still plain markdown
the user owns; nothing is written, no bytes change.

## Behavior

**Anchor syntax.** A `#` in an *internal* link target separates the note path from a
section anchor: everything before the first `#` is the note (resolved as today),
everything after is the anchor. Applies to markdown links (`[t](note#sec)`,
`[t](sub/note#sec)`, `[t](#sec)`) and wikilinks (`[[note#sec]]`,
`[[note#sec|alias]]`, `[[#sec]]`). **External** links are untouched — an `http(s)://…#frag`
keeps its URL fragment verbatim (it is not a note anchor).

**Resolution + scroll.** Following such a link resolves the note exactly as M8 does
(relative path for markdown, basename/path for wikilinks), switches to it if needed,
then scrolls so the matching heading is at the top of the view and places the caret
there. When the path part is empty (`#sec` / `[[#sec]]`) the anchor targets the
**currently-open** note — no switch, just a scroll.

**Heading matching.** The anchor matches a heading by a slug: lower-cased, punctuation
dropped, whitespace runs collapsed to single hyphens (Unicode letters/numbers kept, so
non-English headings work). Both the anchor and each heading line are slugified and
compared; the **first** heading whose slug matches wins. A missing target heading is a
no-op — the note still opens (or stays open), the view just doesn't scroll.

**Missing note.** A link whose *note* part doesn't exist behaves exactly as M8 (offer
to create / broken-link styling); the anchor is irrelevant until the note exists.

## Constraints

- **Reuse M8.** Note resolution stays `resolveNotePath` (markdown) / `resolveWikilink`
  (wikilink); the follow interaction stays FEAT-0026's plain-click-follow. This phase
  adds anchor splitting + a scroll step, not a new link mechanism.
- **External links unchanged.** `isExternalLink` targets keep their `#fragment`; only
  internal targets split on `#`.
- **No collision with the URL hash route (FEAT-0036).** The `#section` lives inside
  the markdown link text, never in the window URL; the `#/path` route codec is
  untouched.
- **Scroll is parse-independent.** Finding the heading scans the document's lines for
  a heading line (`#…#### ` prefix), not the incremental syntax tree, so it works even
  for a heading below the parsed viewport right after a note loads.
- **Moat: no writes.** Splitting, resolving, and scrolling read only; no `.md` byte is
  created or changed (creating a missing note is the existing M8 write, unchanged).

## Out of scope

- **A heading-name autocomplete** when typing `#` in a link — manual for now.
- **Unique-slug disambiguation** (GitHub's `-1`/`-2` suffixes for duplicate headings)
  — the first matching heading wins; duplicates beyond the first aren't addressable.
- **Anchors in external URLs** — those fragments are passed through untouched, not
  interpreted as note anchors.

## Acceptance criteria

**AC-1** — A markdown link with an anchor switches to the note and scrolls to the heading.
Given a note `other` containing a `## Section two` heading below the fold, and the open
note has a link `[go](other#section-two)`,
When the user follows the link,
Then the editor switches to `other` and scrolls so `Section two` is at the top of the
view.

**AC-2** — A wikilink with an anchor does the same.
Given the open note has `[[other#section-two]]` (or `[[other#section-two|alias]]`),
When the user follows it,
Then the editor switches to `other` and scrolls to `Section two`.

**AC-3** — A same-note anchor scrolls without switching.
Given the open note has a `## Later` heading below the fold and a link `[jump](#later)`,
When the user follows it,
Then the view scrolls to `Later` in the same note (no note switch).

**AC-4** — Heading matching is slug-based and case-insensitive.
Given a heading `## My Big Heading!`,
When a link's anchor is `#my-big-heading` (punctuation dropped, spaces hyphenated,
any case),
Then it matches that heading.

**AC-5** — A missing target heading opens the note without scrolling (no error).
Given a link `[go](other#no-such-heading)`,
When the user follows it,
Then `other` opens and nothing errors; the view is not scrolled to a heading.

**AC-6** — An external link's `#fragment` is not treated as a note anchor.
Given a link `[site](https://example.com/page#frag)`,
When the user follows it,
Then it opens in a new tab with the URL (including `#frag`) intact — no note
resolution or in-editor scroll.

**AC-7** — A missing-note link still offers to create (anchor ignored).
Given a link `[go](nope#section)` whose note `nope` doesn't exist,
When the user follows it,
Then the existing create-on-miss flow runs for `nope` (the anchor plays no part).

**AC-8** — No bytes are written by anchor navigation.
Given following anchored links within and across existing notes,
When the navigation + scroll happen,
Then no `.md` file is created or modified.
