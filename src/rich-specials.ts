/**
 * Loss-aware recognition for M47 P4 links and special Markdown blocks.
 *
 * This module is deliberately source-only: it never renders, resolves, or
 * serializes a parsed construct. Every offset is a JavaScript UTF-16 offset in
 * the input string, and ambiguous syntax is omitted so the caller can keep it
 * as an opaque raw region.
 */

export type RichLinkKind = "markdown" | "wikilink" | "autolink"
export type RichSpecialKind = "fence" | "table" | "frontmatter" | "mermaid"
export type TableAlignment = "left" | "center" | "right" | "none"

export interface SourceSpan {
  sourceFrom: number
  sourceTo: number
}

export interface RichLinkNode extends SourceSpan {
  kind: RichLinkKind
  raw: string
  labelFrom: number
  labelTo: number
  targetFrom: number
  targetTo: number
  target: string
  label: string
  alias: string | null
}

export interface RichTableCell extends SourceSpan {
  tableFrom: number
  tableTo: number
  row: number
  column: number
  contentFrom: number
  contentTo: number
  text: string
}

export interface RichTableRow extends SourceSpan {
  row: number
  cells: readonly RichTableCell[]
}

interface FenceNode extends SourceSpan {
  kind: "fence" | "mermaid"
  contentFrom: number
  contentTo: number
  raw: string
  fenceChar: "`" | "~"
  fenceLength: number
  info: string
}

interface TableNode extends SourceSpan {
  kind: "table"
  contentFrom: number
  contentTo: number
  raw: string
  rows: readonly RichTableRow[]
  aligns: readonly TableAlignment[]
}

interface FrontmatterNode extends SourceSpan {
  kind: "frontmatter"
  contentFrom: number
  contentTo: number
  raw: string
}

export type RichSpecialNode = FenceNode | TableNode | FrontmatterNode

export interface ProtectedSourceSpan extends SourceSpan {
  kind: RichSpecialKind
}

export interface RichSpecialScan {
  specials: readonly RichSpecialNode[]
  protected: readonly ProtectedSourceSpan[]
}

interface SourceLine {
  from: number
  to: number
  next: number
}

interface ParsedTableRow {
  line: SourceLine
  cells: readonly Omit<RichTableCell, "tableFrom" | "tableTo">[]
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []
  let from = 0
  while (from <= source.length) {
    const newline = source.indexOf("\n", from)
    if (newline < 0) {
      lines.push({ from, to: source.length, next: source.length })
      break
    }
    const to = newline > from && source[newline - 1] === "\r" ? newline - 1 : newline
    lines.push({ from, to, next: newline + 1 })
    from = newline + 1
    if (from === source.length) {
      lines.push({ from, to: from, next: from })
      break
    }
  }
  if (!source.length && lines.length === 0) lines.push({ from: 0, to: 0, next: 0 })
  return lines
}

function overlaps(span: SourceSpan, from: number, to: number): boolean {
  return span.sourceFrom < to && span.sourceTo > from
}

function fenceOpen(line: string): { marker: string; info: string } | null {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line)
  if (!match) return null
  return { marker: match[1], info: match[2].trim() }
}

function fenceClose(line: string, marker: string): boolean {
  const char = marker[0]
  const length = marker.length
  return new RegExp(`^[ \\t]{0,3}${char}{${length},}[ \\t]*$`).test(line)
}

function delimiterLine(line: string, value: "---" | "..."): boolean {
  return new RegExp(`^${value}[ \\t]*$`).test(line)
}

function unescapedPipePositions(text: string): number[] {
  const positions: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "|") continue
    let slashes = 0
    for (let previous = index - 1; previous >= 0 && text[previous] === "\\"; previous -= 1) slashes += 1
    if (slashes % 2 === 0) positions.push(index)
  }
  return positions
}

function trimCell(text: string, from: number, to: number): { from: number; to: number } {
  while (from < to && /[ \t]/.test(text[from] ?? "")) from += 1
  while (to > from && /[ \t]/.test(text[to - 1] ?? "")) to -= 1
  return { from, to }
}

