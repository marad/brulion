/**
 * The pure note-path↔hash codec for the open-note URL route (FEAT-0036/0098).
 * A note path mirrors into `#/segment/segment`, with the `.md` extension
 * dropped and each path segment individually percent-encoded. A local section
 * anchor may follow the route as a second fragment: `#/note#section`.
 *
 * The first `#` belongs to the browser's fragment URL; the optional second `#`
 * is Brulion's route delimiter. Note path segments encode literal `#` as
 * `%23`, so the delimiter remains unambiguous. No DOM/History/FSA dependency.
 */

import { displayName } from "./note-name"

export interface NoteRoute {
  path: string
  anchor: string | null
}

/**
 * Encode a folder-relative note path to its hash route. Drops the `.md`
 * extension (via {@link displayName}), percent-encodes each `/`-separated
 * segment, and optionally appends an encoded local heading anchor.
 *
 * `start.md` → `#/start`; `note.md`, `Section two` → `#/note#Section%20two`.
 */
export function pathToHash(path: string, anchor: string | null = null): string {
  const route = "#/" + displayName(path).split("/").map(encodeURIComponent).join("/")
  return anchor === null ? route : `${route}#${encodeURIComponent(anchor)}`
}

/**
 * Decode a hash route to its folder-relative note path and optional local
 * anchor. Returns `null` for malformed routes, empty segments, traversal, or
 * malformed/empty anchor escapes. Legacy `#/path` routes return `anchor: null`.
 */
export function hashToRoute(hash: string): NoteRoute | null {
  if (!hash.startsWith("#/")) return null
  const rawRoute = hash.slice(2)
  const delimiter = rawRoute.indexOf("#")
  const rawPath = delimiter === -1 ? rawRoute : rawRoute.slice(0, delimiter)
  const rawAnchor = delimiter === -1 ? null : rawRoute.slice(delimiter + 1)
  if (rawPath === "" || rawAnchor === "") return null

  const segments: string[] = []
  for (const segment of rawPath.split("/")) {
    if (segment === "") return null // empty interior/trailing segment
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null // malformed %-escape
    }
    if (decoded === "" || decoded === "." || decoded === ".." || decoded.includes("/")) {
      return null // empty, traversal, or a smuggled separator
    }
    segments.push(decoded)
  }

  let anchor: string | null = null
  if (rawAnchor !== null) {
    try {
      anchor = decodeURIComponent(rawAnchor)
    } catch {
      return null
    }
    if (anchor === "") return null
  }

  return { path: segments.join("/") + ".md", anchor }
}

/** Decode a hash route to its note path, ignoring its optional anchor. */
export function hashToPath(hash: string): string | null {
  return hashToRoute(hash)?.path ?? null
}
