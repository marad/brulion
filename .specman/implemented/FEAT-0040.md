---
id: FEAT-0040
title: Update references when a note is renamed
status: draft
depends_on: [FEAT-0034, FEAT-0025, FEAT-0027, FEAT-0037]
---

## Intent

Renaming a note moves one file (FEAT-0034); links to it in *other* notes are left
exactly as written and silently dangle, relying on the missing-target handling
(FEAT-0025/0027). M14's review judged that too lossy: the user values vault
consistency over a manual fix-up. This phase closes the loop — on a rename, the
links that pointed at the old path are rewritten to point at the new one, so the
vault stays internally consistent across the move.

Rewriting a link is still plain markdown the user owns (no lock-in, no
app-private state), and it happens only on an explicit, user-initiated rename —
so it does not break the moat. The rewrite is **silent and unconditional**: a
rename's links should just follow it, the way a refactor-rename does in an
editor, and prompting would only invite the user to decline and thereby keep the
very dangling links this feature exists to prevent (decided in the M25 review).
The one guardrail that remains is data-safety: every write goes through the
existing per-note stale-write guard, so a file edited from outside is **skipped,
never clobbered**.

The detection of "what does this link point at" reuses the existing resolvers
(`resolveNotePath` for markdown links, `resolveWikilink` for wikilinks) so there
is one source of truth shared with rendering; the bare-vs-full wikilink form
reuses `shortestLinkText` (FEAT-0037). The rewrite itself is a new pure module so
the byte-mutating logic is unit-tested in isolation.

## Behavior

**The pure rewrite core.** `rewriteLinksForRename({ text, notePath, oldPath,
newPath, pathsBefore, pathsAfter })` takes the markdown `text` of one note, that
note's own path (`notePath`, unchanged by the rename — links resolve relative to
its folder), the rename (`oldPath` → `newPath`), and the vault's note-path set
**before** the rename (`pathsBefore`, used to decide what a link currently points
at) and **after** it (`pathsAfter`, used to choose the new wikilink form). It
returns the rewritten text, or `null` when nothing in the note pointed at
`oldPath` (so the caller can skip writing an unchanged file). It rewrites:

