import { describe, expect, it, vi } from "vitest"
import {
  getScriptEditorText,
  mountScriptEditor,
  setScriptEditorText,
} from "./script-editor"

describe("script editor (FEAT-0082)", () => {
  it("mounts a JavaScript CodeMirror surface", () => {
    const parent = document.createElement("div")
    const view = mountScriptEditor(parent)

    expect(parent.querySelector(".cm-editor")).not.toBeNull()
    expect(getScriptEditorText(view)).toBe("")
    view.destroy()
  })

  it("loads source programmatically without reporting a user change", () => {
    const onChange = vi.fn()
    const view = mountScriptEditor(document.createElement("div"), { onChange })

    setScriptEditorText(view, "export const answer = 42")

    expect(getScriptEditorText(view)).toBe("export const answer = 42")
    expect(onChange).not.toHaveBeenCalled()
    view.destroy()
  })

  it("reports user edits with the current source", () => {
    const onChange = vi.fn()
    const view = mountScriptEditor(document.createElement("div"), { onChange })

    view.dispatch({ changes: { from: 0, insert: "const ready = true" } })

    expect(onChange).toHaveBeenCalledWith("const ready = true")
    view.destroy()
  })

  it("routes Mod-s to the save callback", () => {
    const onSave = vi.fn()
    const view = mountScriptEditor(document.createElement("div"), { onSave })
    setScriptEditorText(view, "export default 1")
    view.focus()

    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
    )

    expect(onSave).toHaveBeenCalledWith("export default 1")
    view.destroy()
  })
})
