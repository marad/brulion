import { EditorView } from "@codemirror/view"
import { setVimMode } from "./editor"

/**
 * User preferences (M16): a small, opaque settings model persisted as plain JSON
 * in `.brulion.json` at the open folder's root, so it travels with the vault. The
 * file is the single source of truth — there is no idb cache and no "defaults vs
 * current" concept; before a folder is open the built-in defaults apply.
 *
 * `.brulion.json` is a non-`.md` file, so `listNotes` (which collects only `.md`
 * files) already excludes it from the note list and the M4 poller — this module
 * relies on that filter rather than re-implementing exclusion.
 */

/** The editor's text column width: a preset, mapped to a CSS measure on apply. */
export type EditorWidth = "narrow" | "wider" | "full"

export interface Settings {
  /** Ordered font-family names; empty means "use the built-in default stack". */
  font: string[]
  /** Editor base font size in px; clamped to [MIN_SIZE, MAX_SIZE]. */
  textSize: number
  /** Text column width preset. */
  editorWidth: EditorWidth
  /** Whether opt-in Vim mode is on. */
  vim: boolean
  /** Ordered ids of actions pinned to the header action bar (FEAT-0058); empty by
   * default. Unknown ids are tolerated and ignored when the bar renders. */
  actionBar: string[]
  /** Folder-relative note-path template for the weekly journal (FEAT-0062), with date
   * placeholders (`{mondayOfTheWeek}` etc.); empty (unconfigured) by default. */
  journalPath: string
}

/** The on-disk settings file at the folder root. */
export const SETTINGS_FILE = ".brulion.json"

/** The generic family always appended to a built font stack (the cross-OS floor). */
export const GENERIC_FLOOR = "sans-serif"

export const MIN_SIZE = 12
export const MAX_SIZE = 24

/** Defaults matching today's hard-coded editor: 16px, 68ch measure, the CSS
 * default font stack, Vim off. */
export const DEFAULT_SETTINGS: Settings = {
  font: [],
  textSize: 16,
  editorWidth: "narrow",
  vim: false,
  actionBar: [],
  journalPath: "",
}

/** Each width preset's CSS `max-width` value for the content column. */
export const WIDTH_MEASURE: Record<EditorWidth, string> = {
  narrow: "68ch",
  wider: "90ch",
  full: "none",
}

/**
 * Coerce arbitrary parsed JSON into a valid {@link Settings}: every field falls to
 * its default when missing or wrong-typed; `textSize` is rounded and clamped to
 * [MIN_SIZE, MAX_SIZE]; `editorWidth` must be one of the three literals; `font`
 * keeps only string entries; `vim` is coerced to a boolean. Pure and total — any
 * input yields a valid value, never a throw.
 */
export function normalizeSettings(raw: unknown): Settings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS }
  const r = raw as Record<string, unknown>
  return {
    font: Array.isArray(r.font)
      ? r.font.filter((x): x is string => typeof x === "string" && isSafeFontName(x))
      : [],
    textSize: clampSize(r.textSize),
    editorWidth: isEditorWidth(r.editorWidth) ? r.editorWidth : "narrow",
    vim: Boolean(r.vim),
    actionBar: Array.isArray(r.actionBar) ? dedupeStrings(r.actionBar) : [],
    journalPath: typeof r.journalPath === "string" ? r.journalPath : "",
  }
}

/** Keep only string entries, dropping duplicates (first occurrence wins). Pure. */
function dedupeStrings(values: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (typeof v === "string" && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

/** Round and clamp a candidate text size into [MIN_SIZE, MAX_SIZE]; a non-number
 * (or NaN) falls back to the default. */
function clampSize(value: unknown): number {
  const n = typeof value === "number" ? Math.round(value) : NaN
  if (Number.isNaN(n)) return DEFAULT_SETTINGS.textSize
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, n))
}

function isEditorWidth(value: unknown): value is EditorWidth {
  return value === "narrow" || value === "wider" || value === "full"
}

/** A font-family name safe to emit into the `--font-stack` CSS value: non-empty and
 * free of quote/semicolon/brace/backslash/newline, which could otherwise break the
 * property or inject into the inline style from a hand-edited `.brulion.json`. The
 * P2 font picker only ever supplies real installed-font names, so this only guards
 * a tampered file. */
function isSafeFontName(name: string): boolean {
  return name.length > 0 && !/["\\;{}\n\r]/.test(name)
}

/**
 * Build a CSS `font-family` value from an ordered list: quote families that need
 * it (spaces / non-identifier chars), join in order, and append {@link GENERIC_FLOOR}
 * as the last fallback. An empty list yields the generic floor alone. Pure.
 */
export function buildFontStack(fonts: string[]): string {
  const families = fonts.map((f) => (/^[A-Za-z0-9-]+$/.test(f) ? f : `"${f}"`))
  return [...families, GENERIC_FLOOR].join(", ")
}

/**
 * Read `.brulion.json` from the folder root and return its normalized settings. An
 * absent file or invalid JSON yields {@link DEFAULT_SETTINGS} — never throws.
 */
export async function loadSettings(
  dir: FileSystemDirectoryHandle,
): Promise<Settings> {
  try {
    const handle = await dir.getFileHandle(SETTINGS_FILE)
    const text = await (await handle.getFile()).text()
    return normalizeSettings(JSON.parse(text))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Write `settings` as pretty-printed JSON to `.brulion.json` at the folder root. */
export async function saveSettings(
  dir: FileSystemDirectoryHandle,
  settings: Settings,
): Promise<void> {
  const handle = await dir.getFileHandle(SETTINGS_FILE, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(settings, null, 2))
  await writable.close()
}

/**
 * Apply `settings` to the live editor: set the `--editor-font-size`,
 * `--editor-measure`, and `--font-stack` custom properties on `root` (the font
 * override is removed when `font` is empty, so the stylesheet default applies), and
 * toggle Vim via {@link setVimMode}. Idempotent and reversible — applying the
 * defaults restores the built-in look.
 */
export function applySettings(
  view: EditorView,
  settings: Settings,
  root: HTMLElement = document.documentElement,
): void {
  root.style.setProperty("--editor-font-size", `${settings.textSize}px`)
  root.style.setProperty("--editor-measure", WIDTH_MEASURE[settings.editorWidth])
  if (settings.font.length > 0) {
    root.style.setProperty("--font-stack", buildFontStack(settings.font))
  } else {
    root.style.removeProperty("--font-stack")
  }
  setVimMode(view, settings.vim)
}