function parseTableRow(source: string, line: SourceLine, row: number): ParsedTableRow | null {
  const text = source.slice(line.from, line.to)
  const pipes = unescapedPipePositions(text)
  if (!pipes.length) return null
  const leadingPipe = text.slice(0, pipes[0]).trim() === ""
  const trailingPipe = text.slice(pipes[pipes.length - 1] + 1).trim() === ""
  const segments: Array<{ from: number; to: number }> = []
  if (leadingPipe) {
    for (let index = 0; index < pipes.length - (trailingPipe ? 1 : 0); index += 1) {
      const start = pipes[index] + 1
      const end = index + 1 < pipes.length ? pipes[index + 1] : text.length
      if (index + 1 === pipes.length && trailingPipe) break
      segments.push({ from: start, to: end })
    }
  } else {
    for (let index = 0; index < pipes.length; index += 1) {
      const start = index === 0 ? 0 : pipes[index - 1] + 1
      const end = pipes[index]
      segments.push({ from: start, to: end })
    }
    if (!trailingPipe) segments.push({ from: pipes[pipes.length - 1] + 1, to: text.length })
  }
  if (!segments.length) return null

  const cells = segments.map((segment, column) => {
    const trimmed = trimCell(text, segment.from, segment.to)
    return {
      sourceFrom: line.from + segment.from,
      sourceTo: line.from + segment.to,
      row,
      column,
      contentFrom: line.from + trimmed.from,
      contentTo: line.from + trimmed.to,
      text: source.slice(line.from + trimmed.from, line.from + trimmed.to),
    }
  })
  return { line, cells }
}

function separatorAligns(row: ParsedTableRow): TableAlignment[] | null {
  if (!row.cells.length) return null
  const aligns: TableAlignment[] = []
  for (const cell of row.cells) {
    const value = cell.text
    if (!/^:?-+:?$/.test(value)) return null
    const left = value.startsWith(":")
    const right = value.endsWith(":")
    aligns.push(left && right ? "center" : right ? "right" : left ? "left" : "none")
  }
  return aligns
}

function makeFenceNode(source: string, lines: readonly SourceLine[], openIndex: number, closeIndex: number, open: { marker: string; info: string }): RichSpecialNode {
  const opening = lines[openIndex]!
  const closing = lines[closeIndex]!
  const sourceFrom = opening.from
  const sourceTo = closing.to
  const kind = open.info.toLowerCase() === "mermaid" ? "mermaid" : "fence"
  return {
    kind,
    sourceFrom,
    sourceTo,
    contentFrom: opening.next,
    contentTo: closing.from,
    raw: source.slice(sourceFrom, sourceTo),
    fenceChar: open.marker[0] as "`" | "~",
    fenceLength: open.marker.length,
    info: open.info,
  }
}

function makeTableNode(source: string, rows: readonly ParsedTableRow[], aligns: readonly TableAlignment[]): RichSpecialNode {
  const sourceFrom = rows[0]!.line.from
  const sourceTo = rows[rows.length - 1]!.line.to
  const richRows = rows.map((row) => ({
    row: row.cells[0]?.row ?? 0,
    sourceFrom: row.line.from,
    sourceTo: row.line.to,
    cells: row.cells.map((cell) => ({
      ...cell,
      tableFrom: sourceFrom,
      tableTo: sourceTo,
    })),
  }))
  return {
    kind: "table",
    sourceFrom,
    sourceTo,
    contentFrom: sourceFrom,
    contentTo: sourceTo,
    raw: source.slice(sourceFrom, sourceTo),
    rows: richRows,
    aligns: [...aligns],
  }
}

