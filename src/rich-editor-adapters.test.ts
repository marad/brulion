import { describe, expect, it, vi } from "vitest"
import { CompletionContext } from "@codemirror/autocomplete"
import { undo } from "@codemirror/commands"
import { EditorView } from "@codemirror/view"
import {
  applyRichFormat,
  applyRichSlash,
  serializeRichSelection,
  type RichEditorSelectionRange,
} from "./rich-adapters"
import {
  richEditorPositionToModel,
  richEditorRangeToModel,
  richModelPositionToEditor,
  richModelSelectionToEditor,
} from "./rich-editor"
import {
  getEditorSelection,
  mountEditor,
  setEditorSelection,
  setEditorText,
  setLinkContext,
} from "./editor"
import { importMarkdown } from "./rich-markdown"
import { serializedRichMarkdown } from "./rich-editor"
import { wikilinkSource } from "./link-complete"

function richView(): EditorView {
  return mountEditor(document.createElement("div"), { rich: true })
}

function clipboardEvent(type: "copy" | "cut" | "paste", data: Record<string, string>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const clipboardData = {
    clearData: vi.fn(),
    setData: vi.fn(),
    getData: vi.fn((format: string) => data[format] ?? ""),
    types: Object.keys(data),
  }
  Object.defineProperty(event, "clipboardData", { value: clipboardData })
  return event
}

