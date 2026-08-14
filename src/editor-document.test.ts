import { describe, expect, it, vi } from "vitest"
import { createEditorDocument } from "./editor-document"
import { mountEditor } from "./editor"
import * as richEditor from "./rich-editor"

function mountRichDocument() {
  const view = mountEditor(document.createElement("div"), { rich: true })
  return { view, document: createEditorDocument(view) }
}

describe("editor document source boundary (FEAT-0113)", () => {
  it("reads serialized Markdown separately from the visible projection", () => {
    const { view, document } = mountRichDocument()
    const source = "# **title**\r\nbody"

    document.loadMarkdown(source)

    expect(document.readMarkdown()).toBe(source)
    expect(document.readVisible()).toBe("title\nbody")
    expect(document.readModel()?.source).toBe(source)
    view.destroy()
  })

  it("reloads source through the rich boundary rather than inserting raw Markdown", () => {
    const { view, document } = mountRichDocument()
    document.loadMarkdown("before **old**")

    document.reloadMarkdown("before **new**")

    expect(document.readVisible()).toBe("before new")
    expect(document.readMarkdown()).toBe("before **new**")
    expect(view.state.doc.toString()).toBe("before new")
    view.destroy()
  })

  it("falls back to raw CodeMirror text for a non-rich editor", () => {
    const view = mountEditor(document.createElement("div"))
    const boundary = createEditorDocument(view)

    boundary.loadMarkdown("**raw**")

    expect(boundary.readMarkdown()).toBe("**raw**")
    expect(boundary.readVisible()).toBe("**raw**")
    expect(boundary.readModel()).toBeNull()
    view.destroy()
  })

  it("retains the previous source and projection when a load fails", () => {
    const { view, document } = mountRichDocument()
    document.loadMarkdown("before **valid**")
    const load = vi.spyOn(richEditor, "setRichEditorSource").mockImplementationOnce(() => {
      throw new Error("invalid source")
    })

    expect(() => document.loadMarkdown("broken")).toThrow("invalid source")
    expect(document.readMarkdown()).toBe("before **valid**")
    expect(document.readVisible()).toBe("before valid")
    load.mockRestore()
    view.destroy()
  })

  it("retains the previous source and selection when a reparse fails", () => {
    const { view, document } = mountRichDocument()
    document.loadMarkdown("before **valid**")
    view.dispatch({ selection: { anchor: 3 } })
    const reload = vi.spyOn(richEditor, "reloadRichEditorSource").mockImplementationOnce(() => {
      throw new Error("reparse failed")
    })

    expect(() => document.reloadMarkdown("before **replacement**")).toThrow("reparse failed")
    expect(document.readMarkdown()).toBe("before **valid**")
    expect(document.readVisible()).toBe("before valid")
    expect(view.state.selection.main.head).toBe(3)
    reload.mockRestore()
    view.destroy()
  })
})
