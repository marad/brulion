import { parser } from "@lezer/markdown"
import {
  displayName,
  isExternalLink,
  resolveNotePath,
  resolveWikilink,
} from "./note-name"
import { shortestLinkText } from "./wikilink"
import { WIKILINK_RE } from "./wikilink"

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

/** A markdown link destination for `rel`: wrapped in CommonMark's `<…>` form when
 * it contains a space or parenthesis (which would otherwise break a bare
 * destination), else `rel` as-is. Our paths never contain `<`/`>` — `normalizeNoteName`
 * rejects them — so the angle-bracket form is always safe. */
function markdownDest(rel: string): string {
  return /[ ()]/.test(rel) ? `<${rel}>` : rel
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
export function rewriteLinksForRename(args: RenameRewrite): string | null {
  const { text, notePath, oldPath, newPath, pathsBefore, pathsAfter } = args
  const edits: Array<{ from: number; to: number; insert: string }> = []

  // Markdown inline links, via the CommonMark grammar (the same grammar the
  // renderer uses, so detection matches what the user sees). Only `Link` nodes —
  // never `Image` — and only those with an inline `URL` child (reference/shortcut
  // links have none). A link whose destination resolves, relative to this note's
  // folder, to the renamed note is re-pointed at its new path.
  parser.parse(text).iterate({
    enter(node) {
      if (node.name !== "Link") return
      const url = node.node.getChild("URL")
      if (!url) return
      const dest = text.slice(url.from, url.to)
      const bare = dest.replace(/^<(.*)>$/, "$1") // unwrap CommonMark's <…> for the scheme check
      if (isExternalLink(bare)) return
      if (resolveNotePath(notePath, dest) !== oldPath) return
      edits.push({ from: url.from, to: url.to, insert: markdownDest(relativeLink(notePath, newPath)) })
    },
  })

  // Wikilinks, via the renderer's `[[…]]` scan (not the CommonMark tree). A link
  // that pointed at the renamed note is re-pointed; bare links keep the shortest
  // unambiguous form (so a folder move that keeps the basename unique needs no
  // rewrite), slashed links keep their full-path form. Detection uses the
  // pre-rename set (the old note still exists there); the new form uses the
  // post-rename set for the ambiguity check.
  const re = new RegExp(WIKILINK_RE.source, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const rawTarget = m[1]
    const target = rawTarget.trim()
    if (resolveWikilink(target, pathsBefore).resolved !== oldPath) continue
    const insert = target.includes("/")
      ? displayName(newPath) // slashed → keep a full root-relative path
      : shortestLinkText(newPath, pathsAfter) // bare → bare when unique, else full path
    // No rewrite when the link already names the new note. `resolveWikilink` is
    // case-insensitive, so a bare name differing only in case still resolves —
    // compare case-insensitively to avoid churning a link a folder move left valid.
    if (insert.toLowerCase() === target.toLowerCase()) continue
    const from = m.index + 2 // past the opening `[[`
    edits.push({ from, to: from + rawTarget.length, insert })
  }

  if (edits.length === 0) return null
  // Apply right-to-left so earlier edits don't shift later offsets.
  edits.sort((a, b) => b.from - a.from)
  let out = text
  for (const e of edits) out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  return out
}