describe("rich adapter coordinate and transaction contracts (FEAT-0114)", () => {
  it("converts CodeMirror LF coordinates to model CRLF coordinates exactly once", () => {
    const document = importMarkdown("x\r\n**café**\r\nend")
    const editorRange: RichEditorSelectionRange = {
      from: 2,
      to: 6,
    }

    expect(richEditorPositionToModel(document, 2)).toBe(3)
    expect(richModelPositionToEditor(document, 3)).toBe(2)
    expect(richEditorRangeToModel(document, editorRange)).toEqual({ from: 3, to: 7 })
    expect(richModelSelectionToEditor(document, { anchor: 7, head: 3 })).toEqual({
      anchor: 6,
      head: 2,
    })
  })

  it("dispatches one model/visible transaction for formatting and one undo restores it", () => {
    const view = richView()
    setEditorText(view, "plain")
    view.dispatch({ selection: { anchor: 0, head: 5 } })
    const dispatch = vi.spyOn(view, "dispatch")

    expect(applyRichFormat(view, "Bold")).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(view.state.doc.toString()).toBe("plain")
    expect(serializedRichMarkdown(view.state)).toBe("**plain**")
    expect(undo(view)).toBe(true)
    expect(view.state.doc.toString()).toBe("plain")
    expect(serializedRichMarkdown(view.state)).toBe("plain")
    view.destroy()
  })

  it("rejects formatting that crosses or touches an opaque source island without dispatch", () => {
    const view = richView()
    setEditorText(view, "before\r\n```js\r\nraw\r\n```\r\nafter")
    const raw = view.state.doc.toString().indexOf("raw")
    view.dispatch({ selection: { anchor: raw, head: raw + 3 } })
    const dispatch = vi.spyOn(view, "dispatch")

    expect(applyRichFormat(view, "Italic")).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    expect(serializedRichMarkdown(view.state)).toBe("before\r\n```js\r\nraw\r\n```\r\nafter")
    view.destroy()
  })

  it("serializes partial nested, linked, block, Unicode, and CRLF selections as Markdown", () => {
    const nested = importMarkdown("*outer **inner** end*")
    const inner = nested.visible.indexOf("inner")
    expect(serializeRichSelection(nested, [{ from: inner, to: inner + "inner".length }])).toBe("***inner***")

    const linked = importMarkdown("See [**bold** label](target.md)")
    const bold = linked.visible.indexOf("bold")
    expect(serializeRichSelection(linked, [{ from: bold, to: bold + "bold".length }])).toBe(
      "[**bold**](target.md)",
    )

    const blocks = importMarkdown("# Hé **world**\r\n> *quote*")
    const world = blocks.visible.indexOf("world")
    const quote = blocks.visible.indexOf("quote")
    expect(serializeRichSelection(blocks, [{ from: world, to: quote + "quote".length }])).toBe(
      "# **world**\r\n> *quote*",
    )
    const emoji = blocks.visible.indexOf("Hé")
    expect(serializeRichSelection(blocks, [{ from: emoji, to: emoji + "Hé".length }])).toBe("# Hé")
    expect(serializeRichSelection(blocks, [{ from: blocks.visible.length, to: blocks.visible.length }])).toBe("")
  })

  it("copies rich Markdown to text/plain without mutating source or selection", () => {
    const view = richView()
    setEditorText(view, "# **café**\r\n> quote")
    const from = view.state.doc.toString().indexOf("café")
    view.dispatch({ selection: { anchor: from, head: from + "café".length } })
    const before = view.state
    const event = clipboardEvent("copy", { "text/plain": "" })

    expect(view.contentDOM.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    const clipboard = (event as unknown as { clipboardData: { setData: ReturnType<typeof vi.fn> } }).clipboardData
    expect(clipboard.setData).toHaveBeenCalledWith("text/plain", "# **café**")
    expect(view.state).toBe(before)
    expect(serializedRichMarkdown(view.state)).toBe("# **café**\r\n> quote")
    view.destroy()
  })

  it("cuts a complete wrapper, removes the empty wrapper, and undoes as one unit", () => {
    const view = richView()
    setEditorText(view, "**hello**")
    view.dispatch({ selection: { anchor: 0, head: 5 } })
    const event = clipboardEvent("cut", { "text/plain": "" })

    expect(view.contentDOM.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(serializedRichMarkdown(view.state)).toBe("")
    expect(view.state.doc.toString()).toBe("")
    expect(undo(view)).toBe(true)
    expect(serializedRichMarkdown(view.state)).toBe("**hello**")
    view.destroy()
  })

  it("removes wrappers when a cut spans a complete marked fragment and following text", () => {
    const view = richView()
    setEditorText(view, "**bold** tail")
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" }, userEvent: "delete.cut" })

    expect(serializedRichMarkdown(view.state)).toBe("")
    view.destroy()
  })

  it("falls through instead of cutting an opaque block", () => {
    const view = richView()
    setEditorText(view, "```js\nraw\n```")
    view.dispatch({ selection: { anchor: 6, head: 9 } })
    const event = clipboardEvent("cut", { "text/plain": "" })

    expect(view.contentDOM.dispatchEvent(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(serializedRichMarkdown(view.state)).toBe("```js\nraw\n```")
    view.destroy()
  })

  it("pastes only text/plain Markdown at one undo boundary", () => {
    const view = richView()
    setEditorText(view, "prefix ")
    view.dispatch({ selection: { anchor: view.state.doc.length } })

    const event = clipboardEvent("paste", {
      "text/html": "<strong>must not be imported</strong>",
      "text/plain": "**pasted** ",
    })
    expect(view.contentDOM.dispatchEvent(event)).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe("prefix pasted ")
    expect(serializedRichMarkdown(view.state)).toBe("prefix **pasted** ")
    expect(undo(view)).toBe(true)
    expect(serializedRichMarkdown(view.state)).toBe("prefix ")
    view.destroy()
  })

  it("accepts a current slash token but rejects a stale token without dispatch", () => {
    const view = richView()
    setEditorText(view, "/h2 title")
    const dispatch = vi.spyOn(view, "dispatch")

    expect(applyRichSlash(view, 0, 3, "/h2")).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(serializedRichMarkdown(view.state)).toBe("## title")
    view.destroy()

    const stale = richView()
    setEditorText(stale, "changed")
    const staleDispatch = vi.spyOn(stale, "dispatch")
    expect(applyRichSlash(stale, 0, 3, "/h2")).toBe(false)
    expect(staleDispatch).not.toHaveBeenCalled()
    expect(serializedRichMarkdown(stale.state)).toBe("changed")
    stale.destroy()
  })

  it("accepts a visible wikilink completion without duplicating an existing close", () => {
    const view = richView()
    setLinkContext(view, { activeNote: "start.md", notePaths: new Set(["note.md"]) })
    setEditorText(view, "[[no")
    const context = new CompletionContext(view.state, view.state.doc.length, false)
    const result = wikilinkSource(context)
    expect(result).not.toBeNull()
    const option = result!.options[0]!
    ;(option.apply as (view: EditorView, completion: typeof option, from: number, to: number) => void)(
      view,
      option,
      result!.from,
      view.state.doc.length,
    )
    expect(view.state.doc.toString()).toBe("note")
    expect(serializedRichMarkdown(view.state)).toBe("[[note]]")
    view.destroy()

  })

  it("keeps extension selections source-compatible in reverse Unicode/CRLF ranges", () => {
    const view = richView()
    const source = "**café 😀**\r\n[Link](target.md)"
    setEditorText(view, source)
    const visible = view.state.doc.toString()
    view.dispatch({ selection: { anchor: visible.length, head: 0 } })

    expect(getEditorSelection(view)).toEqual({
      anchor: 18,
      head: 2,
      text: "café 😀**\r\n[Link",
    })
    setEditorSelection(view, { anchor: source.length, head: 0 })
    expect(view.state.selection.main.anchor).toBe(visible.length)
    expect(view.state.selection.main.head).toBe(0)
    view.destroy()
  })

  it("replaces a source selection through the visible rich boundary", () => {
    const view = richView()
    setEditorText(view, "**café**")
    setEditorSelection(view, { anchor: 2, head: 6 })
    view.dispatch(view.state.replaceSelection("tea"))

    expect(view.state.doc.toString()).toBe("tea")
    expect(serializedRichMarkdown(view.state)).toBe("**tea**")
    view.destroy()
  })
})
