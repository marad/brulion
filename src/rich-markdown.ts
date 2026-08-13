/** Loss-aware Markdown projection for the primary CodeMirror editor (M47 P1).
 *
 * The source string remains authoritative. Import records every visible fragment
 * against its original UTF-16 source span and records prefixes/delimiters as
 * zero-width ranges. The latter are addressable for raw-source work, but never
 * become visible caret stops. Serialization returns the original source until
 * an explicit fragment edit is made.
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
  /** UTF-16 offsets of visible content within this source span. */
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

export interface SourceReplacement {
  sourceFrom: number
  sourceTo: number
  text: string
}

export interface RichDocument {
  readonly source: string
  readonly visible: string
  readonly ranges: readonly SourceMapRange[]
  /** Compatibility/debug view of explicit changes, keyed by source start. */
  readonly changed: ReadonlyMap<number, string>
  readonly replacements: readonly SourceReplacement[]
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

interface InlineParse {
  fragments: Fragment[]
  unmatched: boolean
}

const HEADING = /^(#{1,6})([ \t]+)(.*)$/
const QUOTE = /^>([ \t]?)(.*)$/
const BULLET = /^([*-])([ \t]+)(.*)$/
const ORDERED = /^(\d+\.)([ \t]+)(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
const MARKER_LIKE = /\^\^/
// P1 keeps the whole line raw as soon as it recognizes unsupported syntax,
// including an incomplete construct. Dedicated parsing arrives in P4.
const STRIKETHROUGH_LIKE = /~~/
const MARKDOWN_LINK = /\[[^\]\n]+\]\([^\)\n]+\)/
// Any bracketed source is kept raw in P1; link parsing belongs to P4.
const LINK_LIKE = /\[[^\n]*$/
const WIKILINK = /\[\[[^\]\n]+\]\]/
const HTML_LIKE = /<!--[\s\S]*?(?:-->|$)|<\/?[A-Za-z][^>\n]*(?:>|$)/

function push(
  fragments: Fragment[],
  text: string,
  from: number,
  to: number,
  marks: RichMark[],
  block: RichBlock,
  contentFrom = from,
  contentTo = to,
): void {
  if (to <= from && !text) return
  fragments.push({ text, sourceFrom: from, sourceTo: to, contentFrom, contentTo, marks, block })
}

function pushHidden(
  fragments: Fragment[],
  from: number,
  to: number,
  marks: RichMark[],
  block: RichBlock,
): void {
  if (to <= from) return
  push(fragments, "", from, to, marks, block, from, to)
}

function escapedAt(text: string, position: number): boolean {
  let slashes = 0
  for (let i = position - 1; i >= 0 && text[i] === "\\"; i -= 1) slashes += 1
  return slashes % 2 === 1
}

function matchingDelimiter(text: string, delimiter: string, start: number): number {
  for (let i = start; i <= text.length - delimiter.length; i += 1) {
    if (escapedAt(text, i) || !text.startsWith(delimiter, i)) continue
    // A single `*`/`_` cannot close in the middle of a strong delimiter pair.
    if (delimiter.length === 1 && (text[i - 1] === delimiter || text[i + 1] === delimiter)) continue
    // In a closing run such as the final `***` in `**bold *italic***`, the
    // first two stars close the nested italic span. Let the outer strong span
    // take the final pair instead of stopping at an overlapping pair.
    if (delimiter.length === 2 && text[i + 2] === delimiter[0]) continue
    return i
  }
  return -1
}

function delimiterAt(text: string, position: number): string {
  if (escapedAt(text, position)) return ""
  const triple = text.slice(position, position + 3)
  if (triple === "***" || triple === "___") return triple
  const pair = text.slice(position, position + 2)
  if (pair === "**" || pair === "__") return pair
  if (text[position] === "_") {
    const previous = text[position - 1]
    const next = text[position + 1]
    // CommonMark-style intraword underscores are literal text. Use Unicode
    // letters/numbers so names such as `café_bar` are not split either.
    const word = /[\p{L}\p{N}_]/u
    if (previous && next && word.test(previous) && word.test(next)) return ""
  }
  if (text[position] === "`" || text[position] === "*") return text[position]
  if (text[position] === "_") return text[position]
  return ""
}

function marksForDelimiter(delimiter: string): RichMark[] {
  if (delimiter.length === 3) return ["bold", "italic"]
  if (delimiter === "**" || delimiter === "__") return ["bold"]
  if (delimiter === "`") return ["code"]
  return ["italic"]
}

/** Parse emphasis/code only. Unsupported constructs are handled by opaqueLine. */
function inlineFragments(
  text: string,
  sourceFrom: number,
  block: RichBlock,
  inherited: RichMark[] = [],
): InlineParse {
  const fragments: Fragment[] = []
  let plainStart = 0
  let unmatched = false
  const flushPlain = (to: number): void => {
    if (to > plainStart) {
      push(fragments, text.slice(plainStart, to), sourceFrom + plainStart, sourceFrom + to, inherited, block)
    }
  }

  let i = 0
  while (i < text.length) {
    const delimiter = delimiterAt(text, i)
    if (!delimiter) {
      i += 1
      continue
    }
    const end = matchingDelimiter(text, delimiter, i + delimiter.length)
    if (end < 0 || end <= i + delimiter.length || /^\s*$/.test(text.slice(i + delimiter.length, end))) {
      unmatched = true
      i += delimiter.length
      continue
    }
    // A single delimiter must not consume the first half of a strong pair.
    if (delimiter.length === 1 && text.startsWith(delimiter + delimiter, i)) {
      unmatched = true
      i += 2
      continue
    }

    flushPlain(i)
    const innerStart = i + delimiter.length
    const innerEnd = end
    const marks = marksForDelimiter(delimiter)
    const inheritedMarks = [...inherited, ...marks]
    const nested = delimiter === "`"
      ? { fragments: [{
          text: text.slice(innerStart, innerEnd),
          sourceFrom: sourceFrom + innerStart,
          sourceTo: sourceFrom + innerEnd,
          contentFrom: sourceFrom + innerStart,
          contentTo: sourceFrom + innerEnd,
          marks: inheritedMarks,
          block,
        }], unmatched: false }
      : inlineFragments(text.slice(innerStart, innerEnd), sourceFrom + innerStart, block, inheritedMarks)

    if (nested.unmatched) unmatched = true
    pushHidden(fragments, sourceFrom + i, sourceFrom + innerStart, inheritedMarks, block)
    fragments.push(...nested.fragments)
    pushHidden(fragments, sourceFrom + innerEnd, sourceFrom + end + delimiter.length, inheritedMarks, block)

    i = end + delimiter.length
    plainStart = i
  }
  flushPlain(text.length)
  return { fragments, unmatched }
}

function lineBlock(line: string, offset: number): { body: string; bodyOffset: number; block: RichBlock; prefixTo: number } {
  const heading = HEADING.exec(line)
  if (heading) {
    const prefixTo = offset + heading[1].length + heading[2].length
    return { body: heading[3], bodyOffset: prefixTo, block: "heading", prefixTo }
  }
  const quote = QUOTE.exec(line)
  if (quote) {
    const prefixTo = offset + 1 + quote[1].length
    return { body: quote[2], bodyOffset: prefixTo, block: "quote", prefixTo }
  }
  const bullet = BULLET.exec(line)
  if (bullet) {
    const prefixTo = offset + bullet[1].length + bullet[2].length
    return { body: bullet[3], bodyOffset: prefixTo, block: "unordered-list", prefixTo }
  }
  const ordered = ORDERED.exec(line)
  if (ordered) {
    const prefixTo = offset + ordered[1].length + ordered[2].length
    return { body: ordered[3], bodyOffset: prefixTo, block: "ordered-list", prefixTo }
  }
  return { body: line, bodyOffset: offset, block: "paragraph", prefixTo: offset }
}

function opaqueLine(line: string): boolean {
  // P1 deliberately does not interpret links, tables, fences, HTML, frontmatter,
  // or application-specific marker syntax. Keep the complete line visible.
  if (MARKDOWN_LINK.test(line) || LINK_LIKE.test(line) || WIKILINK.test(line) || MARKER_LIKE.test(line) || STRIKETHROUGH_LIKE.test(line) || HTML_LIKE.test(line)) return true
  if (/^\s*\|/.test(line)) return true
  return inlineFragments(line, 0, "paragraph").unmatched
}

function rangesFromFragments(fragments: readonly Fragment[]): { visible: string; ranges: SourceMapRange[] } {
  const visible = fragments.map((fragment) => fragment.text).join("")
  const ranges: SourceMapRange[] = []
  let visibleOffset = 0
  for (const fragment of fragments) {
    const visibleTo = visibleOffset + fragment.text.length
    ranges.push({
      sourceFrom: fragment.sourceFrom,
      sourceTo: fragment.sourceTo,
      contentFrom: fragment.contentFrom,
      contentTo: fragment.contentTo,
      visibleFrom: visibleOffset,
      visibleTo,
      marks: fragment.marks,
      block: fragment.block,
      visible: fragment.text.length > 0,
    })
    visibleOffset = visibleTo
  }
  return { visible, ranges }
}

/** Import Markdown into a visible projection. All positions are JavaScript UTF-16 offsets. */
export function importMarkdown(source: string): RichDocument {
  const fragments: Fragment[] = []
  let offset = 0
  let inFence = false
  let fenceChar = ""
  let inHtmlComment = false
  let inFrontmatter = source.startsWith("---") && /^(?:---)(?:\r?\n|$)/.test(source)
  const lines = source.split(/(\r?\n)/)

  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i] ?? ""
    const newline = lines[i + 1] ?? ""
    const lineStart = offset
    const fence = FENCE.exec(line)
    const lineIsFrontmatter = inFrontmatter
    const lineIsFence = Boolean(fence || inFence)
    const lineIsHtmlComment = inHtmlComment || HTML_LIKE.test(line)

