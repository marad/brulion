/** Loss-aware Markdown projection for the primary CodeMirror editor (M47 P1).
 *
 * The source string remains authoritative. Import records every visible fragment
 * against its original UTF-16 source span; serialization returns the original
 * source until an explicit fragment edit is made. The visible string is suitable
 * for use as a CodeMirror EditorState document; source positions never become
 * hidden caret stops.
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

const HEADING = /^(#{1,6})([ \t]+)(.*)$/
const QUOTE = /^>([ \t]?)(.*)$/
const BULLET = /^([*-])([ \t]+)(.*)$/
const ORDERED = /^(\d+\.)([ \t]+)(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/
const MARKER_LIKE = /\^\^[^\n]+\^\^/
const MARKDOWN_LINK = /\[[^\]\n]+\]\([^\)\n]+\)/
const WIKILINK = /\[\[[^\]\n]+\]\]/

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

function matchingDelimiter(text: string, delimiter: string, start: number): number {
  for (let i = start; i < text.length - delimiter.length + 1; i += 1) {
    if (!text.startsWith(delimiter, i) || text[i - 1] === "\\") continue
    // A single `*`/`_` cannot close in the middle of a strong delimiter pair.
    if (delimiter.length === 1 && (text[i - 1] === delimiter || text[i + 1] === delimiter)) continue
    return i
  }
  return -1
}

/** Parse only the P1 inline language. Unsupported link syntax is opaque. */
function inlineFragments(
  text: string,
  sourceFrom: number,
  block: RichBlock,
  inherited: RichMark[] = [],
): Fragment[] {
  const out: Fragment[] = []
  let plainStart = 0
  const flushPlain = (to: number): void => {
    if (to > plainStart) push(out, text.slice(plainStart, to), sourceFrom + plainStart, sourceFrom + to, inherited, block)
  }
  let i = 0
  while (i < text.length) {
    const two = text.slice(i, i + 2)
    const isStrong = two === "**" || two === "__"
    const isCode = text[i] === "`"
    const isEm = !isStrong && (text[i] === "*" || text[i] === "_")
    const delimiter = isStrong ? two : isCode || isEm ? text[i] : ""
    if (!delimiter) {
      if ((text[i] === "[" && (MARKDOWN_LINK.test(text.slice(i)) || WIKILINK.test(text.slice(i)))) ||
          (text[i] === "^" && MARKER_LIKE.test(text.slice(i)))) {
        const end = text[i] === "^"
          ? i + (text.slice(i).match(MARKER_LIKE)?.[0].length ?? 1)
          : (() => {
              const markdown = text.slice(i).match(MARKDOWN_LINK)?.[0]
              const wiki = text.slice(i).match(WIKILINK)?.[0]
              return i + Math.min(...[markdown, wiki].filter((v): v is string => Boolean(v)).map((v) => v.length))
            })()
        flushPlain(i)
        push(out, text.slice(i, end), sourceFrom + i, sourceFrom + end, [], "opaque")
        i = end
        plainStart = i
        continue
      }
      i += 1
      continue
    }
    const end = matchingDelimiter(text, delimiter, i + delimiter.length)
    if (end <= i + delimiter.length || end < 0) {
      i += delimiter.length
      continue
    }
    // A single delimiter must not consume the first half of a strong pair.
    if (isEm && text.startsWith(delimiter + delimiter, i)) {
      i += 2
      continue
    }
    flushPlain(i)
    const innerStart = i + delimiter.length
    const inner = text.slice(innerStart, end)
    const mark: RichMark = isStrong ? "bold" : isCode ? "code" : "italic"
    if (isCode) {
      push(out, inner, sourceFrom + i, sourceFrom + end + delimiter.length, [...inherited, mark], block,
        sourceFrom + innerStart, sourceFrom + end)
    } else {
      const nested = inlineFragments(inner, sourceFrom + innerStart, block, [...inherited, mark])
      if (nested.length) out.push(...nested.map((fragment) => ({
        ...fragment,
        sourceFrom: sourceFrom + i,
        sourceTo: sourceFrom + end + delimiter.length,
      })))
      else push(out, inner, sourceFrom + i, sourceFrom + end + delimiter.length, [...inherited, mark], block,
        sourceFrom + innerStart, sourceFrom + end)
    }
    i = end + delimiter.length
    plainStart = i
  }
  flushPlain(text.length)
  return out
}

function lineBlock(line: string, offset: number): { body: string; bodyOffset: number; block: RichBlock } {
  const heading = HEADING.exec(line)
  if (heading) return { body: heading[3], bodyOffset: offset + heading[1].length + heading[2].length, block: "heading" }
  const quote = QUOTE.exec(line)
  if (quote) return { body: quote[2], bodyOffset: offset + 1 + quote[1].length, block: "quote" }
  const bullet = BULLET.exec(line)
  if (bullet) return { body: bullet[3], bodyOffset: offset + bullet[1].length + bullet[2].length, block: "unordered-list" }
  const ordered = ORDERED.exec(line)
  if (ordered) return { body: ordered[3], bodyOffset: offset + ordered[1].length + ordered[2].length, block: "ordered-list" }
  return { body: line, bodyOffset: offset, block: "paragraph" }
}

function opaqueLine(line: string): boolean {
  return Boolean(FENCE.test(line) || MARKDOWN_LINK.test(line) || WIKILINK.test(line) || MARKER_LIKE.test(line) || /^\s*\|/.test(line))
}

