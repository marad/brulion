import { describe, it, expect } from "vitest"
import { EditorState, type TransactionSpec } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { ensureSyntaxTree } from "@codemirror/language"
import {
  BOLD,
  ITALIC,
  CODE,
  type InlineMarker,
  toggleInline,
  headingLevelOf,
  withHeadingLevel,
  promotedLevel,
  demotedLevel,
  promoteHeading,
  demoteHeading,
  setHeading,
  setHeadingLines,
  clearFormatting,
  isEmptyMarkerLine,
  markerSpaceDeletion,
} from "./markdown-transforms"

/** Build a state with a selection, marked `|` for caret or `[`…`]` for a range. */
function stateOf(marked: string): EditorState {
  let doc = marked
  let anchor = 0
  let head = 0
  if (marked.includes("[")) {
    anchor = marked.indexOf("[")
    head = marked.indexOf("]") - 1
    doc = marked.replace("[", "").replace("]", "")
  } else {
    anchor = head = marked.indexOf("|")
    doc = marked.replace("|", "")
  }
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown()],
  })
  // Force a COMPLETE parse: clearFormatting walks the syntax tree, and a
  // time-budgeted lazy parse can be incomplete under heavy parallel-test CPU load
  // (a marker node not yet parsed → a missed strip). Loop until the tree is whole,
  // so the transforms see the full document deterministically.
  while (ensureSyntaxTree(state, doc.length, 5000) === null) {
    /* keep parsing — progress is cached on the state, so each call advances it */
  }
  return state
}

/** Apply a transform and return the resulting document + selection text.
 * A `null` spec (no-op) leaves the state unchanged. */
function applied(state: EditorState, spec: TransactionSpec | null) {
  const next = spec ? state.update(spec).state : state
  const { from, to } = next.selection.main
  return { doc: next.doc.toString(), selected: next.doc.sliceString(from, to) }
}

const toggle = (marked: string, m: InlineMarker) => {
  const s = stateOf(marked)
  return applied(s, toggleInline(s, m))
}

describe("toggleInline", () => {
  it("wraps a selection in bold and keeps it selected (AC-1)", () => {
    expect(toggle("hello [world]", BOLD)).toEqual({
      doc: "hello **world**",
      selected: "world",
    })
  })

  it("removes bold when the wrapped word is selected (AC-2)", () => {
    expect(toggle("hello **[world]**", BOLD)).toEqual({
      doc: "hello world",
      selected: "world",
    })
  })

  it("toggles italic and inline code the same way (AC-3)", () => {
    expect(toggle("a [b] c", ITALIC).doc).toBe("a *b* c")
    expect(toggle("a *[b]* c", ITALIC).doc).toBe("a b c")
    expect(toggle("a [b] c", CODE).doc).toBe("a `b` c")
    expect(toggle("a `[b]` c", CODE).doc).toBe("a b c")
  })

  it("inserts empty markers with the caret between them on no selection (AC-4)", () => {
    const s = stateOf("x|")
    const next = s.update(toggleInline(s, BOLD)!).state
    expect(next.doc.toString()).toBe("x****")
    expect(next.selection.main.empty).toBe(true)
    expect(next.selection.main.head).toBe(3) // between the two **
  })

  it("does not corrupt bold markers when toggling italic inside (AC-8)", () => {
    // `word` selected inside **word**; adding italic must keep the ** intact.
    const r = toggle("**[word]**", ITALIC)
    expect(r.doc).toBe("***word***")
  })

  it("unwraps bold cleanly without leaving a stray * from the ** pair", () => {
    // Removing bold must strip the whole **…**, never just one of the two *.
    expect(toggle("**[word]**", BOLD).doc).toBe("word")
  })

  it("unwraps rather than nesting when the selection overlaps a marker", () => {
    // Selection runs from inside a bold span past its end. Wrapping here would
    // emit invalid `****`; instead the existing span is unwrapped (valid md).
    expect(toggle("x **[bo** y]", BOLD).doc).toBe("x bo y")
  })

  it("wraps each line separately across a multi-line selection (AC: moat)", () => {
    // `**a\nb\nc**` straddles block boundaries and isn't valid CommonMark;
    // per-line markers keep the file clean.
    expect(toggle("[a\nb\nc]", BOLD).doc).toBe("**a**\n**b**\n**c**")
  })

  it("skips blank lines when wrapping a multi-line selection", () => {
    expect(toggle("[a\n\nb]", BOLD).doc).toBe("**a**\n\n**b**")
  })

  it("returns null when a multi-line selection has nothing to wrap", () => {
    // Selecting only blank lines: no change, and no empty transaction.
    expect(toggleInline(stateOf("[\n\n]"), BOLD)).toBeNull()
  })
})

