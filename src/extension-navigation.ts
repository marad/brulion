import {
  isExternalLink,
  normalizeNoteName,
  resolveNotePath,
  resolveWikilink,
  splitAnchor,
} from "./note-name"

/** Public navigation result and resolver contracts for M43. */

export interface ActiveNote {
  /** Canonical folder-relative POSIX path, including `.md`. */
  path: string
}

export interface OpenNoteOptions {
  /** Heading slug without the leading `#`. */
  anchor?: string
}

export type AnchorStatus = "not-requested" | "found" | "not-found"

export type OpenNoteResult =
  | {
      status: "opened" | "already-open"
      path: string
      anchor: string | null
      anchorStatus: AnchorStatus
    }
  | { status: "missing"; path: string; anchor: string | null }
  | { status: "conflict"; path: string }

export type LinkKind = "markdown" | "wikilink"

export interface ResolveLinkOptions {
  /** Source note path; defaults to the active note when omitted. */
  from?: string
  /** The target syntax being resolved; no syntax guessing. */
  kind: LinkKind
}

export type LinkResolution =
  | { status: "resolved"; path: string; anchor: string | null }
  | { status: "missing"; path: string; anchor: string | null }
  | { status: "external"; target: string }
  | { status: "invalid"; target: string }

/** Application callbacks injected into one host runner; each may reject when its vault is gone. */
export interface ExtensionNavigationCapabilities {
  getActiveNote: () => Promise<ActiveNote | null>
  openNote: (path: string, options?: OpenNoteOptions) => Promise<OpenNoteResult>
  resolveLink: (target: string, options: ResolveLinkOptions) => Promise<LinkResolution>
}

export interface NavigationResolutionContext {
  activeNote: string | null
  notePaths: ReadonlySet<string>
}

/** Resolve one explicit markdown or wikilink destination against a fresh vault snapshot. */
export function resolveNavigationLink(
  target: string,
  options: ResolveLinkOptions,
  context: NavigationResolutionContext,
): LinkResolution {
  const invalid = (): LinkResolution => ({ status: "invalid", target })
  const trimmed = target.trim()

  // External destinations keep their original fragment and do not need an
  // active note. Check before splitAnchor: a URL's `#fragment` is not a note
  // anchor, matching the editor's existing markdown-link rule.
  if (isExternalLink(trimmed)) return { status: "external", target }

  if (options.kind === "markdown") {
    const { path: rawPath, anchor } = splitAnchor(trimmed)
    const sourceInput = options.from ?? context.activeNote
    const source = sourceInput ? normalizeNoteName(sourceInput) : null
    if (!source?.ok) return invalid()

    if (rawPath === "") {
      if (anchor === null) return invalid()
      const path = source.filename
      return context.notePaths.has(path)
        ? { status: "resolved", path, anchor }
        : { status: "missing", path, anchor }
    }
    if (rawPath.startsWith("/")) return invalid()

    const resolved = resolveNotePath(source.filename, rawPath)
    if (!resolved) return invalid()
    const canonical = normalizeNoteName(resolved)
    if (!canonical.ok) return invalid()
    return context.notePaths.has(canonical.filename)
      ? { status: "resolved", path: canonical.filename, anchor }
      : { status: "missing", path: canonical.filename, anchor }
  }

  if (options.kind === "wikilink") {
    const { path: rawPath, anchor } = splitAnchor(trimmed)
    if (rawPath === "") {
      if (anchor === null) return invalid()
      const sourceInput = options.from ?? context.activeNote
      const source = sourceInput ? normalizeNoteName(sourceInput) : null
      if (!source?.ok) return invalid()
      return context.notePaths.has(source.filename)
        ? { status: "resolved", path: source.filename, anchor }
        : { status: "missing", path: source.filename, anchor }
    }

    const canonicalTarget = normalizeNoteName(rawPath)
    if (!canonicalTarget.ok) return invalid()
    const wikilink = resolveWikilink(canonicalTarget.filename, context.notePaths)
    const path = normalizeNoteName(wikilink.createPath)
    if (!path.ok) return invalid()
    return wikilink.resolved
      ? { status: "resolved", path: wikilink.resolved, anchor }
      : { status: "missing", path: path.filename, anchor }
  }

  return invalid()
}
