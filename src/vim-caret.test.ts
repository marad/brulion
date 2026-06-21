import { describe, it, expect } from "vitest"
import { snapOutOfSpans, type Span } from "./vim-caret"

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

  it("snaps a backward motion to the run's start (AC-5)", () => {
    // `h` from the first visible char: prev=2, new=1, inside [0,2) → land at 0
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
