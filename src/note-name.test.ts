import { describe, it, expect } from "vitest"
import { normalizeNoteName } from "./note-name"

describe("normalizeNoteName bare name (AC-9)", () => {
  it("trims and appends a .md extension when absent", () => {
    expect(normalizeNoteName("  Diablo builds  ")).toEqual({
      ok: true,
      filename: "Diablo builds.md",
    })
  })

  it("does not double the extension when the name already ends in .md", () => {
    expect(normalizeNoteName("notes.md")).toEqual({ ok: true, filename: "notes.md" })
  })

  it("normalizes the extension case (.MD → .md), not doubling it", () => {
    expect(normalizeNoteName("Recipe.MD")).toEqual({ ok: true, filename: "Recipe.md" })
  })
})

describe("normalizeNoteName pathed name (AC-9)", () => {
  it("normalizes a folder path, .md on the last segment only", () => {
    expect(normalizeNoteName("  projects/Diablo builds  ")).toEqual({
      ok: true,
      filename: "projects/Diablo builds.md",
    })
  })

  it("trims each segment", () => {
    expect(normalizeNoteName("a / b / c")).toEqual({ ok: true, filename: "a/b/c.md" })
  })

  it("does not double the extension on a pathed name", () => {
    expect(normalizeNoteName("sub/notes.md")).toEqual({ ok: true, filename: "sub/notes.md" })
  })

  it("handles a deep path", () => {
    expect(normalizeNoteName("a/b/c/deep")).toEqual({ ok: true, filename: "a/b/c/deep.md" })
  })
})

describe("normalizeNoteName rejection (AC-10)", () => {
  it("rejects an empty or whitespace-only name", () => {
    expect(normalizeNoteName("   ").ok).toBe(false)
    expect(normalizeNoteName("").ok).toBe(false)
  })

  it("rejects a bare extension with no base name", () => {
    expect(normalizeNoteName(".md").ok).toBe(false)
    expect(normalizeNoteName("sub/.md").ok).toBe(false)
  })

  it("rejects a . or .. segment (no escaping the root)", () => {
    expect(normalizeNoteName("..").ok).toBe(false)
    expect(normalizeNoteName("../secrets").ok).toBe(false)
    expect(normalizeNoteName("a/../b").ok).toBe(false)
    expect(normalizeNoteName("./a").ok).toBe(false)
    expect(normalizeNoteName("a/.").ok).toBe(false)
  })

  it("rejects empty segments (leading, trailing, or doubled slash)", () => {
    expect(normalizeNoteName("/a").ok).toBe(false)
    expect(normalizeNoteName("a/").ok).toBe(false)
    expect(normalizeNoteName("a//b").ok).toBe(false)
  })

  it("rejects a backslash or other filename-unsafe character in any segment", () => {
    expect(normalizeNoteName("a\\b").ok).toBe(false)
    for (const bad of ["a<b", "a>b", "a:b", 'a"b', "a|b", "a?b", "a*b"]) {
      expect(normalizeNoteName(bad).ok).toBe(false)
      expect(normalizeNoteName("sub/" + bad).ok).toBe(false)
    }
  })
})
