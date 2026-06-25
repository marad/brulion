import { parser } from "@lezer/markdown"
import {
  displayName,
  isExternalLink,
  resolveNotePath,
  resolveWikilink,
} from "./note-name"
import { findWikilinks, shortestLinkText } from "./wikilink"

/**
 * Rewrite the links in **one** note that point at a renamed note, so they follow
 * it to its new path (FEAT-0040). Pure — no DOM / FSA / CodeMirror — so the one
 * place a rename mutates *other* notes' bytes is unit-tested directly. Detection of
 * "what does this link point at" reuses the existing resolvers
 * (`resolveNotePath` / `resolveWikilink`) and the bare-vs-full wikilink choice
 * reuses `shortestLinkText`, so this never invents a second notion of where a link
 * goes. The controller drives it across the vault (read each note → rewrite → write
 * through the stale-write guard); see {@link NoteController.renameActive}.
 */

/** Inputs to {@link rewriteLinksForRename}. */
export interface RenameRewrite {
  /** The markdown text of the note being scanned. */
  text: string
  /** That note's own folder-relative path — markdown links resolve relative to
   * its folder; it is unchanged by the rename. */
  notePath: string
  /** The renamed note's path before the move. */
  oldPath: string
  /** The renamed note's path after the move. */
  newPath: string
  /** The vault's note paths *before* the rename (contains `oldPath`) — used to
   * decide what a link currently points at. */
  pathsBefore: ReadonlySet<string>
  /** The vault's note paths *after* the rename (contains `newPath`, not `oldPath`)
   * — used to choose the new wikilink form and to tell when a link already
   * resolves to `newPath` (so it needs no rewrite). */
  pathsAfter: ReadonlySet<string>
}

/**
 * The POSIX relative path from the folder containing `fromNote` to `target`, such
 * that `resolveNotePath(fromNote, relativeLink(fromNote, target)) === target` (the
 * round-trip invariant). A same-folder target yields the bare filename (no `./`);
 * a target in an ancestor/sibling folder is reached with `../` prefixes.
 */
export function relativeLink(fromNote: string, target: string): string {
  const fromDir = fromNote.split("/").slice(0, -1) // the linking note's folder segments
  const targetSegs = target.split("/")
  const targetDir = targetSegs.slice(0, -1)
  let common = 0
  while (
    common < fromDir.length &&
    common < targetDir.length &&
    fromDir[common] === targetDir[common]
  ) {
    common++
  }
  const ups = Array<string>(fromDir.length - common).fill("..") // climb out of fromDir
  return [...ups, ...targetSegs.slice(common)].join("/")
}

/** A markdown link destination for `rel`: a literal `#` is percent-encoded first
 * (in a destination `#` starts a section anchor, so a note named `a#b` would be
 * split into path `a` + anchor `b` and the link would silently retarget — the
 * `<…>` wrapper does not help, the `#` stays literal inside it). `resolveNotePath`
 * decodes the `%23` back. The result is then wrapped in CommonMark's `<…>` form
 * when it contains a space or parenthesis (which would otherwise break a bare
 * destination). Our paths never contain `<`/`>` — `normalizeNoteName` rejects
 * them — so the angle-bracket form is always safe. */
