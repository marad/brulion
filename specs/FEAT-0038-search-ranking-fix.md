---
id: FEAT-0038
title: search ranking fix
status: draft
depends_on: [FEAT-0033]
---

## Intent

The quick switcher's fuzzy ranking (`note-search.ts`) gets two real cases wrong,
both reported from daily use on a deep vault:

1. **Depth is punished.** `fuzzyScore` charges the first matched character a "gap"
   equal to its absolute distance from the start of the string. A note matched
   deep in a long path — `Allegro/Journal/Week/2026-06-22` matched by `2026` —
   pays for every folder character that precedes the match, so it sinks below
   shallower, worse matches purely for living in a deep folder.
2. **Greedy matching misses contiguous runs.** The matcher walks the target
   left-to-right and grabs the *first* occurrence of each query character. A clean
   contiguous run the user clearly meant (`06-22` inside `…/2026-06-22`) is never
   scored *as* contiguous when an earlier scattered alignment of those characters
   exists — so an exact substring loses to noise.

This phase rewrites the scoring so that a literal contiguous substring wins, the
best alignment is found rather than the first, and a match's folder depth costs
nothing — while keeping `fuzzyScore` pure & total and leaving the `searchNotes`
result contract (and therefore every caller: the Ctrl+K switcher and the wikilink
autocomplete) unchanged. No file behavior changes; this is ranking logic only.

## Behavior

**Same shape, better order.** `searchNotes(query, paths)` keeps its signature and
contract: it returns the matching note paths best-first (ties broken by path
ascending) plus the `create` offer, and an empty/whitespace query still lists all
paths in name (path-ascending) order with `create: null`. Only the *order* of the
matches changes, driven by a rewritten `fuzzyScore`.

`fuzzyScore(query, target)` stays a pure, total function returning a number
(higher is better) or `null` when the query is not even a subsequence of the
target; an empty query still scores `0`. Matching stays case-insensitive and, via
`searchNotes`, is performed over each note's display form (`.md` stripped). What
changes is how the number is computed:

**A literal contiguous substring wins.** When the (case-folded) query occurs as a
contiguous substring of the target, the match scores in a band strictly above any
score reachable by a non-contiguous (gapped) subsequence match. Among substring
occurrences the best one is chosen by *where the run begins*: a run starting at a
**segment boundary** — string start, or right after a `/`, space, `-`, or `_` —
outranks a run starting **mid-token**. So `06-22` typed against
`…/Week/2026-06-22` finds the contiguous run, and a segment-aligned hit is
preferred to one buried inside a word.

**Best alignment, not greedy.** When the query is only a subsequence (it needs
gaps), the score is the maximum over *all* valid alignments, not the first
left-to-right one — found with a small dynamic-programming pass over the two
strings. This is what lets the contiguous-substring case actually be discovered
even when an earlier scattered alignment exists.

**Depth costs nothing.** There is no penalty for how far into the target the match
begins — the leading-distance penalty is gone. Only *interior* gaps (characters
skipped *between* two matched characters) are penalized, and a contiguous pair is
rewarded. So a note matched in its name ranks the same whether that name sits at
the vault root or four folders deep; folder depth never lowers a score.

**Boundary bonus on matched characters.** A matched character that falls at a
segment boundary (as defined above) scores a bonus, so matches that align to
word/segment starts rank above matches buried mid-word — preserving the existing
"segment start is better" intuition, now without the depth penalty that used to
distort it.

## Constraints

- **Pure & total.** `fuzzyScore` and `searchNotes` never throw, never read the
  clock/DOM/disk, and depend only on their arguments. Same determinism as today.
- **Contract unchanged.** `searchNotes`'s return shape, the empty/whitespace-query
  behavior, the path-ascending tiebreak, and the `create` logic are all unchanged.
  Callers (`quick-switcher.ts`, `link-complete.ts`) are not touched and keep
  working without modification.
- **One scorer.** There remains exactly one fuzzy scorer (`fuzzyScore`); the
  switcher and the autocomplete both rank through `searchNotes`. No second
  implementation is introduced.
- **Bounded cost.** The alignment pass is at worst linear in (query length ×
  target length) per candidate — fine for note-name-sized strings scored per
  keystroke. No pathological blow-up on long paths.
- **Moat: untouched.** Pure ranking logic; nothing is read from or written to the
  folder, and no on-disk bytes change.

## Out of scope

- **Recency / most-recently-visited ordering** — FEAT-0039 (M21 P2). This phase is
  purely about match-quality ranking for a given query; recency is layered on top
  next.
- **Body / full-text search** — suggestions still match note names/paths only, not
  note content (same boundary as the switcher today).
- **Matching across the `/` as if flat** — segments are still part of the display
  form the query matches against; this phase changes *scoring*, not what string is
  matched.
- **Configurable weights / a settings knob** — the scoring constants stay internal
  and fixed.

## Acceptance criteria

**AC-1** — A contiguous substring outranks a scattered match, regardless of depth.
Given a query that occurs as a contiguous run in one note's display path and only
as a scattered subsequence in another,
When `searchNotes` ranks them,
Then the note containing the contiguous run is ordered first — even when its path
is deeper (longer leading distance) than the scattered match's.

**AC-2** — Folder depth does not lower a match's score.
Given two notes whose *names* match a query identically but one lives at the vault
root and the other several folders deep,
When `fuzzyScore` scores the query against each note's display path,
Then the two scores are equal (the deep path is not penalized for its leading
folders).

**AC-3** — The best alignment is found, not the first.
Given a target in which the query's characters appear both as an early scattered
alignment and as a later contiguous run,
When `fuzzyScore` scores it,
Then the score reflects the contiguous run (the higher-scoring alignment), not the
first greedy left-to-right one.

**AC-4** — A segment-start run beats a mid-token run.
Given the query occurs as a contiguous substring in two notes — once starting at a
segment boundary (string start or after `/`, space, `-`, `_`) and once starting
mid-token,
When `searchNotes` ranks them,
Then the segment-start occurrence is ordered first.

**AC-5** — `fuzzyScore` stays pure & total with the same null/empty contract.
Given any query and target,
When `fuzzyScore` is called,
Then it returns `null` when the query is not a subsequence of the target, a number
otherwise, and exactly `0` for an empty query — never throwing.

**AC-6** — `searchNotes`'s contract is unchanged.
Given the existing `searchNotes` behavior (empty/whitespace query → all paths in
path-ascending order with `create: null`; path-ascending tiebreak among equal
scores; `create` offered for a non-existing, non-empty name),
When the rewritten scorer is in place,
Then all of that still holds — only the relative order of differently-scored
matches improves.
