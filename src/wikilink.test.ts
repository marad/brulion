import { describe, it, expect } from "vitest"
import { shortestLinkText, findWikilinkAt, computeWikilinkToggle } from "./wikilink"

const VAULT = new Set(["start.md", "diablo.md", "projects/journal.md", "work/todo.md", "home/todo.md"])

describe("shortestLinkText", () => {
  it("uses the bare name when the basename is unique (nested note)", () => {
    expect(shortestLinkText("projects/journal.md", VAULT)).toBe("journal")
  })

  it("uses the bare name for a root-level note", () => {
    expect(shortestLinkText("diablo.md", VAULT)).toBe("diablo")
  })

  it("uses the full path when the basename is ambiguous", () => {
    expect(shortestLinkText("work/todo.md", VAULT)).toBe("work/todo")
    expect(shortestLinkText("home/todo.md", VAULT)).toBe("home/todo")
  })
})

describe("findWikilinkAt", () => {
  it("returns the link whose span contains pos, with target/alias sub-ranges", () => {
    const text = "see [[projects/journal|notes]] here"
    const found = findWikilinkAt(text, 10)!
    expect(found.from).toBe(4)
    expect(found.to).toBe(text.indexOf("]]") + 2)
    expect(found.target).toBe("projects/journal")
    expect(text.slice(found.targetFrom, found.targetTo)).toBe("projects/journal")
    expect(found.alias).toBe("notes")
  })

  it("returns null when pos is outside any wikilink", () => {
    expect(findWikilinkAt("see [[journal]] here", 1)).toBeNull()
    expect(findWikilinkAt("no links here", 5)).toBeNull()
  })

  it("matches at the edges of the span (inclusive)", () => {
    const text = "[[diablo]]"
    expect(findWikilinkAt(text, 0)).not.toBeNull()
    expect(findWikilinkAt(text, text.length)).not.toBeNull()
  })
})

describe("computeWikilinkToggle", () => {
  it("offers 'Use full path' for a name-only link to a unique nested note", () => {
    const text = "[[journal]]"
    const t = computeWikilinkToggle(text, 4, VAULT)!
    expect(t.label).toBe("Use full path")
    expect(t.insert).toBe("projects/journal")
    expect(text.slice(0, t.from) + t.insert + text.slice(t.to)).toBe("[[projects/journal]]")
  })

  it("offers 'Use name only' for a full-path link, and back", () => {
    const text = "[[projects/journal]]"
    const t = computeWikilinkToggle(text, 5, VAULT)!
    expect(t.label).toBe("Use name only")
    expect(t.insert).toBe("journal")
    expect(text.slice(0, t.from) + t.insert + text.slice(t.to)).toBe("[[journal]]")
  })

  it("rewrites only the target, preserving the alias (AC-11)", () => {
    const text = "[[projects/journal|My notes]]"
    const t = computeWikilinkToggle(text, 5, VAULT)!
    expect(text.slice(0, t.from) + t.insert + text.slice(t.to)).toBe("[[journal|My notes]]")
  })

  it("returns null for a root-level note (forms are equal — AC-12)", () => {
    expect(computeWikilinkToggle("[[diablo]]", 4, VAULT)).toBeNull()
  })

  it("returns null for an ambiguous basename (name-only would retarget — AC-12)", () => {
    expect(computeWikilinkToggle("[[work/todo]]", 5, VAULT)).toBeNull()
  })

  it("returns null for a dangling link (no note to canonicalize — AC-12)", () => {
    expect(computeWikilinkToggle("[[ghost]]", 4, VAULT)).toBeNull()
  })

  it("returns null when pos is not on a wikilink", () => {
    expect(computeWikilinkToggle("plain text", 3, VAULT)).toBeNull()
  })
})
