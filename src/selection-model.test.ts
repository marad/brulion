import { describe, it, expect } from "vitest"
import { rangeSelect, toggleSelection } from "./selection-model"

describe("toggleSelection (FEAT-0078)", () => {
  it("adds a path that is absent", () => {
    expect([...toggleSelection(new Set(), "a.md")]).toEqual(["a.md"])
    expect([...toggleSelection(new Set(["a.md"]), "b.md")].sort()).toEqual(["a.md", "b.md"])
  })

  it("removes a path that is present", () => {
    expect([...toggleSelection(new Set(["a.md", "b.md"]), "a.md")]).toEqual(["b.md"])
  })

  it("does not mutate the input set", () => {
    const input = new Set(["a.md"])
    toggleSelection(input, "b.md")
    expect([...input]).toEqual(["a.md"])
  })
})

describe("rangeSelect (FEAT-0078)", () => {
  const visible = ["a.md", "sub", "sub/x.md", "sub/y.md", "z.md"]

  it("selects the inclusive span from anchor to focus (downward)", () => {
    expect([...rangeSelect(visible, "sub", "sub/y.md")].sort()).toEqual(
      ["sub", "sub/x.md", "sub/y.md"].sort(),
    )
  })

  it("selects the inclusive span regardless of direction (upward)", () => {
    expect([...rangeSelect(visible, "sub/y.md", "sub")].sort()).toEqual(
      ["sub", "sub/x.md", "sub/y.md"].sort(),
    )
  })

  it("a range of one is just that row", () => {
    expect([...rangeSelect(visible, "z.md", "z.md")]).toEqual(["z.md"])
  })

  it("replaces (returns only the span, not a union with anything prior)", () => {
    expect([...rangeSelect(visible, "a.md", "sub")].sort()).toEqual(["a.md", "sub"].sort())
  })

  it("returns empty when an endpoint is not visible", () => {
    expect([...rangeSelect(visible, "gone.md", "z.md")]).toEqual([])
    expect([...rangeSelect(visible, "a.md", "gone.md")]).toEqual([])
  })
})