    if (lineIsFrontmatter || lineIsFence || lineIsHtmlComment || opaqueLine(line)) {
      push(fragments, line, lineStart, lineStart + line.length, [], "opaque")
      if (lineIsFrontmatter && i > 0 && /^---\s*$/.test(line)) inFrontmatter = false
      if (fence) {
        if (!inFence) {
          inFence = true
          fenceChar = fence[1][0]
        } else if (fence[1][0] === fenceChar) {
          inFence = false
        }
      }
      if (inHtmlComment) {
        if (line.includes("-->")) inHtmlComment = false
      } else if (line.includes("<!--") && !line.includes("-->")) {
        inHtmlComment = true
      }
    } else {
      const info = lineBlock(line, lineStart)
      const parsed = inlineFragments(info.body, info.bodyOffset, info.block)
      if (parsed.unmatched) {
        // Keep the entire malformed line as one raw island. Do not emit the
        // otherwise-recognized block prefix first: overlapping source ranges
        // would make delimiter/source mapping ambiguous.
        push(fragments, line, lineStart, lineStart + line.length, [], "opaque")
      } else {
        if (info.prefixTo > lineStart) pushHidden(fragments, lineStart, info.prefixTo, [], info.block)
        fragments.push(...parsed.fragments)
      }
    }

