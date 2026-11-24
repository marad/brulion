/**
 * Table rendering & inline cell editing (M26/FEAT-0063 + inline cell editing).
 *
 * A CodeMirror extension that replaces a contiguous pipe-delimited table block
 * (header + separator + body) with a rendered, aligned `<table>` whose cells are
 * directly editable in place. Inactive cells render as lightweight text nodes;
 * activating a cell mounts a minimal nested CodeMirror `EditorView` inside that cell,
 * giving native selection, multiline `<br>` editing (`Shift+Enter`), and full
 * `@replit/codemirror-vim` keybindings when Vim mode is enabled.
 *
 * Untouched cells, rows, spacing, and separator syntax stay byte-for-byte unchanged —
 * edits patch only the modified cell's exact slice in the underlying Markdown document.
 * Raw Markdown source remains reachable via Ctrl/Cmd+Click on the table, the subtle
 * `</>` button on the table wrapper, or moving the editor caret/selection inside
 * the block from outside.
 */
import {
  Annotation,
  ChangeSet,
  Compartment,
  EditorSelection,
  type EditorState,
  type Extension,
  Facet,
  Prec,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state"
import { defaultKeymap, history, isolateHistory, undo, redo } from "@codemirror/commands"
import {
  type DecorationSet,
  Decoration,
  drawSelection,
  EditorView,
  keymap,
  WidgetType,
} from "@codemirror/view"
import { getCM, Vim, vim } from "@replit/codemirror-vim"

/** Facet set by `editor.ts` when Vim mode is active on the outer editor so inline
 * table cell editors automatically inherit Vim keybindings. */
export const tableVimMode = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
})

/** A column's text alignment, from the separator row's colons. */
export type Align = "left" | "center" | "right" | "none"

/**
 * A detected table block: the document offsets of the whole block (header line to last
 * body line, inclusive), the per-column alignments (one per separator cell), the header
 * cells, and the body rows (each a list of cells, as written — not yet padded/truncated
 * to the column count; the widget does that).
 */
export interface TableBlock {
  from: number
  to: number
  aligns: Align[]
  header: string[]
  rows: string[][]
}

/** Exact line-relative offsets and text of one parsed table cell. */
export interface ParsedCell {
  /** Offset right after the opening pipe (or row content start). */
  rawFrom: number
  /** Offset right before the closing pipe (or row content end). */
  rawTo: number
  /** Offset of the first non-whitespace character inside the cell (or `rawFrom` if empty). */
  contentFrom: number
  /** Offset past the last non-whitespace character inside the cell (or `rawFrom` if empty). */
  contentTo: number
  /** Raw slice between pipes, including surrounding whitespace. */
  raw: string
  /** Trimmed raw slice (still containing any `\|` escapes or `<br>` tags). */
  trimmed: string
  /** Display/editable cell value with `\|` unescaped to `|` and `<br>` to `\n`. */
  value: string
}

/** Parsed structure of a single Markdown table row line. */
export interface ParsedRow {
  hasLeadingPipe: boolean
  hasTrailingPipe: boolean
  trimmedStart: number
  trimmedEnd: number
  trailingPipeOffset: number | null
  cells: ParsedCell[]
}

/** A minimal document replacement for editing a cell or adding a row. */
export interface TextChange {
  from: number
  to: number
  insert: string
}

/** Marks outer-editor transactions dispatched by inline table cell editing so
 * `updateDOM` does not overwrite the active cell's live nested editor. */
const TableCellEdit = Annotation.define<boolean>()

/** Marks nested cell-editor transactions synced from the outer editor (e.g. undo or
 * external reload) so its updateListener does not echo the change back. */
const CellProgrammaticSync = Annotation.define<boolean>()

/** True if the pipe at `index` is NOT preceded by an odd number of backslashes. */
function isUnescapedPipe(text: string, index: number): boolean {
  if (text[index] !== "|") return false
  let slashes = 0
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++
  return slashes % 2 === 0
}

/** True if `text` ends with an odd number of backslashes (which would escape an
 * immediately adjacent `|` delimiter if no space separates them). */
function hasOddTrailingBackslashes(text: string): boolean {
  let slashes = 0
  for (let i = text.length - 1; i >= 0 && text[i] === "\\"; i--) slashes++
  return slashes % 2 === 1
}

/** Unescape GFM-escaped pipes (`\|` → `|`) and `<br>` line breaks (`<br>` → `\n`)
 * for display/editing inside a cell. */
export function unescapeCellText(raw: string): string {
  return raw.replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|")
}

/** Normalize raw editable cell text: standardize line endings to `\n` and trim
 * outer horizontal whitespace (`[ \t]`) while preserving deliberate `\n` line breaks. */
export function normalizeCellInput(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").replace(/^[ \t]+|[ \t]+$/g, "")
}