- **Markdown inline links** `[label](dest)` whose `dest` resolves (via
  `resolveNotePath(notePath, dest)`) to `oldPath`. The new `dest` is the POSIX
  relative path from `notePath`'s folder to `newPath` — so a same-folder rename
  changes only the filename, and a folder move recomputes the `../` prefix. A
  destination that needs it (contains a space or parenthesis) is wrapped in
  `<…>` (CommonMark's angle-bracket form) so it stays a single valid destination.
  External links (`http(s):`, `mailto:`, protocol-relative) and image links
  (`![…](…)`) are never rewritten. Reference-style links and link-reference
  definitions are out of scope (left as-is).
- **Slashed wikilinks** `[[sub/note]]` / `[[sub/note|alias]]` whose target
  resolves to `oldPath`. The target is rewritten to the new full path
  (`displayName(newPath)`); the alias and brackets are preserved.
- **Bare wikilinks** `[[note]]` / `[[note|alias]]` whose target resolves to
  `oldPath`. The new target is `shortestLinkText(newPath, pathsAfter)` — the bare
  basename when it is **unique** in the post-rename vault (so a folder move that
  keeps the basename unique leaves the link untouched), and the full path only
  when the move would make the bare name resolve to a *different* note. The alias
  and brackets are preserved.

Detection uses `pathsBefore` so a bare wikilink that currently resolves to
`oldPath` is recognized even though `oldPath` no longer exists after the move. A
link that resolves to any *other* note, or to nothing, is left untouched. The
rewrite is byte-minimal: only the matched destinations/targets change; everything
else in the note is preserved exactly. Re-resolving a rewritten markdown
destination against `notePath` yields `newPath` (round-trip correct).

**Driving it across the vault.** `NoteController.renameActive(name)` (FEAT-0034)
gains an inbound-link pass that runs **after** the file is successfully moved and
the editor follows it to the new path, inside the same serialize slot so it
cannot interleave with a switch, save, or poll:

1. Capture the pre-rename listing and derive the post-rename one (the same set
   with `oldPath` replaced by `newPath`).
2. Read every *other* note (skip the renamed note itself) and run the rewrite
   core. For each note whose text changed, write it back immediately with
   `saveNote(dir, path, newText, knownLastModified)` (the `lastModified` from that
   fresh read). A `conflict` result (the file changed on disk between the read and
   the write) **skips that file** — it is never overwritten — and the rename still
   completes for the others.
3. The pass is **best-effort**: a failure in it (an I/O error part-way) is
   swallowed and never reports the already-succeeded rename as failed — the
   affected links simply stay as they were.

The renamed note's own move is unchanged (FEAT-0034): native `move()` preferred,
copy-then-delete fallback, no-clobber guard, content preserved. A rename with no
inbound links anywhere behaves exactly as before — no extra writes, nothing
surfaced.

## Constraints

- Detection of a link's target reuses `resolveNotePath` / `resolveWikilink` — no
  second, divergent "where does this link go" logic. The bare-vs-full wikilink
  choice reuses `shortestLinkText` (FEAT-0037).
- The rewrite core is **pure** (no DOM / FSA / CodeMirror) and is the only place
  link bytes are mutated for a rename — unit-tested directly.
- A rewritten markdown destination re-resolves to `newPath` from the linking
  note's folder (round-trip invariant).
- Bare wikilinks stay bare whenever that still resolves unambiguously to the
  renamed note; they are promoted to a full path only when necessary to keep them
  pointing at the renamed note.
- The renamed note's own bytes are untouched by the inbound-link pass; the note is
  excluded from its own scan.
- Every inbound write goes through `saveNote`'s stale-write guard with the mtime
  read moments earlier; a file changed out from under us is skipped, never
  clobbered (the moat). A rename touching N files never loses an edit in any.
- The inbound-link pass runs inside the controller's serialize queue, after the
  move and the active-note follow, so a concurrent poll cannot misread it.
- The rewrite is silent and unconditional (no confirmation prompt); a rename of a
  note nobody links to writes nothing extra. The pass is best-effort — a failure
  never reports the rename itself as failed.
- Markdown links use the markdown grammar to locate `[label](dest)` spans (so
  images and non-inline links are correctly excluded); wikilinks are located with
  the existing `WIKILINK_RE` scan — matching how the renderer detects each.

## Out of scope

- A global rename-any-note surface (renaming a note other than the active one).
- Undo of a multi-file rename (the writes are individually guarded but there is no
  single rollback).
- Reference-style markdown links (`[label][ref]`) and link-reference definitions
  (`[ref]: path`) — left as-is; the app renders only inline links.
- Rewriting links in non-note files (the settings file, etc.) — only `.md` notes
  in the listing are scanned.
- Rebasing links *inside* the renamed note that used relative paths to reach other
  notes (a folder move can break the moved note's own outbound relative links).
  This phase handles inbound links only; the moved note's outbound links are a
  separate concern, deferred.

## Acceptance criteria

**AC-1** — Rewrite a same-folder markdown link.
Given a note `n.md` containing `[d](diablo.md)` and a vault where
`resolveNotePath("n.md", "diablo.md")` is `diablo.md`,
When `rewriteLinksForRename` runs with `oldPath = "diablo.md"`,
`newPath = "diablo-2.md"`,
Then the returned text contains `[d](diablo-2.md)` and is otherwise unchanged.

**AC-2** — Rebase a markdown link across a folder move.
Given `sub/n.md` containing `[d](diablo.md)` (which resolves to `sub/diablo.md`),
When `rewriteLinksForRename` runs with `oldPath = "sub/diablo.md"`,
`newPath = "archive/diablo.md"`,
Then the link destination becomes `../archive/diablo.md`, which re-resolves from
`sub/n.md` back to `archive/diablo.md` (round-trip).

**AC-3** — A markdown destination needing escaping is wrapped in `<…>`.
Given a note `n.md` linking to `oldPath`,
When the rename targets a `newPath` whose relative destination contains a space,
Then the rewritten destination is wrapped as `<…/new note.md>` and re-resolves to
`newPath`.

**AC-4** — A bare wikilink stays bare when its basename is renamed.
Given `n.md` containing `[[diablo]]` resolving to `diablo.md`,
When the rename is `diablo.md` → `diablo-2.md` (basename unique after),
Then the text becomes `[[diablo-2]]`.

**AC-5** — A bare wikilink is left untouched by a pure folder move.
Given `n.md` containing `[[diablo]]` resolving to `proj/diablo.md`, with the
basename `diablo` unique in the vault,
When the rename is `proj/diablo.md` → `archive/diablo.md` (basename still unique),
Then the text is unchanged and `rewriteLinksForRename` returns `null` (the bare
name still resolves to the moved note).

**AC-6** — A bare wikilink is promoted to a full path when the move would make it
ambiguous.
Given `n.md` containing `[[note]]` resolving (first sorted) to `a/note.md`, with a
second `b/note.md` also in the vault,
When the rename is `a/note.md` → `c/note.md`,
Then the text becomes `[[c/note]]` (a bare `[[note]]` would now resolve to
`b/note.md`).

**AC-7** — A slashed wikilink is rewritten to the new full path, alias preserved.
Given `n.md` containing `[[sub/diablo|Diablo]]` resolving to `sub/diablo.md`,
When the rename is `sub/diablo.md` → `archive/diablo.md`,
Then the text becomes `[[archive/diablo|Diablo]]`.

**AC-8** — Unrelated and external links are never rewritten.
Given `n.md` containing `[other](other.md)`, `[ext](https://x.test)`, and
`![img](diablo.md)` while renaming `diablo.md` → `diablo-2.md`,
Then none of those three change (`other.md` points elsewhere; the external link
and the image are excluded), and if they are the only links the function returns
`null`.

**AC-9** — Rename silently rewrites inbound links across the vault.
Given an open folder with `diablo.md` active and `n.md` containing
`[[diablo]]` and `[d](diablo.md)`,
When `renameActive("diablo-2")` is called,
Then `diablo.md` is moved to `diablo-2.md`, `n.md` on disk now contains
`[[diablo-2]]` and `[d](diablo-2.md)` (no prompt), and the result is
`{ ok: true }`.

**AC-10** — A failure in the inbound pass does not fail the rename.
Given the AC-9 setup but a guarded inbound write throws or rejects part-way,
When `renameActive("diablo-2")` is called,
Then the move still stands, the active note is `diablo-2.md`, and the result is
`{ ok: true }` (the inbound rewrite is best-effort, not load-bearing on the
rename).

**AC-11** — A rename with no inbound links writes nothing extra.
Given an open folder with `diablo.md` active and `n.md` containing no link to it,
When `renameActive("diablo-2")` is called,
Then `n.md` is byte-identical on disk.

**AC-12** — An inbound write that would clobber an externally-changed file is
skipped.
Given `n.md` links to the active `diablo.md`, and between the rewrite scan and the
write `n.md` is changed on disk by another writer (its mtime no longer matches),
When the inbound-link pass writes `n.md`,
Then `saveNote` reports a conflict, `n.md` keeps the external content (the rewrite
is not applied to it), and the rename still completes for the move and any other
files.
