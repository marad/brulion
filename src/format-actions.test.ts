import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { FORMAT_ITEMS } from "./format-actions"

// FORMAT_ITEMS is the single shared definition reused by the context menu (FEAT-0008)
// and the touch selection toolbar (FEAT-0052), so every surface produces the same
// clean markdown (FEAT-0052 AC-5). These assert the action set and that each `run`
// yields the expected FEAT-0007 transform.

const item = (label: string) => FORMAT_ITEMS.find((i) => i.label === label)!

/** Apply an action's transform to a doc with the given selection; return the doc. */
const apply = (label: string, doc: string, anchor: number, head: number) => {
  const state = EditorState.create({ doc, selection: { anchor, head } })
  const spec = item(label).run(state)
  return spec ? state.update(spec).state.doc.toString() : doc
}

describe("FORMAT_ITEMS (FEAT-0052)", () => {
  it("AC-5: is exactly the seven shared format actions", () => {
    expect(FORMAT_ITEMS.map((i) => i.label)).toEqual([
      "Bold",
      "Italic",
      "Code",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Clear formatting",
    ])
  })

  it("AC-2: Bold wraps the selection in **…**", () => {
    expect(apply("Bold", "word", 0, 4)).toBe("**word**")
  })

  it("Italic wraps the selection in *…*", () => {
    expect(apply("Italic", "word", 0, 4)).toBe("*word*")
  })

  it("AC-3: Heading 2 sets the line to a level-2 heading", () => {
    expect(apply("Heading 2", "Title", 0, 0)).toBe("## Title")
  })
})