/** Scan closed special blocks and return exact source spans. */
export function scanRichSpecials(source: string): RichSpecialScan {
  const lines = sourceLines(source)
  const comments = commentSpans(source)
  const html = htmlSourceSpans(source)
  const specials: RichSpecialNode[] = []
  const protectedSpans: ProtectedSourceSpan[] = []

  if (lines[0] && /^---[ \t]*$/.test(source.slice(lines[0].from, lines[0].to))) {
    let closed = false
    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index]!
      const text = source.slice(line.from, line.to)
      if (!delimiterLine(text, "---") && !delimiterLine(text, "...")) continue
      const node: FrontmatterNode = {
        kind: "frontmatter",
        sourceFrom: 0,
        sourceTo: line.to,
        contentFrom: lines[0]!.next,
        contentTo: line.from,
        raw: source.slice(0, line.to),
      }
      specials.push(node)
      protectedSpans.push({ sourceFrom: node.sourceFrom, sourceTo: node.sourceTo, kind: node.kind })
      closed = true
      break
    }
    if (!closed) protectedSpans.push({ sourceFrom: 0, sourceTo: source.length, kind: "frontmatter" })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (protectedSpans.some((span) => overlaps(span, line.from, line.to))
      || comments.some((span) => overlaps(span, line.from, line.to))
      || html.some((span) => overlaps(span, line.from, line.to))) continue
    const opening = fenceOpen(source.slice(line.from, line.to))
    if (!opening) continue
    let closeIndex = -1
    for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
      const closeLine = lines[candidate]!
      if (fenceClose(source.slice(closeLine.from, closeLine.to), opening.marker)) {
        closeIndex = candidate
        break
      }
    }
    if (closeIndex < 0) {
      protectedSpans.push({ sourceFrom: line.from, sourceTo: source.length, kind: "fence" })
      index = lines.length
      continue
    }
    const node = makeFenceNode(source, lines, index, closeIndex, opening)
    specials.push(node)
    protectedSpans.push({ sourceFrom: node.sourceFrom, sourceTo: node.sourceTo, kind: node.kind })
    index = closeIndex
  }

  for (let index = 0; index + 1 < lines.length; index += 1) {
    const headerLine = lines[index]!
    const separatorLine = lines[index + 1]!
    if (protectedSpans.some((span) => overlaps(span, headerLine.from, separatorLine.to))
      || comments.some((span) => overlaps(span, headerLine.from, separatorLine.to))
      || html.some((span) => overlaps(span, headerLine.from, separatorLine.to))) continue
    const header = parseTableRow(source, headerLine, 0)
    const separator = parseTableRow(source, separatorLine, 1)
    if (!header || !separator || !separatorAligns(separator) || header.cells.length !== separator.cells.length) continue
    if (header.cells.every((cell) => /^:?-+:?$/.test(cell.text))) continue

    const rows: ParsedTableRow[] = [header, separator]
    let lastIndex = index + 1
    for (let bodyIndex = index + 2; bodyIndex < lines.length; bodyIndex += 1) {
      const bodyLine = lines[bodyIndex]!
      if (bodyLine.from === bodyLine.to
        || protectedSpans.some((span) => overlaps(span, bodyLine.from, bodyLine.to))
        || comments.some((span) => overlaps(span, bodyLine.from, bodyLine.to))
        || html.some((span) => overlaps(span, bodyLine.from, bodyLine.to))) break
      const body = parseTableRow(source, bodyLine, rows.length)
      if (!body || body.cells.length === 0) break
      rows.push(body)
      lastIndex = bodyIndex
    }
    const table = makeTableNode(source, rows, separatorAligns(separator)!)
    specials.push(table)
    protectedSpans.push({ sourceFrom: table.sourceFrom, sourceTo: table.sourceTo, kind: table.kind })
    index = lastIndex
  }

  specials.sort((left, right) => left.sourceFrom - right.sourceFrom)
  protectedSpans.sort((left, right) => left.sourceFrom - right.sourceFrom)
  return { specials, protected: protectedSpans }
}

function escapedAt(source: string, position: number): boolean {
  let slashes = 0
  for (let index = position - 1; index >= 0 && source[index] === "\\"; index -= 1) slashes += 1
  return slashes % 2 === 1
}

function insideAny(spans: readonly SourceSpan[], from: number, to: number): boolean {
  return spans.some((span) => overlaps(span, from, to))
}

function commentSpans(source: string): SourceSpan[] {
  const spans: SourceSpan[] = []
  let start = source.indexOf("<!--")
  while (start >= 0) {
    const close = source.indexOf("-->", start + 4)
    const sourceTo = close < 0 ? source.length : close + 3
    spans.push({ sourceFrom: start, sourceTo })
    start = source.indexOf("<!--", sourceTo)
  }
  return spans
}

const VOID_HTML_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"])
function removeAngleLinkDestinations(line: string): string {
  return line.replace(/\]\(<[^>\r\n]*>\)/g, (match) => " ".repeat(match.length))
}

function htmlSourceSpans(source: string): SourceSpan[] {
  const spans: SourceSpan[] = []
  const lines = sourceLines(source)
  const tagPattern = /<\/(?:[A-Za-z][\w:-]*)\s*>|<[A-Za-z][\w:-]*(?:\s[^>]*)?>/g
  let blockFrom = -1
  const stack: string[] = []
  for (const line of lines) {
    const text = removeAngleLinkDestinations(source.slice(line.from, line.to))
    const tags = [...text.matchAll(tagPattern)]
    if (!tags.length) {
      if (blockFrom >= 0) continue
      continue
    }
    if (blockFrom < 0) blockFrom = line.from
    for (const tag of tags) {
      const raw = tag[0]
      const closing = raw.startsWith("</")
      const nameMatch = /^<\/?([A-Za-z][\w:-]*)/.exec(raw)
      const name = nameMatch?.[1]?.toLowerCase()
      if (!name || VOID_HTML_TAGS.has(name) || raw.endsWith("/>") && !closing) continue
      if (closing) {
        if (stack.at(-1) === name) stack.pop()
      } else {
        stack.push(name)
      }
    }
    if (stack.length === 0) {
      spans.push({ sourceFrom: blockFrom, sourceTo: line.to })
      blockFrom = -1
    }
  }
  if (blockFrom >= 0) spans.push({ sourceFrom: blockFrom, sourceTo: source.length })
  return spans
}

