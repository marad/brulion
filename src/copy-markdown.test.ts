import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { Autolink } from "@lezer/markdown"
import { serializeCopy, type SelRange } from "./copy-markdown"

/**
 * Build an EditorState (with the markdown parser, so the syntax tree exists) plus
 * a list of selection ranges from a string marked with `[`…`]`. Offsets are RAW
 * document offsets, computed before the markers are stripped — place `[`/`]` where
 * a real atomic-snapped selection would begin/end (e.g. AFTER `# `, or inside a
 * bold word past `**`).
 */
function stateOf(marked: string): { state: EditorState; range: SelRange } {
  const from = marked.indexOf("[")
  const to = marked.indexOf("]") - 1
  const doc = marked.replace("[", "").replace("]", "")
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Autolink] })],
  })
  return { state, range: { from, to } }
}

/** serializeCopy for a single `[`…`]`-marked range. */
function copy(marked: string): string {
  const { state, range } = stateOf(marked)
  return serializeCopy(state, [range])
}

describe("serializeCopy", () => {
  describe("AC-1 line marker — heading", () => {
    it("prepends the heading marker run when selection starts past it", () => {
      // `## ` is 3 chars; select `llo w` inside "Hello world".
      expect(copy("## He[llo w]orld")).toBe("## llo w")
    })

    it("keeps the marker once when selection begins at text start", () => {
      // `# ` is 2 chars; select the whole word "Title" from its start.
      expect(copy("# [Title]")).toBe("# Title")
    })
  })

  describe("AC-2 line marker — blockquote & list", () => {
    it("prepends the blockquote marker run", () => {
      // `> ` is 2 chars; select "text" at the end.
      expect(copy("> quoted [text]")).toBe("> text")
    })

    it("prepends a dash list marker", () => {
      expect(copy("- buy [milk]")).toBe("- milk")
    })

    it("prepends a star list marker", () => {
      expect(copy("* a [item]")).toBe("* item")
    })
  })

  describe("AC-3 inline fragments", () => {
    it("repairs a bold fragment selected inside the word", () => {
      // doc: "a **bold** b"; select "ol" inside "bold" (offsets 5..7).
      expect(copy("a **b[ol]d** b")).toBe("**ol**")
    })

    it("repairs an italic fragment", () => {
      // doc: "a *x* b"; select "x" (offset 3..4).
      expect(copy("a *[x]* b")).toBe("*x*")
    })

    it("repairs an inline-code fragment", () => {
      // doc: "a `code` b"; select "od" inside "code" (offset 4..6).
      expect(copy("a `c[od]e` b")).toBe("`od`")
    })
  })

  describe("AC-4 boundary crossing a construct edge", () => {
    it("synthesizes the open mark without doubling the in-slice close mark", () => {
      // doc: "**bold** tail"; select from content start (offset 2) through
      // " ta" — the slice already contains the closing `**`.
      expect(copy("**[bold** ta]il")).toBe("**bold** ta")
    })
  })

  describe("AC-5 verbatim delimiters", () => {
    it("reads underscore-bold verbatim", () => {
      // doc: "a __b__ c"; select "b" (offset 4..5).
      expect(copy("a __[b]__ c")).toBe("__b__")
    })

    it("reads underscore-italic verbatim", () => {
      expect(copy("a _[i]_ c")).toBe("_i_")
    })

    it("orders nested spans outermost-first open / innermost-first close", () => {
      // doc: "**a *b* c**"; select "b" (offset 5..6).
      expect(copy("**a *[b]* c**")).toBe("***b***")
    })
  })

  describe("AC-6 full-construct byte identity", () => {
    it("leaves a fully-selected bold span untouched", () => {
      // Select the whole `**bold**`, markers included (offset 0..8).
      expect(copy("[**bold**]")).toBe("**bold**")
    })

    it("leaves a fully-selected heading line untouched", () => {
      // Select from the very start of the line, including `# `.
      expect(copy("[# Title]")).toBe("# Title")
    })
  })

  describe("AC-8 empty range", () => {
    it("contributes an empty string", () => {
      const { state } = stateOf("# He[]llo")
      const off = "# He".length
      expect(serializeCopy(state, [{ from: off, to: off }])).toBe("")
    })
  })

  describe("does not misfire where the renderer hides nothing", () => {
    function rawState(doc: string): EditorState {
      return EditorState.create({ doc, extensions: [markdown({ extensions: [Autolink] })] })
    }

    it("does not treat a fenced-code line as a heading", () => {
      // The `# comment` line is CodeText inside a fence, not a heading.
      const doc = "```\n# comment\n```"
      const from = doc.indexOf("comment")
      expect(serializeCopy(rawState(doc), [{ from, to: from + "comment".length }])).toBe(
        "comment",
      )
    })

    it("does not treat a fenced-code line as a list item", () => {
      const doc = "```\n- item\n```"
      const from = doc.indexOf("item")
      expect(serializeCopy(rawState(doc), [{ from, to: from + "item".length }])).toBe("item")
    })

    it("does not pull a marker from an (expanded) frontmatter line", () => {
      // The markdown parser parses `- tag` as a list item, but it sits in the
      // leading `---…---` frontmatter block, which the renderer leaves raw.
      const doc = "---\n- tag\n---\nbody"
      const from = doc.indexOf("tag")
      expect(serializeCopy(rawState(doc), [{ from, to: from + "tag".length }])).toBe("tag")
    })
  })

  describe("empty ranges in a multi-range selection", () => {
    it("are skipped, not joined as blank lines", () => {
      const doc = "alpha beta"
      const state = EditorState.create({
        doc,
        extensions: [markdown({ extensions: [Autolink] })],
      })
      const b = doc.indexOf("beta")
      // A collapsed caret at 0 plus a real range — the empty one must not add a
      // leading blank line.
      expect(serializeCopy(state, [{ from: 0, to: 0 }, { from: b, to: b + 4 }])).toBe("beta")
    })
  })

  describe("plain paragraph", () => {
    it("returns the slice unchanged when there are no markers", () => {
      expect(copy("just [some] text")).toBe("some")
    })
  })

  describe("multi-range", () => {
    it("joins non-empty ranges with the document line break", () => {
      const doc = "# Hello\nworld para"
      const state = EditorState.create({
        doc,
        extensions: [markdown({ extensions: [Autolink] })],
      })
      // range 1: "Hello" past the `# ` marker → "# Hello"
      const r1: SelRange = { from: 2, to: 7 }
      // range 2: "world" in the plain paragraph → "world"
      const w = doc.indexOf("world")
      const r2: SelRange = { from: w, to: w + 5 }
      expect(serializeCopy(state, [r1, r2])).toBe("# Hello" + state.lineBreak + "world")
    })
  })
})
