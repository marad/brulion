import type { EditorView } from "@codemirror/view"
import {
  applyInlineInputRule,
  clearRichFormatting,
  replaceVisibleForEditor,
  setHeadingLevel,
  sourceToVisible,
  toggleInlineMark,
  visibleToSource,
  type InlineMark,
  type RichDocument,
} from "./rich-markdown"
import {
  dispatchRichDocumentChange,
  richDocumentFromState,
  richEditorRangeToModel,
  type RichVisibleSelection,
} from "./rich-editor"

export type RichFormatAction =
  | "Bold"
  | "Italic"
  | "Code"
  | "Heading 1"
  | "Heading 2"
  | "Heading 3"
  | "Clear formatting"

export interface RichEditorSelectionRange {
  /** UTF-16 offset in CodeMirror's LF-normalized visible document. */
  from: number
  to: number
}

export interface RichModelSelectionRange {
  /** UTF-16 offset in `RichDocument.visible`, which may retain CRLF. */
  from: number
  to: number
}

export type RichHeadingDirection = "promote" | "demote"

function modelFor(view: EditorView): RichDocument | null {
  return richDocumentFromState(view.state)
}

function inlineAction(action: RichFormatAction): InlineMark | null {
  if (action === "Bold") return "bold"
  if (action === "Italic") return "italic"
  if (action === "Code") return "code"
  return null
}

function modelSelection(view: EditorView, document: RichDocument): RichVisibleSelection {
  const selection = view.state.selection.main
  return {
    anchor: richEditorRangeToModel(document, { from: selection.anchor, to: selection.anchor }).from,
    head: richEditorRangeToModel(document, { from: selection.head, to: selection.head }).from,
  }
}

/** Apply one visible rich formatting action, or return false without dispatch. */
export function applyRichFormat(view: EditorView, action: RichFormatAction): boolean {
  const document = modelFor(view)
  if (!document || !["Bold", "Italic", "Code", "Heading 1", "Heading 2", "Heading 3", "Clear formatting"].includes(action)) return false
  try {
    let result: { document: RichDocument; anchor: number; head: number } | null = null
    const selection = modelSelection(view, document)
    const mark = inlineAction(action)
    if (mark) {
      result = toggleInlineMark(document, selection.anchor, selection.head, mark)
    } else {
      const level = action === "Heading 1" ? 1 : action === "Heading 2" ? 2 : action === "Heading 3" ? 3 : null
      const block = level === null
        ? clearRichFormatting(document, selection.anchor, selection.head)
        : setHeadingLevel(document, selection.anchor, selection.head, level)
      if (!block || !block.changed) return false
      result = block
    }
    if (!result) return false
    dispatchRichDocumentChange(view, result.document, { anchor: result.anchor, head: result.head }, "input.format")
    return true
  } catch {
    return false
  }
}

/** Move the current visible line through the agreed heading cycle. */
export function applyRichHeadingStep(view: EditorView, direction: RichHeadingDirection): boolean {
  const document = modelFor(view)
  if (!document) return false
  try {
    const current = modelSelection(view, document)
    const sourcePosition = visibleToSource(document, current.head)
    const lineStart = lineStartAt(document.source, sourcePosition)
    const newline = document.source.indexOf("\n", lineStart)
    const line = document.source.slice(lineStart, newline < 0 ? document.source.length : newline)
    const level = /^(?:[ \t]*)(#{1,6})[ \t]+/.exec(line)?.[1].length ?? 0
    const next = direction === "promote" ? (level === 0 ? 3 : Math.max(1, level - 1)) : (level === 0 ? 0 : level >= 3 ? 0 : level + 1)
    if (next === level) return false
    const operation = setHeadingLevel(document, current.head, current.head, next)
    if (!operation || !operation.changed) return false
    dispatchRichDocumentChange(view, operation.document, { anchor: operation.anchor, head: operation.head }, "input.format")
    return true
  } catch {
    return false
  }
}

function lineRange(document: RichDocument, lineNumber: number): { from: number; to: number } | null {
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) return null
  let line = 1
  let from = 0
  while (line < lineNumber) {
    const newline = document.visible.indexOf("\n", from)
    if (newline < 0) return null
    from = newline + 1
    line += 1
  }
  const newline = document.visible.indexOf("\n", from)
  const rawTo = newline < 0 ? document.visible.length : newline
  const to = rawTo > from && document.visible[rawTo - 1] === "\r" ? rawTo - 1 : rawTo
  return { from, to }
}

