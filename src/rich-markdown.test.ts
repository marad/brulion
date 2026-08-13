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
    const inner = doc.visible.indexOf("inner")
    expect(sourceToVisible(doc, "*outer **".length)).toBe(inner)
    expect(visibleToSource(doc, inner)).toBe("*outer **".length)
    expect(sourceToVisible(doc, "*outer **inner".length)).toBe(inner + "inner".length)

    const triple = importMarkdown("***both***")
    expect(triple.visible).toBe("both")
    expect(triple.ranges.find((r) => r.visible)?.marks).toEqual(["bold", "italic"])

    const strongAroundEmphasis = importMarkdown("**bold *italic***")
    expect(strongAroundEmphasis.visible).toBe("bold italic")
    expect(strongAroundEmphasis.ranges.some((r) => r.visible && r.marks.includes("bold") && !r.marks.includes("italic"))).toBe(true)
    expect(strongAroundEmphasis.ranges.some((r) => r.visible && r.marks.includes("bold") && r.marks.includes("italic"))).toBe(true)

    const intraword = importMarkdown("**foo_bar_baz**")
    expect(intraword.visible).toBe("foo_bar_baz")
    expect(intraword.ranges.find((r) => r.visible)?.marks).toEqual(["bold"])
  })

  it("preserves unknown syntax as an opaque visible region", () => {
    const doc = importMarkdown("before ^^future^^ after\n[unknown](target.md)")
    expect(doc.visible).toBe("before ^^future^^ after\n[unknown](target.md)")
    const opaque = doc.ranges.find((r) => r.visible && r.sourceFrom === "before ^^future^^ after\n".length)
    expect(opaque?.block).toBe("opaque")
    expect(opaque?.marks).toEqual([])

    const unsupported = importMarkdown("before ~~strike~~ after")
    expect(unsupported.visible).toBe("before ~~strike~~ after")
    expect(unsupported.ranges[0]?.block).toBe("opaque")

    const incompleteLink = importMarkdown("[unknown] and [x](target")
    expect(incompleteLink.visible).toBe("[unknown] and [x](target")
    expect(incompleteLink.ranges[0]?.block).toBe("opaque")
  })

  it("changes only one mapped fragment while preserving its delimiters and unknown source", () => {
    const source = "before **future** after\n[unknown](target.md)"
    const doc = importMarkdown(source)
    const from = doc.visible.indexOf("future")
    const next = replaceVisible(doc, from, from + 6, "known")
    expect(serializeMarkdown(next)).toBe("before **known** after\n[unknown](target.md)")
    expect(next.visible).toContain("known")

    const secondFrom = next.visible.indexOf("known")
    const twice = replaceVisible(next, secondFrom, secondFrom + 5, "again")
    expect(serializeMarkdown(twice)).toBe("before **again** after\n[unknown](target.md)")

    const inserted = replaceVisible(twice, 0, 0, "start ")
    expect(serializeMarkdown(inserted)).toBe("start before **again** after\n[unknown](target.md)")

    const marker = replaceVisible(importMarkdown("x"), 0, 1, "**y**")
    expect(serializeMarkdown(marker)).toBe("**y**")
    expect(marker.visible).toBe("y")
    expect(marker.ranges.some((r) => r.visible && r.marks.includes("bold"))).toBe(true)
    const markerEdited = replaceVisible(marker, 0, 1, "z")
    expect(serializeMarkdown(markerEdited)).toBe("**z**")
    expect(markerEdited.visible).toBe("z")
  })

  it("keeps incomplete markers literal and handles deterministic empty boundaries", () => {
    const incomplete = importMarkdown("**unfinished\nplain")
    expect(incomplete.visible).toBe("**unfinished\nplain")
    expect(incomplete.ranges.find((r) => r.sourceFrom === 0)?.block).toBe("opaque")

    const emptyHeading = importMarkdown("# \n")
    expect(emptyHeading.visible).toBe("\n")
    expect(emptyHeading.ranges.find((r) => !r.visible)?.block).toBe("heading")

    const empty = importMarkdown("")
    expect(empty.visible).toBe("")
    expect(visibleToSource(empty, 0)).toBe(0)
    expect(sourceToVisible(empty, 0)).toBe(0)
    const doc = importMarkdown("**unfinished\nplain")
    expect(sourceToVisible(doc, 0)).toBe(0)
    expect(visibleToSource(doc, doc.visible.length)).toBe(doc.source.length)
    expect(() => visibleToSource(doc, doc.visible.length + 1)).toThrow(RangeError)
    expect(() => sourceToVisible(doc, doc.source.length + 1)).toThrow(RangeError)
  })
})
