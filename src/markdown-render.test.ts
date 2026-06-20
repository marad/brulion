import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { markdownSyntaxRanges, blockSyntaxRanges } from "./markdown-render"

const state = (doc: string) => EditorState.create({ doc, extensions: [markdown()] })
const ranges = (doc: string) => markdownSyntaxRanges(state(doc))

/** The exact substrings that would be hidden, for readable assertions. */
const hiddenText = (doc: string) =>
  ranges(doc).hidden.map((h) => doc.slice(h.from, h.to))

/** Content spans, as `[text, class]` pairs. */
const markText = (doc: string) =>
  ranges(doc).marks.map((m) => [doc.slice(m.from, m.to), m.cls] as const)

const blocks = (doc: string) => blockSyntaxRanges(state(doc))

/** Block-construct hides, as the exact hidden substrings. */
const blockHiddenText = (doc: string) =>
  blocks(doc).hidden.map((h) => doc.slice(h.from, h.to))

/** Block content spans (the code-block body), as `[text, class]` pairs. */
const blockMarkText = (doc: string) =>
  blocks(doc).marks.map((m) => [doc.slice(m.from, m.to), m.cls] as const)

/** Block line decorations, as `[line text, class]` pairs (line starting at `from`). */
const lineMarks = (doc: string) =>
  blocks(doc).lines.map((l) => {
    const nl = doc.indexOf("\n", l.from)
    return [doc.slice(l.from, nl === -1 ? doc.length : nl), l.cls] as const
  })

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

// FEAT-0016: block constructs render through a separate StateField, so they have
// their own pure function (line-break-replacing hides are illegal from a plugin).
describe("blockSyntaxRanges", () => {
  it("collapses both fences of a closed code block and styles the body (AC-1)", () => {
    const doc = "```js\ncode\n```"
    // Opening fence line (incl. language + newline) and closing fence line (incl.
    // its leading newline) are hidden; the body is styled as a code span (a mark,
    // not a line — the fence collapse merges the body into the fence's line).
    expect(blockHiddenText(doc)).toEqual(["```js\n", "\n```"])
    expect(blockMarkText(doc)).toEqual([["code", "cm-code-block"]])
  })

  it("styles the whole body of a multi-line code block (AC-1)", () => {
    const doc = "```\na\nb\n```"
    expect(blockMarkText(doc)).toEqual([["a\nb", "cm-code-block"]])
  })

  it("leaves an unclosed code block fully visible (don't vanish mid-typing)", () => {
    // Only one fence so far — collapsing it would make the ``` the user just
    // typed disappear, same anti-pattern as a bare heading marker (AC-8 spirit).
    expect(blocks("```js\ncode")).toEqual({ hidden: [], lines: [], marks: [] })
  })

  it("hides the blockquote marker and styles the line as a quote (AC-2)", () => {
    expect(blockHiddenText("> quoted")).toEqual(["> "])
    expect(lineMarks("> quoted")).toEqual([["> quoted", "cm-blockquote"]])
  })

  it("hides every marker across a multi-line blockquote (AC-3)", () => {
    const doc = "> a\n> b"
    expect(blockHiddenText(doc)).toEqual(["> ", "> "])
    expect(lineMarks(doc)).toEqual([
      ["> a", "cm-blockquote"],
      ["> b", "cm-blockquote"],
    ])
  })

  it("handles a nested blockquote once, with no duplicate hides or lines", () => {
    // The outer blockquote's subtree walk already collects the inner `>`s and its
    // line span already covers the nested lines; the inner Blockquote node must be
    // skipped so we don't emit the same hide / line decoration twice.
    const doc = "> outer\n> > nested"
    expect(blockHiddenText(doc)).toEqual(["> ", "> ", "> "])
    expect(lineMarks(doc)).toEqual([
      ["> outer", "cm-blockquote"],
      ["> > nested", "cm-blockquote"],
    ])
  })

  it("hides the bullet marker and emits a list-item line (AC-4)", () => {
    expect(blockHiddenText("* item")).toEqual(["* "])
    expect(lineMarks("* item")).toEqual([["* item", "cm-list-item"]])
    // `-` markers behave identically.
    expect(blockHiddenText("- item")).toEqual(["- "])
    expect(lineMarks("- item")).toEqual([["- item", "cm-list-item"]])
  })

  it("hides the marker on each item of a multi-item list (AC-4)", () => {
    const doc = "* one\n* two"
    expect(blockHiddenText(doc)).toEqual(["* ", "* "])
    expect(lineMarks(doc)).toEqual([
      ["* one", "cm-list-item"],
      ["* two", "cm-list-item"],
    ])
  })

  it("leaves ordered lists and plain prose untouched (out of scope, AC-8)", () => {
    expect(blocks("1. item")).toEqual({ hidden: [], lines: [], marks: [] })
    expect(blocks("just some words")).toEqual({ hidden: [], lines: [], marks: [] })
  })

  it("composes with inline rendering: a quote marker hides, inner bold still renders", () => {
    // The block field hides the `> ` and styles the line; the inline plugin
    // (markdownSyntaxRanges) independently hides the `**` and bolds the word.
    const doc = "> a **b** c"
    expect(blockHiddenText(doc)).toEqual(["> "])
    expect(lineMarks(doc)).toEqual([["> a **b** c", "cm-blockquote"]])
    expect(hiddenText(doc)).toEqual(["**", "**"])
    expect(markText(doc)).toEqual([["b", "cm-strong"]])
  })
})
