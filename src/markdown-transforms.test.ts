import { describe, it, expect } from "vitest"
import { EditorState, type TransactionSpec } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
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
  return EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [markdown()],
  })
}

/** Apply a transform and return the resulting document + selection text. */
function applied(state: EditorState, spec: TransactionSpec) {
  const next = state.update(spec).state
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
    const next = s.update(toggleInline(s, BOLD)).state
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
