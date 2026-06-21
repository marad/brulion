import { describe, it, expect } from "vitest"
import { fuzzyScore, searchNotes } from "./note-search"

describe("fuzzyScore (FEAT-0033 AC-2)", () => {
  it("returns a number when the query is a subsequence of the target", () => {
    expect(typeof fuzzyScore("dia", "Diablo builds")).toBe("number")
  })

  it("returns null when the query is not a subsequence", () => {
    expect(fuzzyScore("xyz", "Diablo builds")).toBeNull()
  })

  it("scores an empty query as 0 (matches everything)", () => {
    expect(fuzzyScore("", "anything")).toBe(0)
  })

  it("is case-insensitive", () => {
    expect(fuzzyScore("DIAB", "diablo")).not.toBeNull()
    expect(fuzzyScore("diab", "DIABLO")).not.toBeNull()
  })

  it("scores a contiguous/earlier match higher than a scattered/later one", () => {
    // "diab" is a contiguous run at the very start of "diablo"; in "media bar"
    // the same letters are scattered (d-i-a-b spread out, and later). Assert the
    // ordering, not the magnitudes.
    const contiguous = fuzzyScore("diab", "diablo")
    const scattered = fuzzyScore("diab", "media bar")
    expect(contiguous).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(contiguous!).toBeGreaterThan(scattered!)
  })
})

describe("searchNotes (FEAT-0033 AC-2)", () => {
  const paths = ["start.md", "projects/diablo.md", "ideas.md"]

  it("empty query → all paths in name (path asc) order, create null", () => {
    const result = searchNotes("", paths)
    expect(result.matches).toEqual(["ideas.md", "projects/diablo.md", "start.md"])
    expect(result.create).toBeNull()
  })

  it("a whitespace-only query is treated as empty (all paths, create null)", () => {
    const result = searchNotes("   ", paths)
    expect(result.matches).toEqual(["ideas.md", "projects/diablo.md", "start.md"])
    expect(result.create).toBeNull()
  })

  it("a fuzzy query returns the matches best-first and excludes non-matches", () => {
    // "ia" is a subsequence of "diablo" and "ideas" but not "start".
    const result = searchNotes("ia", paths)
    expect(result.matches).toContain("projects/diablo.md")
    expect(result.matches).toContain("ideas.md")
    expect(result.matches).not.toContain("start.md")
  })

  it("matches over the display form (.md stripped) and case-insensitively", () => {
    // "DIABLO" only matches if the ".md" is stripped and case is ignored.
    const result = searchNotes("DIABLO", paths)
    expect(result.matches).toContain("projects/diablo.md")
    expect(result.matches).not.toContain("start.md")
  })

  it("ranks a contiguous match ahead of a scattered one", () => {
    // "ab" is contiguous in "able" (a-b at the start) but scattered in
    // "a x b" (a…b with a gap). The contiguous hit must sort first. Paths are
    // given in the reverse of the expected order to prove it's score-driven,
    // not input-order driven.
    const ranked = searchNotes("ab", ["a x b.md", "able.md"])
    expect(ranked.matches).toEqual(["able.md", "a x b.md"])
  })

  it("a query naming an existing note (bare) → create null, note in matches", () => {
    // "ideas" normalizes to "ideas.md" which exists → offer to open, not create.
    const result = searchNotes("ideas", paths)
    expect(result.create).toBeNull()
    expect(result.matches).toContain("ideas.md")
  })

  it("a query naming an existing pathed note → create null, note in matches", () => {
    // "projects/diablo" normalizes to "projects/diablo.md" which exists.
    const result = searchNotes("projects/diablo", paths)
    expect(result.create).toBeNull()
    expect(result.matches).toContain("projects/diablo.md")
  })

  it("a valid new name → create equals the trimmed query; matches excludes it", () => {
    const result = searchNotes("  newnote ", paths)
    expect(result.create).toBe("newnote")
    expect(result.matches).not.toContain("newnote.md")
  })

  it("an invalid name matching nothing → create equals the trimmed query anyway", () => {
    // ".." is rejected by normalizeNoteName (a `.`/`..` path segment), and is not
    // a subsequence of any display form. create is still offered so the UI can
    // attempt it and surface the validation error from the create path.
    const result = searchNotes("  .. ", paths)
    expect(result.matches).toEqual([])
    expect(result.create).toBe("..")
  })
})
