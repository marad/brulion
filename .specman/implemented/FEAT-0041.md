---
id: FEAT-0041
title: "Rebase a moved note's own outbound links"
status: draft
depends_on: [FEAT-0040, FEAT-0034, FEAT-0025]
---

## Intent

FEAT-0040 keeps the vault consistent by following *inbound* links when a note is
renamed. The M25 review found the mirror gap: when a rename also **moves the note
to a different folder**, the moved note's *own* outbound relative markdown links
(resolved relative to its old folder) now point at the wrong place. The user
judged this unacceptable — a folder move that silently breaks the note's own links
defeats the point of M25. This phase closes it: on a folder-crossing rename, the
moved note's outbound relative markdown links are rebased so they still resolve to
the same targets from the new location.

Only **relative markdown links** are affected: wikilinks resolve by basename or
from the root, independent of where the linking note lives, so a move never breaks
them; and a same-folder rename leaves every relative destination resolving
identically, so it changes nothing. The rebase reuses the FEAT-0040 path
primitives (`relativeLink` / `resolveNotePath`) and stays display-faithful — bytes
change only for the destinations that genuinely moved.

## Behavior

**The pure rebase.** `rebaseOutboundLinks(text, oldPath, newPath)` returns `text`
with each markdown inline link's destination recomputed so it still points at the
same note from `newPath`'s folder, or `null` when nothing changed. For each
inline `[label](dest)` (located via the CommonMark grammar — images and
reference/shortcut links excluded):

- An external destination (`http(s):`, `mailto:`, protocol-relative, with or
  without a `<…>` wrapper) is left as-is.
- The target is `resolveNotePath(oldPath, dest)` — where the link pointed from the
  old location. A `null` target (not an in-tree `.md` note: escapes the root, or
  not a note) is left as-is.
- If `resolveNotePath(newPath, dest)` already equals that target, the destination
  still resolves correctly from the new location (the same-folder case) and is left
  unchanged.
- Otherwise the destination is rewritten to `relativeLink(newPath, target)`,
  wrapped in `<…>` when it needs escaping — round-tripping back to the same target
  from `newPath`.

A pure rename within the same folder changes no destination, so the function
returns `null`. Wikilinks are never touched.

**Driving it on rename.** `NoteController.renameActive` (FEAT-0040) runs the
rebase right after the move and **before** re-pointing the editor, inside the same
serialize slot, as a best-effort follow-on (a failure leaves the links as-is and
never fails the already-succeeded rename):

1. If the move did not cross folders (`old` and `new` share a folder), skip
   entirely — no file is even read.
2. Otherwise read the moved note at its new path, run `rebaseOutboundLinks`, and
   if it changed, write it back through `saveNote`'s stale-write guard (the mtime
   read moments earlier; a racing external edit yields a conflict and is skipped,
   never clobbered).
3. The editor then loads the (possibly rebased) content as the active note.

## Constraints

- Reuses `resolveNotePath` and `relativeLink` (FEAT-0040) — no second notion of
  where a link points or how a relative path is built. The rebased destination
  round-trips: `resolveNotePath(newPath, rebased) === target`.
- The rebase is **pure** (no DOM / FSA), unit-tested directly; the controller only
  does the read/guarded-write.
- Wikilinks and external/non-note links are never rewritten.
- A same-folder rename writes nothing extra (the pure core returns `null`, and the
  controller skips the file read on a same-folder move).
- The write goes through the per-note stale-write guard; a conflict is skipped.
- Best-effort: a failure in the rebase pass never reports the rename as failed.

## Out of scope

- Rebasing outbound links in *other* notes (those are inbound links to a third
  note, untouched by this rename) — only the moved note's own links.
- Reference-style markdown links and link-reference definitions (the app renders
  only inline links) — consistent with FEAT-0040.
- Rewriting wikilinks (they don't break on a move).

## Acceptance criteria

**AC-1** — A same-folder rename rebases nothing.
Given a note `a/n.md` containing `[x](other.md)`,
When `rebaseOutboundLinks(text, "a/n.md", "a/n2.md")` runs,
Then it returns `null`.

**AC-2** — A folder move rebases a relative markdown link, round-tripping.
Given `a/n.md` containing `[x](other.md)` (which points at `a/other.md`),
When `rebaseOutboundLinks(text, "a/n.md", "b/n.md")` runs,
Then the destination becomes `../a/other.md`, and `resolveNotePath("b/n.md",
"../a/other.md")` is `a/other.md`.

**AC-3** — A `..`-relative link is rebased when moving toward the root.
Given `sub/n.md` containing `[x](../top.md)` (points at `top.md`),
When `rebaseOutboundLinks(text, "sub/n.md", "n.md")` runs,
Then the destination becomes `top.md` and re-resolves to `top.md` from `n.md`.

**AC-4** — Wikilinks, external links, and non-note links are untouched.
Given `a/n.md` containing `[[other]]`, `[e](https://x.test)`, and `[t](file.txt)`,
When `rebaseOutboundLinks(text, "a/n.md", "b/n.md")` runs,
Then it returns `null` (none of those is a rebasable in-tree relative note link).

**AC-5** — Renaming the active note across folders rebases its own links on disk.
Given an open folder with `proj/diablo.md` active, containing `[x](other.md)`
(pointing at `proj/other.md`),
When `renameActive("archive/diablo")` is called,
Then `archive/diablo.md` on disk contains `[x](../proj/other.md)`, the active note
is `archive/diablo.md`, and the result is `{ ok: true }`.

**AC-6** — A same-folder rename does not rewrite the moved note's body.
Given an open folder with `diablo.md` active containing `[x](other.md)`,
When `renameActive("diablo-2")` is called,
Then no rebasing write of the moved note occurs (its body is byte-identical, only
its path changed) and the result is `{ ok: true }`.