/** Remove one exact visible slash token and apply its rich command atomically. */
export function applyRichSlash(
  view: EditorView,
  tokenFrom: number,
  tokenTo: number,
  command: "/h1" | "/h2" | "/h3" | "/clear",
): boolean {
  const document = modelFor(view)
  if (!document || !Number.isSafeInteger(tokenFrom) || !Number.isSafeInteger(tokenTo) || tokenFrom < 0 || tokenTo < tokenFrom || tokenTo > view.state.doc.length) return false
  if (view.state.sliceDoc(tokenFrom, tokenTo) !== command) return false
  const deleteTo = tokenTo < view.state.doc.length && view.state.sliceDoc(tokenTo, tokenTo + 1) === " "
    ? tokenTo + 1
    : tokenTo
  let candidate: RichDocument
  try {
    const modelToken = richEditorRangeToModel(document, { from: tokenFrom, to: deleteTo })
    candidate = replaceVisibleForEditor(document, modelToken.from, modelToken.to, "")
  } catch {
    return false
  }
  const line = lineRange(candidate, view.state.doc.lineAt(tokenFrom).number)
  if (!line) return false
  let final = candidate
  const operation = command === "/clear"
    ? clearRichFormatting(candidate, line.from, line.to)
    : setHeadingLevel(candidate, line.from, line.to, Number(command.slice(2)))
  if (!operation) return false
  if (operation.changed) final = operation.document
  const finalLine = lineRange(final, view.state.doc.lineAt(tokenFrom).number)
  const caret = finalLine?.to ?? final.visible.length
  dispatchRichDocumentChange(view, final, { anchor: caret, head: caret }, "input.slash")
  return true
}

/** Paste plain text into the current CodeMirror-visible selection. */
export function applyRichPaste(view: EditorView, text: string): boolean {
  const document = modelFor(view)
  if (!document || text.length === 0) return false
  const selection = view.state.selection.main
  let modelRange: RichModelSelectionRange
  try {
    modelRange = richEditorRangeToModel(document, { from: selection.from, to: selection.to })
  } catch {
    return false
  }
  let candidate: RichDocument
  try {
    candidate = replaceVisibleForEditor(document, modelRange.from, modelRange.to, text)
  } catch {
    return false
  }
  const modelCaret = modelRange.from + text.length
  const flushed = applyInlineInputRule(candidate, modelCaret, "blur")
  const final = flushed.converted ? flushed.document : candidate
  const caret = flushed.converted ? flushed.caret : sourceToVisible(final, modelCaret)
  dispatchRichDocumentChange(view, final, { anchor: caret, head: caret }, "input.paste")
  return true
}

const INLINE_MARKS = ["bold", "italic", "code"] as const
const canonicalDelimiter: Record<InlineMark, string> = { bold: "**", italic: "*", code: "`" }

type RichRange = RichDocument["ranges"][number]

type CopyEntry = {
  range: RichRange
  from: number
  to: number
  sourceFrom: number
  sourceTo: number
}

function lineStartAt(source: string, position: number): number {
  return source.lastIndexOf("\n", Math.max(0, position - 1)) + 1
}

function copyEntries(document: RichDocument, from: number, to: number): CopyEntry[] {
  return document.ranges
    .filter((range) => range.visible && range.visibleFrom < to && range.visibleTo > from)
    .map((range) => {
      const entryFrom = Math.max(from, range.visibleFrom)
      const entryTo = Math.min(to, range.visibleTo)
      return {
        range,
        from: entryFrom,
        to: entryTo,
        sourceFrom: range.contentFrom + entryFrom - range.visibleFrom,
        sourceTo: range.contentFrom + entryTo - range.visibleFrom,
      }
    })
    .filter((entry) => entry.to > entry.from)
}

function sameLink(left: NonNullable<RichRange["link"]>, right: NonNullable<RichRange["link"]>): boolean {
  return left.kind === right.kind && left.sourceFrom === right.sourceFrom && left.sourceTo === right.sourceTo && left.raw === right.raw
}

function delimiterFor(document: RichDocument, mark: InlineMark, sourceFrom: number, sourceTo: number, marks: readonly InlineMark[]): string {
  if (marks.includes("bold") && marks.includes("italic")) {
    for (const delimiter of ["***", "___"]) {
      if (document.source.slice(sourceFrom - delimiter.length, sourceFrom) === delimiter && document.source.slice(sourceTo, sourceTo + delimiter.length) === delimiter) return delimiter
    }
  }
  const candidates = mark === "bold" ? ["**", "__"] : mark === "italic" ? ["*", "_"] : ["`"]
  for (const delimiter of candidates) {
    if (document.source.slice(sourceFrom - delimiter.length, sourceFrom) === delimiter && document.source.slice(sourceTo, sourceTo + delimiter.length) === delimiter) return delimiter
  }
  return canonicalDelimiter[mark]
}

