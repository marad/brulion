import { describe, expect, it } from "vitest"
import { EditorView } from "@codemirror/view"
import {
  mountEditor,
  scrollEditorToHeading,
  setEditorText,
  setLinkContext,
} from "./editor"
import { richRendering } from "./rich-render"
import { applyRichFormat } from "./rich-adapters"

function richView(): EditorView {
  return mountEditor(document.createElement("div"), { rich: true })
}

describe("rich projection renderer (FEAT-0114)", () => {
  it("styles marks and blocks, exposes trusted link attributes, and has no atomic ranges", () => {
    const view = richView()
    setLinkContext(view, {
      activeNote: "start.md",
      notePaths: new Set(["note.md"]),
    })
    setEditorText(view, "# **Bold**\r\nSee [site](https://example.test) and [[note|Alias]]")

    expect(view.state.doc.toString()).toBe("Bold\nSee site and Alias")
    expect(view.dom.querySelector(".cm-strong")?.textContent).toBe("Bold")
    expect(view.dom.querySelector(".cm-heading.cm-h1")?.textContent).toBe("Bold")
    expect(view.dom.querySelector('.cm-link[data-href="https://example.test"]')?.textContent).toBe("site")
    expect(view.dom.querySelector('.cm-link[data-note="note.md"]')?.textContent).toBe("Alias")
    expect(view.dom.textContent).not.toContain("**")
    expect(view.dom.textContent).not.toContain("[site]")
    expect(view.state.facet(EditorView.atomicRanges)).toHaveLength(0)
    view.destroy()
  })

  it("rebuilds decorations when a rich model-only transaction changes formatting", () => {
    const view = richView()
    setEditorText(view, "plain")
    view.dispatch({ selection: { anchor: 0, head: 5 } })

    expect(view.dom.querySelector(".cm-strong")).toBeNull()
    expect(applyRichFormat(view, "Bold")).toBe(true)
    expect(view.dom.querySelector(".cm-strong")?.textContent).toBe("plain")

    expect(applyRichFormat(view, "Clear formatting")).toBe(true)
    expect(view.dom.querySelector(".cm-strong")).toBeNull()
    view.destroy()
  })

  it("uses model source offsets to map the first duplicate Unicode CRLF heading to visible content", () => {
    const view = richView()
    const source = "intro\r\n## Zażółć część\r\nbody\r\n## Zażółć część"
    setEditorText(view, source)
    const expected = view.state.doc.toString().indexOf("Zażółć")

    expect(scrollEditorToHeading(view, "zażółć-część")).toBe(true)
    expect(view.state.selection.main.anchor).toBe(expected)
    expect(view.state.selection.main.head).toBe(expected)
    expect(view.state.doc.sliceString(expected, expected + "Zażółć".length)).toBe("Zażółć")

    const before = view.state.selection.main.head
    expect(scrollEditorToHeading(view, "missing-anchor")).toBe(false)
    expect(view.state.selection.main.head).toBe(before)
    view.destroy()
  })

  it("is a decoration-only extension with no replace or hidden atomic ranges", () => {
    const extension = richRendering()
    expect(extension).toBeDefined()

    const view = richView()
    setEditorText(view, "plain **text**")
    expect(view.state.doc.toString()).toBe("plain text")
    expect(view.state.facet(EditorView.atomicRanges)).toHaveLength(0)
    view.destroy()
  })
})
