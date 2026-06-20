import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { markdownSyntaxRanges } from "./markdown-render"

const ranges = (doc: string) =>
  markdownSyntaxRanges(EditorState.create({ doc, extensions: [markdown()] }))

/** The exact substrings that would be hidden, for readable assertions. */
const hiddenText = (doc: string) =>
  ranges(doc).hidden.map((h) => doc.slice(h.from, h.to))

/** Content spans, as `[text, class]` pairs. */
const markText = (doc: string) =>
  ranges(doc).marks.map((m) => [doc.slice(m.from, m.to), m.cls] as const)

describe("markdownSyntaxRanges", () => {
  it("hides the heading marker plus its trailing space, styles the text", () => {
    // The styled span is the heading TEXT only — never the hidden markers, or
    // the drawn selection would be offset by their width.
    expect(hiddenText("# Title")).toEqual(["# "])
    expect(markText("# Title")).toEqual([["Title", "cm-heading cm-h1"]])
  })

  it("distinguishes heading levels", () => {
    expect(markText("### Three")).toEqual([["Three", "cm-heading cm-h3"]])
    expect(hiddenText("### Three")).toEqual(["### "])
  })

  it("keeps a bare heading marker visible until a space completes it (AC-8)", () => {
    // `##` with no trailing space: still visible, not styled — so the user sees
    // what they're typing and learns the space finishes the heading.
    expect(ranges("##")).toEqual({ hidden: [], marks: [] })
    expect(ranges("##text")).toEqual({ hidden: [], marks: [] }) // not a heading
    // Once the space arrives, the marker + space hide and styling applies.
    expect(hiddenText("## ")).toEqual(["## "])
    expect(hiddenText("## done")).toEqual(["## "])
    expect(markText("## done")).toEqual([["done", "cm-heading cm-h2"]])
  })

  it("hides bold markers (** and __) and styles the inner text", () => {
    expect(hiddenText("a **b** c")).toEqual(["**", "**"])
    expect(markText("a **b** c")).toEqual([["b", "cm-strong"]])
    expect(hiddenText("a __b__ c")).toEqual(["__", "__"])
    expect(markText("a __b__ c")).toEqual([["b", "cm-strong"]])
  })

  it("hides italic markers (* and _) and styles the inner text", () => {
    expect(hiddenText("a *b* c")).toEqual(["*", "*"])
    expect(markText("a *b* c")).toEqual([["b", "cm-em"]])
    expect(hiddenText("a _b_ c")).toEqual(["_", "_"])
    expect(markText("a _b_ c")).toEqual([["b", "cm-em"]])
  })

  it("hides inline-code backticks and styles the inner text", () => {
    expect(hiddenText("a `b` c")).toEqual(["`", "`"])
    expect(markText("a `b` c")).toEqual([["b", "cm-inline-code"]])
  })

  it("leaves plain prose untouched", () => {
    expect(ranges("just some words")).toEqual({ hidden: [], marks: [] })
  })

  it("does not hide a lone '#' that is not a heading marker", () => {
    // '#' mid-line is not an ATX heading; nothing hidden and nothing styled.
    expect(ranges("color #ff0000 value")).toEqual({ hidden: [], marks: [] })
  })

  it("leaves Setext heading underlines untouched (out of scope, not styled)", () => {
    // Hiding the `=====` without styling the title would be a glitch; this phase
    // handles ATX headings only, so setext markup stays fully visible.
    expect(ranges("Title\n=====")).toEqual({ hidden: [], marks: [] })
  })

  it("only scans the requested range", () => {
    const doc = "# One\n\n# Two"
    const state = EditorState.create({ doc, extensions: [markdown()] })
    // Restrict to the second heading's region only.
    const r = markdownSyntaxRanges(state, 7, doc.length)
    expect(r.marks.map((m) => doc.slice(m.from, m.to))).toEqual(["Two"])
  })
})
