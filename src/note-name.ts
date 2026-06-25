/**
 * Turn a free-form name the user typed (e.g. `Diablo builds`) into a safe
 * `.md` filename, or reject it. Pure — no File System Access / DOM dependency —
 * so the one place a bad name could corrupt the folder is unit-tested directly.
 */

export type NormalizeResult =
  | { ok: true; filename: string }
  | { ok: false; reason: string }

/** Filename-unsafe punctuation, checked **per path segment** (the `/` separator
 * is consumed by the split before this runs, so it is not listed here; `\` stays,
 * as a stray Windows separator inside a segment). Spaces and hyphens are
 * deliberately allowed — `Diablo builds.md` is a valid segment. Control
 * characters are rejected separately (see {@link hasControlChar}) so this source
 * stays plain ASCII with no embedded control bytes. */
const UNSAFE = /[\\<>:"|?*]/

/** True if `s` contains any C0 control character (U+0000–U+001F). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 0x20) return true
  }
  return false
}

/**
 * Normalize `input` to a folder-relative `.md` path (FEAT-0023). Trims the input,
 * then splits on `/` into folder segments plus a final note segment. Each segment
 * is trimmed and validated (non-empty, no unsafe/control character); the last
 * segment gets exactly one `.md` extension (case-normalized, never doubled). The
 * `.`/`..` segments are rejected so a normalized path can never escape the folder
 * the user granted — the moat must not let a note be written outside it. A bare
 * name with no `/` behaves exactly as the single-file case did.
 */
export function normalizeNoteName(input: string): NormalizeResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: "Name cannot be empty." }

  const raw = trimmed.split("/")
  const last = raw.length - 1
  const segments: string[] = []
  for (let i = 0; i < raw.length; i++) {
    let segment = raw[i].trim()
    if (i === last) segment = segment.replace(/\.md$/i, "").trim() // strip the extension off the note name only
    if (!segment) return { ok: false, reason: "Name segments cannot be empty." }
    if (segment === "." || segment === "..") {
      return { ok: false, reason: "Name cannot contain . or .. path segments." }
    }
    if (UNSAFE.test(segment) || hasControlChar(segment)) {
      return { ok: false, reason: 'Name cannot contain \\ < > : " | ? * or control characters.' }
    }
    segments.push(segment)
  }

  segments[last] += ".md"
  return { ok: true, filename: segments.join("/") }
}

/** The user-facing label for a note filename: the name without its `.md`
 * extension (the file on disk keeps it). One definition so the list, the
 * delete prompt, and any other surface always show the same thing. */
export function displayName(filename: string): string {
  return filename.replace(/\.md$/i, "")
}

/**
 * Split an *internal* link target into its note path and section anchor (M32/
 * FEAT-0061): everything before the first `#` is the path, everything after is the
 * anchor. `note#sec` → `{ path: "note", anchor: "sec" }`; a bare `#sec` →
 * `{ path: "", anchor: "sec" }` (a same-note jump); no `#`, or an empty/`#`-only
 * fragment → `anchor: null`. Pure. Only call on internal targets — an external URL's
 * `#fragment` is not a note anchor (guard with {@link isExternalLink}).
 */
export function splitAnchor(target: string): { path: string; anchor: string | null } {
  const hash = target.indexOf("#")
  if (hash === -1) return { path: target, anchor: null }
  const anchor = target.slice(hash + 1)
  return { path: target.slice(0, hash), anchor: anchor === "" ? null : anchor }
}

/**
 * Slug of a heading's text for anchor matching (M32/FEAT-0061), GitHub-ish and
 * **Unicode-aware**: lower-cased, punctuation dropped (only letters/numbers/marks
 * `\p{L}\p{N}`, underscore, whitespace, and hyphens survive — so Polish/non-English
 * headings slug correctly and `_` is kept like GitHub), whitespace runs collapsed to
 * single hyphens, leading/trailing hyphens trimmed. `## My Big Heading!` →
 * `my-big-heading`. Pure.
 */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/** True when a link `href` points outside the folder — a `scheme:` URL
 * (`https:`, `mailto:`) or a protocol-relative `//host`. Internal note links are
 * plain relative paths with no scheme (FEAT-0025). */
export function isExternalLink(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")
}

/**
 * Resolve an internal link `href` (a relative path, no scheme) to a
 * folder-relative note path, **relative to the linking note `fromNote`'s own
 * folder** (FEAT-0025). Folds `.`/`..`/empty segments POSIX-style; returns `null`
 * when the path would escape the picked root (a `..` above it) or does not name a
 * markdown note (`.md`). Pure — no DOM/FSA — and can never resolve outside the
 * root (the moat). A surrounding `<>` (CommonMark's wrapper for a url with
 * spaces) is stripped and percent-encoding is decoded first, so a link another
 * tool wrote as `My%20Note.md` (or that the user wrapped as `<My Note.md>`)
 * resolves to the real `My Note.md`. Decoding happens before the `..` check, so
 * an encoded `..%2F` can't sneak past the root guard.
 */
export function resolveNotePath(fromNote: string, href: string): string | null {
  const unwrapped = href.replace(/^<(.*)>$/, "$1")
  let cleaned: string
  try {
    cleaned = decodeURIComponent(unwrapped)
  } catch {
    cleaned = unwrapped // malformed %-escape — use it as-is rather than throwing
  }
  const slash = fromNote.lastIndexOf("/")
  const segments = slash === -1 ? [] : fromNote.slice(0, slash).split("/")
  for (const segment of cleaned.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) return null // escapes the granted root
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  if (segments.length === 0) return null
  const path = segments.join("/")
  return /\.md$/i.test(path) ? path : null
}

/**
 * Resolve a wikilink `target` against the set of known note paths (FEAT-0027).
 * A `target` with no `/` is a **bare name**, matched by basename (the filename,
 * ignoring folders) case-insensitively anywhere in the tree — the low-friction
 * point of a wikilink; ties resolve to the first by the set's order (the listing's
 * sorted order). A `target` with a `/` is a **root-relative path**, matched
 * case-insensitively against the full paths. Returns the matched existing note
 * (`resolved`, or `null` when none) and the `createPath` to use if the user
 * follows a missing link: `name.md` at the root for a bare name, the given path
 * for a slashed one. Pure — no DOM/FSA.
 */
export function resolveWikilink(
  target: string,
  notePaths: ReadonlySet<string>,
): { resolved: string | null; createPath: string } {
  const trimmed = target.trim()
  const createPath = /\.md$/i.test(trimmed) ? trimmed : `${trimmed}.md`
  const wanted = createPath.toLowerCase()
  const matches = trimmed.includes("/")
    ? (path: string) => path.toLowerCase() === wanted // root-relative full path
    : (path: string) => basename(path).toLowerCase() === wanted // bare name → basename
  for (const path of notePaths) {
    if (matches(path)) return { resolved: path, createPath }
  }
  return { resolved: null, createPath }
}

/** The filename of a `/`-separated path (the part after the last `/`). */
function basename(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? path : path.slice(slash + 1)
}