/** Return HTML/unknown markup spans that must stay opaque to link and table scans. */
export function scanRichHtmlSpans(source: string): readonly SourceSpan[] {
  return htmlSourceSpans(source)
}

function trimDestination(source: string, from: number, to: number): { from: number; to: number } {
  while (from < to && /[ \t]/.test(source[from] ?? "")) from += 1
  while (to > from && /[ \t]/.test(source[to - 1] ?? "")) to -= 1
  return { from, to }
}

function markdownLinkAt(source: string, start: number, lineEnd: number): RichLinkNode | null {
  if (source[start] !== "[" || escapedAt(source, start) || source[start + 1] === "[" || (start > 0 && source[start - 1] === "!")) return null
  let closeBracket = -1
  for (let index = start + 1; index < lineEnd; index += 1) {
    if (source[index] === "\n" || source[index] === "\r") return null
    if (source[index] === "[" && !escapedAt(source, index)) return null
    if (source[index] === "]" && !escapedAt(source, index)) {
      closeBracket = index
      break
    }
  }
  if (closeBracket <= start + 1 || source[closeBracket + 1] !== "(") return null

  let depth = 1
  let closeParen = -1
  for (let index = closeBracket + 2; index < lineEnd; index += 1) {
    if (escapedAt(source, index)) continue
    if (source[index] === "(") depth += 1
    else if (source[index] === ")") {
      depth -= 1
      if (depth === 0) {
        closeParen = index
        break
      }
    }
  }
  if (closeParen < 0) return null

  const destination = trimDestination(source, closeBracket + 2, closeParen)
  if (destination.from >= destination.to) return null
  let targetFrom = destination.from
  let targetTo = destination.to
  if (source[targetFrom] === "<") {
    if (source[targetTo - 1] !== ">") return null
    targetFrom += 1
    targetTo -= 1
    const angle = source.indexOf(">", targetFrom)
    if (angle < 0 || angle !== targetTo) return null
  }
  if (targetFrom >= targetTo) return null
  return {
    kind: "markdown",
    sourceFrom: start,
    sourceTo: closeParen + 1,
    raw: source.slice(start, closeParen + 1),
    labelFrom: start + 1,
    labelTo: closeBracket,
    targetFrom,
    targetTo,
    target: source.slice(targetFrom, targetTo),
    label: source.slice(start + 1, closeBracket),
    alias: null,
  }
}

function wikilinkAt(source: string, start: number, lineEnd: number): RichLinkNode | null {
  if (!source.startsWith("[[", start) || escapedAt(source, start)) return null
  let close = -1
  for (let index = start + 2; index + 1 < lineEnd; index += 1) {
    if (source[index] === "]" && source[index + 1] === "]" && !escapedAt(source, index)) {
      close = index
      break
    }
  }
  if (close < 0 || close <= start + 2) return null
  for (let index = start + 2; index + 1 < close; index += 1) {
    if (source[index] === "[" && source[index + 1] === "[" && !escapedAt(source, index)) return null
  }
  const bodyFrom = start + 2
  const bodyTo = close
  if (source.slice(bodyFrom, bodyTo).includes("\\|")) return null
  let pipe = -1
  for (let index = bodyFrom; index < bodyTo; index += 1) {
    if (source[index] === "|" && !escapedAt(source, index)) {
      pipe = index
      break
    }
  }
  const hasAlias = pipe >= bodyFrom && pipe < bodyTo
  const rawTargetFrom = bodyFrom
  const rawTargetTo = hasAlias ? pipe : bodyTo
  const target = trimDestination(source, rawTargetFrom, rawTargetTo)
  if (target.from >= target.to) return null
  const rawLabelFrom = hasAlias ? pipe + 1 : target.from
  const rawLabelTo = hasAlias ? bodyTo : target.to
  const label = trimDestination(source, rawLabelFrom, rawLabelTo)
  if (label.from >= label.to) return null
  return {
    kind: "wikilink",
    sourceFrom: start,
    sourceTo: close + 2,
    raw: source.slice(start, close + 2),
    labelFrom: label.from,
    labelTo: label.to,
    targetFrom: target.from,
    targetTo: target.to,
    target: source.slice(target.from, target.to),
    label: source.slice(label.from, label.to),
    alias: hasAlias ? source.slice(label.from, label.to) : null,
  }
}

