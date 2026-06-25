import { describe, it, expect, vi } from "vitest"
import { mountEditor, setEditorText, scrollEditorToHeading } from "./editor"

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

describe("scrollEditorToHeading (FEAT-0061)", () => {
  const doc = "intro\n\n## Section two\n\nbody\n\n### Zażółć część\n\nmore\n"

  it("moves the caret to the first heading whose slug matches, returning true", () => {
    const view = mountEditor(document.createElement("div"))
    setEditorText(view, doc)

    expect(scrollEditorToHeading(view, "section-two")).toBe(true)
    // Caret sits at the start of the "## Section two" line.
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    expect(line.text).toBe("## Section two")
    view.destroy()
  })

  it("matches case-insensitively / Unicode and ignores the # prefix", () => {
    const view = mountEditor(document.createElement("div"))
    setEditorText(view, doc)

    expect(scrollEditorToHeading(view, "Zażółć część")).toBe(true)
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toBe("### Zażółć część")
    view.destroy()
  })

  it("skips a heading-looking line inside a fenced code block", () => {
    const view = mountEditor(document.createElement("div"))
    // A `# Section two` comment in code precedes the real prose heading.
    setEditorText(view, "```\n# Section two\n```\n\nprose\n\n## Section two\n\nreal\n")

    expect(scrollEditorToHeading(view, "section-two")).toBe(true)
    const line = view.state.doc.lineAt(view.state.selection.main.head)
    expect(line.text).toBe("## Section two") // the prose heading, not the code comment
    view.destroy()
  })

  it("returns false and does not move the caret when no heading matches", () => {
    const view = mountEditor(document.createElement("div"))
    setEditorText(view, doc)
    view.dispatch({ selection: { anchor: 0 } })

    expect(scrollEditorToHeading(view, "no-such-heading")).toBe(false)
    expect(view.state.selection.main.head).toBe(0) // unchanged
    view.destroy()
  })
})
