/**
 * Table rendering (M26/FEAT-0063). A CodeMirror extension that replaces a contiguous
 * pipe-delimited table block (header + separator + body) with a rendered, aligned
 * `<table>`, leaving the document bytes untouched. The raw source is revealed when the
 * selection is inside the block — the same pattern as fenced code (FEAT-0016) and
 * Mermaid (FEAT-0056). Detection is a pure line scan (the base markdown grammar
 * doesn't parse GFM tables), fence-aware so a `|` inside code isn't mistaken for one.
 */
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state"
import { type DecorationSet, Decoration, EditorView, WidgetType } from "@codemirror/view"

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

/** Split a table row into trimmed cells, dropping a single outer leading/trailing `|`
 * (so `| a | b |` and `a | b` yield the same cells). Known limitation: an escaped
 * `\|` inside a cell is split like a real pipe (GFM would keep it literal) — out of
 * scope for this phase. */
function splitRow(text: string): string[] {
  let s = text.trim()
  if (s.startsWith("|")) s = s.slice(1)
  if (s.endsWith("|")) s = s.slice(0, -1)
  return s.split("|").map((c) => c.trim())
}

/** Per-column alignment from a separator row's colons. */
function parseAligns(text: string): Align[] {
  return splitRow(text).map((c) => {
    const left = c.startsWith(":")
    const right = c.endsWith(":")
    return left && right ? "center" : right ? "right" : left ? "left" : "none"
  })
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
export function tableDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const block of findTableBlocks(state)) {
    if (selectionTouches(state, block.from, block.to)) continue
    builder.add(block.from, block.to, Decoration.replace({ widget: new TableWidget(block), block: true }))
  }
  return builder.finish()
}

/** Block-replace widget that renders its {@link TableBlock} as an aligned `<table>`.
 * Header and body cells are padded with empties / truncated to the column count
 * (the separator's). `eq` compares the rendered content so an unrelated edit reuses
 * the DOM. */
export class TableWidget extends WidgetType {
  private readonly key: string

  constructor(readonly block: TableBlock) {
    super()
    this.key = JSON.stringify([block.aligns, block.header, block.rows])
  }

  eq(other: TableWidget): boolean {
    return other.key === this.key
  }

  toDOM(): HTMLElement {
    const cols = this.block.aligns.length
    const styleFor = (i: number): string => {
      const a = this.block.aligns[i]
      return a === "none" ? "" : a
    }
    const fit = (cells: string[]): string[] => {
      const out = cells.slice(0, cols)
      while (out.length < cols) out.push("")
      return out
    }
    const cell = (tag: "th" | "td", text: string, i: number): HTMLElement => {
      const c = document.createElement(tag)
      c.textContent = text
      const align = styleFor(i)
      if (align) c.style.textAlign = align
      return c
    }
    const table = document.createElement("table")
    table.className = "cm-table"
    const thead = document.createElement("thead")
    const htr = document.createElement("tr")
    fit(this.block.header).forEach((t, i) => htr.append(cell("th", t, i)))
    thead.append(htr)
    const tbody = document.createElement("tbody")
    for (const row of this.block.rows) {
      const tr = document.createElement("tr")
      fit(row).forEach((t, i) => tr.append(cell("td", t, i)))
      tbody.append(tr)
    }
    table.append(thead, tbody)
    return table
  }

  /** Let clicks/selection through so the block can be revealed. */
  ignoreEvent(): boolean {
    return false
  }
}

// Block decorations must come from a StateField. Rebuild on a document change (blocks
// appear/disappear/change) or a selection change (reveal the block the caret entered /
// re-render the one it left); otherwise map the (empty) changes.
const tableField = StateField.define<DecorationSet>({
  create: (state) => tableDecorations(state),
  update: (value, tr) => {
    if (tr.docChanged || tr.selection) return tableDecorations(tr.state)
    return value.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

// Clicking a rendered table reveals its source: a block-replace widget is atomic, so a
// plain click lands the caret on a boundary (which, by the strict overlap rule, does
// NOT reveal). Move the caret just inside the block so the next rebuild reveals it.
const tableClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const el = (event.target as HTMLElement).closest(".cm-table")
    if (!el) return false
    const pos = view.posAtDOM(el)
    const block = findTableBlocks(view.state).find((b) => pos >= b.from && pos <= b.to)
    if (!block) return false
    event.preventDefault()
    view.dispatch({ selection: { anchor: Math.min(block.from + 1, block.to) } })
    view.focus()
    return true
  },
})

/**
 * The editor extension: the block-decoration field plus the click-to-reveal handler.
 * Register after `markdownRendering` in `editor.ts`. Styling lives in `styles.css`
 * (`.cm-table`).
 */
export const tableRendering: Extension = [tableField, tableClick]
