import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { ensureSyntaxTree } from "@codemirror/language"
import {
  buildAddRowChange,
  buildCellEditChange,
  cellSourceOffset,
  findTableBlocks,
  parseRowCells,
  safeTableEditSelection,
  type TableBlock,
} from "./table-render"
import { mountEditor, setEditorEditable, setEditorText, setVimMode } from "./editor"

// FEAT-0063 + inline table cell editing (<br> multiline + nested CodeMirror/Vim) — UNIT tests.

/** Build a state whose markdown syntax tree is fully populated (for consistency). */
const state = (doc: string) => {
  const s = EditorState.create({ doc, extensions: [markdown()] })
  ensureSyntaxTree(s, doc.length, 1e9)
  return s
}

const blocks = (doc: string): TableBlock[] => findTableBlocks(state(doc))

/** Slice the exact source spanned by a block's [from, to). */
const sourceOf = (doc: string, b: TableBlock) => state(doc).doc.sliceString(b.from, b.to)

/** Apply a cell edit to `doc` and return the resulting document text (or `doc` on no-op). */
function applyCellEdit(doc: string, row: number, col: number, value: string): string {
  const s = state(doc)
  const found = findTableBlocks(s)
  expect(found).toHaveLength(1)
  const change = buildCellEditChange(s, found[0], row, col, value)
  if (!change) return doc
  return s.doc.replace(change.from, change.to, s.toText(change.insert)).toString()
}

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
    expect(found[0].to).toBe(doc.length)
    expect(sourceOf(doc, found[0])).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |")
  })

  it("ends the body at a blank line, excluding it from the span", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntrailing prose\n"
    const found = blocks(doc)
    expect(found).toHaveLength(1)
    expect(found[0].rows).toEqual([["1", "2"]])
    expect(sourceOf(doc, found[0])).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |")
  })
})

// --- Escaped pipes, <br> line breaks, & cell span parsing -------------------

describe("parseRowCells — cell spans, escaped pipes, and <br>", () => {
  it("keeps escaped pipes inside a cell and unescapes them for display", () => {
    const parsed = parseRowCells("| a \\| b | c |")
    expect(parsed.hasLeadingPipe).toBe(true)
    expect(parsed.hasTrailingPipe).toBe(true)
    expect(parsed.cells.map((c) => c.value)).toEqual(["a | b", "c"])
  })

  it("does not treat a trailing escaped pipe as an outer pipe", () => {
    const parsed = parseRowCells("| a | b\\|")
    expect(parsed.hasLeadingPipe).toBe(true)
    expect(parsed.hasTrailingPipe).toBe(false)
    expect(parsed.cells.map((c) => c.value)).toEqual(["a", "b|"])
  })

  it("treats an even number of backslashes before a pipe as a real delimiter", () => {
    const parsed = parseRowCells("| a \\\\| b |")
    expect(parsed.cells.map((c) => c.value)).toEqual(["a \\\\", "b"])
  })

  it("decodes <br>, <br/>, and <br /> tags into editable newlines", () => {
    const parsed = parseRowCells("| line 1<br>line 2<br/>line 3<BR />line 4 | ok |")
    expect(parsed.cells.map((c) => c.value)).toEqual(["line 1\nline 2\nline 3\nline 4", "ok"])
  })
})

// --- Minimal cell patching (file fidelity) ----------------------------------