function hasOpeningMarker(source: string, start: number, marker: string): boolean {
  const openingFrom = start - marker.length
  if (openingFrom < 0 || source.slice(openingFrom, start) !== marker || escapedAt(source, openingFrom)) return false
  return openingFrom === 0 || /\s/.test(source[openingFrom - 1] ?? "")
}

function urlNodeAt(source: string, start: number, end: number): RichLinkNode | null {
  let sourceTo = end
  while (sourceTo > start) {
    const last = source[sourceTo - 1] ?? ""
    if (/[.,;:!?]/.test(last)) {
      sourceTo -= 1
      continue
    }
    if (last === ")" && (source.slice(start, sourceTo).match(/\)/g)?.length ?? 0) > (source.slice(start, sourceTo).match(/\(/g)?.length ?? 0)) {
      sourceTo -= 1
      continue
    }
    if (sourceTo - start >= 2 && /[*_]/.test(source[sourceTo - 2] ?? "") && source[sourceTo - 2] === last
      && hasOpeningMarker(source, start, source.slice(sourceTo - 2, sourceTo))) {
      sourceTo -= 2
      continue
    }
    if ((last === "*" || last === "_" || last === "`") && hasOpeningMarker(source, start, last)) {
      sourceTo -= 1
      continue
    }
    break
  }
  const url = source.slice(start, sourceTo)
  const previous = source[start - 1]
  const previousIsIntrawordUnderscore = previous === "_" && start > 1 && /[\p{L}\p{N}]/u.test(source[start - 2] ?? "")
  if (sourceTo <= start || escapedAt(source, start) || /[*`]/.test(url)) return null
  if (start > 0 && /[\p{L}\p{N}]/u.test(previous ?? "")) return null
  if (previousIsIntrawordUnderscore) return null
  return {
    kind: "autolink",
    sourceFrom: start,
    sourceTo,
    raw: source.slice(start, sourceTo),
    labelFrom: start,
    labelTo: sourceTo,
    targetFrom: start,
    targetTo: sourceTo,
    target: source.slice(start, sourceTo),
    label: source.slice(start, sourceTo),
    alias: null,
  }
}

/** Scan complete links outside the supplied special-block spans. */
export function scanRichLinks(
  source: string,
  protectedSpans: readonly ProtectedSourceSpan[],
): readonly RichLinkNode[] {
  const blocked = [...protectedSpans, ...commentSpans(source), ...htmlSourceSpans(source)]
  const links: RichLinkNode[] = []
  const occupied: SourceSpan[] = []
  const lines = sourceLines(source)

  for (const line of lines) {
    for (let index = line.from; index < line.to; index += 1) {
      if (insideAny(blocked, index, index + 1) || insideAny(occupied, index, index + 1)) continue
      const wiki = wikilinkAt(source, index, line.to)
      if (wiki && !insideAny(blocked, wiki.sourceFrom, wiki.sourceTo)) {
        links.push(wiki)
        occupied.push(wiki)
        index = wiki.sourceTo - 1
        continue
      }
      if (source.startsWith("[[", index)) {
        index = line.to
        continue
      }
      const markdown = markdownLinkAt(source, index, line.to)
      if (markdown && !insideAny(blocked, markdown.sourceFrom, markdown.sourceTo)) {
        links.push(markdown)
        occupied.push(markdown)
        index = markdown.sourceTo - 1
      } else if (source[index] === "[") {
        // A nested/ambiguous bracket sequence makes the complete line raw;
        // do not salvage an inner link from malformed outer Markdown.
        index = line.to
      }
    }
  }

  const urlPattern = /(?:https?:\/\/|www\.)[^\s<>[\]]+/gi
  let match: RegExpExecArray | null
  while ((match = urlPattern.exec(source)) !== null) {
    const start = match.index
    const candidate = urlNodeAt(source, start, start + match[0].length)
    if (!candidate || insideAny(blocked, candidate.sourceFrom, candidate.sourceTo) || insideAny(occupied, candidate.sourceFrom, candidate.sourceTo)) continue
    links.push(candidate)
    occupied.push(candidate)
  }

  return links.sort((left, right) => left.sourceFrom - right.sourceFrom)
}
