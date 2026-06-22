import { describe, it, expect } from "vitest"
import { EditorState, type SelectionRange } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { snapOutOfSpans, leadingHiddenEnd, vimCaretGuard, type Span } from "./vim-caret"

// FEAT-0032 AC-1..AC-5: the pure rule that keeps a caret endpoint out of a hidden
// markup run. A position strictly inside a run snaps to an edge — forward when the
// motion advanced, backward when it retreated; edges and outside positions are
// left untouched.

const heading: Span[] = [{ from: 0, to: 2 }] // a `# ` run at the line start

describe("snapOutOfSpans", () => {
  it("snaps a forward motion to the run's end (AC-1)", () => {
    // `l` from line start: prev=0, new=1, inside [0,2) → land on the text at 2
    expect(snapOutOfSpans(1, 0, heading)).toBe(2)
  })

  it("snaps a backward motion to the run's start (for a non-leading run)", () => {
    // The pure rule snaps a strictly-inside backward motion to the run start. (For
    // a line-leading run the filter overrides this via leadingHiddenEnd — see below.)
    expect(snapOutOfSpans(1, 2, heading)).toBe(0)
  })

  it("leaves a position on the run's start edge untouched (AC-2)", () => {
    expect(snapOutOfSpans(0, 0, heading)).toBe(0)
  })

  it("leaves a position on the run's end edge untouched", () => {
    expect(snapOutOfSpans(2, 0, heading)).toBe(2)
  })

  it("leaves a position outside every run untouched (AC-6)", () => {
    expect(snapOutOfSpans(5, 4, heading)).toBe(5)
  })

  it("treats an unchanged position (pos === prev) as forward", () => {
    expect(snapOutOfSpans(1, 1, heading)).toBe(2)
  })

  it("checks every span, snapping against the one it falls in", () => {
    const spans: Span[] = [
      { from: 0, to: 2 },
      { from: 6, to: 8 },
    ]
    expect(snapOutOfSpans(7, 6, spans)).toBe(8)
    expect(snapOutOfSpans(7, 8, spans)).toBe(6)
  })

  it("returns the position unchanged when there are no spans", () => {
    expect(snapOutOfSpans(3, 0, [])).toBe(3)
  })
})

describe("leadingHiddenEnd", () => {
  it("returns the end of a hidden run that begins the line", () => {
    // `# ` hidden as [0,2) at the line start → first visible char is at 2.
    expect(leadingHiddenEnd(0, [{ from: 0, to: 2 }])).toBe(2)
  })

  it("chains through adjacent leading runs (e.g. nested `> > `)", () => {
    expect(
      leadingHiddenEnd(0, [
        { from: 0, to: 2 },
        { from: 2, to: 4 },
      ]),
    ).toBe(4)
  })

  it("is the line start when nothing hidden begins the line", () => {
    // An inline `**` run mid-line does not extend the leading prefix.
    expect(leadingHiddenEnd(0, [{ from: 5, to: 7 }])).toBe(0)
  })

  it("is the line start when there are no spans", () => {
    expect(leadingHiddenEnd(10, [])).toBe(10)
  })
})

// Integration: the real transactionFilter wired against a markdown state. Vim
// moves by raw offset, so we simulate it with a plain `selection` transaction (no
// `select.pointer` user event) and assert the filter snapped the caret to a visible
// edge — exercising the live filter + the appended-selection combine, not just the
// pure rule.
describe("vimCaretGuard (transaction filter)", () => {
  const stateAt = (doc: string, anchor: number) =>
    EditorState.create({ doc, selection: { anchor }, extensions: [markdown(), vimCaretGuard] })

  const moveTo = (doc: string, from: number, to: number): SelectionRange =>
    stateAt(doc, from).update({ selection: { anchor: to } }).state.selection.main

  it("snaps a forward Vim motion out of a hidden heading run (AC-1)", () => {
    // `# Heading`: `# ` is hidden as [0,2). A forward move onto offset 1 lands on H.
    expect(moveTo("# Heading", 0, 1).head).toBe(2)
  })

  it("a line-start motion lands on the first visible char, not before the marker (AC-2)", () => {
    // `0`/`^`/`I` target column 0 (offset 0, the line-start edge of the hidden
    // `# `). The caret must land on `H` (offset 2), else typing inserts ahead of
    // the marker (`foo# Heading`).
    expect(moveTo("# Heading", 5, 0).head).toBe(2)
  })

  it("a backward motion cannot enter the leading marker (stays on the first visible char) (AC-5)", () => {
    expect(moveTo("# Heading", 2, 1).head).toBe(2)
  })

  it("snaps out of a blockquote marker, proving block ranges are covered (AC-3)", () => {
    expect(moveTo("> quote", 0, 1).head).toBe(2)
  })

  it("snaps out of a list marker (AC-4)", () => {
    expect(moveTo("* item", 0, 1).head).toBe(2)
  })

  it("leaves a pointer selection alone so a click can reveal markup (AC-7)", () => {
    const main = stateAt("# Heading", 0)
      .update({ selection: { anchor: 1 }, userEvent: "select.pointer" })
      .state.selection.main
    expect(main.head).toBe(1)
  })
})
