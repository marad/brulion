/** Loss-aware Markdown projection for the primary CodeMirror editor (M47).
 *
 * The source string remains authoritative. Import records every visible fragment
 * against its original UTF-16 source span; serialization returns the original
 * source until an explicit fragment edit is made. This small, dependency-free
 * core is intentionally usable by tests and by the eventual CM StateField.
 */

export type RichMark = "bold" | "italic" | "code" | "link" | "wikilink"
export type RichBlock =
  | "paragraph"
  | "heading"
  | "quote"
  | "unordered-list"
  | "ordered-list"
  | "fence"
  | "table"
  | "frontmatter"
  | "mermaid"
  | "opaque"

export interface SourceMapRange {
  /** UTF-16 offsets in the original Markdown source. */
  sourceFrom: number
  sourceTo: number
  /** UTF-16 offsets of visible content within the source span. */
  contentFrom: number
  contentTo: number
  /** UTF-16 offsets in the visible projection. */
  visibleFrom: number
  visibleTo: number
  marks: readonly RichMark[]
  block: RichBlock
  /** False for delimiters/prefixes that have no visible representation. */
  visible: boolean
}

export interface RichDocument {
  readonly source: string
  readonly visible: string
  readonly ranges: readonly SourceMapRange[]
  readonly changed: ReadonlyMap<number, string>
}

interface Fragment {
  text: string
  sourceFrom: number
  sourceTo: number
  contentFrom: number
  contentTo: number
  marks: RichMark[]
  block: RichBlock
}