/** Import Markdown into a visible projection. All positions are JavaScript UTF-16 offsets. */
export function importMarkdown(source: string): RichDocument {
  const fragments: Fragment[] = []
  let visible = ""
  let offset = 0
  let inFence = false
  let fenceChar = ""
  let inFrontmatter = source.startsWith("---") && /^(?:---)(?:\r?\n|$)/.test(source)
  const lines = source.split(/(\r?\n)/)
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i] ?? ""
    const newline = lines[i + 1] ?? ""
    const lineStart = offset
    const fence = FENCE.exec(line)
    if (inFrontmatter) {
      push(fragments, line, lineStart, lineStart + line.length, [], "opaque")
      visible += line
      if (i > 0 && /^---\s*$/.test(line)) inFrontmatter = false
    } else if (fence || inFence) {
      if (fence) {
        if (!inFence) { inFence = true; fenceChar = fence[1][0] }
        else if (fence[1][0] === fenceChar) inFence = false
      }
      push(fragments, line, lineStart, lineStart + line.length, [], fence?.[2].trim() === "mermaid" ? "mermaid" : "fence")
    } else if (opaqueLine(line)) {
      push(fragments, line, lineStart, lineStart + line.length, [], "opaque")
    } else {
      const info = lineBlock(line, lineStart)
      const parts = inlineFragments(info.body, info.bodyOffset, info.block)
      if (parts.length) fragments.push(...parts)
      else push(fragments, line, lineStart, lineStart + line.length, [], info.block)
    }
    if (newline) {
      const block = fragments.at(-1)?.block ?? "paragraph"
      push(fragments, newline, lineStart + line.length, lineStart + line.length + newline.length, [], block)
      visible += newline
    }
    if (!fence && !inFrontmatter && !inFence && opaqueLine(line)) visible += line
    else if (fence || inFence || inFrontmatter) visible += line
    else if (!opaqueLine(line)) {
      const lineVisible = fragments.slice(-inlineFragments(lineBlock(line, lineStart).body, lineBlock(line, lineStart).bodyOffset, lineBlock(line, lineStart).block).length)
      // `visible` is assembled from fragments below; this branch is intentionally empty.
      void lineVisible
    }
    offset += line.length + newline.length
  }
  // Assemble from fragments so nested/opaque fragments cannot be counted twice.
  visible = fragments.map((fragment) => fragment.text).join("")
  const ranges: SourceMapRange[] = []
  let visibleOffset = 0
  for (const fragment of fragments) {
    const visibleTo = visibleOffset + fragment.text.length
    ranges.push({ sourceFrom: fragment.sourceFrom, sourceTo: fragment.sourceTo, contentFrom: fragment.contentFrom, contentTo: fragment.contentTo,
      visibleFrom: visibleOffset, visibleTo, marks: fragment.marks, block: fragment.block, visible: fragment.text.length > 0 })
    visibleOffset = visibleTo
  }
  return { source, visible, ranges, changed: new Map(), replacements: [] }
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

function rangeAtVisible(document: RichDocument, position: number): SourceMapRange | undefined {
  if (position === document.visible.length) return [...document.ranges].reverse().find((range) => range.visible)
  return document.ranges.find((range) => range.visible && position >= range.visibleFrom && position < range.visibleTo)
}

export function visibleToSource(document: RichDocument, position: number): number {
  if (!Number.isSafeInteger(position) || position < 0 || position > document.visible.length) throw new RangeError("Visible position out of bounds")
  const range = rangeAtVisible(document, position)
  if (!range) return document.source.length
  if (position === document.visible.length) return range.contentTo
  return range.contentFrom + Math.min(position - range.visibleFrom, range.contentTo - range.contentFrom)
}

export function sourceToVisible(document: RichDocument, position: number): number {
  if (!Number.isSafeInteger(position) || position < 0 || position > document.source.length) throw new RangeError("Source position out of bounds")
  if (!document.ranges.length) return 0
  if (position === document.source.length) return document.visible.length
  const range = document.ranges.find((candidate) => position >= candidate.sourceFrom && position < candidate.sourceTo)
  if (!range) {
    const next = document.ranges.find((candidate) => candidate.sourceFrom > position)
    return next?.visibleFrom ?? document.visible.length
  }
  if (!range.visible) return range.visibleFrom
  if (position <= range.contentFrom) return range.visibleFrom
  return range.visibleFrom + Math.min(position - range.contentFrom, range.contentTo - range.contentFrom)
}

/** Replace one visible mapped fragment. Explicit edits may use canonical Markdown
 * text; unrelated source, including opaque syntax, is never rewritten. */
export function replaceVisible(document: RichDocument, from: number, to: number, text: string): RichDocument {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > document.visible.length) {
    throw new RangeError("Visible range out of bounds")
  }
  const start = rangeAtVisible(document, from)
  const end = rangeAtVisible(document, Math.max(from, to - 1))
  if (!start || !end) return { ...document, visible: document.visible.slice(0, from) + text + document.visible.slice(to) }
  const sourcePrefix = document.source.slice(start.sourceFrom, start.contentFrom)
  const sourceSuffix = document.source.slice(end.contentTo, end.sourceTo)
  const replacement: SourceReplacement = {
    sourceFrom: start.sourceFrom,
    sourceTo: end.sourceTo,
    text: sourcePrefix + text + sourceSuffix,
  }
  const replacements = [...document.replacements.filter((item) => item.sourceTo <= replacement.sourceFrom || item.sourceFrom >= replacement.sourceTo), replacement]
  const changed = new Map(document.changed)
  changed.set(replacement.sourceFrom, text)
  return { ...document, visible: document.visible.slice(0, from) + text + document.visible.slice(to), changed, replacements }
}