describe("buildCellEditChange — minimal file-faithful cell edits", () => {
  it("patches only the edited body cell and preserves all other spacing/rows verbatim", () => {
    const doc =
      "| Name   | Count | Notes   |\n| :----- | ----: | ------- |\n| Foo    | 42    | ok      |\n| Bar    | 7     | kept    |\n"
    const next = applyCellEdit(doc, 0, 1, "999")
    expect(next).toBe(
      "| Name   | Count | Notes   |\n| :----- | ----: | ------- |\n| Foo    | 999    | ok      |\n| Bar    | 7     | kept    |\n",
    )
  })

  it("patches a header cell (row = -1) without touching separator or body", () => {
    const doc = "| a | b |\n| :--- | ---: |\n| 1 | 2 |\n"
    expect(applyCellEdit(doc, -1, 1, "Total")).toBe("| a | Total |\n| :--- | ---: |\n| 1 | 2 |\n")
  })

  it("returns null (no-op) when the normalized cell text is unchanged, preserving <br/> spelling", () => {
    const doc = "| a | b |\n| --- | --- |\n| one<br/>two | 2 |\n"
    const s = state(doc)
    const block = findTableBlocks(s)[0]
    expect(buildCellEditChange(s, block, 0, 0, "  one\ntwo  ")).toBeNull()
  })

  it("fills a previously empty cell cleanly", () => {
    const doc = "| a | b | c |\n| --- | --- | --- |\n| 1 || 3 |\n"
    expect(applyCellEdit(doc, 0, 1, "two")).toBe("| a | b | c |\n| --- | --- | --- |\n| 1 | two | 3 |\n")
  })

  it("clears a cell in a pipe-wrapped row without losing its column", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n"
    const next = applyCellEdit(doc, 0, 0, "")
    expect(next).toBe("| a | b |\n| --- | --- |\n|  | 2 |\n")
    expect(blocks(next)[0].rows).toEqual([["", "2"]])
  })

  it("clears column 0 of an outer-pipe-less row without shifting column 1 into column 0", () => {
    const doc = "a | b\n--- | ---\n1 | 2\n"
    const next = applyCellEdit(doc, 0, 0, "")
    expect(blocks(next)).toHaveLength(1)
    expect(blocks(next)[0].rows).toEqual([["", "2"]])
  })

  it("escapes literal pipes as \\| and encodes newlines as <br> without breaking the table", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n"
    const next = applyCellEdit(doc, 0, 0, "x | y\nz")
    expect(next).toBe("| a | b |\n| --- | --- |\n| x \\| y<br>z | 2 |\n")
    expect(blocks(next)[0].rows).toEqual([["x | y\nz", "2"]])
  })

  it("bijectively escapes backslash-before-pipe sequences (\\|, \\\\|) without splitting columns", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n"
    const next1 = applyCellEdit(doc, 0, 0, "foo\\|bar")
    expect(blocks(next1)[0].rows).toEqual([["foo\\|bar", "2"]])

    const next2 = applyCellEdit(doc, 0, 0, "foo\\\\|bar")
    expect(blocks(next2)[0].rows).toEqual([["foo\\\\|bar", "2"]])
  })

  it("pads a trailing space when a cell without spaces ends with a backslash before a pipe", () => {
    const doc = "|a|b|\n|---|---|\n|1|2|\n"
    const next = applyCellEdit(doc, 0, 0, "foo\\")
    expect(blocks(next)[0].rows).toEqual([["foo\\", "2"]])
  })

  it("pads missing cells when editing a ragged short row", () => {
    const doc = "| a | b | c |\n| --- | --- | --- |\n| 1 |\n"
    const next = applyCellEdit(doc, 0, 2, "3")
    expect(next).toBe("| a | b | c |\n| --- | --- | --- |\n| 1 |  | 3 |\n")
    expect(blocks(next)[0].rows).toEqual([["1", "", "3"]])
  })

  it("pads missing cells in an outer-pipe-less ragged row", () => {
    const doc = "a | b | c\n--- | --- | ---\n1\n"
    const next = applyCellEdit(doc, 0, 2, "3")
    expect(next).toBe("a | b | c\n--- | --- | ---\n1 | | 3\n")
    expect(blocks(next)[0].rows).toEqual([["1", "", "3"]])
  })
})