/** Serialize editable cell text back to Markdown table cell syntax: escape literal
 * pipes (`|` → `\|`) and encode multiline breaks (`\n` → `<br>`). */
export function escapeCellText(value: string): string {
  return normalizeCellInput(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>")
}

/**
 * Parse a single Markdown table row line into its exact pipe-delimited cell spans.
 * Outer pipes are optional (`| a | b |` and `a | b` yield the same cell values) and
 * escaped pipes (`\|`) stay inside their cell instead of splitting it.
 */
export function parseRowCells(text: string): ParsedRow {
  let trimmedStart = 0
  while (trimmedStart < text.length && /\s/.test(text[trimmedStart])) trimmedStart++
  let trimmedEnd = text.length
  while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1])) trimmedEnd--

  const hasLeadingPipe = trimmedStart < trimmedEnd && text[trimmedStart] === "|"
  const innerStart = hasLeadingPipe ? trimmedStart + 1 : trimmedStart

  const lastIdx = trimmedEnd - 1
  const hasTrailingPipe = lastIdx >= innerStart && isUnescapedPipe(text, lastIdx)
  const trailingPipeOffset = hasTrailingPipe ? lastIdx : null
  const innerEnd = hasTrailingPipe ? lastIdx : trimmedEnd

  const cells: ParsedCell[] = []
  let cellStart = innerStart
  const pushCell = (from: number, to: number) => {
    const raw = text.slice(from, to)
    let cs = from
    while (cs < to && /\s/.test(text[cs])) cs++
    let ce = to
    while (ce > cs && /\s/.test(text[ce - 1])) ce--
    const trimmed = text.slice(cs, ce)
    cells.push({
      rawFrom: from,
      rawTo: to,
      contentFrom: cs < ce ? cs : from,
      contentTo: cs < ce ? ce : from,
      raw,
      trimmed,
      value: unescapeCellText(trimmed),
    })
  }

  for (let i = innerStart; i < innerEnd; i++) {
    if (isUnescapedPipe(text, i)) {
      pushCell(cellStart, i)
      cellStart = i + 1
    }
  }
  pushCell(cellStart, innerEnd)

  return {
    hasLeadingPipe,
    hasTrailingPipe,
    trimmedStart,
    trimmedEnd,
    trailingPipeOffset,
    cells,
  }
}

/**
 * Find every table block in the document (pure; line scan). A block is a **separator
 * row** (cells of optional-colon dashes) with a non-blank **header** line directly
 * above and contiguous **body** lines below (until a blank line or EOF). Outer pipes
 * optional. Lines inside fenced code blocks (```` ``` ````/`~~~`) are skipped. Returns
 * blocks in document order.
 */
export function findTableBlocks(state: EditorState): TableBlock[] {
  const doc = state.doc
  const out: TableBlock[] = []
  let inFence = false
  let i = 1
  while (i <= doc.lines) {
    const line = doc.line(i)
    if (isFenceDelimiter(line.text)) {
      inFence = !inFence
      i++
      continue
    }
    if (!inFence && i >= 2 && isSeparatorRow(line.text)) {
      const headerLine = doc.line(i - 1)
      const ht = headerLine.text
      if (ht.trim() !== "" && !isFenceDelimiter(ht) && !isSeparatorRow(ht)) {
        const rows: string[][] = []
        let last = line
        let j = i + 1
        while (j <= doc.lines) {
          const bl = doc.line(j)
          if (bl.text.trim() === "" || isFenceDelimiter(bl.text)) break // blank / fence ends the body
          // A new table starting flush against this one (no blank line between): if the
          // next line is a separator, `bl` is that table's header — stop before it so
          // the outer scan picks the new block up rather than eating it as a body row.
          if (j < doc.lines && !isSeparatorRow(bl.text) && isSeparatorRow(doc.line(j + 1).text)) break
          rows.push(splitRow(bl.text))
          last = bl
          j++
        }
        out.push({
          from: headerLine.from,
          to: last.to,
          aligns: parseAligns(line.text),
          header: splitRow(ht),
          rows,
        })
        i = j // resume after the block
        continue
      }
    }
    i++
  }
  return out
}

