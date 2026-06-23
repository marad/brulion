---
id: FEAT-0037
title: link autocomplete
status: draft
depends_on: [FEAT-0023, FEAT-0025, FEAT-0027, FEAT-0033]
---

## Intent

Linking to another note today means typing the whole `[[name]]` from memory — you
have to know the note's name (or its path) and type it correctly, or the link
dangles. This phase suggests existing notes *while you type the link*: the moment
you open a wikilink with `[[`, a completion list of existing notes appears, ranked
by the **same fuzzy scoring the Ctrl+K quick switcher uses** (`note-search.ts`),
so "what ranks first here" and "what ranks first in the switcher" never disagree.
Accepting a suggestion inserts the note's path and closes the `]]` for you.

This is pure editor interaction built on `@codemirror/autocomplete` (the same
machinery the slash menu rides on). It reads the note paths the editor already
knows — the `linkContext` facet that drives valid-vs-broken link rendering
(FEAT-0025/0027) — so there is one source of truth for "which notes exist". It
writes nothing to disk and never creates a note: it only inserts link text the
user then owns. The file-fidelity moat is untouched.

## Behavior

**Trigger.** Inside an open wikilink — when the text immediately before the caret
is `[[` optionally followed by a partial target (no `]` and no newline between the
`[[` and the caret) — a completion list opens automatically. The list offers
existing notes only.

**Ranking.** The notes are ranked by the existing `note-search.ts` scoring
(`searchNotes`) against the partial target typed after `[[`: a fuzzy subsequence
match, best matches first, ties broken by path; an empty target (just-typed `[[`)
lists all notes in name order. Matching is over each note's display path (no
`.md`), case-insensitively. This is the *same* ranking the quick switcher shows,
so the order is consistent between the two surfaces. The editor's own
re-filtering is disabled so this ranking is authoritative.

**Acceptance.** Choosing a suggestion (Enter, Tab, or click) replaces the partial
target with the chosen note's **display path** (folder-relative, `.md` stripped —
e.g. `projects/diablo`) and ensures the link is closed with `]]`, leaving the
caret after the closing `]]`. If a `]]` already sits right after the caret, it is
reused rather than duplicated. Inserting the full path (not the bare basename)
makes the wikilink resolve unambiguously to the chosen note even when two notes
share a basename in different folders.

**Existing notes only; new names still allowed.** The list never offers a
"create" row and never creates a note. Typing a name that matches nothing is fully
allowed — the user just types it between the brackets and gets a dangling
wikilink, which the existing missing-target handling (FEAT-0027) already renders as
broken and offers to create on follow. Autocomplete only *suggests* among notes
that already exist.

**Coexists with the slash menu.** The wikilink source and the slash-command source
(FEAT-0008) are both registered as markdown autocomplete sources; each returns
nothing when its own trigger is absent, so they never collide.

## Constraints

- **Reuse the switcher's scoring.** Ranking calls the existing `note-search.ts`
  (`searchNotes`) — no second fuzzy/scoring implementation. The order matches the
  Ctrl+K switcher.
- **One source of truth for known notes.** The candidate notes come from the
  editor's existing `linkContext` facet (`notePaths`), the same set that drives
  link valid-vs-broken rendering — not a separately threaded list.
- **No new dependency.** Built on `@codemirror/autocomplete`, already in use for
  the slash menu.
- **No create-on-miss.** Autocomplete suggests existing notes only and writes
  nothing; it never creates a note (unlike the quick switcher).
- **Moat: read-only.** Opening, filtering, and accepting a suggestion only edit the
  editor buffer's link text; nothing is read from or written to the folder by the
  completion itself.

## Out of scope

- **Markdown `[text](path.md)` link autocomplete** — this phase covers the `[[ ]]`
  wikilink trigger only (the ergonomic, name-first form FEAT-0027 added).
- **Create-on-miss from the completion** — creating a note is the quick switcher's
  job (FEAT-0033); a dangling wikilink is created by following it (FEAT-0027).
- **Alias completion** (`[[note|…]]`) — the alias text is free prose the user
  writes; only the target is suggested.
- **Body/full-text search** — suggestions match note names/paths, not note content
  (same boundary as the switcher).

## Acceptance criteria

**AC-1** — Typing `[[` opens a note-suggestion list.
Given a folder is open with several notes,
When the user types `[[` in the editor,
Then a completion list appears offering the existing notes (an empty target lists
all notes), and no "create" option is shown.

**AC-2** — Typing after `[[` fuzzily filters and ranks the notes.
Given the completion list is open after `[[`,
When the user types a partial target,
Then the list narrows to notes whose display path fuzzily matches, ordered by the
same `note-search.ts` scoring the quick switcher uses (best match first, ties by
path).

**AC-3** — Accepting inserts the note's display path and closes the link.
Given the completion list is open with a highlighted note,
When the user accepts it (Enter, Tab, or click),
Then the partial target is replaced by that note's display path (no `.md`), the
link is closed with `]]`, and the caret is left after the closing `]]`.

**AC-4** — An already-present `]]` is not duplicated.
Given the caret sits inside `[[…]]` with the closing `]]` already present right
after the partial target,
When the user accepts a suggestion,
Then the result is a single well-formed `[[path]]` (the existing `]]` is reused,
not doubled).

**AC-5** — Only existing notes are suggested; a new name is still typeable.
Given the completion list is open after `[[`,
When the user types a target that matches no existing note,
Then the list shows no match and offers no create row, yet the user can finish
typing the name and brackets to leave a (dangling) wikilink unimpeded.

**AC-6** — The wikilink target resolves to the chosen note.
Given two notes share a basename in different folders,
When the user accepts one of them from the list,
Then the inserted target is the full display path, so the wikilink resolves to the
chosen note (not the other same-named one).

**AC-7** — The slash menu still works alongside it.
Given the link-autocomplete source is registered,
When the user triggers a slash command (`/` at a line start/after whitespace),
Then the slash menu behaves exactly as before (the two completion sources do not
interfere).

**AC-8** — Read-only: no writes from completing a link.
Given a folder is open,
When the user opens the suggestion list, filters it, and accepts a suggestion,
Then nothing is written to or read from the folder by the completion (only the
editor buffer's link text changes).