    if (newline) {
      const block = fragments.at(-1)?.block ?? "paragraph"
      push(fragments, newline, lineStart + line.length, lineStart + line.length + newline.length, [], block)
    }
    offset += line.length + newline.length
  }

  const projection = rangesFromFragments(fragments)
  return { source, visible: projection.visible, ranges: projection.ranges, changed: new Map(), replacements: [] }
}

/** Serialize a document. Untouched source spans are returned byte-for-byte. */
export function serializeMarkdown(document: RichDocument): string {
  if (!document.replacements.length) return document.source
  let result = document.source
  for (const replacement of [...document.replacements].sort((a, b) => b.sourceFrom - a.sourceFrom)) {
    result = result.slice(0, replacement.sourceFrom) + replacement.text + result.slice(replacement.sourceTo)
  }
  return result
}

function visibleRangeAt(document: RichDocument, position: number, side: "start" | "end"): SourceMapRange | undefined {
  const visible = document.ranges.filter((range) => range.visible)
  if (!visible.length) return undefined
  if (side === "start") {
    return visible.find((range) => position >= range.visibleFrom && position < range.visibleTo)
      ?? visible.find((range) => range.visibleFrom >= position)
      ?? (position === document.visible.length ? visible.at(-1) : undefined)
  }
  return visible.find((range) => position > range.visibleFrom && position <= range.visibleTo)
    ?? [...visible].reverse().find((range) => range.visibleTo <= position)
}