describe("buildAddRowChange & cellSourceOffset & safeTableEditSelection", () => {
  it("appends a matching empty row at block.to without touching earlier lines", () => {
    const doc = "| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n\nafter\n"
    const s = state(doc)
    const block = findTableBlocks(s)[0]
    const change = buildAddRowChange(s, block)
    const next = s.doc.replace(change.from, change.to, s.toText(change.insert)).toString()
    expect(next).toBe("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n|  |  |  |\n\nafter\n")
    expect(blocks(next)[0].rows).toEqual([["1", "2", "3"], ["", "", ""]])
  })

  it("computes exact raw source offsets strictly inside (block.from, block.to), including ragged last rows", () => {
    const doc = "| a | b |\n| --- | --- |\n| alpha | beta |\n"
    const s = state(doc)
    const block = findTableBlocks(s)[0]
    const pos = cellSourceOffset(s, block, 0, 1)
    expect(pos).toBeGreaterThan(block.from)
    expect(pos).toBeLessThan(block.to)
    expect(doc.slice(pos, pos + 4)).toBe("beta")

    // Ragged last row: padded cell (0, 2) must still clamp strictly < block.to so reveal works.
    const ragged = "| a | b | c |\n| --- | --- | --- |\n| 1 |"
    const rs = state(ragged)
    const rblock = findTableBlocks(rs)[0]
    const rpos = cellSourceOffset(rs, rblock, 0, 2)
    expect(rpos).toBeGreaterThan(rblock.from)
    expect(rpos).toBeLessThan(rblock.to)
  })

  it("keeps a boundary caret at block.to outside the table when appending a new row", () => {
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |"
    const s = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [markdown()] })
    const block = findTableBlocks(s)[0]
    const change = buildAddRowChange(s, block)
    const sel = safeTableEditSelection(s, block, change)
    expect(sel).toBeDefined()
    expect(sel!.main.anchor).toBe(doc.length + change.insert.length)
    expect(sel!.main.head).toBe(doc.length + change.insert.length)
  })
})

// --- Mounted EditorView DOM behavior (happy-dom) -----------------------------

