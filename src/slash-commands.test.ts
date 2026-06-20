import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { CompletionContext } from "@codemirror/autocomplete"
import { slashSource } from "./slash-commands"

/** Run the slash source with the caret at the end of `before` on its own line. */
function sourceAt(before: string) {
  const state = EditorState.create({ doc: before, extensions: [markdown()] })
  const ctx = new CompletionContext(state, before.length, false)
  return slashSource(ctx)
}

describe("slashSource", () => {
  it("opens for a lone '/' at the start of a line, offering all commands", () => {
    const result = sourceAt("/")
    expect(result).not.toBeNull()
    expect(result!.from).toBe(0)
    expect(result!.options.map((o) => o.label)).toEqual([
      "/h1",
      "/h2",
      "/h3",
      "/clear",
    ])
  })

  it("stays open while a /word token is being typed", () => {
    expect(sourceAt("/h")).not.toBeNull()
    expect(sourceAt("/h2")).not.toBeNull()
    expect(sourceAt("/clear")).not.toBeNull()
  })

  it("opens after whitespace mid-line, with the token starting at the slash", () => {
    const result = sourceAt("see /h")
    expect(result).not.toBeNull()
    expect(result!.from).toBe(4) // the '/' position, not the preceding space
  })

  it("does not open for a slash inside a word or URL", () => {
    expect(sourceAt("and/or")).toBeNull()
    expect(sourceAt("http://x")).toBeNull()
  })

  it("does not open once the token has a space (no longer a /word)", () => {
    expect(sourceAt("/h1 title")).toBeNull()
  })

  it("opens on the current line of a multi-line document", () => {
    const doc = "first line\n/h"
    const state = EditorState.create({ doc, extensions: [markdown()] })
    const ctx = new CompletionContext(state, doc.length, false)
    const result = slashSource(ctx)
    expect(result).not.toBeNull()
    expect(result!.from).toBe(doc.indexOf("/h")) // token starts at the line's slash
  })
})
