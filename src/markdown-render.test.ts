import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import {
  markdownSyntaxRanges,
  blockSyntaxRanges,
  linkContext,
  type LinkContext,
} from "./markdown-render"

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

/** Block line decorations, as `[line text, class]` pairs (line starting at `from`). */
const lineMarks = (doc: string) =>
  blocks(doc).lines.map((l) => {
    const nl = doc.indexOf("\n", l.from)
    return [doc.slice(l.from, nl === -1 ? doc.length : nl), l.cls] as const
  })

/** Bullet-marker replacements, as `[replaced run, marker]` pairs (FEAT-0019). */
const bulletMarks = (doc: string) =>
  blocks(doc).bullets.map((b) => [doc.slice(b.from, b.to), b.marker] as const)

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
// their own pure function. None of their hides cross a line break (fence lines are
// emptied in place, not collapsed), so the line decorations anchor reliably.
describe("blockSyntaxRanges", () => {
  it("empties both fence lines and styles every block line as a code box (AC-1)", () => {
    const doc = "```js\ncode\n```"
    // The fence text is hidden in place (each fence line becomes an empty,
    // styled padding row); every line of the block carries the code-block class,
    // with rounded top/bottom rows.
    expect(blockHiddenText(doc)).toEqual(["```js", "```"])
    expect(lineMarks(doc)).toEqual([
      ["```js", "cm-code-block cm-code-top"],
      ["code", "cm-code-block"],
      ["```", "cm-code-block cm-code-bottom"],
    ])
  })

  it("styles every line of a multi-line code block (AC-1)", () => {
    const doc = "```\na\nb\n```"
    expect(lineMarks(doc)).toEqual([
      ["```", "cm-code-block cm-code-top"],
      ["a", "cm-code-block"],
      ["b", "cm-code-block"],
      ["```", "cm-code-block cm-code-bottom"],
    ])
  })

  it("leaves an unclosed code block fully visible (don't vanish mid-typing)", () => {
    // Only one fence so far — styling/hiding it would make the ``` the user just
    // typed disappear, same anti-pattern as a bare heading marker (AC-8 spirit).
    expect(blocks("```js\ncode")).toEqual({ hidden: [], lines: [], bullets: [] })
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

  it("hides a continuation `>` even when the grammar drops the QuoteMark node (AC-3)", () => {
    // `> a` then `> -`: CommonMark reads the `-` as a Setext underline and folds
    // line 2 into a SetextHeading2, so its `>` is NOT a QuoteMark node. Hiding by
    // structural line scan (not by node) keeps the `>` hidden anyway.
    const doc = "> a\n> -"
    expect(blockHiddenText(doc)).toEqual(["> ", "> "])
    expect(lineMarks(doc)).toEqual([
      ["> a", "cm-blockquote"],
      ["> -", "cm-blockquote"],
    ])
  })

  it("hides both markers of a nested blockquote line, once each", () => {
    const doc = "> outer\n> > nested"
    expect(blockHiddenText(doc)).toEqual(["> ", "> ", "> "])
    expect(lineMarks(doc)).toEqual([
      ["> outer", "cm-blockquote"],
      ["> > nested", "cm-blockquote"],
    ])
  })

  it("only hides the leading `>` run, not a `>` in the content", () => {
    expect(blockHiddenText("> a > b")).toEqual(["> "])
  })

  it("replaces the bullet marker with a widget run, not a hide+line (FEAT-0019 AC-1)", () => {
    // The whole `* `/`- ` run is replaced by a bullet widget — no separate hide
    // and no `cm-list-*` line decoration drawn over an emptied line.
    expect(bulletMarks("* item")).toEqual([["* ", "*"]])
    expect(blockHiddenText("* item")).toEqual([])
    expect(lineMarks("* item")).toEqual([])
    expect(bulletMarks("- item")).toEqual([["- ", "-"]])
    expect(blockHiddenText("- item")).toEqual([])
    expect(lineMarks("- item")).toEqual([])
  })

  it("keeps a bare bullet marker visible until a space completes it (FEAT-0019 AC-2)", () => {
    // No trailing space yet: nothing replaced, nothing hidden — the `*`/`-` stays
    // a literal char (the bare-`#` heading rule), so the caret has nothing to
    // disagree with while the marker is being typed.
    expect(blocks("*")).toEqual({ hidden: [], lines: [], bullets: [] })
    expect(blocks("-")).toEqual({ hidden: [], lines: [], bullets: [] })
  })

  it("replaces the marker on each item of a multi-item list (FEAT-0019 AC-1)", () => {
    const doc = "* one\n* two"
    expect(bulletMarks(doc)).toEqual([
      ["* ", "*"],
      ["* ", "*"],
    ])
    expect(blockHiddenText(doc)).toEqual([])
  })

  it("renders distinct markers for * and - (FEAT-0019 AC-3)", () => {
    const doc = "* disc\n- dash"
    expect(bulletMarks(doc)).toEqual([
      ["* ", "*"],
      ["- ", "-"],
    ])
  })

  it("leaves ordered lists and plain prose untouched (out of scope, AC-8)", () => {
    expect(blocks("1. item")).toEqual({ hidden: [], lines: [], bullets: [] })
    expect(blocks("just some words")).toEqual({ hidden: [], lines: [], bullets: [] })
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

describe("markdownSyntaxRanges links (FEAT-0025)", () => {
  const linkState = (doc: string, ctx: LinkContext) =>
    EditorState.create({ doc, extensions: [markdown(), linkContext.of(ctx)] })
  const linkRanges = (doc: string, ctx: LinkContext) => markdownSyntaxRanges(linkState(doc, ctx))
  const linkMarks = (doc: string, ctx: LinkContext) =>
    linkRanges(doc, ctx).marks.map(
      (m) => [doc.slice(m.from, m.to), m.cls, m.attrs?.["data-href"]] as const,
    )
  const linkHidden = (doc: string, ctx: LinkContext) =>
    linkRanges(doc, ctx).hidden.map((h) => doc.slice(h.from, h.to))

  const ctx = (active: string, paths: string[]): LinkContext => ({
    activeNote: active,
    notePaths: new Set(paths),
  })

  it("hides the link markup and styles the text, carrying the href (AC-4)", () => {
    const doc = "see [the note](sub/b.md)"
    const c = ctx("a.md", ["a.md", "sub/b.md"])
    expect(linkHidden(doc, c)).toEqual(["[", "](sub/b.md)"])
    expect(linkMarks(doc, c)).toEqual([["the note", "cm-link", "sub/b.md"]])
  })

  it("marks an internal link to a missing note as broken (AC-5)", () => {
    const doc = "see [gone](missing.md)"
    expect(linkMarks(doc, ctx("a.md", ["a.md"]))).toEqual([
      ["gone", "cm-link cm-link-broken", "missing.md"],
    ])
  })

  it("never marks an external link broken", () => {
    const doc = "[site](https://example.com)"
    expect(linkMarks(doc, ctx("a.md", []))).toEqual([
      ["site", "cm-link", "https://example.com"],
    ])
  })

  it("leaves a shortcut link [x] (no url) untouched", () => {
    const doc = "a [x] b"
    expect(linkRanges(doc, ctx("a.md", []))).toEqual({ hidden: [], marks: [] })
  })
})
