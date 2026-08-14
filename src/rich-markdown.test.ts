import { describe, expect, it } from "vitest"
import {
  importMarkdown,
  serializeMarkdown,
  sourceToVisible,
  visibleToSource,
  replaceVisible,
  applyInlineInputRule,
  classifyInlineBoundary,
  toggleInlineMark,
  classifyBlockBoundary,
  applyBlockInputRule,
  applyBlockEnter,
  applyBlockBackspace,
  indentBlocks,
} from "./rich-markdown"

describe("rich Markdown document", () => {
  it("applies block boundaries and block editing without exposing source prefixes", () => {
    expect(classifyBlockBoundary("# ", 2, "space")?.kind).toBe("heading")
    expect(classifyBlockBoundary("> ", 2, "space")?.kind).toBe("quote")
    expect(classifyBlockBoundary("- ", 2, "space")?.kind).toBe("unordered-list")
    expect(importMarkdown("* ").visible).toBe("")
    expect(applyBlockEnter(importMarkdown("* "), 0).document.source).toBe("\n")
    expect(classifyBlockBoundary("#", 1, "space")).toBeNull()
    expect(importMarkdown(">quote").visible).toBe(">quote")
    expect(importMarkdown(">").visible).toBe(">")
    expect(applyBlockInputRule(importMarkdown("# "), 2, "space").document.visible).toBe("")

    const continued = applyBlockEnter(importMarkdown("> quote"), 5)
    expect(continued.document.source).toBe("> quote\n> ")
    expect(continued.document.visible).toBe("quote\n")
    expect(continued.document.source.slice(continued.document.source.length - 2)).toBe("> ")
    const markedContinuation = applyBlockEnter(importMarkdown("- **x**"), 1)
    expect(markedContinuation.document.source).toBe("- **x**\n- ")
    expect(markedContinuation.document.visible).toBe("x\n")
    const markedStart = applyBlockEnter(importMarkdown("- **x**"), 0)
    expect(markedStart.document.source).toBe("- \n- **x**")
    expect(markedStart.document.visible).toBe("\nx")
    expect(applyBlockEnter(importMarkdown("- **xy**"), 1).changed).toBe(false)
    expect(applyBlockEnter(importMarkdown("- **a *b* c**"), 2).changed).toBe(false)
    expect(applyBlockEnter(importMarkdown("- **a *b* c**"), 3).changed).toBe(false)
    const interiorContinuation = applyBlockEnter(importMarkdown("> abc"), 2)
    expect(interiorContinuation.document.source).toBe("> ab\n> c")
    const crlfContinuation = applyBlockEnter(importMarkdown("- **x**\r\n"), 1)
    expect(crlfContinuation.document.source).toBe("- **x**\r\n- ")
    expect(crlfContinuation.document.source.includes("\n\r\n")).toBe(false)
    const crlfAtEof = applyBlockEnter(importMarkdown("- one\r\n- two"), 5)
    expect(crlfAtEof.document.source).toBe("- one\r\n- \r\n- two")
    const nestedContinuation = applyBlockEnter(importMarkdown("  - one"), 3)
    expect(nestedContinuation.document.source).toBe("  - one\n  - ")
    const orderedContinuation = applyBlockEnter(importMarkdown("1. one"), 3)
    expect(orderedContinuation.document.source).toBe("1. one\n")
    expect(orderedContinuation.document.visible).toBe("one\n")
    const exited = applyBlockEnter(importMarkdown("- "), 0)
    expect(exited.document.source).toBe("\n")
    expect(exited.document.visible).toBe("\n")
    expect(applyBlockEnter(importMarkdown("- \nnext"), 0).document.source).toBe("\nnext")

    const removed = applyBlockBackspace(importMarkdown("# "), 0)
    expect(removed.document.source).toBe("")
    expect(removed.document.visible).toBe("")
    expect(applyBlockBackspace(importMarkdown("1. "), 0).changed).toBe(false)
    expect(applyBlockBackspace(importMarkdown("1. "), 0).document.source).toBe("1. ")
    expect(applyBlockBackspace(importMarkdown("# title"), 0).changed).toBe(false)
    expect(applyBlockEnter(importMarkdown("> [x](a)"), 0).changed).toBe(true)

    const list = importMarkdown("- one\r\n- two\r\n1. keep\nraw")
    expect(indentBlocks(list, 0, 0, "indent")).toBeNull()
    const indented = indentBlocks(list, 0, 8, "indent")
    expect(indented?.document.source).toBe("  - one\r\n  - two\r\n1. keep\nraw")
    expect(indented?.document.visible).toBe(list.visible)
    const outdented = indentBlocks(indented!.document, 0, 8, "outdent")
    expect(outdented?.document.source).toBe(list.source)
    expect(serializeMarkdown(outdented!.document)).toBe(list.source)
    expect(indentBlocks(importMarkdown("> [x](a)"), 0, 3, "indent")).toBeNull()
    const adjacentRich = toggleInlineMark(importMarkdown("hello\n- x"), 1, 4, "bold")!.document
    const preservedRich = indentBlocks(adjacentRich, 6, 7, "indent")
    expect(preservedRich?.document.visible).toBe("hello\nx")
    expect(serializeMarkdown(preservedRich!.document)).toBe("h**ell**o\n  - x")
    const markedList = toggleInlineMark(importMarkdown("- hello"), 1, 4, "bold")!.document
    const indentedMarkedList = indentBlocks(markedList, 0, 5, "indent")
    expect(indentedMarkedList?.document.visible).toBe("hello")
    expect(serializeMarkdown(indentedMarkedList!.document)).toBe("  - h**ell**o")
  })
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
    expect(visibleToSource(importMarkdown("**x**"), 1)).toBe(3)
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

    const reverseNested = importMarkdown("*outer **inner***")
    expect(reverseNested.visible).toBe("outer inner")
    expect(reverseNested.ranges.some((r) => r.visible && r.marks.includes("italic") && r.marks.includes("bold"))).toBe(true)
    expect(toggleInlineMark(reverseNested, 1, 1, "italic")).toBeNull()
    expect(toggleInlineMark(reverseNested, 12, 12, "italic")).toBeNull()
    const innerUnwrapped = toggleInlineMark(reverseNested, 7, 7, "bold")
    expect(serializeMarkdown(innerUnwrapped!.document)).toBe("*outer inner*")

    const strongAroundEmphasis = importMarkdown("**bold *italic***")
    expect(strongAroundEmphasis.visible).toBe("bold italic")
    expect(strongAroundEmphasis.ranges.some((r) => r.visible && r.marks.includes("bold") && !r.marks.includes("italic"))).toBe(true)
    expect(strongAroundEmphasis.ranges.some((r) => r.visible && r.marks.includes("bold") && r.marks.includes("italic"))).toBe(true)

    const intraword = importMarkdown("**foo_bar_baz**")
    expect(intraword.visible).toBe("foo_bar_baz")
    expect(intraword.ranges.find((r) => r.visible)?.marks).toEqual(["bold"])

    const tripleUnderscore = importMarkdown("___x___ a___b___ ")
    expect(tripleUnderscore.visible).toBe("x a___b___ ")
    expect(tripleUnderscore.ranges.some((r) => r.visible && r.marks.includes("italic") && r.contentFrom > 8)).toBe(false)

    const unicodeIntraword = importMarkdown("café_bar_baz")
    expect(unicodeIntraword.visible).toBe("café_bar_baz")
    expect(unicodeIntraword.ranges.every((r) => !r.marks.includes("italic"))).toBe(true)
  })

  it("preserves unknown syntax as an opaque visible region", () => {
    const doc = importMarkdown("before ^^future^^ after\n~~unsupported~~")
    expect(doc.visible).toBe("before ^^future^^ after\n~~unsupported~~")
    const opaque = doc.ranges.find((r) => r.visible && r.sourceFrom === "before ^^future^^ after\n".length)
    expect(opaque?.block).toBe("opaque")
    expect(opaque?.marks).toEqual([])

    const unsupported = importMarkdown("before ~~strike~~ after")
    expect(unsupported.visible).toBe("before ~~strike~~ after")
    expect(unsupported.ranges[0]?.block).toBe("opaque")

    const incompleteLink = importMarkdown("[unknown] and [x](target")
    expect(incompleteLink.visible).toBe("[unknown] and [x](target")
    expect(incompleteLink.ranges[0]?.block).toBe("opaque")

    const incompleteUnsupported = importMarkdown("~~strike and <div")
    expect(incompleteUnsupported.visible).toBe("~~strike and <div")
    expect(incompleteUnsupported.ranges[0]?.block).toBe("opaque")

    const comment = importMarkdown("<!-- **x** -->")
    expect(comment.visible).toBe("<!-- **x** -->")
    expect(comment.ranges[0]?.block).toBe("opaque")

    const incompleteMarker = importMarkdown("^^future")
    expect(incompleteMarker.visible).toBe("^^future")
    expect(incompleteMarker.ranges[0]?.block).toBe("opaque")

    const malformedList = importMarkdown("* x*")
    expect(malformedList.visible).toBe("* x*")
    expect(malformedList.ranges).toHaveLength(1)
    expect(malformedList.ranges[0]?.block).toBe("opaque")

    const multilineComment = importMarkdown("<!--\n**x**\n-->")
    expect(multilineComment.visible).toBe("<!--\n**x**\n-->")
    expect(multilineComment.ranges.some((r) => r.block !== "opaque" && r.visible)).toBe(false)
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
    expect(marker.visible).toBe("**y**")
    const markerFlushed = applyInlineInputRule(marker, marker.source.length, "eof")
    expect(markerFlushed.document.visible).toBe("y")
    expect(markerFlushed.document.ranges.some((r) => r.visible && r.marks.includes("bold"))).toBe(true)
    const markerEdited = replaceVisible(markerFlushed.document, 0, 1, "z")
    expect(serializeMarkdown(markerEdited)).toBe("**z**")
    expect(markerEdited.visible).toBe("z")
  })

  it("applies explicit inline input boundaries without changing source bytes", () => {
    const source = "**hello** "
    const result = applyInlineInputRule(importMarkdown(source), source.length, "space")
    expect(result.converted).toBe(true)
    expect(result.document.visible).toBe("hello ")
    expect(result.caret).toBe("hello ".length)
    expect(serializeMarkdown(result.document)).toBe(source)

    expect(applyInlineInputRule(importMarkdown("**hello**"), 9, "eof").converted).toBe(true)
    expect(applyInlineInputRule(importMarkdown("**hello"), 7, "eof").converted).toBe(false)
    expect(applyInlineInputRule(importMarkdown("**hello**."), 10, "eof").converted).toBe(false)
    expect(applyInlineInputRule(importMarkdown("http://**hello** "), 17, "space").converted).toBe(false)
    expect(importMarkdown("http://**hello** ").visible).toBe("http://**hello** ")
    expect(importMarkdown("say **hello**.").visible).toBe("say **hello**.")
    expect(importMarkdown("say **hello**.").ranges[0]?.block).toBe("opaque")
    expect(importMarkdown("http://foo**hello** ").visible).toBe("http://foo**hello** ")
    expect(importMarkdown("**ok** http://foo**bad** ").visible).toBe("**ok** http://foo**bad** ")
    expect(importMarkdown("a__b__c").visible).toBe("a__b__c")
    expect(importMarkdown("a**,...** ").visible).toBe("a**,...** ")
    expect(applyInlineInputRule(importMarkdown("a**,...** "), 9, "space").converted).toBe(false)
    const ordinaryEdit = replaceVisible(importMarkdown("**ok** a_b_c"), 3, 4, "A")
    expect(ordinaryEdit.visible).toBe("ok A_b_c")
    expect(serializeMarkdown(ordinaryEdit)).toBe("**ok** A_b_c")
    const unrelatedFormatting = toggleInlineMark(importMarkdown("a_b_c plain"), 6, 11, "bold")
    expect(unrelatedFormatting?.document.visible).toBe("a_b_c plain")
    const editedLiteral = replaceVisible(unrelatedFormatting!.document, 2, 3, "Z")
    expect(editedLiteral.visible).toBe("a_Z_c plain")
    expect(serializeMarkdown(editedLiteral)).toBe("a_Z_c **plain**")
    expect(applyInlineInputRule(importMarkdown("# **hello** "), 13, "space").converted).toBe(false)
    const fenced = "```md\n**x**\n```"
    expect(applyInlineInputRule(importMarkdown(fenced), fenced.indexOf("**x**") + 5, "enter").converted).toBe(false)
    const frontmatter = "---\n**x**\n---"
    expect(applyInlineInputRule(importMarkdown(frontmatter), frontmatter.indexOf("**x**") + 5, "enter").converted).toBe(false)
    const commentSource = "<!--\n**x**\n-->"
    expect(applyInlineInputRule(importMarkdown(commentSource), commentSource.indexOf("**x**") + 5, "enter").converted).toBe(false)
    expect(classifyInlineBoundary("**hello** ", 10, "space")?.kind).toBe("bold")
    expect(classifyInlineBoundary("say **hello** ", 14, "space")?.sourceFrom).toBe(4)
    expect(classifyInlineBoundary("**a** **b** ", 12, "space")?.sourceFrom).toBe(6)
    const eof = classifyInlineBoundary("**hello** ", 10, "eof")
    expect(eof?.sourceTo).toBe(9)
    expect(eof?.contentTo).toBe(7)
    expect(classifyInlineBoundary("**hello\\** ", 11, "space")).toBeNull()
    expect(classifyInlineBoundary("**hello", 7, "eof")).toBeNull()
    expect(classifyInlineBoundary("**hello**x", 9, "eof")).toBeNull()
    expect(applyInlineInputRule(importMarkdown("**hello**http://x"), 9, "enter").converted).toBe(false)
    expect(applyInlineInputRule(importMarkdown("**ok** http://foo**bad** "), 25, "space").converted).toBe(false)
    expect(applyInlineInputRule(importMarkdown("# **hello** "), 13, "space").caret).toBe("hello ".length)

    const typed = replaceVisible(importMarkdown(""), 0, 0, "**hello**")
    expect(typed.visible).toBe("**hello**")
    expect(typed.pendingLineStarts).toEqual([0])
    expect(applyInlineInputRule(typed, typed.source.length, "eof").document.visible).toBe("hello")
    const pendingWithNewline = replaceVisible(typed, typed.visible.length, typed.visible.length, "\n")
    const flushedAfterNewline = applyInlineInputRule(pendingWithNewline, pendingWithNewline.source.length, "eof")
    expect(flushedAfterNewline.converted).toBe(true)
    expect(flushedAfterNewline.document.pendingLineStarts).toEqual([])
    expect(flushedAfterNewline.document.visible).toBe("hello\n")
    const shifted = replaceVisible(typed, 0, 0, "x")
    expect(shifted.pendingLineStarts).toEqual([0])
    const clearedPending = replaceVisible(typed, 0, typed.visible.length, "plain")
    expect(clearedPending.pendingLineStarts).toEqual([])
    expect(clearedPending.visible).toBe("plain")
    expect(toggleInlineMark(clearedPending, 0, 5, "bold")?.document.visible).toBe("plain")
    const twoPending = replaceVisible(typed, typed.visible.length, typed.visible.length, "\n**b**")
    expect(twoPending.pendingLineStarts).toEqual([0, 10])
    const firstFlushed = applyInlineInputRule(twoPending, 9, "enter")
    expect(firstFlushed.document.visible).toBe("hello\n**b**")
    expect(firstFlushed.document.pendingLineStarts).toEqual([10])

    const pending = importMarkdown("**hello**")
    for (const boundary of ["tab", "blur", "save"] as const) {
      const flushed = applyInlineInputRule(pending, pending.source.length, boundary)
      expect(flushed.converted).toBe(true)
      expect(flushed.document.visible).toBe("hello")
      expect(serializeMarkdown(flushed.document)).toBe(pending.source)
    }
    const repeated = applyInlineInputRule(pending, pending.source.length, "save")
    expect(applyInlineInputRule(repeated.document, repeated.document.source.length, "save").document.visible).toBe("hello")
    expect(serializeMarkdown(pending)).toBe("**hello**")
  })

  it("toggles rich inline marks canonically and unwraps imported spelling", () => {
    const plain = importMarkdown("hello")
    const wrapped = toggleInlineMark(plain, 0, 5, "bold")
    expect(wrapped?.document.visible).toBe("hello")
    expect(serializeMarkdown(wrapped!.document)).toBe("**hello**")
    expect(wrapped!.anchor).toBe(0)
    expect(wrapped!.head).toBe(5)

    const imported = importMarkdown("__hello__")
    const unwrapped = toggleInlineMark(imported, 0, 5, "bold")
    expect(serializeMarkdown(unwrapped!.document)).toBe("hello")
    expect(unwrapped!.document.visible).toBe("hello")

    const partial = toggleInlineMark(importMarkdown("**hello**"), 1, 4, "bold")
    expect(serializeMarkdown(partial!.document)).toBe("**h**ell**o**")
    expect(partial!.document.visible).toBe("hello")

    expect(toggleInlineMark(importMarkdown("  "), 0, 2, "italic")).toBeNull()
    expect(toggleInlineMark(importMarkdown("`hello`"), 0, 5, "code")?.document.visible).toBe("hello")
    expect(toggleInlineMark(importMarkdown("`hello`"), 0, 5, "bold")).toBeNull()
    expect(toggleInlineMark(importMarkdown("***hello***"), 1, 4, "bold")).toBeNull()

    expect(toggleInlineMark(importMarkdown("hello"), 2, 2, "italic")).toBeNull()
    const caretUnwrap = toggleInlineMark(importMarkdown("**hello**"), 2, 2, "bold")
    expect(serializeMarkdown(caretUnwrap!.document)).toBe("hello")

    const reverse = toggleInlineMark(importMarkdown("hello"), 5, 0, "bold")
    expect(reverse?.anchor).toBe(5)
    expect(reverse?.head).toBe(0)

    const insideWord = toggleInlineMark(importMarkdown("hello"), 1, 4, "bold")
    expect(serializeMarkdown(insideWord!.document)).toBe("h**ell**o")
    expect(insideWord!.document.visible).toBe("hello")
    expect(insideWord!.document.ranges.some((r) => r.visible && r.marks.includes("bold"))).toBe(true)
    expect(toggleInlineMark(importMarkdown("http://example.com"), 7, 14, "bold")).toBeNull()

    const underscorePartial = toggleInlineMark(importMarkdown("__hello__"), 1, 4, "bold")
    expect(serializeMarkdown(underscorePartial!.document)).toBe("__h__ell__o__")
    expect(underscorePartial!.document.visible).toBe("hello")
    const singleUnderscorePartial = toggleInlineMark(importMarkdown("_hello_"), 1, 4, "italic")
    expect(singleUnderscorePartial!.document.visible).toBe("hello")

    const outerUnwrapped = toggleInlineMark(importMarkdown("*outer **inner** end*"), 0, 15, "italic")
    expect(serializeMarkdown(outerUnwrapped!.document)).toBe("outer **inner** end")
    expect(outerUnwrapped!.document.visible).toBe("outer inner end")

    const tripleItalic = toggleInlineMark(importMarkdown("***hello***"), 0, 5, "italic")
    expect(serializeMarkdown(tripleItalic!.document)).toBe("**hello**")
    expect(tripleItalic!.document.visible).toBe("hello")
    const underscoreItalic = toggleInlineMark(importMarkdown("___hello___"), 0, 5, "italic")
    expect(serializeMarkdown(underscoreItalic!.document)).toBe("__hello__")
    expect(underscoreItalic!.document.visible).toBe("hello")

    const punctuation = toggleInlineMark(importMarkdown("a,. next"), 1, 2, "bold")
    expect(serializeMarkdown(punctuation!.document)).toBe("a**,**. next")
    expect(punctuation!.document.visible).toBe("a,. next")
    const stablePunctuation = replaceVisible(punctuation!.document, 0, 0, "")
    expect(stablePunctuation.visible).toBe("a,. next")
    expect(stablePunctuation.ranges.some((range) => range.visible && range.marks.includes("bold"))).toBe(true)

    expect(toggleInlineMark(importMarkdown("~~raw~~"), 0, 5, "bold")).toBeNull()
    expect(toggleInlineMark(importMarkdown("**a** b"), 0, 3, "italic")).toBeNull()
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
