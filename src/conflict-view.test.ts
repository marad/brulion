import { describe, it, expect } from "vitest"
import { mountConflictDiff } from "./conflict-view"

function host(): HTMLElement {
  const el = document.createElement("div")
  document.body.append(el)
  return el
}

// The two MergeView panes, left (mine) then right (theirs).
function panes(parent: HTMLElement): string[] {
  return [...parent.querySelectorAll(".cm-content")].map((p) => p.textContent ?? "")
}

describe("mountConflictDiff (FEAT-0022)", () => {
  it("renders both versions side by side under labelled panes (AC-1)", () => {
    const parent = host()
    mountConflictDiff(parent, "line one\nmine", "line one\ntheirs")

    const labels = [...parent.querySelectorAll(".conflict-diff-labels span")].map(
      (s) => s.textContent,
    )
    expect(labels).toEqual(["Your version", "On disk"])

    const [mine, theirs] = panes(parent)
    expect(mine).toContain("mine")
    expect(theirs).toContain("theirs")
  })

  it("labels the disk pane as deleted and shows it empty when theirs is null (AC-3)", () => {
    const parent = host()
    mountConflictDiff(parent, "my buffer", null)

    const theirsLabel = parent.querySelectorAll(".conflict-diff-labels span")[1]
    expect(theirsLabel?.textContent).toContain("deleted on disk")

    const [mine, theirs] = panes(parent)
    expect(mine).toContain("my buffer")
    expect(theirs).toBe("") // nothing on disk → the buffer reads as removed
  })

  it("renders both panes read-only — neither is editable (AC-6)", () => {
    const parent = host()
    mountConflictDiff(parent, "mine", "theirs")

    for (const content of parent.querySelectorAll(".cm-content")) {
      expect(content.getAttribute("contenteditable")).toBe("false")
    }
  })

  it("destroy removes the diff from the DOM (AC-4)", () => {
    const parent = host()
    const diff = mountConflictDiff(parent, "mine", "theirs")
    expect(parent.querySelector(".conflict-diff")).not.toBeNull()

    diff.destroy()
    expect(parent.querySelector(".conflict-diff")).toBeNull()
  })
})
