---
id: FEAT-0027
title: Wikilinks
status: draft
depends_on: [FEAT-0026, FEAT-0023]
---

## Intent

The M8 review reversed the earlier "no wikilinks" call (see `DECISIONS.md`): the
user wants `[[note]]` links, which are the de-facto standard across plain-markdown
note tools and, for quick-capture, more ergonomic than a full `[text](path.md)` —
you type a name, not a path. This phase adds them on top of FEAT-0026's
interaction model. A bare `[[name]]` resolves by basename across the whole tree,
case-insensitively; a `[[sub/name]]` resolves as a root-relative path. They render
like every other link (brackets hidden, label styled, broken if the target is
missing), follow on plain click, reveal for editing on caret, and create the note
when missing. The file keeps the literal `[[…]]` bytes — the user's accepted trade
of strict CommonMark portability for ergonomics.

## Behavior

**Syntax.** `[[target]]` and `[[target|alias]]`. The label shown is `alias` when
present, else `target`. An empty target (`[[]]`, `[[|x]]`) is not a wikilink and
is left as plain text.

**Resolution.** A `target` with no `/` is a **bare name**: it matches a note whose
filename (basename, ignoring folders) equals `target` + `.md`,
**case-insensitively**, anywhere in the tree; if several match, the first by
sorted path wins. A `target` containing `/` is a **root-relative path**:
`sub/name` → `sub/name.md`, matched case-insensitively against the listing. The
**create path** for a missing target is `name.md` at the root for a bare name, or
the given path for a slashed one. Resolution is a pure function over the note
list, unit-tested.

**Rendering.** The `[[` and `]]` (and, for an alias, the `target|` run) are hidden
(atomic, like all markup); the label is styled `cm-link`, gaining `cm-link-broken`
when no note matches. The link carries the resolved note path (or the create path
when missing) so a follow acts on it directly. Reveal-on-caret (FEAT-0026) applies:
while the selection touches a wikilink, its raw `[[…]]` shows for editing.

**Following.** A plain click follows (FEAT-0026's model): an existing target
switches to that note; a missing target prompts to create the note at its create
path, and on confirm creates and opens it. Ctrl/Cmd+click places the caret (edit).

## Constraints

- Wikilinks are detected by a scan (the CommonMark parser doesn't know `[[ ]]`),
  resolved at render time against the active link context (the note list), so
  broken styling and the follow target reflect the real folder.
- Resolution is pure (no DOM/FSA), unit-tested, and never yields a path outside
  the root (a bare name lands at the root; a slashed path is taken as given,
  with `..` not honored — wikilinks address the tree, they don't walk out of it).
- Display/interaction only — the file keeps the literal `[[…]]` bytes (the moat
  trade is explicit and recorded).
- Following reuses the controller (`switchTo`/`addNote`) and FEAT-0026's
  click/reveal model; no second navigation path.

## Out of scope

- Heading/block anchors (`[[note#heading]]`), embeds (`![[note]]`), block refs.
- Autocomplete of note names while typing `[[`.
- Renaming a note updating inbound `[[…]]` references.

## Acceptance criteria

**AC-1** — Resolve a bare wikilink by basename, case-insensitively.
Given the notes `["a.md", "projects/diablo.md"]`,
When `[[DiaBlo]]` is resolved,
Then it resolves to `projects/diablo.md` (basename match, case-insensitive), with a
create path of `DiaBlo.md` at the root.

**AC-2** — Resolve a slashed wikilink as a root-relative path.
Given the notes `["sub/note.md"]`,
When `[[sub/note]]` is resolved,
Then it resolves to `sub/note.md`, with the create path `sub/note.md`.

**AC-3** — A wikilink with no matching note resolves to nothing (but has a create path).
Given the notes `["a.md"]`,
When `[[missing]]` is resolved,
Then there is no resolved note (null) and the create path is `missing.md`.

**AC-4** — Render a bare wikilink with brackets hidden and the label styled.
Given the document `see [[note]]` with `note.md` an existing note,
When the inline rendering runs,
Then `[[` and `]]` are hidden, the label `note` is styled `cm-link` (not broken)
and carries the resolved note path `note.md`.

**AC-5** — Render an aliased wikilink showing the alias.
Given the document `see [[note|the note]]`,
When the inline rendering runs,
Then `[[note|` and `]]` are hidden and the visible label is `the note`, styled as
a link.

**AC-6** — A wikilink to a missing note renders broken.
Given the document `see [[ghost]]` with no `ghost.md`,
When the inline rendering runs,
Then the label `ghost` is styled `cm-link cm-link-broken`.

**AC-7** — Clicking a wikilink to an existing note switches to it.
Given an open note containing `[[other]]` and an existing note `other.md`,
When the wikilink is plain-clicked,
Then the editor switches to `other.md`.

**AC-8** — Clicking a wikilink to a missing note creates it.
Given an open note containing `[[fresh]]` and no `fresh.md`,
When the wikilink is plain-clicked and the prompt confirmed,
Then `fresh.md` is created at the root and opened.
