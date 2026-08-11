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
  void target
  void options
  void context
  throw new Error("resolveNavigationLink stub")
}
