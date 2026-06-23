/**
 * Resolve the set of font families the settings modal (FEAT-0048) offers for
 * selection. Prefers the user's installed fonts via the Local Font Access API
 * (`queryLocalFonts`, Chromium-only, one-time permission — consistent with the
 * FSA-only stance); degrades to a curated cross-OS preset list when the API is
 * absent, denied, or throws. The user always picks from a list — never free-types a
 * family name.
 */

/** The families offered for selection, and whether they came from the local system
 * or the curated fallback. */
export interface FontChoices {
  source: "local" | "preset"
  families: string[]
}

/** A small list of common, widely-installed families used when local enumeration
 * is unavailable. Selection-only, so a missing one simply won't render — the generic
 * floor (FEAT-0047) still applies. */
export const PRESET_FONTS: string[] = [
  "Arial",
  "Consolas",
  "Courier New",
  "Georgia",
  "Menlo",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
]

/**
 * The selectable font families: the installed set via `queryLocalFonts` when
 * available and granted (de-duplicated, case-insensitively sorted), else the
 * {@link PRESET_FONTS}. Never throws — a missing API, a denied permission, or a
 * thrown call all resolve to the preset list.
 */
export async function resolveFontChoices(): Promise<FontChoices> {
  const query = (
    window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }
  ).queryLocalFonts
  if (typeof query !== "function") return { source: "preset", families: PRESET_FONTS }
  try {
    const fonts = await query()
    const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    )
    return { source: "local", families }
  } catch {
    return { source: "preset", families: PRESET_FONTS }
  }
}
