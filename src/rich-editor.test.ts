import { describe, expect, it, vi } from "vitest"
import { history, undo } from "@codemirror/commands"
import { EditorView } from "@codemirror/view"
import {
  getEditorSelection,
  mountEditor,
  setEditorSelection,
  setEditorText,
} from "./editor"
import {
  applyRichVisibleChanges,
  flushRichEditorInput,
  hasRichEditor,
  mapRichReload,
  richDocumentFromState,
  richEditorExtension,
  richBackspace,
  richEnter,
  richSelectionToSource,
  richSourceSelectionToVisible,
  reloadRichEditorSource,
  serializedRichMarkdown,
  setRichEditorSource,
} from "./rich-editor"
import { importMarkdown } from "./rich-markdown"

function mountRich(onChange?: () => void): EditorView {
  return mountEditor(document.createElement("div"), { rich: true, onChange })
}

describe("rich editor boundary (FEAT-0113)", () => {
  it("loads a rich projection, exposes exact source, and does not report a programmatic edit", () => {
    const onChange = vi.fn()
    const view = mountRich(onChange)
    const source = "# Hé **world**\r\n> *quote*"

    setRichEditorSource(view, source)

    expect(view.state.doc.toString()).toBe("Hé world\nquote")
    expect(serializedRichMarkdown(view.state)).toBe(source)
    expect(onChange).not.toHaveBeenCalled()
    expect(hasRichEditor(view.state)).toBe(true)
    expect(richDocumentFromState(view.state)?.visible.replace(/\r\n?/g, "\n")).toBe(view.state.doc.toString())
    view.destroy()
  })

  it("keeps a completed **hello** conversion in one history unit while retaining Markdown", () => {
    const view = new EditorView({
      parent: document.createElement("div"),
      extensions: [history(), richEditorExtension()],
    })

    view.dispatch({ changes: { from: 0, insert: "**hello** " } })

    expect(view.state.doc.toString()).toBe("hello ")
    expect(serializedRichMarkdown(view.state)).toBe("**hello** ")
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("")
    expect(serializedRichMarkdown(view.state)).toBe("")
    view.destroy()
  })

  it("reports and undoes a source-only empty heading conversion", () => {
    const onChange = vi.fn()
    const view = mountRich(onChange)

    view.dispatch({ changes: { from: 0, insert: "# " } })

    expect(view.state.doc.toString()).toBe("")
    expect(serializedRichMarkdown(view.state)).toBe("# ")
    expect(onChange).toHaveBeenCalledOnce()
    expect(undo(view)).toBe(true)
    expect(serializedRichMarkdown(view.state)).toBe("")
    expect(onChange).toHaveBeenCalledTimes(2)
    view.destroy()
  })

  it("flushes pending inline markers at Enter and save boundaries", () => {
    const view = mountRich()
    view.dispatch({ changes: { from: 0, insert: "**hello**" } })
    view.dispatch({ selection: { anchor: view.state.doc.length } })

    expect(richEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("hello\n")
    expect(serializedRichMarkdown(view.state)).toBe("**hello**\n")

    const saveView = mountRich()
    saveView.dispatch({ changes: { from: 0, insert: "**save**" } })
    expect(flushRichEditorInput(saveView, "save")).toBe(true)
    expect(saveView.state.doc.toString()).toBe("save")
    expect(serializedRichMarkdown(saveView.state)).toBe("**save**")
    view.destroy()
    saveView.destroy()
  })

  it("routes rich block Enter and Backspace through the model", () => {
    const view = mountRich()
    setRichEditorSource(view, "- item")
    view.dispatch({ selection: { anchor: view.state.doc.length } })

    expect(richEnter(view)).toBe(true)
    expect(serializedRichMarkdown(view.state)).toBe("- item\n- ")
    expect(view.state.doc.toString()).toBe("item\n")

    setRichEditorSource(view, "- ")
    view.dispatch({ selection: { anchor: 0 } })
    expect(richBackspace(view)).toBe(true)
    expect(serializedRichMarkdown(view.state)).toBe("")
    view.destroy()
  })

  it("leaves incomplete markers visible and editable instead of dropping their source", () => {
    const view = mountRich()

    view.dispatch({ changes: { from: 0, insert: "**hello" } })

    expect(view.state.doc.toString()).toBe("**hello")
    expect(serializedRichMarkdown(view.state)).toBe("**hello")
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } })
    expect(view.state.doc.toString()).toBe("**hello!")
    expect(serializedRichMarkdown(view.state)).toBe("**hello!")
    view.destroy()
  })

  it("keeps incomplete markers editable on later lines", () => {
    const view = mountRich()
    view.dispatch({ changes: { from: 0, insert: "first\n**hello" } })
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } })

    expect(view.state.doc.toString()).toBe("first\n**hello!")
    expect(serializedRichMarkdown(view.state)).toBe("first\n**hello!")
    view.destroy()
  })

  it("preserves unknown syntax, special blocks, Unicode, and CRLF while editing one mapped span", () => {
    const view = mountRich()
    const source = "before **café** after\r\n~~unknown~~\r\n```mermaid\r\n**raw**\r\n```\r\n"
    setRichEditorSource(view, source)

    const from = view.state.doc.toString().indexOf("café")
    view.dispatch({ changes: { from, to: from + "café".length, insert: "naïve" } })

    expect(serializedRichMarkdown(view.state)).toBe(
      "before **naïve** after\r\n~~unknown~~\r\n```mermaid\r\n**raw**\r\n```\r\n",
    )
    expect(view.state.doc.toString()).toContain("~~unknown~~\n```mermaid\n**raw**")
    const specialBefore = serializedRichMarkdown(view.state)
    const rawPosition = view.state.doc.toString().indexOf("**raw**")
    view.dispatch({ changes: { from: rawPosition, to: rawPosition + 2, insert: "xx" } })
    expect(serializedRichMarkdown(view.state)).toBe(specialBefore)
    expect(view.state.doc.toString()).toContain("**raw**")
    expect(serializedRichMarkdown(view.state)?.match(/\r\n/g)?.length).toBe(5)
    view.destroy()
  })

  it("maps source-coordinate selections without exposing hidden delimiters as visible caret text", () => {
    const view = mountRich()
    const source = "**café** and [label](target.md)"
    setRichEditorSource(view, source)

    setEditorSelection(view, { anchor: 2, head: 6 })

    expect(view.state.selection.main.anchor).toBe(0)
    expect(view.state.selection.main.head).toBe("café".length)
    expect(getEditorSelection(view)).toEqual({ anchor: 2, head: 6, text: "café" })
    expect(richSelectionToSource(importMarkdown(source), { anchor: 0, head: 4 })).toEqual({
      anchor: 2,
      head: 6,
      text: "café",
    })
    expect(richSourceSelectionToVisible(importMarkdown(source), { anchor: 0, head: 2 })).toEqual({
      anchor: 0,
      head: 0,
    })
    const unicode = importMarkdown("**café 😀**")
    expect(richSelectionToSource(unicode, { anchor: 5, head: 7 })).toEqual({
      anchor: 7,
      head: 9,
      text: "😀",
    })
    view.destroy()
  })

  it("maps edits after a CRLF through CodeMirror's LF projection without changing source bytes", () => {
    const view = mountRich()
    const source = "first **one**\r\nsecond **two**"
    setRichEditorSource(view, source)
    const from = view.state.doc.toString().indexOf("two")

    view.dispatch({ changes: { from, to: from + 3, insert: "dos" }, selection: { anchor: from + 3 } })

    expect(view.state.doc.toString()).toBe("first one\nsecond dos")
    expect(view.state.selection.main.head).toBe(view.state.doc.length)
    expect(serializedRichMarkdown(view.state)).toBe("first **one**\r\nsecond **dos**")
    view.destroy()
  })

  it("reloads external source through a reparse, maps a stable caret, and does not call onChange", () => {
    const onChange = vi.fn()
    const view = mountRich(onChange)
    setRichEditorSource(view, "prefix **word**\r\nend")
    view.dispatch({ selection: { anchor: 2 } })

    reloadRichEditorSource(view, "prefix **longer word**\r\nend")

    expect(view.state.doc.toString()).toBe("prefix longer word\nend")
    expect(serializedRichMarkdown(view.state)).toBe("prefix **longer word**\r\nend")
    expect(view.state.selection.main.head).toBe(2)
    expect(onChange).not.toHaveBeenCalled()
    view.destroy()
  })

  it("maps selection and viewport anchors through a source reload", () => {
    const oldDocument = importMarkdown("before **word** after")
    const nextDocument = importMarkdown("before **longer word** after")
    const mapping = mapRichReload(
      oldDocument,
      nextDocument,
      { anchor: 2, head: 2 },
      { visiblePosition: 2 },
    )

    expect(mapping.selection).toEqual({ anchor: 2, head: 2 })
    expect(mapping.viewport).toEqual({ visiblePosition: 2 })

    const oldMarks = importMarkdown("before **word** after")
    const newDelimiter = importMarkdown("before __word__ after")
    const wordCaret = oldMarks.visible.indexOf("word") + 2
    const delimiterMapping = mapRichReload(
      oldMarks,
      newDelimiter,
      { anchor: wordCaret, head: wordCaret },
      { visiblePosition: wordCaret },
    )
    expect(delimiterMapping.selection).toEqual({ anchor: wordCaret, head: wordCaret })
    expect(delimiterMapping.viewport).toEqual({ visiblePosition: wordCaret })
  })

  it("applies visible changes against the rich model rather than a rendered projection", () => {
    const document = importMarkdown("before **future** after")
    const from = document.visible.indexOf("future")
    const result = applyRichVisibleChanges(
      document,
      [{ from, to: from + "future".length, insert: "known" }],
      { anchor: from + "known".length, head: from + "known".length },
    )

    expect(result.document.source).toBe("before **known** after")
    expect(result.document.visible).toBe("before known after")
    expect(result.selection).toEqual({
      anchor: from + "known".length,
      head: from + "known".length,
    })
  })
})

describe("raw editor fallback", () => {
  it("keeps secondary/raw editors on direct CodeMirror text", () => {
    const view = mountEditor(document.createElement("div"))
    setEditorText(view, "**raw**")

    expect(view.state.doc.toString()).toBe("**raw**")
    expect(hasRichEditor(view.state)).toBe(false)
    expect(serializedRichMarkdown(view.state)).toBeNull()
    view.destroy()
  })
})