const INLINE = /(\*\*|__)(.+?)\1|(\*|_)([^*_\n]+?)\3|`([^`\n]+?)`|\[([^\]\n]+)\]\(([^)\n]+)\)|\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g
const HEADING = /^(#{1,6})([ \t]+)(.*)$/
const QUOTE = /^>[ \t]?(.*)$/
const BULLET = /^([*-])[ \t]+(.*)$/
const ORDERED = /^(\d+\.)[ \t]+(.*)$/

function push(fragments: Fragment[], text: string, from: number, to: number, marks: RichMark[], block: RichBlock, contentFrom = from, contentTo = to): void {
  if (to <= from && !text) return
  fragments.push({ text, sourceFrom: from, sourceTo: to, contentFrom, contentTo, marks, block })
}

function inlineFragments(text: string, sourceFrom: number, block: RichBlock): Fragment[] {
  const out: Fragment[] = []
  let cursor = 0
  INLINE.lastIndex = 0
  for (let match: RegExpExecArray | null; (match = INLINE.exec(text)); ) {
    if (match.index > cursor) push(out, text.slice(cursor, match.index), sourceFrom + cursor, sourceFrom + match.index, [], block)
    const raw = match[0]
    let value = raw
    let marks: RichMark[] = []
    if (match[1]) { value = match[2]; marks = ["bold"] }
    else if (match[3]) { value = match[4]; marks = ["italic"] }
    else if (match[5]) { value = match[5]; marks = ["code"] }
    else if (match[6]) { value = match[6]; marks = ["link"] }
    else if (match[8]) { value = match[9] || match[8]; marks = ["wikilink"] }
    // Delimiters are included in source span but excluded from visible positions.
    const contentStart = match[1] || match[3] ? raw.indexOf(value) : match[5] ? 1 : match[6] ? 1 : match[8] ? Math.max(2, raw.indexOf("|") + 1) : 0
    push(out, value, sourceFrom + match.index, sourceFrom + match.index + raw.length, marks, block,
      sourceFrom + match.index + contentStart, sourceFrom + match.index + contentStart + value.length)
    cursor = match.index + raw.length
  }
  if (cursor < text.length) push(out, text.slice(cursor), sourceFrom + cursor, sourceFrom + text.length, [], block)
  return out
}

function lineBlock(line: string, offset: number): { body: string; bodyOffset: number; block: RichBlock } {
  const h = HEADING.exec(line)
  if (h) return { body: h[3], bodyOffset: offset + h[1].length + h[2].length, block: "heading" }
  const q = QUOTE.exec(line)
  if (q) return { body: q[1], bodyOffset: offset + 1 + (line[1] === " " ? 1 : 0), block: "quote" }
  const b = BULLET.exec(line)
  if (b) return { body: b[2], bodyOffset: offset + b[0].length - b[2].length, block: "unordered-list" }
  const o = ORDERED.exec(line)
  if (o) return { body: o[2], bodyOffset: offset + o[0].length - o[2].length, block: "ordered-list" }
  return { body: line, bodyOffset: offset, block: "paragraph" }
}

/** Import Markdown into a visible projection. All positions are JavaScript UTF-16 offsets. */
export function importMarkdown(source: string): RichDocument {
  const fragments: Fragment[] = []
  let visible = ""
  let offset = 0
  let inFence = false
  let fenceChar = ""
  let frontmatter = source.startsWith("---") && /^(?:---)[^\n]*(?:\n|$)/.test(source)
  const lines = source.split(/(\r?\n)/)
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i] || ""
    const newline = lines[i + 1] || ""
    const lineStart = offset
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (frontmatter) {
      push(fragments, line, lineStart, lineStart + line.length, [], "frontmatter")
      visible += line
      if (line !== "---" && i > 0 && /^---\s*$/.test(line)) frontmatter = false
    } else if (fence) {
      if (!inFence) { inFence = true; fenceChar = fence[1][0] }
      else if (fence[1][0] === fenceChar) inFence = false
      // Fence source is opaque in the rich view: code editing is explicit.
      push(fragments, line, lineStart, lineStart + line.length, [], fence[2].trim() === "mermaid" ? "mermaid" : "fence")
      visible += line
    } else if (inFence) {
      push(fragments, line, lineStart, lineStart + line.length, [], "fence")
      visible += line
    } else {
      const info = lineBlock(line, lineStart)
      const parts = inlineFragments(info.body, info.bodyOffset, info.block)
      for (const part of parts) { fragments.push(part); visible += part.text }
    }
    if (newline) {
      const block = inFence ? "fence" : (fragments.at(-1)?.block || "paragraph")
      push(fragments, newline, lineStart + line.length, lineStart + line.length + newline.length, [], block)
      visible += newline
    }
    offset += line.length + newline.length
  }
  const ranges: SourceMapRange[] = []
  let visibleOffset = 0
  for (const fragment of fragments) {
    ranges.push({ sourceFrom: fragment.sourceFrom, sourceTo: fragment.sourceTo, contentFrom: fragment.contentFrom, contentTo: fragment.contentTo, visibleFrom: visibleOffset, visibleTo: visibleOffset + fragment.text.length, marks: fragment.marks, block: fragment.block, visible: fragment.text.length > 0 })
    visibleOffset += fragment.text.length
  }
  return { source, visible, ranges, changed: new Map() }
}

/** Serialize a document. Untouched source spans are returned byte-for-byte. */
export function serializeMarkdown(document: RichDocument): string {
  if (!document.changed.size) return document.source
  let result = document.source
  const replacements = [...document.changed.entries()]
    .map(([from, text]) => ({ from, text, range: document.ranges.find((r) => r.sourceFrom === from) }))
    .filter((x): x is { from: number; text: string; range: SourceMapRange } => Boolean(x.range))
    .sort((a, b) => b.range.sourceFrom - a.range.sourceFrom)
  for (const replacement of replacements) result = result.slice(0, replacement.range.sourceFrom) + replacement.text + result.slice(replacement.range.sourceTo)
  return result
}

function nearestRange(doc: RichDocument, pos: number): SourceMapRange | undefined {
  return doc.ranges.find((range) => pos >= range.visibleFrom && pos < range.visibleTo && range.visible)
    ?? doc.ranges.find((range) => range.visible && range.visibleFrom === pos)
    ?? doc.ranges.filter((range) => range.visible).at(-1)
}

export function visibleToSource(document: RichDocument, position: number): number {
  if (!Number.isSafeInteger(position) || position < 0 || position > document.visible.length) throw new RangeError("Visible position out of bounds")
  const range = nearestRange(document, position)
  if (!range) return document.source.length
  if (position === 0) return document.ranges[0]?.sourceFrom ?? 0
  return range.contentFrom + Math.min(position - range.visibleFrom, range.contentTo - range.contentFrom)
}

export function sourceToVisible(document: RichDocument, position: number): number {
  if (!Number.isSafeInteger(position) || position < 0 || position > document.source.length) throw new RangeError("Source position out of bounds")
  const firstVisible = document.ranges.find((candidate) => candidate.visible)
  if (firstVisible && position < firstVisible.sourceFrom) return firstVisible.visibleFrom
  const range = document.ranges.filter((candidate) => position >= candidate.sourceFrom && position <= candidate.sourceTo)[0]
  if (!range) return document.visible.length
  if (position <= range.contentFrom) return range.visibleFrom
  return range.visibleFrom + Math.min(position - range.contentFrom, range.visibleTo - range.visibleFrom)
}

/** Replace visible text in one mapped fragment. This is the only mutation primitive
 * exposed by P1; callers can choose canonical Markdown for the changed span later. */
export function replaceVisible(document: RichDocument, from: number, to: number, text: string): RichDocument {
  if (from < 0 || to < from || to > document.visible.length) throw new RangeError("Visible range out of bounds")
  const sourceFrom = visibleToSource(document, from)
  visibleToSource(document, to)
  const changed = new Map(document.changed)
  const range = nearestRange(document, from)
  changed.set(range?.sourceFrom ?? sourceFrom, text)
  const nextVisible = document.visible.slice(0, from) + text + document.visible.slice(to)
  return { ...document, visible: nextVisible, changed }
}
