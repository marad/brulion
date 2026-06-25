import { describe, it, expect } from "vitest"
import { resolvePinned, togglePinned, reorderPinned, type Action } from "./actions"

// FEAT-0057/0058 — the pure action-list helpers. No DOM, no state.

const actions = (): Action[] => [
  { id: "goto", label: "Go to note…", run: () => {} },
  { id: "folder", label: "Switch folder…", run: () => {} },
  { id: "vim", label: "Toggle Vim mode", run: () => {} },
]

describe("resolvePinned (FEAT-0058 AC-2, AC-3)", () => {
  it("resolves ids to actions in id order", () => {
    expect(resolvePinned(["vim", "goto"], actions()).map((a) => a.id)).toEqual(["vim", "goto"])
  })

  it("drops ids that match no registered action (AC-3), keeping resolvable ones", () => {
    expect(resolvePinned(["ghost", "vim", "nope"], actions()).map((a) => a.id)).toEqual(["vim"])
  })

  it("an empty id list resolves to no actions", () => {
    expect(resolvePinned([], actions())).toEqual([])
  })
})

describe("togglePinned (FEAT-0058 AC-4)", () => {
  it("appends an absent id and removes a present one, without mutating the input", () => {
    const list = ["a", "b"]
    expect(togglePinned(list, "c")).toEqual(["a", "b", "c"])
    expect(togglePinned(list, "a")).toEqual(["b"])
    expect(list).toEqual(["a", "b"]) // input untouched
  })
})

describe("reorderPinned (FEAT-0058 AC-5)", () => {
  it("moves the dragged id to the target's slot, inserting before it", () => {
    // Drag "a" onto "c": a lands at c's position (before c).
    expect(reorderPinned(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"])
    // Drag "c" onto "a": c lands first.
    expect(reorderPinned(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"])
  })

  it("is a no-op for a drop onto itself or an id not in the list, without mutating", () => {
    const list = ["a", "b", "c"]
    expect(reorderPinned(list, "b", "b")).toEqual(["a", "b", "c"]) // onto itself
    expect(reorderPinned(list, "zzz", "a")).toEqual(["a", "b", "c"]) // dragged absent
    expect(reorderPinned(list, "a", "zzz")).toEqual(["a", "b", "c"]) // target absent
    expect(list).toEqual(["a", "b", "c"]) // input untouched
  })
})
