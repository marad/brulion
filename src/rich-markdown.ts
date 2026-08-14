/** Loss-aware Markdown projection for the primary CodeMirror editor (M47 P1).
 *
 * The source string remains authoritative. Import records every visible fragment
 * against its original UTF-16 source span and records prefixes/delimiters as
 * zero-width ranges. The latter are addressable for raw-source work, but never
 * become visible caret stops. Serialization returns the original source until
 * an explicit fragment edit is made.
 */

export type RichMark = "bold" | "italic" | "code" | "link" | "wikilink"
export type InlineMark = "bold" | "italic" | "code"
export type InlineBoundary = "space" | "enter" | "tab" | "eof" | "blur" | "save"

export interface InlineBoundaryMatch {
  kind: InlineMark
  delimiter: string
  sourceFrom: number
  sourceTo: number
  contentFrom: number
  contentTo: number
}

export interface InlineInputResult {
  document: RichDocument
  converted: boolean
  caret: number
}
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
  /** Source line starts kept raw while a user is still typing an inline marker. */
  readonly pendingLineStarts: readonly number[]
  /** Exact delimiter starts whose explicit selection formatting permits word adjacency. */
  readonly explicitAdjacentMarkerStarts?: readonly number[]
  /** Lines whose punctuation-only formatting was explicitly requested. */
  readonly explicitPunctuationLineStarts?: readonly number[]
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

function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[\p{L}\p{N}]/u.test(value))
}

function matchingDelimiter(text: string, delimiter: string, start: number): number {
  for (let i = start; i <= text.length - delimiter.length; i += 1) {
    if (escapedAt(text, i) || !text.startsWith(delimiter, i)) continue
    // A single `*`/`_` cannot close on the first stars of a strong pair;
    // in a closing run such as `***`, the final star belongs to the outer
    // single-delimiter span.
    if (delimiter.length === 1) {
      let runStart = i
      let runEnd = i
      while (runStart > start && text[runStart - 1] === delimiter) runStart -= 1
      while (runEnd + 1 < text.length && text[runEnd + 1] === delimiter) runEnd += 1
      const runLength = runEnd - runStart + 1
      if (runLength > 1 && (runLength < 3 || i !== runEnd)) continue
    }
    // In a closing run such as the final `***` in `**bold *italic***`, the
    // first two stars close the nested italic span. Let the outer strong span
    // take the final pair instead of stopping at an overlapping pair.
    if (delimiter.length === 2 && text[i + 2] === delimiter[0]) continue
    return i
  }
  return -1
}

function hasValidTripleUnderscoreOpen(text: string, position: number): boolean {
  for (let candidate = position - 3; candidate >= 0; candidate -= 1) {
    if (!text.startsWith("___", candidate) || escapedAt(text, candidate)) continue
    if (isWordCharacter(text[candidate - 1]) && isWordCharacter(text[candidate + 3])) return false
    return true
  }
  return false
}

function invalidTripleUnderscoreAt(text: string, position: number): boolean {
  for (let start = position - 2; start <= position; start += 1) {
    if (start < 0 || text.slice(start, start + 3) !== "___") continue
    if (isWordCharacter(text[start - 1]) && isWordCharacter(text[start + 3])) return true
    if (isWordCharacter(text[start - 1]) && !hasValidTripleUnderscoreOpen(text, start)) return true
  }
  return false
}

