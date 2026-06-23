import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { collectCodeMarks } from "./code-highlight"

// collectCodeMarks highlights ONLY inside fenced code blocks, scoped by range — so
// markdown prose (which shares the highlight-tag namespace: escape/comment/string)
// is never marked (FEAT-0049 AC-4). A plain markdown language is enough to detect
// the FencedCode structure; the nested code language isn't needed for these checks.

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [markdown()] })

describe("collectCodeMarks (FEAT-0049)", () => {
  it("AC-4: prose escapes and HTML comments outside code blocks get no marks", () => {
    const doc = "Use \\*literal\\* stars.\n\n<!-- a note comment -->\n"
    expect(collectCodeMarks(stateOf(doc), 0, doc.length)).toEqual([])
  })

  it("only ever marks ranges inside a fenced code block", () => {
    const prose = "\\*escaped\\* prose with a <!-- comment -->\n\n"
    const code = "```\nplain code\n```\n"
    const doc = prose + code
    const marks = collectCodeMarks(stateOf(doc), 0, doc.length)
    for (const m of marks) {
      expect(m.from).toBeGreaterThanOrEqual(prose.length) // never over the prose above
    }
  })
})
