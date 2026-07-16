import { describe, it, expect } from "vitest"
import {
  isTreeActionKey,
  isTypeaheadKey,
  resolveTreeKey,
  treeDepth,
  typeaheadMatch,
  type TreeRow,
} from "./tree-nav"

// Build a visible-row list compactly. Each spec is [path, kind, expanded?];
// depth is derived from the path exactly as the real glue does.
function rows(specs: Array<[string, "note" | "folder", boolean?]>): TreeRow[] {
  return specs.map(([path, kind, expanded = false]) => ({
    path,
    kind,
    expanded,
    depth: treeDepth(path),
  }))
}

describe("treeDepth", () => {
  it("counts path separators (root = 0)", () => {
    expect(treeDepth("a.md")).toBe(0)
    expect(treeDepth("sub")).toBe(0)
    expect(treeDepth("sub/a.md")).toBe(1)
    expect(treeDepth("a/b/c.md")).toBe(2)
  })
})

describe("resolveTreeKey — Down/Up (AC-1, AC-2)", () => {
  const r = rows([
    ["a.md", "note"],
    ["b.md", "note"],
    ["c.md", "note"],
  ])

  it("Down moves to the next row", () => {
    expect(resolveTreeKey("ArrowDown", r, 0)).toEqual({ type: "focus", index: 1 })
  })

  it("Up moves to the previous row", () => {
    expect(resolveTreeKey("ArrowUp", r, 2)).toEqual({ type: "focus", index: 1 })
  })

  it("Down on the last row is a no-op (no wrap, AC-2)", () => {
    expect(resolveTreeKey("ArrowDown", r, 2)).toEqual({ type: "none" })
  })

  it("Up on the first row is a no-op (no wrap, AC-2)", () => {
    expect(resolveTreeKey("ArrowUp", r, 0)).toEqual({ type: "none" })
  })
})

describe("resolveTreeKey — Home/End (AC-6)", () => {
  const r = rows([
    ["a.md", "note"],
    ["b.md", "note"],
    ["c.md", "note"],
  ])

  it("Home jumps to the first row", () => {
    expect(resolveTreeKey("Home", r, 2)).toEqual({ type: "focus", index: 0 })
  })

  it("End jumps to the last row", () => {
    expect(resolveTreeKey("End", r, 0)).toEqual({ type: "focus", index: 2 })
  })

  it("Home on the first / End on the last are no-ops", () => {
    expect(resolveTreeKey("Home", r, 0)).toEqual({ type: "none" })
    expect(resolveTreeKey("End", r, 2)).toEqual({ type: "none" })
  })
})

describe("resolveTreeKey — collapsed folders skipped by the visible list (AC-3)", () => {
  it("Down from a collapsed folder lands on its sibling, not a hidden child", () => {
    // The visible list simply does not contain the collapsed folder's children,
    // so ordinary Down reaches the next sibling — the glue's job is to build the
    // list from visible rows only; the core just walks what it is given.
    const r = rows([
      ["sub", "folder", false], // collapsed — its notes are NOT in the visible list
      ["z.md", "note"],
    ])
    expect(resolveTreeKey("ArrowDown", r, 0)).toEqual({ type: "focus", index: 1 })
  })
})

describe("resolveTreeKey — Right (AC-4)", () => {
  it("Right on a collapsed folder expands it", () => {
    const r = rows([["sub", "folder", false]])
    expect(resolveTreeKey("ArrowRight", r, 0)).toEqual({ type: "expand", index: 0 })
  })

  it("Right on an expanded folder descends to its first child", () => {
    const r = rows([
      ["sub", "folder", true],
      ["sub/a.md", "note"],
    ])
    expect(resolveTreeKey("ArrowRight", r, 0)).toEqual({ type: "focus", index: 1 })
  })

  it("Right on an expanded but empty folder does nothing", () => {
    const r = rows([
      ["sub", "folder", true],
      ["other.md", "note"], // depth 0, not a child of sub
    ])
    expect(resolveTreeKey("ArrowRight", r, 0)).toEqual({ type: "none" })
  })

  it("Right on a note does nothing", () => {
    const r = rows([["a.md", "note"]])
    expect(resolveTreeKey("ArrowRight", r, 0)).toEqual({ type: "none" })
  })
})

