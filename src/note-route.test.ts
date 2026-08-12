import { describe, it, expect } from "vitest"
import { pathToHash, hashToPath, hashToRoute } from "./note-route"

describe("pathToHash", () => {
  it("encodes a root-level note as a bare hash without .md (AC-1)", () => {
    expect(pathToHash("start.md")).toBe("#/start")
  })

  it("percent-encodes each segment and keeps / as the separator (AC-2)", () => {
    expect(pathToHash("Allegro/Journal/Week 22.md")).toBe("#/Allegro/Journal/Week%2022")
  })

  it("strips the .md case-insensitively", () => {
    expect(pathToHash("Notes/Idea.MD")).toBe("#/Notes/Idea")
  })

  it("adds an encoded local anchor without changing path segments", () => {
    expect(pathToHash("Notes/Idea.md", "Section two")).toBe("#/Notes/Idea#Section%20two")
  })
})

describe("hashToPath", () => {
  it("decodes a bare hash to a .md path (AC-3 inverse)", () => {
    expect(hashToPath("#/start")).toBe("start.md")
  })

  it("decodes percent-encoded segments", () => {
    expect(hashToPath("#/Allegro/Journal/Week%2022")).toBe("Allegro/Journal/Week 22.md")
  })

  it("decodes an optional local anchor while keeping the legacy path helper", () => {
    expect(hashToRoute("#/Allegro/Journal/Week%2022#Section%20two")).toEqual({
      path: "Allegro/Journal/Week 22.md",
      anchor: "Section two",
    })
    expect(hashToPath("#/Allegro/Journal/Week%2022#Section%20two")).toBe(
      "Allegro/Journal/Week 22.md",
    )
  })

  it.each([
    ["empty string", ""],
    ["bare hash", "#"],
    ["root only", "#/"],
    ["no #/ prefix", "/start"],
    ["empty interior segment", "#/a//b"],
    ["trailing slash", "#/a/"],
    ["malformed percent-escape", "#/a%2"],
    ["smuggled separator (%2F)", "#/a%2Fb"],
    ["dot-dot traversal", "#/..%2F..%2Fsecret"],
    ["lone dot segment", "#/."],
    ["empty anchor", "#/start#"],
    ["malformed anchor escape", "#/start#bad%2"],
  ])("decodes %s to null (AC-4)", (_label, hash) => {
    expect(hashToPath(hash)).toBeNull()
    expect(hashToRoute(hash)).toBeNull()
  })
})

describe("round-trip (AC-3)", () => {
  it.each(["start.md", "a/b c.md", "Allegro/Journal/Week 22.md", "emoji 🚀/note.md", "a.b.md"])(
    "encode then decode returns %s unchanged",
    (path) => {
      expect(hashToPath(pathToHash(path))).toBe(path)
    },
  )

  it("round-trips a path and anchor together", () => {
    const hash = pathToHash("a/b c.md", "Zażółć gęślą jaźń")
    expect(hashToRoute(hash)).toEqual({ path: "a/b c.md", anchor: "Zażółć gęślą jaźń" })
  })
})
