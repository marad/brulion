import { describe, it, expect, vi, afterEach } from "vitest"
import { resolveFontChoices, PRESET_FONTS } from "./font-access"

// FEAT-0048 — selectable font families. queryLocalFonts is a Chromium-only
// global not present in the TS DOM lib, so it's assigned through `unknown` and
// removed after each test to keep the global clean.

type QueryLocalFonts = () => Promise<Array<{ family: string }>>

const setQueryLocalFonts = (fn: unknown) => {
  ;(window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts = fn
}

const clearQueryLocalFonts = () => {
  delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts
}

afterEach(() => {
  clearQueryLocalFonts()
})

describe("FEAT-0048 resolveFontChoices", () => {
  it("AC-7a: local fonts are deduped and case-insensitively sorted", async () => {
    const query: QueryLocalFonts = vi.fn().mockResolvedValue([
      { family: "Menlo" },
      { family: "Arial" },
      { family: "Menlo" },
    ])
    setQueryLocalFonts(query)

    const result = await resolveFontChoices()

    expect(result.source).toBe("local")
    expect(result.families).toEqual(["Arial", "Menlo"])
  })

  it("AC-7b: absent API falls back to the preset list", async () => {
    clearQueryLocalFonts()

    const result = await resolveFontChoices()

    expect(result.source).toBe("preset")
    expect(result.families).toEqual(PRESET_FONTS)
  })

  it("AC-7c: a rejected/denied query falls back to the preset list without throwing", async () => {
    const query: QueryLocalFonts = vi
      .fn()
      .mockRejectedValue(new Error("permission denied"))
    setQueryLocalFonts(query)

    const result = await resolveFontChoices()

    expect(result.source).toBe("preset")
    expect(result.families).toEqual(PRESET_FONTS)
  })

  it("AC-7d: an empty local result is still local (empty families)", async () => {
    const query: QueryLocalFonts = vi.fn().mockResolvedValue([])
    setQueryLocalFonts(query)

    const result = await resolveFontChoices()

    expect(result.source).toBe("local")
    expect(result.families).toEqual([])
  })
})
