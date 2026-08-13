import { describe, expect, it } from "vitest"
import {
  importMarkdown,
  serializeMarkdown,
  sourceToVisible,
  visibleToSource,
  replaceVisible,
} from "./rich-markdown"

describe("rich Markdown document", () => {
  it("projects supported syntax without exposing delimiters and maps UTF-16 positions", () => {
    const doc = importMarkdown("# Hé **world**\n> *quote*")
    expect(doc.visible).toBe("Hé world\nquote")
    expect(doc.ranges.some((r) => r.marks.includes("bold"))).toBe(true)
    expect(doc.ranges.some((r) => r.marks.includes("italic"))).toBe(true)
    expect(sourceToVisible(doc, 0)).toBe(0)
    expect(visibleToSource(doc, "Hé ".length)).toBe("# Hé **".length)
    expect(serializeMarkdown(doc)).toBe("# Hé **world**\n> *quote*")
  })

  it("preserves unknown syntax and only changes the explicitly replaced fragment", () => {
    const source = "before ^^future^^ after\n[unknown]"
    const doc = importMarkdown(source)
    const from = doc.visible.indexOf("future")
    const next = replaceVisible(doc, from, from + 6, "known")
    expect(serializeMarkdown(next)).toContain("known")
    expect(serializeMarkdown(next)).toContain("[unknown]")
    expect(next.visible).toContain("known")
    expect(serializeMarkdown(importMarkdown(source))).toBe(source)
  })

  it("keeps incomplete markers literal", () => {
    const doc = importMarkdown("**unfinished\nplain")
    expect(doc.visible).toBe("**unfinished\nplain")
  })
})