function markdownDest(rel: string): string {
  const encoded = rel.replace(/#/g, "%23")
  return /[ ()]/.test(encoded) ? `<${encoded}>` : encoded
}

/**
 * Rewrite every link in `text` that points at `oldPath` so it points at `newPath`,
 * returning the new text — or `null` when nothing changed (so the caller skips an
 * unwritten file). Handles markdown inline links (`[label](dest)`, rebased through
 * `notePath`'s folder; images and external links excluded), slashed wikilinks
 * (rewritten to the new full path), and bare wikilinks (kept bare when still
 * unambiguous, promoted to a full path only when the move would otherwise retarget
 * them). Aliases and brackets are preserved; only the matched destinations/targets
 * change.
 */
/** A markdown inline link's destination found in the text: the `URL` node's
 * `[from, to)` span and the raw destination string (possibly `<…>`-wrapped or
 * percent-encoded). */
interface MarkdownLinkDest {
  from: number
  to: number
  dest: string
}

/**
 * Every markdown **inline** link's destination in `text`, via the CommonMark
 * grammar (the same grammar the renderer uses, so detection matches what the user
 * sees). Only `Link` nodes — never `Image` — and only those with an inline `URL`
 * child; reference/shortcut links have none and are skipped. The single place the
 * two rename rewrites locate markdown destinations.
 */
function markdownLinkDests(text: string): MarkdownLinkDest[] {
  const found: MarkdownLinkDest[] = []
  parser.parse(text).iterate({
    enter(node) {
      if (node.name !== "Link") return
      const url = node.node.getChild("URL")
      if (!url) return
      found.push({ from: url.from, to: url.to, dest: text.slice(url.from, url.to) })
    },
  })
  return found
}

/** Whether a markdown destination is an external link (a `scheme:` URL or
 * protocol-relative), accounting for a CommonMark `<…>` wrapper that would
 * otherwise hide the leading scheme from {@link isExternalLink}. */
function isExternalDest(dest: string): boolean {
  return isExternalLink(dest.replace(/^<(.*)>$/, "$1"))
}

/** Apply `edits` (each replacing `[from, to)` with `insert`) to `text`, or return
 * `null` when there are none. Applied right-to-left so earlier edits don't shift
 * later offsets; callers never produce overlapping ranges. */
function applyEdits(
  text: string,
  edits: Array<{ from: number; to: number; insert: string }>,
): string | null {
  if (edits.length === 0) return null
  edits.sort((a, b) => b.from - a.from)
  let out = text
  for (const e of edits) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return out
}

export function rewriteLinksForRename(args: RenameRewrite): string | null {
  const { text, notePath, oldPath, newPath, pathsBefore, pathsAfter } = args
  const edits: Array<{ from: number; to: number; insert: string }> = []

  // Markdown inline links: a link whose destination resolves, relative to this
  // note's folder, to the renamed note is re-pointed at its new path.
  for (const { from, to, dest } of markdownLinkDests(text)) {
    if (isExternalDest(dest)) continue
    if (resolveNotePath(notePath, dest) !== oldPath) continue
    edits.push({ from, to, insert: markdownDest(relativeLink(notePath, newPath)) })
  }

  // Wikilinks, via the renderer's `[[…]]` scan (not the CommonMark tree). A link
  // that pointed at the renamed note is re-pointed; bare links keep the shortest
  // unambiguous form (so a folder move that keeps the basename unique needs no
  // rewrite), slashed links keep their full-path form. Detection uses the
  // pre-rename set (the old note still exists there); the new form uses the
  // post-rename set for the ambiguity check.
  for (const w of findWikilinks(text)) {
    const target = w.target.trim()
    if (resolveWikilink(target, pathsBefore).resolved !== oldPath) continue
    const insert = target.includes("/")
      ? displayName(newPath) // slashed → keep a full root-relative path
      : shortestLinkText(newPath, pathsAfter) // bare → bare when unique, else full path
    // No rewrite when the link is already in the form we'd write. `resolveWikilink`
    // is case-insensitive and treats a trailing `.md` as redundant, so strip both
    // before comparing — otherwise a still-valid link written as `[[diablo.md]]`
    // (or differing only in case) would be churned to a different spelling. The
    // comparison must stay on the spelling, not the resolved path: a bare name that
    // now resolves ambiguously still needs promoting to a full path (AC-6).
    const normalizedTarget = target.replace(/\.md$/i, "")
    if (insert.toLowerCase() === normalizedTarget.toLowerCase()) continue
    edits.push({ from: w.targetFrom, to: w.targetTo, insert })
  }

  return applyEdits(text, edits)
}

/**
 * Rebase a moved note's **own** outbound markdown links so they still point at the
 * same targets from its new location (FEAT-0041), returning the new text or `null`
 * when nothing changed. When a note moves to a different folder, its relative
 * markdown destinations (resolved relative to the *old* folder) would otherwise
 * point at the wrong place; each is recomputed as the relative path from the new
 * folder to the same target. A pure rename within the same folder changes nothing
 * (every destination still resolves identically), so this returns `null`.
 * Wikilinks are untouched — they resolve by basename / from the root, independent
 * of where the linking note lives. External and non-note links are left as-is.
 */
export function rebaseOutboundLinks(
  text: string,
  oldPath: string,
  newPath: string,
): string | null {
  const edits: Array<{ from: number; to: number; insert: string }> = []
  for (const { from, to, dest } of markdownLinkDests(text)) {
    if (isExternalDest(dest)) continue
    const resolved = resolveNotePath(oldPath, dest) // where it pointed from the old location
    if (resolved === null) continue // not an in-tree note link (escapes root / not .md)
    // A self-link (the moved note links to itself) follows the note: its target is
    // the new path, not the stale old one — otherwise it would be rebased to the
    // old location and dangle.
    const target = resolved === oldPath ? newPath : resolved
    if (resolveNotePath(newPath, dest) === target) continue // still resolves from the new location
    edits.push({ from, to, insert: markdownDest(relativeLink(newPath, target)) })
  }
  return applyEdits(text, edits)
}