function delimiterAt(text: string, position: number, allowAdjacent = false): string {
  if (escapedAt(text, position) || (!allowAdjacent && invalidTripleUnderscoreAt(text, position))) return ""
  const triple = text.slice(position, position + 3)
  if (triple === "***") return triple
  if (triple === "___") {
    if (!allowAdjacent && isWordCharacter(text[position - 1]) && isWordCharacter(text[position + 3])) return ""
    if (!allowAdjacent && isWordCharacter(text[position - 1]) && !hasValidTripleUnderscoreOpen(text, position)) return ""
    return triple
  }
  const pair = text.slice(position, position + 2)
  const previous = text[position - 1]
  const afterPair = text[position + 2]
  if (!allowAdjacent && pair === "__" && isWordCharacter(previous) && isWordCharacter(afterPair)) return ""
  if (pair === "**" || pair === "__") return pair
  if (text[position] === "_") {
    const previous = text[position - 1]
    const next = text[position + 1]
    // CommonMark-style intraword underscores are literal text. Use Unicode
    // letters/numbers so names such as `café_bar` are not split either.
    const word = /[\p{L}\p{N}_]/u
    if (!allowAdjacent && previous && next && word.test(previous) && word.test(next)) return ""
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

function markForDelimiter(delimiter: string): InlineMark {
  return delimiter === "`" ? "code" : delimiter.length === 2 ? "bold" : "italic"
}

function delimiterForMark(mark: InlineMark): string {
  return mark === "bold" ? "**" : mark === "italic" ? "*" : "`"
}

function lineStartAt(source: string, position: number): number {
  return source.lastIndexOf("\n", Math.max(0, position - 1)) + 1
}

function hasBlockPrefixBefore(source: string, position: number): boolean {
  const lineStart = lineStartAt(source, position)
  const before = source.slice(lineStart, position)
  return /^(?:#{1,6}[ \t]+|>[ \t]?|[*-][ \t]+|\d+\.[ \t]+)$/.test(before)
}

function hasInlineBoundaryContext(text: string, start: number, end: number, delimiter: string, allowAdjacent = false, allowPunctuation = false): boolean {
  const previous = text[start - 1]
  const next = text[end + delimiter.length]
  const prefix = text.slice(0, start)
  const content = text.slice(start + delimiter.length, end)
  const punctuationOnly = Boolean(content) && /^[^\p{L}\p{N}\s]+$/u.test(content)
  const openingBoundary = (allowAdjacent && !punctuationOnly && (!previous || isWordCharacter(previous))) || (allowPunctuation && punctuationOnly) || !previous || /\s/.test(previous) || (isWordCharacter(previous) && prefix.includes(delimiter))
  const closingBoundary = (allowAdjacent && !punctuationOnly && (!next || isWordCharacter(next))) || (allowPunctuation && punctuationOnly) || !next || /\s/.test(next) || isWordCharacter(next)
  const urlBefore = /(?:https?:\/\/|www\.)[^\s]*$/i.test(prefix)
  const urlFollows = /^(?:https?:\/\/|www\.)/i.test(text.slice(end + delimiter.length))
  return openingBoundary && closingBoundary && !urlBefore && !urlFollows
}

function visibleCaretForSource(document: RichDocument, cursor: number): number {
  const safe = Math.max(0, Math.min(cursor, document.source.length))
  return sourceToVisible(document, safe)
}

/** Classify a complete inline span immediately before an explicit boundary. */
export function classifyInlineBoundary(
  source: string,
  cursor: number,
  boundary: InlineBoundary,
): InlineBoundaryMatch | null {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > source.length) return null
  if (boundary === "eof" && cursor !== source.length) return null
  const boundaryCursor = boundary === "space" ? cursor - 1 : cursor
  if (boundaryCursor < 0) return null
  if (boundary === "space" && source[cursor - 1] !== " ") return null
  let spanEnd = boundaryCursor
  while (spanEnd > 0 && /[ \t]/.test(source[spanEnd - 1])) spanEnd -= 1
  const lineStart = lineStartAt(source, spanEnd)
  const projection = importMarkdown(source)
  const delimiters = ["**", "__", "*", "_", "`"]
  for (let sourceFrom = spanEnd - 1; sourceFrom >= lineStart; sourceFrom -= 1) {
    for (const delimiter of delimiters) {
      if (source.slice(sourceFrom, sourceFrom + delimiter.length) !== delimiter) continue
      if (delimiterAt(source, sourceFrom) !== delimiter) continue
      const closeFrom = spanEnd - delimiter.length
      if (closeFrom <= sourceFrom + delimiter.length || source.slice(closeFrom, spanEnd) !== delimiter) continue
      const contentFrom = sourceFrom + delimiter.length
      const content = source.slice(contentFrom, closeFrom)
      if (!content || /^\s*$/.test(content) || escapedAt(source, sourceFrom) || escapedAt(source, closeFrom)) continue
      if (delimiter !== "`" && /https?:\/\//i.test(content)) continue
      if (hasBlockPrefixBefore(source, sourceFrom)) continue
      const line = source.slice(lineStart, spanEnd)
      const inOpaqueSource = projection.ranges.some((range) => range.block === "opaque" && sourceFrom < range.sourceTo && spanEnd > range.sourceFrom)
      if (inOpaqueSource || opaqueLine(line) || !hasInlineBoundaryContext(source, sourceFrom, closeFrom, delimiter)) continue
      return {
        kind: markForDelimiter(delimiter),
        delimiter,
        sourceFrom,
        sourceTo: spanEnd,
        contentFrom,
        contentTo: closeFrom,
      }
    }
  }
  return null
}

function lineContentEnd(source: string, lineStart: number): number {
  const newline = source.indexOf("\n", lineStart)
  const end = newline < 0 ? source.length : newline
  return end > lineStart && source[end - 1] === "\r" ? end - 1 : end
}

function pendingBoundaryMatches(document: RichDocument, cursor: number): InlineBoundaryMatch[] {
  const matches: InlineBoundaryMatch[] = []
  for (const lineStart of [...document.pendingLineStarts].sort((a, b) => b - a)) {
    const end = lineContentEnd(document.source, lineStart)
    if (end > cursor) continue
    const match = classifyInlineBoundary(document.source, end, "blur")
    if (match && lineStartAt(document.source, match.sourceFrom) === lineStart) matches.push(match)
  }
  return matches
}

/** Apply a completed marker boundary while retaining Markdown as source. */
export function applyInlineInputRule(
  document: RichDocument,
  cursor: number,
  boundary: InlineBoundary,
): InlineInputResult {
  const directMatch = classifyInlineBoundary(document.source, cursor, boundary)
  const fallbackMatches = directMatch ? [] : pendingBoundaryMatches(document, cursor)
  if (!directMatch && !fallbackMatches.length) return { document, converted: false, caret: visibleCaretForSource(document, cursor) }
  const matches = directMatch ? [directMatch] : fallbackMatches
  const flushedLines = new Set(matches.map((match) => lineStartAt(document.source, match.sourceFrom)))
  const remainingPending = new Set(document.pendingLineStarts.filter((lineStart) => !flushedLines.has(lineStart)))
  const punctuationLines = new Set(document.explicitPunctuationLineStarts ?? [])
  const adjacentMarkers = new Set(document.explicitAdjacentMarkerStarts ?? [])
  const projected = importMarkdownInternal(document.source, adjacentMarkers, remainingPending, punctuationLines)
  return { document: projected, converted: true, caret: sourceToVisible(projected, cursor) }
}

function tripleWrapper(document: RichDocument, range: Pick<SourceMapRange, "contentFrom" | "contentTo">, mark: InlineMark): { from: number; to: number; open: string; close: string } | null {
  if (mark === "code") return null
  const rawOpen = document.source.slice(range.contentFrom - 3, range.contentFrom)
  const rawClose = document.source.slice(range.contentTo, range.contentTo + 3)
  if ((rawOpen !== "***" && rawOpen !== "___") || rawClose !== rawOpen) return null
  const replacement = mark === "bold" ? rawOpen[0] : rawOpen.slice(0, 2)
  return { from: range.contentFrom - 3, to: range.contentTo + 3, open: replacement, close: replacement }
}

function directWrapper(document: RichDocument, range: SourceMapRange, mark: InlineMark): { from: number; to: number; open: string; close: string } | null {
  const delimiters = mark === "bold" ? ["**", "__"] : mark === "italic" ? ["*", "_"] : ["`"]
  for (const delimiter of delimiters) {
    const from = range.contentFrom - delimiter.length
    const to = range.contentTo + delimiter.length
    const openIsPartOfLongerSingleRun = delimiter.length === 1 && document.source[range.contentFrom - delimiter.length - 1] === delimiter
    const closeIsPartOfLongerSingleRun = delimiter.length === 1 && document.source[range.contentTo + 1] === delimiter
    if (!openIsPartOfLongerSingleRun && !closeIsPartOfLongerSingleRun && from >= 0 && document.source.slice(from, range.contentFrom) === delimiter && document.source.slice(range.contentTo, to) === delimiter) {
      return { from, to, open: delimiter, close: delimiter }
    }
  }
  return tripleWrapper(document, range, mark)
}

function unwrapWrapperSource(document: RichDocument, wrapper: { from: number; to: number; open: string; close: string }): string {
  const rawOpen = document.source.slice(wrapper.from, wrapper.from + 3)
  const rawClose = document.source.slice(wrapper.to - 3, wrapper.to)
  const triple = (rawOpen === "***" || rawOpen === "___") && rawClose === rawOpen
  if (triple) {
    return document.source.slice(0, wrapper.from) + wrapper.open + document.source.slice(wrapper.from + 3, wrapper.to - 3) + wrapper.close + document.source.slice(wrapper.to)
  }
  return document.source.slice(0, wrapper.from) + document.source.slice(wrapper.from + wrapper.open.length, wrapper.to - wrapper.close.length) + document.source.slice(wrapper.to)
}

function visibleSourceEnd(document: RichDocument, position: number): number {
  const range = visibleRangeAt(document, position, "end")
  if (!range) return document.source.length
  if (position >= range.visibleTo) return range.contentTo
  return range.contentFrom + (position - range.visibleFrom)
}

function selectedVisibleRanges(document: RichDocument, from: number, to: number): SourceMapRange[] {
  return document.ranges.filter((range) => range.visible && range.visibleFrom < to && range.visibleTo > from)
}

function isUrlSelection(document: RichDocument, sourceFrom: number, sourceTo: number): boolean {
  const lineStart = lineStartAt(document.source, sourceFrom)
  const lineEnd = document.source.indexOf("\n", sourceFrom)
  const line = document.source.slice(lineStart, lineEnd < 0 ? document.source.length : lineEnd)
  const urlPattern = /(?:https?:\/\/|www\.)\S*/gi
  for (const match of line.matchAll(urlPattern)) {
    const start = lineStart + (match.index ?? 0)
    const end = start + match[0].length
    if (sourceFrom < end && sourceTo > start) return true
  }
  return false
}

function enclosingWrapper(document: RichDocument, from: number, to: number, mark: InlineMark): { from: number; to: number; open: string; close: string } | null {
  const sourceFrom = visibleToSource(document, from)
  const sourceTo = visibleSourceEnd(document, to)
  const triple = tripleWrapper(document, { contentFrom: sourceFrom, contentTo: sourceTo }, mark)
  if (triple && sourceToVisible(document, sourceFrom) === from && sourceToVisible(document, sourceTo) === to) return triple
  const delimiters = mark === "bold" ? ["**", "__"] : mark === "italic" ? ["*", "_"] : ["`"]
  for (const delimiter of delimiters) {
    const wrapperFrom = sourceFrom - delimiter.length
    const wrapperTo = sourceTo + delimiter.length
    const closeIsPartOfLongerSingleRun = delimiter.length === 1 && document.source[sourceTo + 1] === delimiter
    if (!closeIsPartOfLongerSingleRun && wrapperFrom >= 0 && document.source.slice(wrapperFrom, sourceFrom) === delimiter && document.source.slice(sourceTo, wrapperTo) === delimiter) {
      const visibleFrom = sourceToVisible(document, sourceFrom)
      const visibleTo = sourceToVisible(document, sourceTo)
      if (visibleFrom === from && visibleTo === to) return { from: wrapperFrom, to: wrapperTo, open: delimiter, close: delimiter }
    }
  }
  return null
}

/** Toggle a visible selection using canonical markers or unwrap its direct
 * imported wrapper. Unsafe cross-fragment/opaque edits are rejected rather than
 * rewriting source the model cannot map losslessly. */
export function toggleInlineMark(
  document: RichDocument,
  from: number,
  to: number,
  mark: InlineMark,
): { document: RichDocument; anchor: number; head: number } | null {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < 0 || from > document.visible.length || to > document.visible.length) return null
  const reversed = from > to
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  if (start !== end && /^\s*$/.test(document.visible.slice(start, end))) return null
  const ranges = selectedVisibleRanges(document, start, end)
  const caretRange = start === end ? visibleRangeAt(document, start, "start") : null
  if (start === end) {
    if (caretRange?.block === "opaque") return null
    if (caretRange?.marks.includes(mark)) {
      const wrapper = caretRange && directWrapper(document, caretRange, mark)
      if (!wrapper) return null
      const next = importMarkdown(unwrapWrapperSource(document, wrapper))
      return { document: next, anchor: start, head: start }
    }
    // A standalone caret has no representable visible content yet. Keep it a
    // no-op; P3/input-state handling can introduce pending empty spans without
    // manufacturing an opaque source island here.
    return null
  }
  const selectionSourceFrom = visibleToSource(document, start)
  const selectionSourceTo = visibleSourceEnd(document, end)
  if (isUrlSelection(document, selectionSourceFrom, selectionSourceTo)) return null
  const enclosing = enclosingWrapper(document, start, end, mark)
  if (enclosing) {
    const next = importMarkdown(unwrapWrapperSource(document, enclosing))
    return { document: next, anchor: reversed ? end : start, head: reversed ? start : end }
  }
  if (!ranges.length || ranges.some((range) => range.block === "opaque")) return null
  if (mark !== "code" && ranges.some((range) => range.marks.includes("code"))) return null
  const target = ranges.length === 1 ? ranges[0] : null
  if (target?.marks.includes(mark)) {
    if (target.marks.length > 1 && (start !== target.visibleFrom || end !== target.visibleTo)) return null
    const wrapper = directWrapper(document, target, mark)
    if (!wrapper) return null
    const rawOpen = document.source.slice(wrapper.from, wrapper.from + 3)
    const rawClose = document.source.slice(wrapper.to - 3, wrapper.to)
    const triple = (rawOpen === "***" || rawOpen === "___") && rawClose === rawOpen
    const openLength = triple ? 3 : wrapper.open.length
    const closeLength = triple ? 3 : wrapper.close.length
    const inner = document.source.slice(wrapper.from + openLength, wrapper.to - closeLength)
    const localFrom = start - target.visibleFrom
    const localTo = end - target.visibleFrom
    const before = inner.slice(0, localFrom)
    const selected = inner.slice(localFrom, localTo)
    const after = inner.slice(localTo)
    const preservedBefore = before ? wrapper.open + before + wrapper.close : ""
    const preservedAfter = after ? wrapper.open + after + wrapper.close : ""
    const replacement = preservedBefore + selected + preservedAfter
    const nextSource = document.source.slice(0, wrapper.from) + replacement + document.source.slice(wrapper.to)
    const adjacentMarkers = new Set<number>()
    if (before) {
      adjacentMarkers.add(wrapper.from)
      adjacentMarkers.add(wrapper.from + wrapper.open.length + before.length)
    }
    if (after) {
      const afterFrom = wrapper.from + preservedBefore.length + selected.length
      adjacentMarkers.add(afterFrom)
      adjacentMarkers.add(afterFrom + wrapper.open.length + after.length)
    }
    const punctuationLines = /^[^\p{L}\p{N}\s]+$/u.test(selected) ? new Set([lineStartAt(nextSource, wrapper.from)]) : new Set<number>()
    const next = importMarkdownInternal(nextSource, adjacentMarkers, new Set(), punctuationLines)
    return { document: next, anchor: reversed ? end : start, head: reversed ? start : end }
  }
  const sourceFrom = selectionSourceFrom
  const sourceTo = selectionSourceTo
  const hasHiddenInterior = document.ranges.some((range) => !range.visible && range.sourceFrom >= sourceFrom && range.sourceTo <= sourceTo)
  if (hasHiddenInterior || document.source.slice(sourceFrom, sourceTo).includes("\n")) return null
  const marker = delimiterForMark(mark)
  const nextSource = document.source.slice(0, sourceFrom) + marker + document.source.slice(sourceFrom, sourceTo) + marker + document.source.slice(sourceTo)
  const adjacentMarkers = new Set([sourceFrom, sourceFrom + marker.length + (sourceTo - sourceFrom)])
  const punctuationLines = /^[^\p{L}\p{N}\s]+$/u.test(document.visible.slice(start, end)) ? new Set([lineStartAt(nextSource, sourceFrom)]) : new Set<number>()
  const next = importMarkdownInternal(nextSource, adjacentMarkers, new Set(), punctuationLines)
  const nextStart = start
  const nextEnd = end
  return reversed ? { document: next, anchor: nextEnd, head: nextStart } : { document: next, anchor: nextStart, head: nextEnd }
}

/** Parse emphasis/code only. Unsupported constructs are handled by opaqueLine. */
function adjacentAllowedAt(allowAdjacent: boolean | ReadonlySet<number>, sourcePosition: number): boolean {
  return allowAdjacent === true || (allowAdjacent !== false && allowAdjacent.has(sourcePosition))
}

function inlineFragments(
  text: string,
  sourceFrom: number,
  block: RichBlock,
  inherited: RichMark[] = [],
  allowAdjacent: boolean | ReadonlySet<number> = false,
  allowPunctuation = false,
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
    const delimiterAllowsAdjacent = adjacentAllowedAt(allowAdjacent, sourceFrom + i)
    const delimiter = delimiterAt(text, i, delimiterAllowsAdjacent)
    if (!delimiter) {
      i += 1
      continue
    }
    const end = matchingDelimiter(text, delimiter, i + delimiter.length)
    const closeAllowsAdjacent = end >= 0 && adjacentAllowedAt(allowAdjacent, sourceFrom + end)
    if (end < 0 || end <= i + delimiter.length || /^\s*$/.test(text.slice(i + delimiter.length, end)) || !hasInlineBoundaryContext(text, i, end, delimiter, delimiterAllowsAdjacent || closeAllowsAdjacent, allowPunctuation)) {
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
      : inlineFragments(text.slice(innerStart, innerEnd), sourceFrom + innerStart, block, inheritedMarks, allowAdjacent, allowPunctuation)

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

function opaqueLine(line: string, sourceFrom = 0, allowAdjacent: boolean | ReadonlySet<number> = false, allowPunctuation = false): boolean {
  // P1 deliberately does not interpret links, tables, fences, HTML, frontmatter,
  // or application-specific marker syntax. Keep the complete line visible.
  if (MARKDOWN_LINK.test(line) || LINK_LIKE.test(line) || WIKILINK.test(line) || MARKER_LIKE.test(line) || STRIKETHROUGH_LIKE.test(line) || HTML_LIKE.test(line)) return true
  if (/^\s*\|/.test(line)) return true
  return inlineFragments(line, sourceFrom, "paragraph", [], allowAdjacent, allowPunctuation).unmatched
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
function importMarkdownInternal(
  source: string,
  allowAdjacent: boolean | ReadonlySet<number>,
  rawLineStarts: ReadonlySet<number> = new Set(),
  allowPunctuation: boolean | ReadonlySet<number> = false,
): RichDocument {
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
    const lineIsPending = rawLineStarts.has(lineStart)
    const lineAllowsPunctuation = allowPunctuation === true || (allowPunctuation !== false && allowPunctuation.has(lineStart))

    if (lineIsPending || lineIsFrontmatter || lineIsFence || lineIsHtmlComment || opaqueLine(line, lineStart, allowAdjacent, lineAllowsPunctuation)) {
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
      const parsed = inlineFragments(info.body, info.bodyOffset, info.block, [], allowAdjacent, lineAllowsPunctuation)
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
  const punctuationLineStarts = new Set<number>()
  for (let i = 0, offset = 0; i < lines.length; i += 2) {
    if (allowPunctuation === true || (allowPunctuation !== false && allowPunctuation.has(offset))) punctuationLineStarts.add(offset)
    offset += (lines[i] ?? "").length + (lines[i + 1] ?? "").length
  }
  return {
    source,
    visible: projection.visible,
    ranges: projection.ranges,
    changed: new Map(),
    replacements: [],
    pendingLineStarts: [...rawLineStarts].sort((a, b) => a - b),
    explicitAdjacentMarkerStarts: typeof allowAdjacent === "boolean" ? [] : [...allowAdjacent].sort((a, b) => a - b),
    explicitPunctuationLineStarts: [...punctuationLineStarts].sort((a, b) => a - b),
  }
}

export function importMarkdown(source: string): RichDocument {
  return importMarkdownInternal(source, false)
}

function projectVisibleEdit(document: RichDocument, nextSource: string, sourceFrom: number, sourceTo: number, text: string): RichDocument {
  const delta = text.length - (sourceTo - sourceFrom)
  const pending = new Set<number>()
  for (const lineStart of document.pendingLineStarts) pending.add(lineStart > sourceTo ? lineStart + delta : lineStart)
  const changedLineStart = lineStartAt(nextSource, Math.min(sourceFrom + text.length, nextSource.length))
  const nextLineEnd = nextSource.indexOf("\n", changedLineStart)
  const changedLine = nextSource.slice(changedLineStart, nextLineEnd < 0 ? nextSource.length : nextLineEnd)
  const oldLineStart = lineStartAt(document.source, sourceFrom)
  const wasPending = document.pendingLineStarts.includes(oldLineStart)
  const adjacent = new Set<number>()
  for (const markerStart of document.explicitAdjacentMarkerStarts ?? []) {
    if (markerStart < sourceFrom) adjacent.add(markerStart)
    else if (markerStart >= sourceTo) adjacent.add(markerStart + delta)
  }
  const punctuation = new Set<number>()
  for (const lineStart of document.explicitPunctuationLineStarts ?? []) punctuation.add(lineStart > sourceTo ? lineStart + delta : lineStart)
  const wasExplicitPunctuation = (document.explicitPunctuationLineStarts ?? []).includes(oldLineStart)
  const markerInput = /[*_`]/.test(text) || (wasPending && /[*_`]/.test(changedLine))
  const boundaryCursor = sourceFrom + text.length
  const committedSpace = text.endsWith(" ") && classifyInlineBoundary(nextSource, boundaryCursor, "space") !== null
  if (markerInput && !committedSpace) pending.add(changedLineStart)
  else pending.delete(changedLineStart)
  if (wasExplicitPunctuation && /[*_`]/.test(changedLine)) punctuation.add(changedLineStart)
  else punctuation.delete(changedLineStart)
  return importMarkdownInternal(nextSource, adjacent, pending, punctuation)
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
 * The replacement text is Markdown source for that fragment. A user edit that
 * contains an inline marker keeps its changed line raw until an explicit
 * boundary flushes it; this is what lets `**hello**` remain editable before the
 * terminating space/Enter/EOF/blur/save. Unchanged lines keep their rich
 * projection and all source bytes remain authoritative.
 */
export function replaceVisible(document: RichDocument, from: number, to: number, text: string): RichDocument {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > document.visible.length) {
    throw new RangeError("Visible range out of bounds")
  }
  if (from === to && from === document.visible.length) {
    return projectVisibleEdit(document, document.source + text, document.source.length, document.source.length, text)
  }

  const start = visibleRangeAt(document, from, "start")
  const end = from === to ? start : visibleRangeAt(document, to, "end")
  if (!start || !end) {
    if (from !== 0 || to !== 0 || document.visible.length !== 0) throw new RangeError("Visible range is not mapped")
    return projectVisibleEdit(document, document.source + text, document.source.length, document.source.length, text)
  }
  if (start.sourceFrom !== end.sourceFrom || start.sourceTo !== end.sourceTo) {
    throw new RangeError("Replacement must stay within one mapped fragment")
  }
  const sourceFrom = start.contentFrom + (from - start.visibleFrom)
  const sourceTo = end.contentFrom + (to - end.visibleFrom)
  const nextSource = document.source.slice(0, sourceFrom) + text + document.source.slice(sourceTo)
  return projectVisibleEdit(document, nextSource, sourceFrom, sourceTo, text)
}
