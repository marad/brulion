import { describe, expect, it } from "vitest"
import { EditorState } from "@codemirror/state"
import { Vim } from "@replit/codemirror-vim"
import {
  mountEditor,
  setEditorText,
  setVimMode,
} from "./editor"

function press(view: ReturnType<typeof mountEditor>, key: string): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  }))
}

describe("rich Vim adapter (FEAT-0114)", () => {
  it("does not install the raw hidden-source caret guard in rich mode", () => {
    const view = mountEditor(document.createElement("div"), { rich: true })
    const before = view.state.facet(EditorState.transactionFilter).length
    setVimMode(view, true)

    expect(view.state.facet(EditorState.transactionFilter)).toHaveLength(before)
    view.destroy()
  })

  it("yanks visible rich text through the boundary-fidelity Markdown serializer", () => {
    const view = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(view, "# **hello**")
    view.dispatch({ selection: { anchor: 0 } })
    setVimMode(view, true)
    view.focus()

    press(view, "v")
    press(view, "$")
    press(view, "y")

    expect(Vim.getRegisterController().unnamedRegister.toString()).toBe("# **hello**")
    view.destroy()
  })
})
