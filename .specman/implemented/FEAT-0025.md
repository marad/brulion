---
id: FEAT-0025
title: Links between notes
status: draft
depends_on: [FEAT-0023, FEAT-0024, FEAT-0006, FEAT-0011]
---

## Intent

A folder of notes is more useful when notes can point at each other. M8's second
half adds that — but defers to the moat: a link is **standard CommonMark**
(`[text](relative/path.md)`), real bytes any markdown tool resolves the same way,
never an Obsidian-style `[[wikilink]]` that other tools would render as literal
text (see `DECISIONS.md` — "Links are standard CommonMark inline links"). The
editor renders a link the way it renders every other construct: the markup is
hidden and the text reads as a link. Following one (Ctrl/Cmd+click) navigates to
the target note, resolved relative to the linking note's folder; a link whose
target doesn't exist shows as broken and offers to create it. The file keeps the
literal markdown-link bytes — display-only, like all the other rendering.

## Behavior

**What is a link.** An inline markdown link `[text](url)` whose `url` is a
relative path (no scheme). `http(s)://` (and other `scheme:`/protocol-relative)
URLs are *external* links. Reference/shortcut links (`[text]` with no `(url)`)
are not links here — left as plain text.

**Rendering.** For an inline link, the `[` and the `](url)` runs are hidden
(atomic, like all hidden markup) and the `text` between is styled as a link
(`cm-link`), carrying the raw `url` so a click can act on it. An *internal* link
whose resolved target is not an existing note is additionally styled **broken**
(`cm-link-broken`); external links are never broken. The on-disk bytes are
untouched. (An empty link text `[](url)` is left raw — there'd be nothing to show
or click.)

**Resolution.** An internal `url` resolves **relative to the linking note's own
folder**, POSIX-style: `b.md` from `sub/a.md` is `sub/b.md`; `../c.md` from
`sub/a.md` is `c.md`; `./` and `.` segments are no-ops. A `url` that walks `..`
above the picked root, or that doesn't end in `.md`, does not resolve to a note.
Resolution is a pure function, unit-tested.

**Following.** Ctrl/Cmd+click on a link (a mouse modifier, so it never clashes
with the slash/format/Vim keybindings) follows it: an external link opens in a
new browser tab; an internal link that resolves to an existing note switches the
editor to it (through the normal controller path, flushing the open note first);
an internal link whose target doesn't exist (but resolves to a valid path)
prompts to create that note, and on confirmation creates and opens it. A plain
click (no modifier) does nothing special — it just places the caret.

## Constraints

- Links are standard CommonMark inline links; no new on-disk syntax (the moat).
  Rendering and following are display/interaction only — no bytes change.
- Path resolution is pure (no DOM/FSA), unit-tested, and can never resolve to a
  path outside the picked root (`..` past root → not a note).
- Following routes through the existing controller (`switchTo` / `addNote`); it
  introduces no second navigation or save path.
- Markup hiding reuses the FEAT-0006 inline-rendering layer and its atomic-range
  behavior; broken-vs-valid styling is fed the active note + the set of existing
  note paths, so it reflects the real folder.

## Out of scope

- Wikilinks (`[[...]]`), link autocomplete, a backlink panel, a link graph — see
  `DECISIONS.md`; navigation only.
- Editing a link's URL inline (the markup is hidden; change a link by retyping it,
  as with every other hidden construct).
- Links to non-`.md` files or to external resources other than opening an
  `http(s)` URL in a new tab.
- Image links (`![alt](src)`).

## Acceptance criteria

**AC-1** — Resolve an internal link relative to the linking note's folder.
Given the linking note `sub/a.md` and a link `url` of `b.md`,
When the path is resolved,
Then it resolves to `sub/b.md`; and `../c.md` resolves to `c.md`, while `./b.md`
resolves to `sub/b.md`.

**AC-2** — A link that escapes the root or isn't markdown does not resolve.
Given the linking note `sub/a.md`,
When resolving `../../x.md` (walks above the root) or `b.txt` (not `.md`),
Then resolution yields "no note" (null), so the link is treated as broken/inert.

**AC-3** — Classify external vs internal links.
Given the urls `https://example.com`, `mailto:x@y.z`, and `sub/b.md`,
When each is classified,
Then the first two are external and the third is internal.

**AC-4** — Render an internal link with markup hidden and text styled.
Given the document `see [the note](sub/b.md)` with `sub/b.md` an existing note,
When the inline rendering runs,
Then the `[` and `](sub/b.md)` runs are hidden, the text `the note` is styled
`cm-link` (not broken) and carries the url `sub/b.md`.

**AC-5** — Render a missing internal target as broken.
Given the document `see [gone](missing.md)` with no `missing.md` note,
When the inline rendering runs,
Then the text `gone` is styled `cm-link cm-link-broken`.

**AC-6** — Ctrl/Cmd+click an internal link switches to the target note.
Given an open note containing a link to an existing note `sub/b.md`,
When the user Ctrl/Cmd+clicks the link's text,
Then the editor switches to `sub/b.md` (its content loads).

**AC-7** — Ctrl/Cmd+click a missing internal link offers to create it.
Given an open note containing a link to `new.md` that does not exist,
When the user Ctrl/Cmd+clicks the link and confirms the prompt,
Then `new.md` is created and opened.

**AC-8** — Ctrl/Cmd+click an external link opens it in a new tab, not in-app.
Given an open note containing `[site](https://example.com)`,
When the user Ctrl/Cmd+clicks it,
Then it opens in a new browser tab and the editor does not navigate notes.