describe("resolveTreeKey — Left (AC-5)", () => {
  it("Left on an expanded folder collapses it", () => {
    const r = rows([["sub", "folder", true]])
    expect(resolveTreeKey("ArrowLeft", r, 0)).toEqual({ type: "collapse", index: 0 })
  })

  it("Left on a collapsed folder moves to its parent", () => {
    const r = rows([
      ["sub", "folder", true],
      ["sub/inner", "folder", false],
    ])
    expect(resolveTreeKey("ArrowLeft", r, 1)).toEqual({ type: "focus", index: 0 })
  })

  it("Left on a note moves to its parent folder", () => {
    const r = rows([
      ["sub", "folder", true],
      ["sub/a.md", "note"],
    ])
    expect(resolveTreeKey("ArrowLeft", r, 1)).toEqual({ type: "focus", index: 0 })
  })

  it("Left on a root-level note (no parent) does nothing", () => {
    const r = rows([["a.md", "note"]])
    expect(resolveTreeKey("ArrowLeft", r, 0)).toEqual({ type: "none" })
  })

  it("Left on a collapsed root-level folder does nothing (no parent)", () => {
    const r = rows([["sub", "folder", false]])
    expect(resolveTreeKey("ArrowLeft", r, 0)).toEqual({ type: "none" })
  })

  it("finds the parent across intervening deeper rows", () => {
    // parent of a depth-2 note is the nearest earlier depth-1 row, skipping a
    // depth-2 sibling in between.
    const r = rows([
      ["sub", "folder", true], // depth 0
      ["sub/ideas", "folder", true], // depth 1  <- the parent
      ["sub/ideas/x.md", "note"], // depth 2
      ["sub/ideas/y.md", "note"], // depth 2 (current)
    ])
    expect(resolveTreeKey("ArrowLeft", r, 3)).toEqual({ type: "focus", index: 1 })
  })
})

describe("resolveTreeKey — activate (AC-7)", () => {
  const r = rows([
    ["sub", "folder", false],
    ["a.md", "note"],
  ])

  it("Enter activates the focused row", () => {
    expect(resolveTreeKey("Enter", r, 1)).toEqual({ type: "activate", index: 1 })
  })

  it("Space activates the focused row", () => {
    expect(resolveTreeKey(" ", r, 0)).toEqual({ type: "activate", index: 0 })
  })
})

describe("resolveTreeKey — F2 rename (FEAT-0076)", () => {
  it("F2 on a note row resolves to rename", () => {
    const r = rows([["a.md", "note"]])
    expect(resolveTreeKey("F2", r, 0)).toEqual({ type: "rename", index: 0 })
  })

  it("F2 on a folder header resolves to rename", () => {
    const r = rows([["sub", "folder", false]])
    expect(resolveTreeKey("F2", r, 0)).toEqual({ type: "rename", index: 0 })
  })

  it("F2 with an out-of-range index does nothing", () => {
    const r = rows([["a.md", "note"]])
    expect(resolveTreeKey("F2", r, -1)).toEqual({ type: "none" })
    expect(resolveTreeKey("F2", r, 5)).toEqual({ type: "none" })
  })

  it("adding F2 leaves the other keys' actions unchanged (AC-5)", () => {
    const r = rows([
      ["sub", "folder", true],
      ["sub/a.md", "note"],
    ])
    expect(resolveTreeKey("ArrowDown", r, 0)).toEqual({ type: "focus", index: 1 })
    expect(resolveTreeKey("ArrowLeft", r, 1)).toEqual({ type: "focus", index: 0 })
    expect(resolveTreeKey("ArrowLeft", r, 0)).toEqual({ type: "collapse", index: 0 })
    expect(resolveTreeKey("Enter", r, 1)).toEqual({ type: "activate", index: 1 })
    expect(resolveTreeKey(" ", r, 0)).toEqual({ type: "activate", index: 0 })
  })
})