/** A fenced-code delimiter line (``` or ~~~, possibly indented / with an info string). */
function isFenceDelimiter(text: string): boolean {
  return /^\s*(```|~~~)/.test(text)
}

/** A separator row: contains a `|` and every cell is optional-colon dashes (`:--:`). */
function isSeparatorRow(text: string): boolean {
  if (!text.includes("|")) return false // a lone `---` is a thematic break, not a 1-col table
  const cells = splitRow(text)
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c))
}

/** Split a table row into trimmed, unescaped cell values. */
function splitRow(text: string): string[] {
  return parseRowCells(text).cells.map((c) => c.value)
}

/** Per-column alignment from a separator row's colons. */
function parseAligns(text: string): Align[] {
  return splitRow(text).map((c) => {
    const left = c.startsWith(":")
    const right = c.endsWith(":")
    return left && right ? "center" : right ? "right" : left ? "left" : "none"
  })
}

/** Resolve the document line for `row` (`-1` = header, `>= 0` = body row index). */
function rowLineFor(state: EditorState, block: TableBlock, row: number) {
  const headerLine = state.doc.lineAt(block.from)
  const lineNum = row === -1 ? headerLine.number : headerLine.number + 2 + row
  if (row < -1 || row >= block.rows.length || lineNum > state.doc.lines) return null
  const line = state.doc.line(lineNum)
  if (line.from < block.from || line.to > block.to) return null
  return line
}

/**
 * Compute the minimal document change that updates cell `(row, col)` of `block`
 * (`row = -1` for header, `row >= 0` for body row) to `newValue`, leaving every
 * untouched cell, row, and surrounding whitespace byte-for-byte unchanged.
 * Returns `null` if the cell's value is unchanged or coordinates are out of bounds.
 */
export function buildCellEditChange(
  state: EditorState,
  block: TableBlock,
  row: number,
  col: number,
  newValue: string,
): TextChange | null {
  if (col < 0 || col >= block.aligns.length) return null
  const line = rowLineFor(state, block, row)
  if (!line) return null

  const clean = normalizeCellInput(newValue)
  const escaped = escapeCellText(newValue)
  const parsed = parseRowCells(line.text)

  if (col < parsed.cells.length) {
    const cell = parsed.cells[col]
    if (cell.value === clean) return null

    if (cell.trimmed !== "") {
      // Clearing col 0 of an outer-pipe-less row (`a | b` → ` | b`) would make the
      // trimmed line start with `|`, shifting col 1 into col 0. Add a leading `| `
      // so the empty first cell remains unambiguous.
      if (!parsed.hasLeadingPipe && col === 0 && clean === "") {
        return {
          from: line.from + parsed.trimmedStart,
          to: line.from + cell.contentTo,
          insert: "| ",
        }
      }
      const needsSpace =
        hasOddTrailingBackslashes(escaped) && line.text[cell.contentTo] === "|"
      return {
        from: line.from + cell.contentFrom,
        to: line.from + cell.contentTo,
        insert: needsSpace ? `${escaped} ` : escaped,
      }
    }

    // Filling a previously empty cell.
    if (clean === "") return null
    let insert: string
    if (col === 0 && !parsed.hasLeadingPipe) {
      insert = `${escaped} `
    } else if (col === parsed.cells.length - 1 && !parsed.hasTrailingPipe) {
      insert = ` ${escaped}`
    } else {
      insert = ` ${escaped} `
    }
    return {
      from: line.from + cell.rawFrom,
      to: line.from + cell.rawTo,
      insert,
    }
  }

  // Editing a padded empty cell past the end of a ragged short row.
  if (clean === "") return null
  const missing = col - parsed.cells.length + 1
  const added = Array<string>(missing).fill("")
  added[missing - 1] = escaped

  if (parsed.hasTrailingPipe && parsed.trailingPipeOffset !== null) {
    const suffix = added.map((v) => (v === "" ? "  |" : ` ${v} |`)).join("")
    return {
      from: line.from + parsed.trailingPipeOffset + 1,
      to: line.from + parsed.trailingPipeOffset + 1,
      insert: suffix,
    }
  }

  const suffix = added.map((v) => (v === "" ? " |" : ` | ${v}`)).join("")
  return {
    from: line.from + parsed.trimmedEnd,
    to: line.from + parsed.trimmedEnd,
    insert: suffix,
  }
}

/**
 * Compute the minimal change that appends one empty body row to the bottom of `block`,
 * matching its column count without touching any existing line.
 */
export function buildAddRowChange(_state: EditorState, block: TableBlock): TextChange {
  const cols = Math.max(1, block.aligns.length)
  const cells = Array<string>(cols).fill("").join(" | ")
  return {
    from: block.to,
    to: block.to,
    insert: `\n| ${cells} |`,
  }
}

/**
 * Find the exact document offset for cell `(row, col)` when revealing the raw Markdown
 * source, clamped strictly inside `(block.from, block.to)` so `selectionTouches` is
 * guaranteed to reveal the table.
 */
export function cellSourceOffset(
  state: EditorState,
  block: TableBlock,
  row: number,
  col: number,
): number {
  const fallback = Math.min(block.from + 1, block.to)
  const line = rowLineFor(state, block, row)
  if (!line) return fallback
  const parsed = parseRowCells(line.text)
  const cell = parsed.cells[col]
  const rawPos = cell
    ? line.from + (cell.trimmed !== "" ? cell.contentFrom : cell.rawFrom)
    : line.to
  if (block.from >= block.to) return block.from
  return Math.min(Math.max(rawPos, block.from + 1), block.to)
}

/**
 * Keep CodeMirror's existing selection outside the edited table's interior when
 * dispatching an inline cell change. Without this, a caret resting right at
 * `block.from` or `block.to` could map *into* the edited range and unexpectedly
 * explode the table to raw source.
 */
export function safeTableEditSelection(
  state: EditorState,
  block: TableBlock,
  change: TextChange,
): EditorSelection | undefined {
  const changes = ChangeSet.of(change, state.doc.length)
  const newFrom = changes.mapPos(block.from, -1)
  const newTo = changes.mapPos(block.to, 1)
  let adjusted = false
  const ranges = state.selection.ranges.map((r) => {
    const mapped = r.map(changes)
    if (mapped.from < newTo && mapped.to > newFrom) {
      adjusted = true
      const anchor =
        r.anchor <= block.from
          ? changes.mapPos(r.anchor, -1)
          : changes.mapPos(r.anchor, 1)
      const head =
        r.head <= block.from
          ? changes.mapPos(r.head, -1)
          : changes.mapPos(r.head, 1)
      return EditorSelection.range(anchor, head)
    }
    return mapped
  })
  return adjusted ? EditorSelection.create(ranges, state.selection.mainIndex) : undefined
}

/** True if any selection range overlaps the block interior (strict `<`/`>`, matching
 * `mermaid-render.ts`) — then the block is revealed for editing. */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from < to && r.to > from)
}

/**
 * The decoration set: a block `Decoration.replace` carrying a {@link TableWidget} for
 * each table block whose range does NOT overlap the selection; overlapping blocks are
 * omitted so their raw source stays visible and editable.
 */
export function tableDecorations(state: EditorState, fromInlineEdit = false): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const readOnly = state.readOnly
  const vimEnabled = state.facet(tableVimMode)
  for (const block of findTableBlocks(state)) {
    if (selectionTouches(state, block.from, block.to)) continue
    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        widget: new TableWidget(block, readOnly, vimEnabled, fromInlineEdit),
        block: true,
      }),
    )
  }
  return builder.finish()
}

interface CellCoord {
  row: number
  col: number
}

interface ActiveCellEditor {
  row: number
  col: number
  cellEl: HTMLElement
  cellView: EditorView
  vimComp: Compartment
  historyIsolated: boolean
}

interface TableDomState {
  view: EditorView
  block: TableBlock
  readOnly: boolean
  vimEnabled: boolean
  wrap: HTMLElement
  table: HTMLTableElement
  thead: HTMLTableSectionElement
  tbody: HTMLTableSectionElement
  active: ActiveCellEditor | null
  lastCell: CellCoord | null
}

/** Per-widget live state so `updateDOM` reuses the DOM without stale closures. */
const domStates = new WeakMap<HTMLElement, TableDomState>()

function fitCells(cells: string[], cols: number): string[] {
  const out = cells.slice(0, cols)
  while (out.length < cols) out.push("")
  return out
}

function alignStyle(align: Align | undefined): string {
  return !align || align === "none" ? "" : align
}

function readCellCoord(el: HTMLElement): CellCoord | null {
  const row = Number(el.dataset.row)
  const col = Number(el.dataset.col)
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null
  return { row, col }
}

function findCellElement(wrap: HTMLElement, row: number, col: number): HTMLElement | null {
  return wrap.querySelector<HTMLElement>(`.cm-table-cell[data-row="${row}"][data-col="${col}"]`)
}

function cellTextFromBlock(block: TableBlock, row: number, col: number): string {
  if (row === -1) return block.header[col] ?? ""
  return block.rows[row]?.[col] ?? ""
}

function isVimInsertMode(cellView: EditorView): boolean {
  return Boolean(getCM(cellView)?.state.vim?.insertMode)
}

function isVimVisualMode(cellView: EditorView): boolean {
  return Boolean(getCM(cellView)?.state.vim?.visualMode)
}

function hasPendingVimInput(cellView: EditorView): boolean {
  const vimState = getCM(cellView)?.state.vim
  if (!vimState) return false
  const inp = vimState.inputState
  return Boolean(
    inp.operator ||
      inp.motion ||
      inp.keyBuffer.length > 0 ||
      inp.prefixRepeat.length > 0 ||
      inp.motionRepeat.length > 0 ||
      inp.registerName,
  )
}

/** Locate the live `TableBlock` in `view.state` corresponding to `domState.wrap`. */
function resolveLiveBlock(domState: TableDomState): TableBlock | null {
  const blocks = findTableBlocks(domState.view.state)
  let pos: number | null = null
  try {
    pos = domState.view.posAtDOM(domState.wrap)
  } catch {
    pos = null
  }
  if (pos !== null) {
    const byDom = blocks.find((b) => pos >= b.from && pos <= b.to)
    if (byDom) return byDom
  }
  return (
    blocks.find((b) => b.from === domState.block.from) ??
    blocks.find((b) => b.from <= domState.block.to && b.to >= domState.block.from) ??
    null
  )
}

function dispatchTableChange(
  domState: TableDomState,
  block: TableBlock,
  change: TextChange,
  isolation?: "before" | "full",
): void {
  const selection = safeTableEditSelection(domState.view.state, block, change)
  const annotations = isolation
    ? [TableCellEdit.of(true), isolateHistory.of(isolation)]
    : TableCellEdit.of(true)
  domState.view.dispatch({
    changes: change,
    ...(selection ? { selection } : {}),
    annotations,
  })
}

function syncActiveCellToDoc(domState: TableDomState): void {
  const active = domState.active
  if (!active || domState.readOnly) return
  const block = resolveLiveBlock(domState)
  if (!block) return
  const change = buildCellEditChange(
    domState.view.state,
    block,
    active.row,
    active.col,
    active.cellView.state.doc.toString(),
  )
  if (!change) return
  const isolation = active.historyIsolated ? undefined : "before"
  active.historyIsolated = true
  dispatchTableChange(domState, block, change, isolation)
}

function closeActiveCell(domState: TableDomState): void {
  const active = domState.active
  if (!active) return
  domState.active = null
  active.cellView.destroy()
  active.cellEl.classList.remove("cm-table-cell-editing")
  active.cellEl.textContent = cellTextFromBlock(domState.block, active.row, active.col)
}

function revealRawSource(domState: TableDomState, coord: CellCoord | null): void {
  syncActiveCellToDoc(domState)
  const targetCoord = coord ?? (domState.active ? { row: domState.active.row, col: domState.active.col } : domState.lastCell)
  closeActiveCell(domState)
  const block = resolveLiveBlock(domState) ?? domState.block
  const anchor = targetCoord
    ? cellSourceOffset(domState.view.state, block, targetCoord.row, targetCoord.col)
    : Math.min(block.from + 1, block.to)
  domState.view.dispatch({ selection: { anchor } })
  domState.view.focus()
}

function exitTableToEditor(domState: TableDomState, edge: "before" | "after"): void {
  syncActiveCellToDoc(domState)
  closeActiveCell(domState)
  const block = resolveLiveBlock(domState) ?? domState.block
  const anchor = edge === "before" ? block.from : block.to
  domState.view.dispatch({ selection: { anchor } })
  domState.view.focus()
}

interface ActivateOptions {
  /** Mouse click position to place the caret where the user clicked. */
  coords?: { x: number; y: number }
  /** When Vim is enabled, whether to enter Insert mode immediately (e.g. after Tab from Insert). */
  vimInsert?: boolean
  /** Initial caret placement when `coords` isn't supplied ("end" or "start"). */
  caret?: "start" | "end"
}

function moveCell(
  domState: TableDomState,
  targetRow: number,
  targetCol: number,
  vimInsert: boolean,
): void {
  const target = findCellElement(domState.wrap, targetRow, targetCol)
  if (!target) return
  activateCell(domState, target, {
    vimInsert,
    caret: domState.vimEnabled && !vimInsert ? "start" : "end",
  })
}

function activateCell(
  domState: TableDomState,
  cellEl: HTMLElement,
  opts: ActivateOptions = {},
): void {
  if (domState.readOnly) return
  const coord = readCellCoord(cellEl)
  if (!coord) return

  if (
    domState.active &&
    domState.active.row === coord.row &&
    domState.active.col === coord.col &&
    domState.active.cellEl === cellEl
  ) {
    domState.active.cellView.focus()
    return
  }

  closeActiveCell(domState)
  domState.lastCell = coord

  const initialText = cellTextFromBlock(domState.block, coord.row, coord.col)
  cellEl.textContent = ""
  cellEl.classList.add("cm-table-cell-editing")

  const vimComp = new Compartment()

  const cellKeyHandler = Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, cellView) {
        const active = domState.active
        if (!active || active.cellView !== cellView) return false
        const mod = event.ctrlKey || event.metaKey
        const key = event.key
        const vimOn = domState.vimEnabled
        const inInsert = vimOn ? isVimInsertMode(cellView) : true
        const inVisual = vimOn && isVimVisualMode(cellView)
        const pending = vimOn && hasPendingVimInput(cellView)
        const cleanNormal = vimOn && !inInsert && !inVisual && !pending

        // Route Mod-z / Mod-Shift-z / Mod-y to the outer editor's unified history.
        if (mod && !event.altKey) {
          const lower = key.toLowerCase()
          if (lower === "z") {
            event.preventDefault()
            active.historyIsolated = false
            if (event.shiftKey) redo(domState.view)
            else undo(domState.view)
            return true
          }
          if (lower === "y" && !event.shiftKey) {
            event.preventDefault()
            active.historyIsolated = false
            redo(domState.view)
            return true
          }
          return false
        }

        if (event.altKey) return false

        const cols = domState.block.aligns.length
        const rowCount = domState.block.rows.length
        const head = cellView.state.selection.main.head
        const curLine = cellView.state.doc.lineAt(head).number
        const totalLines = cellView.state.doc.lines

        if (key === "Tab") {
          event.preventDefault()
          const keepInsert = vimOn && inInsert
          if (event.shiftKey) {
            if (active.col > 0) {
              moveCell(domState, active.row, active.col - 1, keepInsert)
            } else if (active.row > -1) {
              moveCell(domState, active.row - 1, cols - 1, keepInsert)
            } else {
              exitTableToEditor(domState, "before")
            }
          } else {
            if (active.col + 1 < cols) {
              moveCell(domState, active.row, active.col + 1, keepInsert)
            } else if (active.row + 1 < rowCount) {
              moveCell(domState, active.row + 1, 0, keepInsert)
            } else if (!domState.readOnly) {
              syncActiveCellToDoc(domState)
              const live = resolveLiveBlock(domState)
              if (live) {
                const newRowIndex = live.rows.length
                const change = buildAddRowChange(domState.view.state, live)
                dispatchTableChange(domState, live, change, "full")
                moveCell(domState, newRowIndex, 0, keepInsert)
              }
            }
          }
          return true
        }

        if (key === "Enter") {
          // In non-Vim mode and Vim Insert mode, plain Enter inserts a real line
          // break inside the cell (serialized as <br> in Markdown).
          if (!vimOn || inInsert) {
            event.preventDefault()
            cellView.dispatch(cellView.state.replaceSelection("\n"))
            return true
          }
          // In Vim Normal mode at the bottom line of the cell, Enter moves down a row
          // (otherwise let Vim advance to the next line inside the multiline cell).
          if (cleanNormal && !event.shiftKey && curLine === totalLines) {
            event.preventDefault()
            if (active.row + 1 < rowCount) {
              moveCell(domState, active.row + 1, active.col, false)
            } else {
              exitTableToEditor(domState, "after")
            }
            return true
          }
          return false
        }

        if (key === "ArrowDown" && !event.shiftKey && !inVisual && curLine === totalLines) {
          event.preventDefault()
          const keepInsert = vimOn && inInsert
          if (active.row + 1 < rowCount) {
            moveCell(domState, active.row + 1, active.col, keepInsert)
          } else {
            exitTableToEditor(domState, "after")
          }
          return true
        }

        if (key === "ArrowUp" && !event.shiftKey && !inVisual && curLine === 1) {
          event.preventDefault()
          const keepInsert = vimOn && inInsert
          if (active.row > -1) {
            moveCell(domState, active.row - 1, active.col, keepInsert)
          } else {
            exitTableToEditor(domState, "before")
          }
          return true
        }

        // In clean Vim Normal mode, j/k at the cell's bottom/top line jump rows.
        if (cleanNormal && key === "j" && curLine === totalLines) {
          event.preventDefault()
          if (active.row + 1 < rowCount) {
            moveCell(domState, active.row + 1, active.col, false)
          } else {
            exitTableToEditor(domState, "after")
          }
          return true
        }
        if (cleanNormal && key === "k" && curLine === 1) {
          event.preventDefault()
          if (active.row > -1) {
            moveCell(domState, active.row - 1, active.col, false)
          } else {
            exitTableToEditor(domState, "before")
          }
          return true
        }

        if (key === "Escape" && !event.shiftKey) {
          // When Vim is active and in Insert/Visual/pending-operator state, let Vim
          // handle Escape to drop back to Normal mode inside the cell.
          if (vimOn && (inInsert || inVisual || pending)) {
            return false
          }
          event.preventDefault()
          exitTableToEditor(domState, "after")
          return true
        }

        return false
      },
    }),
  )

  const cellView = new EditorView({
    doc: initialText,
    extensions: [
      cellKeyHandler,
      vimComp.of(domState.vimEnabled ? [vim()] : []),
      history(),
      drawSelection(),
      EditorView.lineWrapping,
      keymap.of(defaultKeymap),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        if (update.transactions.some((tr) => tr.annotation(CellProgrammaticSync))) return
        syncActiveCellToDoc(domState)
      }),
    ],
    parent: cellEl,
  })

  const active: ActiveCellEditor = {
    row: coord.row,
    col: coord.col,
    cellEl,
    cellView,
    vimComp,
    historyIsolated: false,
  }
  domState.active = active

  // Position the caret at click coordinates if available, else start (Vim Normal) or end.
  let pos: number | null = null
  if (opts.coords) {
    pos = cellView.posAtCoords(opts.coords)
  }
  if (pos === null) {
    pos =
      opts.caret === "start" || (domState.vimEnabled && !opts.vimInsert && opts.caret !== "end")
        ? 0
        : cellView.state.doc.length
  }
  cellView.dispatch({ selection: { anchor: pos } })
  cellView.focus()

  if (domState.vimEnabled && opts.vimInsert) {
    const cm = getCM(cellView)
    if (cm && !cm.state.vim?.insertMode) {
      Vim.handleKey(cm, "A", "user")
    }
  }
}

function createCellNode(
  tag: "th" | "td",
  text: string,
  row: number,
  col: number,
  align: Align | undefined,
): HTMLElement {
  const td = document.createElement(tag)
  const alignVal = alignStyle(align)
  if (alignVal) td.style.textAlign = alignVal
  const inner = document.createElement("div")
  inner.className = "cm-table-cell"
  inner.dataset.row = String(row)
  inner.dataset.col = String(col)
  inner.textContent = text
  td.append(inner)
  return td
}

function syncRowElement(
  domState: TableDomState,
  tr: HTMLTableRowElement,
  tag: "th" | "td",
  cells: string[],
  row: number,
  aligns: Align[],
  fromInlineEdit: boolean,
): void {
  while (tr.children.length > aligns.length) {
    tr.lastElementChild?.remove()
  }
  for (let col = 0; col < aligns.length; col++) {
    const desired = cells[col] ?? ""
    const existing = tr.children[col] as HTMLElement | undefined
    if (!existing || existing.tagName.toLowerCase() !== tag) {
      const created = createCellNode(tag, desired, row, col, aligns[col])
      if (existing) existing.replaceWith(created)
      else tr.append(created)
      continue
    }
    const alignVal = alignStyle(aligns[col])
    if (existing.style.textAlign !== alignVal) existing.style.textAlign = alignVal
    const inner = existing.firstElementChild as HTMLElement | null
    if (!inner || !inner.classList.contains("cm-table-cell")) {
      const created = createCellNode(tag, desired, row, col, aligns[col])
      existing.replaceWith(created)
      continue
    }
    inner.dataset.row = String(row)
    inner.dataset.col = String(col)

    const active = domState.active
    if (active && active.cellEl === inner) {
      active.row = row
      active.col = col
      // Sync external / outer-undo changes into the nested EditorView without clobbering live typing.
      if (!fromInlineEdit) {
        const curText = active.cellView.state.doc.toString()
        if (normalizeCellInput(curText) !== desired) {
          active.cellView.dispatch({
            changes: { from: 0, to: curText.length, insert: desired },
            selection: { anchor: desired.length },
            annotations: CellProgrammaticSync.of(true),
          })
        }
      }
    } else if (inner.textContent !== desired) {
      inner.textContent = desired
    }
  }
}

function syncTableDom(
  domState: TableDomState,
  block: TableBlock,
  readOnly: boolean,
  vimEnabled: boolean,
  fromInlineEdit: boolean,
): void {
  if (readOnly && domState.active) {
    closeActiveCell(domState)
  }

  // If the active cell's row or column disappeared (e.g. outer undo removed an added row), close it.
  if (
    domState.active &&
    (domState.active.col >= block.aligns.length || domState.active.row >= block.rows.length)
  ) {
    closeActiveCell(domState)
  }

  // Live-reconfigure Vim mode on the active cell if toggled while editing inside the table.
  if (domState.active && domState.vimEnabled !== vimEnabled) {
    domState.active.cellView.dispatch({
      effects: domState.active.vimComp.reconfigure(vimEnabled ? [vim()] : []),
    })
  }

  domState.readOnly = readOnly
  domState.vimEnabled = vimEnabled
  domState.wrap.classList.toggle("cm-table-readonly", readOnly)

  const cols = block.aligns.length
  const headerCells = fitCells(block.header, cols)
  let htr = domState.thead.firstElementChild as HTMLTableRowElement | null
  if (!htr) {
    htr = document.createElement("tr")
    domState.thead.append(htr)
  }
  syncRowElement(domState, htr, "th", headerCells, -1, block.aligns, fromInlineEdit)

  while (domState.tbody.children.length > block.rows.length) {
    domState.tbody.lastElementChild?.remove()
  }
  for (let r = 0; r < block.rows.length; r++) {
    let tr = domState.tbody.children[r] as HTMLTableRowElement | undefined
    if (!tr) {
      tr = document.createElement("tr")
      domState.tbody.append(tr)
    }
    syncRowElement(
      domState,
      tr,
      "td",
      fitCells(block.rows[r], cols),
      r,
      block.aligns,
      fromInlineEdit,
    )
  }
}

/** Block-replace widget that renders its {@link TableBlock} as an aligned, directly
 * editable `<table>`. Reuses the DOM across edits via {@link updateDOM} so focus and
 * caret position stay intact while typing. */
export class TableWidget extends WidgetType {
  private readonly key: string

  constructor(
    readonly block: TableBlock,
    readonly readOnly = false,
    readonly vimEnabled = false,
    private readonly fromInlineEdit = false,
  ) {
    super()
    this.key = JSON.stringify([block.aligns, block.header, block.rows, readOnly, vimEnabled])
  }

  eq(other: TableWidget): boolean {
    return other.key === this.key
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div")
    wrap.className = "cm-table-wrap"
    wrap.contentEditable = "false"

    const scroll = document.createElement("div")
    scroll.className = "cm-table-scroll"

    const table = document.createElement("table")
    table.className = "cm-table"

    const thead = document.createElement("thead")
    const tbody = document.createElement("tbody")
    table.append(thead, tbody)
    scroll.append(table)

    const sourceBtn = document.createElement("button")
    sourceBtn.type = "button"
    sourceBtn.className = "cm-table-source-btn"
    sourceBtn.textContent = "</>"
    sourceBtn.title = "Edit raw Markdown (Ctrl/Cmd+Click)"
    sourceBtn.setAttribute("aria-label", "Edit raw Markdown")
    sourceBtn.addEventListener("click", (event) => {
      if (event.detail === 0) revealRawSource(domState, domState.lastCell)
    })

    wrap.append(scroll, sourceBtn)

    const domState: TableDomState = {
      view,
      block: this.block,
      readOnly: this.readOnly,
      vimEnabled: this.vimEnabled,
      wrap,
      table,
      thead,
      tbody,
      active: null,
      lastCell: null,
    }
    domStates.set(wrap, domState)
    syncTableDom(domState, this.block, this.readOnly, this.vimEnabled, false)

    // --- Mouse interactions --------------------------------------------------
    wrap.addEventListener("mousedown", (event) => {
      const target = event.target as HTMLElement | null
      if (!target) return

      if (target.closest(".cm-table-source-btn")) {
        event.preventDefault()
        revealRawSource(domState, domState.lastCell)
        return
      }

      if (event.button === 0 && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        const cellEl = target.closest<HTMLElement>(".cm-table-cell")
        revealRawSource(domState, cellEl ? readCellCoord(cellEl) : null)
        return
      }

      if (event.button !== 0 || domState.readOnly) return

      // Clicking inside the already-active cell lets its nested EditorView handle
      // caret placement, double-click word selection, and drag selection natively.
      if (domState.active && domState.active.cellEl.contains(target)) return

      const cellEl =
        target.closest<HTMLElement>(".cm-table-cell") ??
        target.closest<HTMLElement>("th, td")?.querySelector<HTMLElement>(".cm-table-cell")
      if (!cellEl) return

      event.preventDefault()
      activateCell(domState, cellEl, {
        coords: { x: event.clientX, y: event.clientY },
      })
    })

    // Close the nested EditorView when focus leaves the active cell for outside the cell.
    wrap.addEventListener("focusout", (event) => {
      const active = domState.active
      if (!active) return
      const next = event.relatedTarget as Node | null
      if (next && active.cellEl.contains(next)) return
      syncActiveCellToDoc(domState)
      closeActiveCell(domState)
    })

    return wrap
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const domState = domStates.get(dom)
    if (!domState) return false
    domState.view = view
    domState.block = this.block
    syncTableDom(domState, this.block, this.readOnly, this.vimEnabled, this.fromInlineEdit)
    return true
  }

  destroy(dom: HTMLElement): void {
    const domState = domStates.get(dom)
    if (domState) closeActiveCell(domState)
  }

  /** Keep inline editing events isolated from the outer CodeMirror/Vim instance,
   * while letting `Mod-s` bubble through so Ctrl/Cmd+S still triggers Brulion's save. */
  ignoreEvent(event: Event): boolean {
    if (event.type === "keydown") {
      const ke = event as KeyboardEvent
      if ((ke.ctrlKey || ke.metaKey) && !ke.altKey && ke.key.toLowerCase() === "s") {
        return false
      }
    }
    return true
  }
}

// Block decorations must come from a StateField. Rebuild on a document change (blocks
// appear/disappear/change), a selection change (reveal the block the caret entered /
// re-render the one it left), or reconfiguration (read-only conflict lock / Vim toggle).
const tableField = StateField.define<DecorationSet>({
  create: (state) => tableDecorations(state),
  update: (value, tr) => {
    if (tr.docChanged || tr.selection || tr.reconfigured) {
      return tableDecorations(tr.state, Boolean(tr.annotation(TableCellEdit)))
    }
    return value.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * The editor extension: renders pipe tables as directly editable aligned tables.
 * Register after `markdownRendering` in `editor.ts`. Styling lives in `styles.css`
 * (`.cm-table-wrap`, `.cm-table`, `.cm-table-cell`).
 */
export const tableRendering: Extension = [tableField]
