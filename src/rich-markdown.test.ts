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
    expect(doc.ranges.some((r) => r.block === "heading")).toBe(true)
    expect(doc.ranges.some((r) => r.block === "quote")).toBe(true)
    expect(sourceToVisible(doc, 0)).toBe(0)
    expect(visibleToSource(doc, "Hé ".length)).toBe("# Hé **".length)
    expect(sourceToVisible(doc, "# Hé **".length)).toBe("Hé ".length)
    expect(serializeMarkdown(doc)).toBe("# Hé **world**\n> *quote*")
  })

  it("records nested marks and every supported block across multiline Unicode text", () => {
    const doc = importMarkdown("*outer **inner** end*\n- café 😀\n1. second")
    expect(doc.visible).toBe("outer inner end\ncafé 😀\nsecond")
    expect(doc.ranges.find((r) => r.visible && r.marks.includes("bold"))?.marks).toEqual(["italic", "bold"])
    expect(doc.ranges.some((r) => r.block === "unordered-list")).toBe(true)
    expect(doc.ranges.some((r) => r.block === "ordered-list")).toBe(true)
    const emoji = doc.visible.indexOf("😀")
    expect(visibleToSource(doc, emoji)).toBe("*outer **inner** end*\n- café ".length)
    expect(sourceToVisible(doc, visibleToSource(doc, emoji))).toBe(emoji)
  })

  it("preserves unknown syntax as an opaque visible region", () => {
    const doc = importMarkdown("before ^^future^^ after\n[unknown](target.md)")
    expect(doc.visible).toBe("before ^^future^^ after\n[unknown](target.md)")
    const opaque = doc.ranges.find((r) => r.visible && r.sourceFrom === "before ^^future^^ after\n".length)
    expect(opaque?.block).toBe("opaque")
    expect(opaque?.marks).toEqual([])
  })

  it("changes only one mapped fragment while preserving its delimiters and unknown source", () => {
    const source = "before **future** after\n[unknown](target.md)"
    const doc = importMarkdown(source)
    const from = doc.visible.indexOf("future")
    const next = replaceVisible(doc, from, from + 6, "known")
    expect(serializeMarkdown(next)).toBe("before **known** after\n[unknown](target.md)")
    expect(next.visible).toContain("known")
  })

  it("keeps incomplete markers literal and handles deterministic empty boundaries", () => {
    const empty = importMarkdown("")
    expect(empty.visible).toBe("")
    expect(visibleToSource(empty, 0)).toBe(0)
    expect(sourceToVisible(empty, 0)).toBe(0)
    const doc = importMarkdown("**unfinished\nplain")
    expect(doc.visible).toBe("**unfinished\nplain")
    expect(sourceToVisible(doc, 0)).toBe(0)
    expect(visibleToSource(doc, doc.visible.length)).toBe(doc.source.length)
    expect(() => visibleToSource(doc, doc.visible.length + 1)).toThrow(RangeError)
    expect(() => sourceToVisible(doc, doc.source.length + 1)).toThrow(RangeError)
  })
})
