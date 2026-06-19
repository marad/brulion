import { describe, it, expect, vi } from "vitest"
import { mountEditor, setEditorText } from "./editor"

describe("mountEditor", () => {
  it("mounts a CodeMirror editor that is present and editable", () => {
    const parent = document.createElement("div")

    const view = mountEditor(parent)

    expect(parent.querySelector(".cm-editor")).not.toBeNull()
    expect(parent.querySelector(".cm-content")).not.toBeNull()
    expect(view.state.readOnly).toBe(false)

    view.destroy()
  })

  it("fires onChange on a user edit", () => {
    const onChange = vi.fn()
    const view = mountEditor(document.createElement("div"), { onChange })

    view.dispatch({ changes: { from: 0, insert: "abc" } })

    expect(onChange).toHaveBeenCalledTimes(1)
    view.destroy()
  })

  it("setEditorText loads content without it counting as a user edit", () => {
    const onChange = vi.fn()
    const view = mountEditor(document.createElement("div"), { onChange })

    setEditorText(view, "loaded from disk")

    expect(view.state.doc.toString()).toBe("loaded from disk")
    expect(onChange).not.toHaveBeenCalled()
    view.destroy()
  })
})
