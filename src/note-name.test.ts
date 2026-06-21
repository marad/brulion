import { describe, it, expect } from "vitest"
import { normalizeNoteName, isExternalLink, resolveNotePath, resolveWikilink } from "./note-name"

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

describe("isExternalLink (FEAT-0025 AC-3)", () => {
  it("treats scheme and protocol-relative urls as external", () => {
    for (const ext of ["https://example.com", "http://x", "mailto:a@b.z", "//cdn/x"]) {
      expect(isExternalLink(ext)).toBe(true)
    }
  })

  it("treats relative note paths as internal", () => {
    for (const rel of ["sub/b.md", "b.md", "../c.md", "./b.md"]) {
      expect(isExternalLink(rel)).toBe(false)
    }
  })
})

describe("resolveNotePath (FEAT-0025 AC-1, AC-2)", () => {
  it("resolves relative to the linking note's folder", () => {
    expect(resolveNotePath("sub/a.md", "b.md")).toBe("sub/b.md")
    expect(resolveNotePath("sub/a.md", "deep/d.md")).toBe("sub/deep/d.md")
    expect(resolveNotePath("a.md", "sub/b.md")).toBe("sub/b.md")
  })

  it("folds . and .. segments", () => {
    expect(resolveNotePath("sub/a.md", "./b.md")).toBe("sub/b.md")
    expect(resolveNotePath("sub/a.md", "../c.md")).toBe("c.md")
    expect(resolveNotePath("a/b/c.md", "../../x.md")).toBe("x.md")
  })

  it("strips surrounding angle brackets (CommonMark url with spaces)", () => {
    expect(resolveNotePath("sub/a.md", "<b c.md>")).toBe("sub/b c.md")
  })

  it("decodes percent-encoding so an encoded space-name resolves", () => {
    expect(resolveNotePath("sub/a.md", "My%20Note.md")).toBe("sub/My Note.md")
  })

  it("still rejects a root escape hidden behind percent-encoding", () => {
    expect(resolveNotePath("a.md", "..%2Fx.md")).toBeNull()
  })

  it("returns null when the link escapes the root", () => {
    expect(resolveNotePath("sub/a.md", "../../x.md")).toBeNull()
    expect(resolveNotePath("a.md", "../x.md")).toBeNull()
  })

  it("returns null for a non-markdown target", () => {
    expect(resolveNotePath("a.md", "b.txt")).toBeNull()
    expect(resolveNotePath("a.md", "b")).toBeNull()
  })
})

describe("resolveWikilink (FEAT-0027 AC-1, AC-2, AC-3)", () => {
  const notes = (paths: string[]) => new Set(paths)

  it("resolves a bare name by basename, case-insensitively (AC-1)", () => {
    expect(resolveWikilink("DiaBlo", notes(["a.md", "projects/diablo.md"]))).toEqual({
      resolved: "projects/diablo.md",
      createPath: "DiaBlo.md",
    })
  })

  it("resolves a slashed name as a root-relative path (AC-2)", () => {
    expect(resolveWikilink("sub/note", notes(["sub/note.md"]))).toEqual({
      resolved: "sub/note.md",
      createPath: "sub/note.md",
    })
  })

  it("returns null resolved with a create path when missing (AC-3)", () => {
    expect(resolveWikilink("missing", notes(["a.md"]))).toEqual({
      resolved: null,
      createPath: "missing.md",
    })
  })

  it("picks the first by sorted order for an ambiguous bare name", () => {
    expect(resolveWikilink("note", notes(["a/note.md", "b/note.md"])).resolved).toBe("a/note.md")
  })
})