describe("typeaheadMatch (FEAT-0077)", () => {
  const labels = ["apple", "Banana", "berry", "cherry"]

  it("jumps to the next label starting with the buffer, after current (AC-1)", () => {
    expect(typeaheadMatch(labels, 0, "b")).toBe(1) // Banana
  })

  it("is case-insensitive on both the buffer and the label", () => {
    expect(typeaheadMatch(labels, 0, "B")).toBe(1)
    expect(typeaheadMatch(["Apple"], 0, "a")).toBe(0)
  })

  it("wraps around past the end (AC-1)", () => {
    expect(typeaheadMatch(labels, 3, "a")).toBe(0) // from cherry, wrap to apple
  })

  it("cycles through same-initial rows on repeated single-char calls (AC-4)", () => {
    // Only Banana(1) and berry(2) start with b; cycling bounces between them.
    expect(typeaheadMatch(labels, 1, "b")).toBe(2)
    expect(typeaheadMatch(labels, 2, "b")).toBe(1)
  })

  it("matches a multi-character prefix (AC-2)", () => {
    expect(typeaheadMatch(labels, 0, "ch")).toBe(3)
    expect(typeaheadMatch(labels, 0, "be")).toBe(2)
  })

  it("returns the current row when only it matches", () => {
    expect(typeaheadMatch(["apple", "banana"], 0, "ap")).toBe(0)
  })

  it("returns -1 on no match, an empty buffer, or empty labels (AC-5)", () => {
    expect(typeaheadMatch(labels, 0, "z")).toBe(-1)
    expect(typeaheadMatch(labels, 0, "")).toBe(-1)
    expect(typeaheadMatch([], 0, "a")).toBe(-1)
  })
})

describe("isTypeaheadKey (FEAT-0077)", () => {
  const k = (
    key: string,
    mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
  ) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods })

  it("is true for a printable single character", () => {
    expect(isTypeaheadKey(k("a"))).toBe(true)
    expect(isTypeaheadKey(k("7"))).toBe(true)
    expect(isTypeaheadKey(k("-"))).toBe(true)
  })

  it("is false for named (multi-character) keys (AC-7)", () => {
    expect(isTypeaheadKey(k("ArrowDown"))).toBe(false)
    expect(isTypeaheadKey(k("F2"))).toBe(false)
    expect(isTypeaheadKey(k("Enter"))).toBe(false)
  })

  it("is false for a real Ctrl-only, Alt-only, or Cmd chord (a shortcut)", () => {
    expect(isTypeaheadKey(k("a", { ctrlKey: true }))).toBe(false)
    expect(isTypeaheadKey(k("a", { metaKey: true }))).toBe(false)
    expect(isTypeaheadKey(k("a", { altKey: true }))).toBe(false)
  })

  it("is true for an AltGr-composed character (Ctrl+Alt together)", () => {
    // Windows/Chrome reports AltGr as ctrlKey && altKey; e.g. AltGr+L → "ł".
    expect(isTypeaheadKey(k("ł", { ctrlKey: true, altKey: true }))).toBe(true)
    // …but not if Cmd is also somehow held.
    expect(isTypeaheadKey(k("ł", { ctrlKey: true, altKey: true, metaKey: true }))).toBe(false)
  })
})

describe("isTreeActionKey (FEAT-0077)", () => {
  it("is true for every key resolveTreeKey handles", () => {
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "Enter",
      " ",
      "F2",
    ]) {
      expect(isTreeActionKey(key)).toBe(true)
    }
  })

  it("is false for printable and other non-tree keys (they never end a session)", () => {
    expect(isTreeActionKey("a")).toBe(false)
    expect(isTreeActionKey("Shift")).toBe(false)
    expect(isTreeActionKey("NumLock")).toBe(false)
    expect(isTreeActionKey("Dead")).toBe(false)
    expect(isTreeActionKey("Escape")).toBe(false)
  })
})

describe("resolveTreeKey — guards", () => {
  const r = rows([["a.md", "note"]])

  it("an unrelated key does nothing", () => {
    expect(resolveTreeKey("x", r, 0)).toEqual({ type: "none" })
  })

  it("an out-of-range current index does nothing", () => {
    expect(resolveTreeKey("ArrowDown", r, -1)).toEqual({ type: "none" })
    expect(resolveTreeKey("ArrowDown", r, 5)).toEqual({ type: "none" })
  })

  it("an empty tree does nothing", () => {
    expect(resolveTreeKey("ArrowDown", [], 0)).toEqual({ type: "none" })
  })
})