function wrapInline(document: RichDocument, raw: string, sourceFrom: number, sourceTo: number, marks: readonly InlineMark[]): string {
  if (!marks.length) return raw
  const combined = marks.includes("bold") && marks.includes("italic") &&
    (document.source.slice(sourceFrom - 3, sourceFrom) === "***" || document.source.slice(sourceFrom - 3, sourceFrom) === "___") &&
    document.source.slice(sourceTo, sourceTo + 3) === document.source.slice(sourceFrom - 3, sourceFrom)
  if (combined) {
    const delimiter = document.source.slice(sourceFrom - 3, sourceFrom)
    return `${delimiter}${raw}${delimiter}`
  }
  let result = raw
  for (const mark of [...marks].filter((value): value is InlineMark => INLINE_MARKS.includes(value)).reverse()) {
    const delimiter = delimiterFor(document, mark, sourceFrom, sourceTo, marks)
    result = `${delimiter}${result}${delimiter}`
  }
  return result
}

function blockPrefix(document: RichDocument, visibleFrom: number): string {
  const sourcePosition = visibleToSource(document, visibleFrom)
  const lineStart = lineStartAt(document.source, sourcePosition)
  const prefix = document.ranges.find((range) =>
    !range.visible && range.sourceFrom === lineStart && range.sourceTo > lineStart &&
    (range.block === "heading" || range.block === "quote" || range.block === "unordered-list") &&
    range.sourceTo <= sourcePosition,
  )
  return prefix ? document.source.slice(lineStart, prefix.sourceTo) : ""
}

function serializeEntry(document: RichDocument, entry: CopyEntry): string {
  const raw = document.source.slice(entry.sourceFrom, entry.sourceTo)
  const marks = entry.range.marks.filter((mark): mark is InlineMark => INLINE_MARKS.includes(mark as InlineMark))
  return wrapInline(document, raw, entry.sourceFrom, entry.sourceTo, marks)
}

function serializeLinkGroup(document: RichDocument, entries: CopyEntry[], selectedFrom: number, selectedTo: number): string {
  const first = entries[0]
  const link = first.range.link!
  const inner = entries.map((entry) => serializeEntry(document, entry)).join("")
  const labelFrom = sourceToVisible(document, link.labelFrom)
  const labelTo = sourceToVisible(document, link.labelTo)
  if (selectedFrom <= labelFrom && selectedTo >= labelTo) return document.source.slice(link.sourceFrom, link.sourceTo)
  const target = document.source.slice(link.targetFrom, link.targetTo)
  if (link.kind === "markdown" || link.kind === "autolink") return `[${inner}](${target})`
  return `[[${target}|${inner}]]`
}

function serializeRange(document: RichDocument, from: number, to: number): string {
  const entries = copyEntries(document, from, to)
  if (!entries.length) return ""
  let result = ""
  let lineHasContent = false
  for (let index = 0; index < entries.length; ) {
    const entry = entries[index]!
    if (/^[\r\n]+$/.test(document.visible.slice(entry.from, entry.to))) {
      result += document.source.slice(entry.sourceFrom, entry.sourceTo)
      lineHasContent = false
      index += 1
      continue
    }
    const prefix = lineHasContent ? "" : blockPrefix(document, entry.from)
    let chunk: string
    if (entry.range.link) {
      const group: CopyEntry[] = [entry]
      let next = index + 1
      while (next < entries.length && entries[next]!.range.link && sameLink(entries[next]!.range.link!, entry.range.link!)) {
        group.push(entries[next]!)
        next += 1
      }
      chunk = serializeLinkGroup(document, group, from, to)
      index = next
    } else {
      chunk = serializeEntry(document, entry)
      index += 1
    }
    result += prefix + chunk
    lineHasContent = true
  }
  return result
}

/** Serialize model-visible ranges to an ephemeral Markdown clipboard payload. */
export function serializeRichSelection(
  document: RichDocument,
  ranges: readonly RichModelSelectionRange[],
): string {
  const lineBreak = document.source.includes("\r\n") ? "\r\n" : "\n"
  return ranges
    .filter((range) => Number.isSafeInteger(range.from) && Number.isSafeInteger(range.to) && range.from >= 0 && range.to >= 0 && range.from <= document.visible.length && range.to <= document.visible.length && range.from !== range.to)
    .map((range) => {
      try {
        return serializeRange(document, Math.min(range.from, range.to), Math.max(range.from, range.to))
      } catch {
        return ""
      }
    })
    .filter((text) => text.length > 0)
    .join(lineBreak)
}