describe("heading level helpers", () => {
  it("reads the ATX level, 0 for a paragraph", () => {
    expect(headingLevelOf("plain")).toBe(0)
    expect(headingLevelOf("# h1")).toBe(1)
    expect(headingLevelOf("### h3")).toBe(3)
    expect(headingLevelOf("####### not a heading")).toBe(0) // 7 # is not valid
    expect(headingLevelOf("#nospace")).toBe(0)
  })

  it("rewrites only the prefix, preserving the text", () => {
    expect(withHeadingLevel("note", 2)).toBe("## note")
    expect(withHeadingLevel("## note", 1)).toBe("# note")
    expect(withHeadingLevel("### note", 0)).toBe("note")
    expect(withHeadingLevel("note", 0)).toBe("note")
  })

  it("promotes paragraph → H3 → H2 → H1 and stops", () => {
    expect([0, 3, 2, 1].map(promotedLevel)).toEqual([3, 2, 1, 1])
  })

  it("demotes H1 → H2 → H3 → paragraph and stops", () => {
    expect([1, 2, 3, 0].map(demotedLevel)).toEqual([2, 3, 0, 0])
  })
})

describe("heading transforms on the caret line", () => {
  /** Apply a heading transform, treating a `null` (no-op) as no change. */
  const apply = (s: EditorState, spec: TransactionSpec | null) =>
    spec ? s.update(spec).state : s

  it("promotes the caret line one step (AC-5)", () => {
    let s = stateOf("no|te")
    for (const expected of ["### note", "## note", "# note", "# note"]) {
      s = apply(s, promoteHeading(s))
      expect(s.doc.toString()).toBe(expected)
    }
  })

  it("demotes the caret line and removes the heading (AC-6)", () => {
    let s = stateOf("# no|te")
    for (const expected of ["## note", "### note", "note", "note"]) {
      s = apply(s, demoteHeading(s))
      expect(s.doc.toString()).toBe(expected)
    }
  })

  it("sets a heading level directly (AC-7)", () => {
    let s = stateOf("no|te")
    s = apply(s, setHeading(2)(s))
    expect(s.doc.toString()).toBe("## note")
    s = apply(s, setHeading(1)(s))
    expect(s.doc.toString()).toBe("# note")
  })

  it("returns null (no transaction) when the level is unchanged", () => {
    // No-op promote on H1, demote on a paragraph, or set-to-current must not
    // dispatch an identity change (which would pollute undo and jump the caret).
    expect(promoteHeading(stateOf("# h|1"))).toBeNull()
    expect(demoteHeading(stateOf("para|graph"))).toBeNull()
    expect(setHeading(2)(stateOf("## al|ready"))).toBeNull()
  })

  it("acts on the line the caret is on in a multi-line doc", () => {
    const s = stateOf("first\nsec|ond\nthird")
    const next = apply(s, setHeading(1)(s))
    expect(next.doc.toString()).toBe("first\n# second\nthird")
  })
})

describe("setHeadingLines (multi-line, for the right-click menu)", () => {
  const apply = (s: EditorState, spec: TransactionSpec | null) =>
    spec ? s.update(spec).state : s

  it("turns every line touched by the selection into a heading", () => {
    const s = stateOf("[a\nb\nc]")
    expect(apply(s, setHeadingLines(s, 2)).doc.toString()).toBe("## a\n## b\n## c")
  })

  it("strips headings across the selection when leveled to paragraph", () => {
    const s = stateOf("[# one\n## two]")
    expect(apply(s, setHeadingLines(s, 0)).doc.toString()).toBe("one\ntwo")
  })

  it("covers only the lines the selection touches, not the whole doc", () => {
    const s = stateOf("keep\n[mid1\nmid2]\nkeep2")
    expect(apply(s, setHeadingLines(s, 1)).doc.toString()).toBe(
      "keep\n# mid1\n# mid2\nkeep2",
    )
  })

  it("returns null when no line would change", () => {
    expect(setHeadingLines(stateOf("[already plain]"), 0)).toBeNull()
  })

  it("does not format the next line when the selection ends at its start", () => {
    // Selection covers "a\n" and stops at the start of "b": only "a" is headed.
    const s = stateOf("[a\n]b")
    expect(apply(s, setHeadingLines(s, 1)).doc.toString()).toBe("# a\nb")
  })

  it("handles a single-line selection", () => {
    const s = stateOf("[solo]")
    expect(apply(s, setHeadingLines(s, 3)).doc.toString()).toBe("### solo")
  })
})

