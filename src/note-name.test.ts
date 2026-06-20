import { describe, it, expect } from "vitest"
import { normalizeNoteName } from "./note-name"

describe("normalizeNoteName (AC-10)", () => {
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

describe("normalizeNoteName rejection (AC-11)", () => {
  it("rejects an empty or whitespace-only name", () => {
    expect(normalizeNoteName("   ").ok).toBe(false)
    expect(normalizeNoteName("").ok).toBe(false)
  })

  it("rejects a bare extension with no base name", () => {
    expect(normalizeNoteName(".md").ok).toBe(false)
  })

  it("rejects names containing a path separator", () => {
    expect(normalizeNoteName("notes/diablo").ok).toBe(false)
    expect(normalizeNoteName("a\\b").ok).toBe(false)
  })

  it("rejects names with filename-unsafe characters", () => {
    for (const bad of ['a<b', 'a>b', 'a:b', 'a"b', "a|b", "a?b", "a*b"]) {
      expect(normalizeNoteName(bad).ok).toBe(false)
    }
  })
})
