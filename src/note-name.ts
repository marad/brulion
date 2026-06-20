/**
 * Turn a free-form name the user typed (e.g. `Diablo builds`) into a safe
 * `.md` filename, or reject it. Pure — no File System Access / DOM dependency —
 * so the one place a bad name could corrupt the folder is unit-tested directly.
 */

export type NormalizeResult =
  | { ok: true; filename: string }
  | { ok: false; reason: string }

/** Path separators plus the Windows-reserved punctuation set. Spaces and
 * hyphens are deliberately allowed — `Diablo builds.md` is a valid note name.
 * Control characters are rejected separately (see {@link hasControlChar}) so
 * this source stays plain ASCII with no embedded control bytes. */
const UNSAFE = /[/\\<>:"|?*]/

/** True if `s` contains any C0 control character (U+0000–U+001F). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 0x20) return true
  }
  return false
}

/**
 * Normalize `input` to a single-extension `.md` filename. Trims surrounding
 * whitespace; rejects empty/whitespace-only names and names containing unsafe
 * characters; ensures exactly one `.md` extension (case-normalized), so a name
 * the user already typed with `.md` is not given a second one.
 */
export function normalizeNoteName(input: string): NormalizeResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: "Name cannot be empty." }
  if (UNSAFE.test(trimmed) || hasControlChar(trimmed)) {
    return { ok: false, reason: 'Name cannot contain / \\ < > : " | ? * or control characters.' }
  }

  const base = trimmed.replace(/\.md$/i, "").trim()
  if (!base) return { ok: false, reason: "Name cannot be empty." }
  return { ok: true, filename: `${base}.md` }
}

/** The user-facing label for a note filename: the name without its `.md`
 * extension (the file on disk keeps it). One definition so the list, the
 * delete prompt, and any other surface always show the same thing. */
export function displayName(filename: string): string {
  return filename.replace(/\.md$/i, "")
}
