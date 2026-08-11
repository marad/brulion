---
id: FEAT-0093
title: Extension link resolution
status: draft
depends_on: [FEAT-0091, FEAT-0025, FEAT-0027, FEAT-0061]
---

## Intent

Extensions that want to follow links should not reimplement Brulion's rules for
relative markdown links, wikilink basename matching, anchors, and external
URLs. Expose a read-only resolver that accepts the link destination and its
explicit syntax kind, returning a composable canonical result without changing
the active view or filesystem.

## Behavior

`resolveLink(target, { kind, from? })` receives only the destination text: no
brackets, visible alias, or surrounding markdown. `kind` is required and is
`markdown` or `wikilink`; `from` defaults to the active note and is the source
note for relative markdown paths and same-note anchors. The implementation uses
the existing `splitAnchor`, `resolveNotePath`, `resolveWikilink`,
`isExternalLink`, and note listing rules. Existing notes return `resolved`,
missing but valid note targets return `missing`, external schemes return
`external`, and malformed/unsafe/non-note targets return `invalid`.

Anchors are returned without `#` and are carried through without checking whether
the heading exists. Markdown relative paths stay relative to `from`; wikilink
bare names use case-insensitive basename matching and slashed names use the
case-insensitive root-relative path rule. A display alias is not parsed because
it is outside the API input. Resolution is read-only: it never switches notes,
pushes a route, opens a browser, creates a missing note, or writes bytes.

## Acceptance criteria

- AC-1: Given an existing markdown target relative to `from`, when
  `resolveLink(target, {kind: "markdown", from})` is called, then it returns
  `status: "resolved"` with the canonical `.md` path and the fragment without
  `#`.
- AC-2: Given `#section` and a valid source note, when it is resolved as
  markdown, then it returns the source note path with the anchor; given a
  relative path that stays inside the vault but is absent, then it returns
  `status: "missing"` with that canonical path rather than creating it.
- AC-3: Given an HTTP(S), protocol-relative, or other scheme URL, when it is
  resolved as markdown, then it returns `status: "external"` with the original
  destination and does not consult or mutate the note listing.
- AC-4: Given a markdown destination that escapes the root, has an unsafe path,
  lacks the required note form, or has no usable source for a relative/same-note
  target, when it is resolved, then it returns `status: "invalid"` and no
  filesystem or active-view operation is performed.
- AC-5: Given a wikilink bare basename matching an existing note, a slashed
  root-relative target, or a case-insensitive match, when it is resolved, then
  it returns the same canonical path Brulion's editor resolver uses; duplicate
  basenames use the authoritative sorted-list first match.
- AC-6: Given a valid but absent wikilink with or without a slash, when it is
  resolved, then it returns `status: "missing"` with the normalized root or
  slashed `.md` path; no file is created and aliases are not interpreted.
- AC-7: Given an empty, unsafe, traversal, malformed-kind, or otherwise invalid
  wikilink destination, when it is resolved, then it returns `status: "invalid"`
  rather than a createable path; external-looking targets are classified by the
  documented external-link rule.
- AC-8: Given any valid resolution, when it is called repeatedly, then the
  active note, editor content/selection, route/history, recency, and filesystem
  bytes remain unchanged.

## Out of scope

- Verifying heading existence; `openNote()` owns the anchor scroll attempt.
- Parsing link labels/aliases or scanning complete markdown documents.
- Rewriting links, opening external URLs, or adding a general link graph API.
