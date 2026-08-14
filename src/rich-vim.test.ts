import { describe, expect, it } from "vitest"
import { EditorState } from "@codemirror/state"
import { Vim } from "@replit/codemirror-vim"
import {
  mountEditor,
  setEditorEditable,
  setEditorText,
  setVimMode,
} from "./editor"
import { serializedRichMarkdown } from "./rich-editor"

function press(view: ReturnType<typeof mountEditor>, key: string, modifiers: Partial<KeyboardEventInit> = {}): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
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

  it("pastes a Vim register through the rich visible boundary", () => {
    const view = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(view, "")
    setVimMode(view, true)
    Vim.getRegisterController().unnamedRegister.setText("**hello**")
    view.focus()

    press(view, "p")

    expect(view.state.doc.toString()).toBe("hello")
    // The register's Markdown meaning survives while delimiters stay out of the
    // visible Vim motion surface.
    expect(serializedRichMarkdown(view.state)).toBe("**hello**")
    view.destroy()
  })

  it("preserves Vim counts and does not steal Ctrl-P", () => {
    const view = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(view, "")
    setVimMode(view, true)
    Vim.getRegisterController().unnamedRegister.setText("x")
    view.focus()

    press(view, "3")
    press(view, "p")
    expect(view.state.doc.toString()).toBe("xxx")

    setEditorText(view, "abc")
    view.dispatch({ selection: { anchor: 0 } })
    press(view, "p", { ctrlKey: true })
    expect(view.state.doc.toString()).toBe("abc")
    view.destroy()
  })

  it("does not mutate a read-only rich editor through Vim paste", () => {
    const view = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(view, "plain")
    setVimMode(view, true)
    Vim.getRegisterController().unnamedRegister.setText("**x**")
    view.dispatch({ selection: { anchor: 0 } })
    setEditorEditable(view, false)
    press(view, "p")
    expect(view.state.doc.toString()).toBe("plain")
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
