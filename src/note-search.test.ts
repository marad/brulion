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

describe("ranking (FEAT-0038)", () => {
  it("AC-1: a contiguous substring outranks a scattered match, even when deeper", () => {
    // "2026" is a contiguous run in the deep path and only a scattered
    // subsequence in the shallow one — the deep contiguous match must win.
    const ranked = searchNotes("2026", ["2x0x2x6.md", "x/y/z/report-2026.md"])
    expect(ranked.matches[0]).toBe("x/y/z/report-2026.md")
  })

  it("AC-2: folder depth does not lower a match's score", () => {
    // The same name matched at the root vs four folders deep scores identically.
    expect(fuzzyScore("week", "Week")).toBe(fuzzyScore("week", "a/b/c/Week"))
  })

  it("AC-3: the contiguous run is found, not the first greedy alignment", () => {
    // The query's chars appear early-scattered (a-b-c) and later-contiguous (abc).
    // The score must reflect the contiguous run — equal to the plain substring
    // score (both runs begin at a segment boundary: string start vs after "-").
    const score = fuzzyScore("abc", "a-b-c-abc")
    expect(score).toBe(fuzzyScore("abc", "abc"))
  })

  it("AC-3: best alignment, not greedy, within the subsequence tier", () => {
    // Neither target contains "ab" contiguously, so both fall to the DP tier. The
    // first has a second 'a' closer to the 'b' (a tighter alignment the greedy
    // left-to-right matcher would miss), so it must score strictly higher.
    expect(fuzzyScore("ab", "a x a b")!).toBeGreaterThan(fuzzyScore("ab", "a x x x b")!)
  })

  it("AC-4: a segment-start run beats a mid-token run", () => {
    // "bar" begins a segment in "x/bar" (after "/") but is buried in "foobar".
    const ranked = searchNotes("bar", ["foobar.md", "x/bar.md"])
    expect(ranked.matches).toEqual(["x/bar.md", "foobar.md"])
  })

  it("AC-5: stays total — null for a non-subsequence, 0 for empty", () => {
    expect(fuzzyScore("xyz", "abc")).toBeNull()
    expect(fuzzyScore("", "anything")).toBe(0)
  })
})
