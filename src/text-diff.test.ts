import { describe, it, expect } from "vitest"
import { diffRange } from "./text-diff"

// Apply a TextChange the way CodeMirror would, to assert the result reconstructs `next`.
const apply = (old: string, c: { from: number; to: number; insert: string }) =>
  old.slice(0, c.from) + c.insert + old.slice(c.to)

describe("diffRange (FEAT-0067 AC-3)", () => {
  it("returns null for identical strings", () => {
    expect(diffRange("", "")).toBeNull()
    expect(diffRange("hello world", "hello world")).toBeNull()
  })

  it("isolates a changed middle span (common prefix + suffix)", () => {
    const old = "the quick brown fox"
    const next = "the slow brown fox"
    const c = diffRange(old, next)!
    expect(c).toEqual({ from: 4, to: 9, insert: "slow" })
    expect(apply(old, c)).toBe(next)
  })

  it("handles a pure insertion in the middle", () => {
    const old = "abcfgh"
    const next = "abcdefgh"
    const c = diffRange(old, next)!
    expect(c.from).toBe(3)
    expect(c.to).toBe(3) // nothing removed
    expect(c.insert).toBe("de")
    expect(apply(old, c)).toBe(next)
  })

  it("handles a pure deletion in the middle", () => {
    const old = "abcdefgh"
    const next = "abcfgh"
    const c = diffRange(old, next)!
    expect(c.insert).toBe("") // nothing inserted
    expect(apply(old, c)).toBe(next)
  })

  it("handles an append at the end (prefix only)", () => {
    const old = "hello"
    const next = "hello, world"
    const c = diffRange(old, next)!
    expect(c).toEqual({ from: 5, to: 5, insert: ", world" })
    expect(apply(old, c)).toBe(next)
  })

  it("handles a prepend at the start (suffix only)", () => {
    const old = "world"
    const next = "hello world"
    const c = diffRange(old, next)!
    expect(c).toEqual({ from: 0, to: 0, insert: "hello " })
    expect(apply(old, c)).toBe(next)
  })

  it("handles a full replace with no common prefix or suffix", () => {
    const old = "abc"
    const next = "xyz"
    const c = diffRange(old, next)!
    expect(c).toEqual({ from: 0, to: 3, insert: "xyz" })
    expect(apply(old, c)).toBe(next)
  })

  it("handles empty <-> non-empty", () => {
    expect(apply("", diffRange("", "seeded")!)).toBe("seeded")
    expect(apply("gone", diffRange("gone", "")!)).toBe("")
  })

  it("does not let an overlapping run be counted in both prefix and suffix", () => {
    // "aaaa" -> "aa": the shared 'a's must be split between prefix and suffix without
    // double-counting (from <= to, total kept <= shorter length).
    const old = "aaaa"
    const next = "aa"
    const c = diffRange(old, next)!
    expect(c.from).toBeLessThanOrEqual(c.to)
    expect(c.from + (old.length - c.to)).toBeLessThanOrEqual(next.length)
    expect(apply(old, c)).toBe(next)
  })

  it("only the differing middle is touched on a realistic multi-line edit", () => {
    const old = "# Title\n\nfirst line\nsecond line\nthird line\n"
    const next = "# Title\n\nfirst line\nSECOND line\nthird line\n"
    const c = diffRange(old, next)!
    // The change must sit inside the second line, not span the whole doc.
    expect(c.from).toBeGreaterThan("# Title\n\nfirst line\n".length - 1)
    expect(apply(old, c)).toBe(next)
  })
})
