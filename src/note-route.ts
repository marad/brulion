/**
 * The pure path↔hash codec for the open-note URL route (FEAT-0036). A note's
 * folder-relative path mirrors into the location hash as `#/segment/segment`,
 * with the `.md` extension dropped and each path segment individually
 * percent-encoded. No DOM/History/FSA dependency — so the round-trip that the
 * navigation wiring leans on is unit-tested directly.
 *
 * The two functions are total inverses for any path the app produces (a path
 * always ends in a lowercase `.md` — see {@link normalizeNoteName}), so
 * encode-then-decode returns the original path unchanged.
 */

/**
 * Encode a folder-relative note path to its hash route. Strips a trailing `.md`
 * (case-insensitive), percent-encodes each `/`-separated segment, and prefixes
 * `#/`. `start.md` → `#/start`; `Allegro/Journal/Week 22.md` →
 * `#/Allegro/Journal/Week%2022`.
 */
export function pathToHash(path: string): string {
  const display = path.replace(/\.md$/i, "")
  return "#/" + display.split("/").map(encodeURIComponent).join("/")
}

/**
 * Decode a hash route back to a folder-relative note path, or `null` when the
 * hash is not a well-formed route. Rejects (returns `null`) a hash that does not
 * start with `#/`, an empty route (`#/`), any empty segment (`#/a//b`, a trailing
 * slash), and a segment with a malformed `%`-escape. A decoded route gains the
 * `.md` extension back.
 */
export function hashToPath(hash: string): string | null {
  if (!hash.startsWith("#/")) return null
  const raw = hash.slice(2)
  if (raw === "") return null
  const segments: string[] = []
  for (const segment of raw.split("/")) {
    if (segment === "") return null // empty interior/trailing segment — not a real path
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch {
      return null // malformed %-escape
    }
    if (decoded === "") return null
    segments.push(decoded)
  }
  return segments.join("/") + ".md"
}