describe("TableWidget — mounted inline editing behavior", () => {
  it("mounts a nested CodeMirror editor on cell click and syncs Enter as <br>", () => {
    const parent = document.createElement("div")
    document.body.append(parent)
    const view = mountEditor(parent)
    setEditorText(view, "a | b\n--- | ---\n1 | 2\n\nafter\n")

    const cell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="0"][data-col="0"]')!
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))

    expect(cell.classList.contains("cm-table-cell-editing")).toBe(true)
    const innerContent = cell.querySelector<HTMLElement>(".cm-content")!
    expect(innerContent).not.toBeNull()

    // Plain Enter inserts a newline inside the cell, serialized as <br> in the outer doc.
    innerContent.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    )
    expect(view.state.doc.toString()).toBe("a | b\n--- | ---\n<br>1 | 2\n\nafter\n")
    expect(parent.querySelector(".cm-table")).not.toBeNull()

    view.destroy()
    parent.remove()
  })

  it("enables Vim mode inside the active cell when Vim is enabled on the outer editor", () => {
    const parent = document.createElement("div")
    document.body.append(parent)
    const view = mountEditor(parent)
    setEditorText(view, "| a | b |\n| --- | --- |\n| hello | world |\n")
    setVimMode(view, true)

    const cell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="0"][data-col="0"]')!
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))

    expect(cell.querySelector(".cm-vimMode")).not.toBeNull()

    // Toggling Vim off live reconfigures the active cell editor too.
    setVimMode(view, false)
    expect(cell.querySelector(".cm-vimMode")).toBeNull()

    view.destroy()
    parent.remove()
  })

  it("closes active cell editing and ignores clicks when the editor becomes read-only", () => {
    const parent = document.createElement("div")
    document.body.append(parent)
    const view = mountEditor(parent)
    setEditorText(view, "| a | b |\n| --- | --- |\n| 1 | 2 |\n")

    const cell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="0"][data-col="0"]')!
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    expect(cell.classList.contains("cm-table-cell-editing")).toBe(true)

    setEditorEditable(view, false)
    expect(cell.classList.contains("cm-table-cell-editing")).toBe(false)

    // Clicking while read-only does not open the cell editor.
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    expect(cell.classList.contains("cm-table-cell-editing")).toBe(false)

    setEditorEditable(view, true)
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    expect(cell.classList.contains("cm-table-cell-editing")).toBe(true)

    view.destroy()
    parent.remove()
  })

  it("reveals raw markdown on Ctrl+Click and positions the caret at the clicked cell", () => {
    const parent = document.createElement("div")
    document.body.append(parent)
    const view = mountEditor(parent)
    const doc = "| a | b |\n| --- | --- |\n| alpha | beta |\n\nafter\n"
    setEditorText(view, doc)

    const cell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="0"][data-col="1"]')!
    cell.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }),
    )

    expect(parent.querySelector(".cm-table")).toBeNull()
    const head = view.state.selection.main.head
    expect(doc.slice(head, head + 4)).toBe("beta")

    view.destroy()
    parent.remove()
  })

  it("lands the outer caret on the line after/before the table on Escape/ArrowUp so typing never corrupts rows", () => {
    const parent = document.createElement("div")
    document.body.append(parent)
    const view = mountEditor(parent)
    const doc = "before\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n"
    setEditorText(view, doc)
    const block = findTableBlocks(view.state)[0]

    // Exit downward via Escape → caret lands on the line after the table (`block.to + 1`).
    const bodyCell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="0"][data-col="1"]')!
    bodyCell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    bodyCell
      .querySelector<HTMLElement>(".cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
    expect(view.state.selection.main.head).toBe(block.to + 1)

    // Exit upward via ArrowUp on header → caret lands on the line before the table (`block.from - 1`).
    const headerCell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="-1"][data-col="0"]')!
    headerCell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    headerCell
      .querySelector<HTMLElement>(".cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }))
    expect(view.state.selection.main.head).toBe(block.from - 1)

    view.destroy()
    parent.remove()
  })

  it("ignores IME composition keydown events and non-primary clicks on the source button", () => {
    const parent = document.createElement("div")
    document.body.append(parent)
    const view = mountEditor(parent)
    const doc = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n"
    setEditorText(view, doc)

    // Right-clicking </> does not reveal raw markdown.
    const btn = parent.querySelector<HTMLElement>(".cm-table-source-btn")!
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 }))
    expect(parent.querySelector(".cm-table")).not.toBeNull()

    // IME composing Escape/Tab does not close the cell or jump columns.
    const cell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="0"][data-col="0"]')!
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    const innerContent = cell.querySelector<HTMLElement>(".cm-content")!
    for (const key of ["Escape", "Tab"]) {
      const composing = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      Object.defineProperty(composing, "isComposing", { value: true })
      innerContent.dispatchEvent(composing)
    }
    expect(view.state.doc.toString()).toBe(doc)
    expect(cell.classList.contains("cm-table-cell-editing")).toBe(true)

    view.destroy()
    parent.remove()
  })

  it("restores focus to the outer editor when undo removes the active added row", async () => {
    const parent = document.createElement("div")
    document.body.append(parent)
    const view = mountEditor(parent)
    setEditorText(view, "| a | b |\n| --- | --- |\n| 1 | 2 |\n")

    const lastCell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="0"][data-col="1"]')!
    lastCell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))
    lastCell
      .querySelector<HTMLElement>(".cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }))

    const addedCell = parent.querySelector<HTMLElement>('.cm-table-cell[data-row="1"][data-col="0"]')!
    expect(addedCell.classList.contains("cm-table-cell-editing")).toBe(true)

    addedCell
      .querySelector<HTMLElement>(".cm-content")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }))

    await Promise.resolve()
    expect(view.state.doc.toString()).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n")
    expect(document.activeElement).toBe(view.contentDOM)

    view.destroy()
    parent.remove()
  })
})