const clear = (marked: string) => {
  const s = stateOf(marked)
  return applied(s, clearFormatting(s)).doc
}

describe("clearFormatting", () => {
  it("unwraps inline marks to plain text (AC-1)", () => {
    expect(clear("[a **bold** and *italic* and `code`]")).toBe(
      "a bold and italic and code",
    )
    // underscore variants too
    expect(clear("[a __b__ and _i_]")).toBe("a b and i")
  })

  it("strips a heading prefix (AC-2)", () => {
    expect(clear("|## Title")).toBe("Title")
    expect(clear("|###### deep")).toBe("deep")
  })

  it("strips a blockquote marker (AC-3)", () => {
    expect(clear("|> quoted")).toBe("quoted")
  })

  it("strips an unordered-list marker (AC-4)", () => {
    expect(clear("|* item")).toBe("item")
    expect(clear("|- item")).toBe("item")
  })

  it("strips block prefix and inline marks together on the caret line", () => {
    expect(clear("|## A **bold** title")).toBe("A bold title")
    expect(clear("|> a *quote*")).toBe("a quote")
  })

  it("clears every line a multi-line selection touches (AC-5)", () => {
    expect(clear("[# Heading\n**bold** here\n> quote]")).toBe(
      "Heading\nbold here\nquote",
    )
  })

  it("unwraps nested inline marks completely (AC-6)", () => {
    expect(clear("|**_x_**")).toBe("x")
  })

  it("is a no-op on an unformatted line (AC-7)", () => {
    const s = stateOf("|just text")
    expect(clearFormatting(s)).toBeNull()
  })

  it("leaves ordered-list numbers and fenced-code fences intact (AC-10)", () => {
    expect(clearFormatting(stateOf("|1. item"))).toBeNull()
    // A fenced block: fences (and the body) are out of scope, so no change.
    expect(clearFormatting(stateOf("|```js\ncode\n```"))).toBeNull()
  })

  it("does not clear the next line when a selection ends at its start", () => {
    // Selection covers "# a\n" and stops at the start of "## b": only "a" clears.
    expect(clear("[# a\n]## b")).toBe("a\n## b")
  })
})

describe("isEmptyMarkerLine", () => {
  it("is true for a line that is only a list/quote marker (+ whitespace)", () => {
    for (const t of ["* ", "- ", "+ ", "> ", ">", "1. ", "2) ", "  * ", "> > "]) {
      expect(isEmptyMarkerLine(t)).toBe(true)
    }
  })

  it("is false when the marker carries content, or there is no marker", () => {
    for (const t of ["* a", "> a", "1. x", "plain", "   ", "", "a > b"]) {
      expect(isEmptyMarkerLine(t)).toBe(false)
    }
  })
})

describe("markerSpaceDeletion", () => {
  const del = (marked: string) => {
    const s = stateOf(marked)
    return applied(s, markerSpaceDeletion(s))
  }
  const spec = (marked: string) => {
    const s = stateOf(marked)
    return markerSpaceDeletion(s)
  }

  it("deletes only the trailing space after a completed bullet, leaving the marker (AC-6)", () => {
    expect(del("- |").doc).toBe("-")
    expect(del("* |").doc).toBe("*")
  })

  it("leaves the marker on a bullet line that has content (AC-6)", () => {
    // Caret right after the marker run, before the text: only the space goes.
    expect(del("- |text").doc).toBe("-text")
  })

  it("puts the caret right after the bare marker (so a second Backspace removes it)", () => {
    const s = stateOf("- |")
    const next = s.update(markerSpaceDeletion(s)!).state
    expect(next.selection.main.head).toBe(1) // after the "-"
  })

  it("applies to heading and blockquote markers too (AC-7)", () => {
    expect(del("# |").doc).toBe("#")
    expect(del("### |").doc).toBe("###")
    expect(del("> |").doc).toBe(">")
    expect(del("  - |").doc).toBe("  -") // indented marker
  })

  it("does not fire without a completed marker before the caret", () => {
    expect(spec("-|")).toBeNull() // bare marker, no trailing space
    expect(spec("|- ")).toBeNull() // caret at line start
    expect(spec("hello |")).toBeNull() // a space, but not after a marker
    expect(spec("- text|")).toBeNull() // caret after content, not the marker
    expect(spec("####### |")).toBeNull() // 7 hashes is not a heading marker → no special delete
  })

  it("does not fire on a non-empty selection", () => {
    expect(spec("[- ]")).toBeNull()
  })
})
