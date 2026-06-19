import { describe, it, expect } from "vitest"
import { mountEditor } from "./editor"

describe("mountEditor", () => {
  it("mounts a CodeMirror editor that is present and editable", () => {
    const parent = document.createElement("div")

    const view = mountEditor(parent)

    expect(parent.querySelector(".cm-editor")).not.toBeNull()
    expect(parent.querySelector(".cm-content")).not.toBeNull()
    expect(view.state.readOnly).toBe(false)

    view.destroy()
  })
})
