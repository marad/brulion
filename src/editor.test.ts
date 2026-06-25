import { describe, it, expect, vi } from "vitest"
import { mountEditor, setEditorText, reloadEditorText, scrollEditorToHeading } from "./editor"

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

describe("reloadEditorText (FEAT-0067)", () => {
  it("AC-3: catches the buffer up to the new content without a user edit", () => {
    const onChange = vi.fn()
    const view = mountEditor(document.createElement("div"), { onChange })
    setEditorText(view, "the quick brown fox")

    reloadEditorText(view, "the slow brown fox")

    expect(view.state.doc.toString()).toBe("the slow brown fox")
    expect(onChange).not.toHaveBeenCalled() // programmatic, not a user edit
    view.destroy()
  })

  it("AC-3: an identical reload dispatches nothing (no spurious history/undo step)", () => {
    const view = mountEditor(document.createElement("div"))
    setEditorText(view, "unchanged content")
    const before = view.state

    reloadEditorText(view, "unchanged content")

    expect(view.state).toBe(before) // same state object — no transaction applied
    view.destroy()
  })

  it("AC-2: a caret before the changed span keeps its position", () => {
    const view = mountEditor(document.createElement("div"))
    setEditorText(view, "abc XXX def")
    // Caret in the common prefix "abc " (pos 2), well before the changed "XXX".
    view.dispatch({ selection: { anchor: 2 } })

    reloadEditorText(view, "abc YYYY def")

    expect(view.state.selection.main.head).toBe(2) // unmoved — not collapsed to the end
    view.destroy()
  })

  it("AC-2: a caret after the changed span shifts by the edit's length delta", () => {
    const view = mountEditor(document.createElement("div"))
    setEditorText(view, "abcdef")
    view.dispatch({ selection: { anchor: 6 } }) // at the end

    reloadEditorText(view, "Xabcdef") // a 1-char prepend before the caret

    expect(view.state.selection.main.head).toBe(7) // shifted by +1, still at the end
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
