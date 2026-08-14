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

  it("keeps linewise Vim paste separated at EOF and in visual mode", () => {
    const view = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(view, "existing")
    setVimMode(view, true)
    Vim.getRegisterController().unnamedRegister.setText("line", true)
    view.focus()

    press(view, "p")
    expect(view.state.doc.toString()).toBe("existing\nline\n")
    expect(view.state.selection.main.head).toBe("existing\n".length)

    setEditorText(view, "old")
    view.dispatch({ selection: { anchor: 0 } })
    press(view, "V")
    Vim.getRegisterController().unnamedRegister.setText("new", true)
    press(view, "p")
    expect(view.state.doc.toString()).toBe("new")
    view.destroy()
  })

  it("uses serialized line boundaries for rich block linewise paste", () => {
    for (const source of ["# title", "> quote", "- item"]) {
      const view = mountEditor(document.createElement("div"), { rich: true })
      setEditorText(view, source)
      setVimMode(view, true)
      Vim.getRegisterController().unnamedRegister.setText("line", true)
      view.focus()

      press(view, "P")

      expect(serializedRichMarkdown(view.state)).toBe(`line\n${source}`)
      view.destroy()
    }

    const visual = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(visual, "# old")
    setVimMode(visual, true)
    visual.focus()
    press(visual, "V")
    Vim.getRegisterController().unnamedRegister.setText("# new", true)
    press(visual, "p")
    expect(serializedRichMarkdown(visual.state)).toBe("# new")
    expect(visual.state.doc.toString()).toBe("new")
    expect(visual.state.selection.main.head).toBe(0)
    visual.destroy()
  })

  it("preserves untouched pending lines and CRLF during source-boundary paste", () => {
    const pending = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(pending, "first\n")
    pending.dispatch({ changes: { from: pending.state.doc.length, insert: "**pending**" }, userEvent: "input" })
    setVimMode(pending, true)
    Vim.getRegisterController().unnamedRegister.setText("new", true)
    pending.focus()
    press(pending, "P")
    expect(serializedRichMarkdown(pending.state)).toBe("new\nfirst\n**pending**")
    expect(pending.state.doc.toString()).toContain("**pending**")
    pending.destroy()

    const crlf = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(crlf, "# old\r\nnext")
    setVimMode(crlf, true)
    crlf.focus()
    press(crlf, "V")
    Vim.getRegisterController().unnamedRegister.setText("# new\r\n", true)
    press(crlf, "p")
    expect(serializedRichMarkdown(crlf.state)).toBe("# new\r\nnext")
    crlf.destroy()
  })

  it("keeps unsupported rectangular or wrapper-splitting Vim pastes lossless", () => {
    const marked = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(marked, "**old**")
    setVimMode(marked, true)
    marked.focus()
    press(marked, "v")
    press(marked, "$")
    Vim.getRegisterController().unnamedRegister.setText("new", true)
    press(marked, "p")
    expect(serializedRichMarkdown(marked.state)).toBe("**old**")
    marked.destroy()

    const block = mountEditor(document.createElement("div"), { rich: true })
    setEditorText(block, "old")
    setVimMode(block, true)
    Vim.getRegisterController().unnamedRegister.setText("x", false, true)
    block.focus()
    press(block, "p")
    expect(serializedRichMarkdown(block.state)).toBe("old")
    block.destroy()
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