export function visibleToSource(document: RichDocument, position: number): number {
  if (!Number.isSafeInteger(position) || position < 0 || position > document.visible.length) throw new RangeError("Visible position out of bounds")
  const range = visibleRangeAt(document, position, "start")
  if (!range) return document.source.length
  if (position <= range.visibleFrom) return range.contentFrom
  return range.contentFrom + Math.min(position - range.visibleFrom, range.contentTo - range.contentFrom)
}

export function sourceToVisible(document: RichDocument, position: number): number {
  if (!Number.isSafeInteger(position) || position < 0 || position > document.source.length) throw new RangeError("Source position out of bounds")
  if (position === document.source.length) return document.visible.length
  const range = document.ranges.find((candidate) => position >= candidate.sourceFrom && position < candidate.sourceTo)
  if (!range) {
    const next = document.ranges.find((candidate) => candidate.sourceFrom >= position)
    return next?.visibleFrom ?? document.visible.length
  }
  if (!range.visible) return range.visibleFrom
  return range.visibleFrom + Math.min(position - range.contentFrom, range.contentTo - range.contentFrom)
}

/** Replace one visible mapped fragment.
 *
 * The replacement text is Markdown source for that fragment. Re-importing the
 * resulting source immediately is intentional: a caller may insert a marker
 * sequence such as `**new**`, and the returned visible document must then agree
 * with the source map rather than exposing the delimiters as ordinary text.
 * Since the returned source is the new authoritative snapshot, later edits use
 * its current coordinates and remain composable. Untouched source bytes are
 * copied directly; P2 expands this primitive to rich operations and
 * cross-fragment selections.
 */
export function replaceVisible(document: RichDocument, from: number, to: number, text: string): RichDocument {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > document.visible.length) {
    throw new RangeError("Visible range out of bounds")
  }
  if (from === to && from === document.visible.length) {
    return importMarkdown(document.source + text)
  }

  const start = visibleRangeAt(document, from, "start")
  const end = from === to ? start : visibleRangeAt(document, to, "end")
  if (!start || !end) {
    if (from !== 0 || to !== 0 || document.visible.length !== 0) throw new RangeError("Visible range is not mapped")
    return importMarkdown(document.source + text)
  }
  if (start.sourceFrom !== end.sourceFrom || start.sourceTo !== end.sourceTo) {
    throw new RangeError("Replacement must stay within one mapped fragment")
  }
  const sourceFrom = start.contentFrom + (from - start.visibleFrom)
  const sourceTo = end.contentFrom + (to - end.visibleFrom)
  const nextSource = document.source.slice(0, sourceFrom) + text + document.source.slice(sourceTo)
  return importMarkdown(nextSource)
}
