import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { CompletionContext } from "@codemirror/autocomplete"
import { slashSource, stripSlashToken } from "./slash-commands"
import { withHeadingLevel } from "./markdown-transforms"

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

  it("does not open for a slash that is not at the line start (AC-6)", () => {
    expect(sourceAt("see /")).toBeNull()
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
    expect(result!.from).toBe(doc.indexOf("/h")) // token starts at the line start
  })
})

describe("stripSlashToken", () => {
  it("removes the /command token and one following space", () => {
    expect(stripSlashToken("/h2")).toBe("")
    expect(stripSlashToken("/h2 text")).toBe("text") // the single space goes too
    expect(stripSlashToken("/clear")).toBe("")
  })

  it("keeps content that directly follows the token (no extra space)", () => {
    // The /clear-before-a-heading flow: `/clear# Heading` → `# Heading`.
    expect(stripSlashToken("/clear# Heading")).toBe("# Heading")
  })

  it("leaves a line without a leading slash token untouched", () => {
    expect(stripSlashToken("see /x later")).toBe("see /x later")
  })

  it("composes with withHeadingLevel to write only clean markdown", () => {
    // What the slash action actually writes — the /command must never survive.
    expect(withHeadingLevel(stripSlashToken("/h2"), 2)).toBe("## ")
    expect(withHeadingLevel(stripSlashToken("/clear# Done"), 0)).toBe("Done")
    expect(withHeadingLevel(stripSlashToken("/h1 Title"), 1)).toBe("# Title")
  })
})
