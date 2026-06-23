---
id: FEAT-0039
title: recency ranking
status: draft
depends_on: [FEAT-0033, FEAT-0038]
---

## Intent

The quick switcher today ranks purely by match quality and, with no query typed,
lists every note in path order — so hopping back to a note you were just in means
typing its name even though "the note I came from" is almost always what you want.
This phase adds **recency**: the switcher remembers the order in which notes were
visited and uses it to surface recent notes first on an empty query, and to break
ties between equally-good matches when a query is typed.

Recency is **most-recently-*visited***, not disk mtime — it reflects where *you*
have been, not what some other tool touched. The roadmap framed this as reusing
"the M19 visit history", but M19 (FEAT-0036) leans entirely on the browser's own
Back/Forward stack, which JavaScript cannot read back. So this phase maintains its
**own** small most-recently-used (MRU) list of visited note paths — persisted
alongside the other `brulion:` UI state and updated on the same active-note change
M19 already mirrors into the URL.

Crucially, recency is **only a tiebreaker** when a query is typed: match quality
always wins, and recency never adds to a score — so a freshly-touched poor match
can never jump ahead of a better one. It is purely a switcher/ranking concern; no
file behavior changes and the file-fidelity moat is untouched.

## Behavior

**An MRU list of visited notes.** The app keeps an ordered list of recently
*visited* note paths, most-recent first. Whenever the active note changes (the
single signal that also drives the URL mirror — opening a folder, switching,
creating, renaming, or falling back after a delete), that note is moved to the
front of the list (deduplicated — it appears once, at the front). The list is
capped to a sane maximum length (older entries beyond the cap drop off) and is
persisted in IndexedDB with the other UI state, so it survives a reload.

**Empty query → most-recently-visited first.** When the switcher is opened with no
query (or whitespace only), the notes are listed **most-recently-visited first**,
then every remaining (never-visited) note in the existing path-ascending name
order. So the most recent note you can switch to sits at the top, and a couple of
arrow-downs reach the ones around it — usually no typing needed to switch nearby.

**The currently-open note is excluded from the switcher.** The switcher lists
notes you can switch *to*; switching to the note you are already in is a no-op, so
the open note never appears in the results (for any query, not just the empty one).
The direct consequence — agreed in the M21 review — is that on an empty query the
**first** row is the *previously*-visited note, so Enter performs a back-and-forth
toggle to where you just came from. The exclusion lives in the switcher, not in
`searchNotes` (so it does not affect the wikilink autocomplete, which may legitimately
list the open note).

**Non-empty query → recency breaks ties only.** When a query is typed, notes are
ordered by match score (the FEAT-0038 ranking) exactly as before; recency is
applied **only** as a tiebreaker between notes with the **equal** score — the
more-recently-visited one ranks first — and the existing path-ascending order
remains the final tiebreak after that. Recency is never added into the score, so a
recently-visited weak match never outranks a stronger match.

**Stale entries are harmless.** A path in the MRU list that no longer names an
existing note (it was renamed or deleted) simply never matches the current note
set and is ignored by the ranking; it does not need to be actively pruned to stay
correct. The MRU list orders whatever live notes it contains and leaves the rest in
name order.

## Constraints

- **One ranking source.** Recency is layered inside `searchNotes` (the single
  ranking entry point), as an added sort key — `fuzzyScore` and the FEAT-0038
  scoring are unchanged. No second ranking path is introduced.
- **Recency is a tiebreaker, never a score term.** For a non-empty query the
  primary order is match score; recency only orders notes whose scores are equal.
  This must be observable: a more-recently-visited note with a strictly worse score
  must still rank below the better match.
- **Pure & total ranking.** `searchNotes` (and any MRU-update helper) stay pure and
  total — no clock, DOM, or disk reads inside them; recency is passed in as data.
  Determinism is preserved.
- **Own MRU list, not the browser history.** The visit list is maintained and
  persisted by the app (IndexedDB, with the other `brulion:` state); it is not read
  from the browser's Back/Forward stack (which JS cannot access).
- **Bounded.** The MRU list is capped; it cannot grow without limit across a long
  session.
- **Moat: untouched.** Recency tracking and ranking read and write only app UI
  state (IndexedDB); nothing is read from or written to the note folder, and no
  on-disk bytes change.

## Out of scope

- **Disk-mtime "recently modified" ordering** — recency here is *visited*, not
  file modification time; mtime-based ordering is not part of this.
- **A "recent notes" UI outside the switcher** — no separate recents panel,
  sidebar section, or header control; recency only reorders the existing switcher
  results.
- **Cross-device sync of the visit list** — the MRU list is per-origin local state
  (like the other `brulion:` keys), not synced through the folder.
- **Changing `fuzzyScore` or the match-quality ranking** — that was FEAT-0038; this
  phase only adds the recency ordering on top.
- **Recency-ordering the wikilink autocomplete** — the `[[` completion keeps its
  pure match-quality order; recency applies to the quick switcher.

## Acceptance criteria

**AC-1** — An MRU update moves a visited note to the front, deduped and capped.
Given an ordered MRU list of visited paths,
When a note is visited (recorded),
Then it appears once at the front of the list, any earlier occurrence of it is
removed, the previously-front notes shift back, and the list never exceeds its cap
(the oldest entries beyond the cap are dropped).

**AC-2** — Empty query lists most-recently-visited notes first, then name order.
Given a set of notes where some have been visited (in a known order) and some never
have,
When `searchNotes` is called with an empty (or whitespace) query and that recency
order,
Then the visited notes come first in most-recently-visited order, followed by the
never-visited notes in path-ascending name order, and `create` is `null`.

**AC-3** — For a query, recency breaks ties between equally-scored matches only.
Given two notes that score **equally** for a typed query, one visited more recently
than the other,
When `searchNotes` ranks them with the recency order,
Then the more-recently-visited one is ordered first (path order is the final
tiebreak when neither has been visited).

**AC-4** — Recency never outranks a better match.
Given a recently-visited note that scores **worse** for a query than a
not-recently-visited note,
When `searchNotes` ranks them,
Then the better-scoring note still ranks first — recency does not lift the weaker
match above it.

**AC-5** — The visit list survives a reload.
Given notes were visited in a session and the MRU list was persisted,
When the app reloads and reads the persisted list,
Then opening the switcher with an empty query shows the same most-recently-visited
ordering (the list was not lost).

**AC-6** — A real visit→switcher flow shows recency order (e2e).
Given a folder with several notes is open,
When the user visits a couple of notes in order and then opens the quick switcher
with an empty query,
Then the just-visited notes appear at the top in most-recently-visited order.

**AC-7** — Stale entries are ignored, not shown.
Given the MRU list contains a path that no longer names an existing note,
When `searchNotes` ranks the current notes with that list,
Then the stale path is absent from the results and the live notes are ordered
correctly (the stale entry neither appears nor breaks the ordering).

**AC-8** — The currently-open note is excluded from the switcher (M21 review).
Given a folder is open with the active note among the notes,
When the switcher renders its results (empty query or a query that would match the
open note),
Then the open note is not listed, so on an empty query the first row is the
previously-visited note (Enter toggles back to where you came from). The exclusion
is in the switcher only — `searchNotes` itself still returns the note.
