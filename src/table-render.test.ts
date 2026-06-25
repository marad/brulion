import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { ensureSyntaxTree } from "@codemirror/language"
import { findTableBlocks, type TableBlock } from "./table-render"

// FEAT-0063 — UNIT tests for the table renderer's CONTRACT (happy-dom).
//
// `findTableBlocks` is a pure LINE SCAN — it reads `state.doc` lines and does not
// need the syntax tree. For consistency with mermaid-render.test.ts we still build
// the state with the `markdown()` extension and force a complete parse; the scan
// ignores the tree.
//
// These tests assert OBSERVABLE behaviour only: the returned blocks' fields
// (from/to, aligns, header, rows) and the sliced source range
// (`state.doc.sliceString(from, to)`). No widget / private-state assertions.

/** Build a state whose markdown syntax tree is fully populated (for consistency). */
const state = (doc: string) => {
  const s = EditorState.create({ doc, extensions: [markdown()] })
  ensureSyntaxTree(s, doc.length, 1e9)
  return s
}

const blocks = (doc: string): TableBlock[] => findTableBlocks(state(doc))

/** Slice the exact source spanned by a block's [from, to). */
const sourceOf = (doc: string, b: TableBlock) => state(doc).doc.sliceString(b.from, b.to)

// --- AC-1: a header + separator + body renders as a table --------------------

describe("findTableBlocks — basic table (FEAT-0063 AC-1)", () => {
  it("finds one block with header, rows, and default alignments", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    expect(found[0].header).toEqual(["a", "b"])
    expect(found[0].rows).toEqual([["1", "2"]])
    expect(found[0].aligns).toEqual(["none", "none"])
  })

  it("spans exactly the three source lines (header start to last body line end)", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    // The slice is the three table lines verbatim, without the trailing newline.
    expect(sourceOf(doc, found[0])).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |")
  })
})

// --- AC-2: column alignment follows the separator ----------------------------

describe("findTableBlocks — alignment (FEAT-0063 AC-2)", () => {
  it("maps :--- / :--: / ---: to left / center / right", () => {
    const doc = "| h1 | h2 | h3 |\n| :--- | :--: | ---: |\n| 1 | 2 | 3 |\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    expect(found[0].aligns).toEqual(["left", "center", "right"])
  })
})

// --- AC-3: outer pipes are optional ------------------------------------------

describe("findTableBlocks — outer pipes optional (FEAT-0063 AC-3)", () => {
  it("parses the same header/rows without leading/trailing pipes", () => {
    const doc = "a | b\n--- | ---\n1 | 2\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    expect(found[0].header).toEqual(["a", "b"])
    expect(found[0].rows).toEqual([["1", "2"]])
    expect(found[0].aligns).toEqual(["none", "none"])
  })
})

// --- AC-4: a `|` inside a fenced code block is not a table -------------------

describe("findTableBlocks — fenced code is skipped (FEAT-0063 AC-4)", () => {
  it("does not detect a table from pipes/dashes inside a ``` fence", () => {
    const doc = "```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n"
    expect(blocks(doc)).toEqual([])
  })

  it("still finds a real table outside the fence", () => {
    const doc =
      "```\n| a | b |\n| --- | --- |\n```\n\n| x | y |\n| --- | --- |\n| 1 | 2 |\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    expect(found[0].header).toEqual(["x", "y"])
    expect(found[0].rows).toEqual([["1", "2"]])
    expect(sourceOf(doc, found[0])).toBe("| x | y |\n| --- | --- |\n| 1 | 2 |")
  })
})

// --- AC-6: a header with no separator row is not a table ---------------------

describe("findTableBlocks — header without separator (FEAT-0063 AC-6)", () => {
  it("returns no block when a paragraph (not a separator) follows the header", () => {
    const doc = "| a | b |\nThis is just a normal paragraph.\n"
    expect(blocks(doc)).toEqual([])
  })
})

// --- AC-7: ragged rows are returned as written (widget pads/truncates) -------

describe("findTableBlocks — ragged rows preserved (FEAT-0063 AC-7)", () => {
  it("keeps a short (1-cell) and a long (3-cell) row exactly as written", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 |\n| 3 | 4 | 5 |\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    expect(found[0].header).toEqual(["a", "b"])
    expect(found[0].rows).toEqual([["1"], ["3", "4", "5"]])
    expect(found[0].rows[0]).toHaveLength(1)
    expect(found[0].rows[1]).toHaveLength(3)
  })
})

// --- AC-1 (multiple): multiple tables in document order ----------------------

describe("findTableBlocks — multiple tables (FEAT-0063 AC-1)", () => {
  it("returns two blocks in document order, separated by prose", () => {
    const doc =
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nSome prose between tables.\n\n| c | d |\n| --- | --- |\n| 3 | 4 |\n"
    const found = blocks(doc)
    expect(found).toHaveLength(2)
    expect(found[0].header).toEqual(["a", "b"])
    expect(found[1].header).toEqual(["c", "d"])
    expect(found[0].from).toBeLessThan(found[1].from)
    expect(found[0].to).toBeLessThanOrEqual(found[1].from)
  })
})

// --- AC-1 (adjacency): two tables flush against each other ------------------

describe("findTableBlocks — flush adjacent tables (FEAT-0063 AC-1)", () => {
  it("splits two tables with no blank line between them into two blocks", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| c | d |\n| --- | --- |\n| 3 | 4 |\n"
    const found = blocks(doc)
    expect(found).toHaveLength(2)
    expect(found[0].header).toEqual(["a", "b"])
    expect(found[0].rows).toEqual([["1", "2"]])
    expect(found[1].header).toEqual(["c", "d"])
    expect(found[1].rows).toEqual([["3", "4"]])
  })
})

// --- AC-1 (boundaries): EOF without trailing newline, and blank-line end -----

describe("findTableBlocks — block boundaries (FEAT-0063 AC-1)", () => {
  it("ends `to` at the last body line when the table is at EOF with no trailing newline", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    // `to` is the document end (no trailing newline to exclude).
    expect(found[0].to).toBe(doc.length)
    expect(sourceOf(doc, found[0])).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |")
  })

  it("ends the body at a blank line, excluding it from the span", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntrailing prose\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    expect(found[0].rows).toEqual([["1", "2"]])
    // The span stops at the end of the last body line, before the blank line.
    expect(sourceOf(doc, found[0])).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |")
  })
})
