import { EditorView } from "@codemirror/view"
import { invertedEffects } from "@codemirror/commands"
import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type AnnotationType,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state"
import {
  applyBlockBackspace,
  applyBlockEnter,
  applyInlineInputRule,
  importMarkdown,
  replaceVisibleForEditor,
  serializeMarkdown,
  type InlineBoundary,
  sourceToVisible,
  visibleToSource,
  type RichDocument,
} from "./rich-markdown"
import { diffRange, type TextChange } from "./text-diff"
import { ProgrammaticLoad } from "./editor-load"

export interface RichVisibleSelection {
  anchor: number
  head: number
}

export interface RichSourceSelection extends RichVisibleSelection {
  text: string
}

export interface RichViewportAnchor {
  /** UTF-16 position in the visible CodeMirror projection. */
  visiblePosition: number
}

export interface RichReloadMapping {
  selection: RichVisibleSelection
  viewport: RichViewportAnchor
}

/** Exact rich editor state used when a speculative controller preview must be
 * rolled back without re-importing away transient pending input. */
export interface RichEditorSnapshot {
  document: RichDocument
  selection: RichVisibleSelection
  viewport: RichViewportAnchor
}

export interface RichVisibleChange {
  /** Positions in the pre-transaction visible projection. */
  from: number
  to: number
  insert: string
}

export interface RichVisibleChangeResult {
  document: RichDocument
  /** Selection positions in `document.visible`. */
  selection: RichVisibleSelection
}

const setRichDocumentEffect = StateEffect.define<RichDocument>()
/** Marks a transaction whose serialized source changed even when its visible
 * projection did not (for example, a completed empty `# ` heading). */
export const RichSourceChange: AnnotationType<boolean> = Annotation.define<boolean>()

const richDocumentField = StateField.define<RichDocument>({
  create: () => importMarkdown(""),
  update(document, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setRichDocumentEffect)) return effect.value
    }
    return document
  },
})

function fieldDocument(state: EditorState): RichDocument | null {
  return state.field(richDocumentField, false) ?? null
}

export function hasRichEditor(state: EditorState): boolean {
  return state.field(richDocumentField, false) !== undefined
}

export function richDocumentFromState(state: EditorState): RichDocument | null {
  return fieldDocument(state)
}

export function serializedRichMarkdown(state: EditorState): string | null {
  const document = fieldDocument(state)
  return document ? serializeMarkdown(document) : null
}

/** Whether a transaction changed the primary model's serialized source. */
export function isRichDocumentTransaction(transaction: Transaction): boolean {
  return transaction.effects.some((effect) => effect.is(setRichDocumentEffect))
}

/** CodeMirror stores LF line separators. The pure model keeps source line
 * endings, so the rich boundary maps only the visible projection here. */
export function richEditorVisibleText(document: RichDocument): string {
  return document.visible.replace(/\r\n?/g, "\n")
}

const editorVisibleText = richEditorVisibleText

interface LineEndingMap {
  modelToEditor: readonly number[]
  editorToModel: readonly number[]
}

function lineEndingMap(document: RichDocument): LineEndingMap {
  const modelToEditor: number[] = Array.from({ length: document.visible.length + 1 }, () => 0)
  const editorText = editorVisibleText(document)
  const editorToModel: number[] = Array.from({ length: editorText.length + 1 }, () => 0)
  let model = 0
  let editor = 0
  while (model < document.visible.length) {
    modelToEditor[model] = editor
    if (document.visible.startsWith("\r\n", model)) {
      modelToEditor[model + 1] = editor
      editorToModel[editor] = model
      editorToModel[editor + 1] = model + 2
      model += 2
      editor += 1
    } else {
      editorToModel[editor] = model
      model += 1
      editor += 1
      editorToModel[editor] = model
    }
  }
  modelToEditor[document.visible.length] = editor
  editorToModel[editor] = document.visible.length
  return { modelToEditor, editorToModel }
}

function modelPositionFromEditor(document: RichDocument, position: number): number {
  const map = lineEndingMap(document).editorToModel
  if (!Number.isSafeInteger(position) || position < 0 || position >= map.length) throw new RangeError("Visible position out of bounds")
  return map[position] ?? document.visible.length
}

function editorPositionFromModel(document: RichDocument, position: number): number {
  const map = lineEndingMap(document).modelToEditor
  if (!Number.isSafeInteger(position) || position < 0 || position >= map.length) throw new RangeError("Visible position out of bounds")
  return map[position] ?? editorVisibleText(document).length
}

/** Convert a CodeMirror LF-visible position into the model-visible position. */
export function richEditorPositionToModel(document: RichDocument, position: number): number {
  return modelPositionFromEditor(document, position)
}

/** Convert a model-visible position into a CodeMirror LF-visible position. */
export function richModelPositionToEditor(document: RichDocument, position: number): number {
  return editorPositionFromModel(document, position)
}

/** Convert one CodeMirror-visible range into model-visible coordinates. */
export function richEditorRangeToModel(
  document: RichDocument,
  range: { from: number; to: number },
): { from: number; to: number } {
  const from = modelPositionFromEditor(document, range.from)
  const to = modelPositionFromEditor(document, range.to)
  if (to < from) throw new RangeError("Visible range is reversed")
  return { from, to }
}

function mapInterimPosition(position: number, change: TextChange | null): number {
  if (!change) return position
  if (position <= change.from) return position
  if (position >= change.to) return position + change.insert.length - (change.to - change.from)
  return change.from + Math.min(position - change.from, change.insert.length)
}

function visibleChangeFromTransaction(transaction: Transaction): RichVisibleChange[] {
  const changes: RichVisibleChange[] = []
  transaction.changes.iterChanges((fromA, toA, _fromB, _toB, insert) => {
    // `iterChanges` reports both old and new coordinates. The old coordinates
    // are the ones needed by applyRichVisibleChanges.
    changes.push({ from: fromA, to: toA, insert: insert.toString() })
  })
  return changes
}

function isOpaqueBlock(block: RichDocument["ranges"][number]["block"]): boolean {
  return block === "opaque" || block === "fence" || block === "table" || block === "frontmatter" || block === "mermaid"
}

function isPendingRange(document: RichDocument, range: RichDocument["ranges"][number]): boolean {
  const lineStart = document.source.lastIndexOf("\n", Math.max(0, range.sourceFrom - 1)) + 1
  return document.pendingLineStarts.includes(lineStart)
}

function isIncompleteWikilinkRange(document: RichDocument, range: RichDocument["ranges"][number]): boolean {
  if (range.block !== "opaque") return false
  const lineStart = document.source.lastIndexOf("\n", Math.max(0, range.sourceFrom - 1)) + 1
  const newline = document.source.indexOf("\n", lineStart)
  const line = document.source.slice(lineStart, newline < 0 ? document.source.length : newline)
  const open = line.lastIndexOf("[[")
  return open >= 0 && line.indexOf("]]", open + 2) < 0
}

function assertVisibleEditorChangeSafe(document: RichDocument, change: RichVisibleChange): void {
  const modelFrom = modelPositionFromEditor(document, change.from)
  const modelTo = modelPositionFromEditor(document, change.to)
  const touched = document.ranges.filter((range) =>
    range.visible && range.visibleFrom < modelTo && range.visibleTo > modelFrom,
  )
  const opaque = touched.filter((range) =>
    isOpaqueBlock(range.block) &&
    !isPendingRange(document, range) &&
    !isIncompleteWikilinkRange(document, range),
  )
  if (opaque.length) throw new RangeError("Opaque source requires an explicit source edit")
  if (change.from !== change.to && touched.length > 1) {
    throw new RangeError("Visible replacement must stay within one mapped fragment")
  }
  if (change.from === change.to) {
    const at = document.ranges.filter((range) =>
      range.visible && range.visibleFrom <= modelFrom && modelFrom <= range.visibleTo,
    )
    if (at.some((range) =>
      isOpaqueBlock(range.block) &&
      !isPendingRange(document, range) &&
      !isIncompleteWikilinkRange(document, range),
    )) {
      throw new RangeError("Opaque source requires an explicit source edit")
    }
  }
}

/** Apply a set of visible CodeMirror changes against the model, not against
 * Markdown source. Changes use the pre-transaction visible coordinates. */
export function applyRichVisibleChanges(
  document: RichDocument,
  changes: readonly RichVisibleChange[],
  interimSelection: RichVisibleSelection,
): RichVisibleChangeResult {
  const editorOrdered = [...changes].sort((left, right) => right.from - left.from || right.to - left.to)
  for (const change of editorOrdered) assertVisibleEditorChangeSafe(document, change)
  const editorLength = editorVisibleText(document).length
  let interim = editorVisibleText(document)
  let previousEditorFrom = Number.POSITIVE_INFINITY
  for (const change of editorOrdered) {
    if (
      !Number.isSafeInteger(change.from) ||
      !Number.isSafeInteger(change.to) ||
      change.from < 0 ||
      change.to < change.from ||
      change.to > editorLength ||
      change.to > previousEditorFrom
    ) throw new RangeError("Visible changes overlap or are out of bounds")
    previousEditorFrom = change.from
    interim = interim.slice(0, change.from) + change.insert + interim.slice(change.to)
  }

  const modelOrdered = editorOrdered
    .map((change) => ({
      ...change,
      from: modelPositionFromEditor(document, change.from),
      to: modelPositionFromEditor(document, change.to),
    }))
    .sort((left, right) => right.from - left.from || right.to - left.to)
  let next = document
  let previousModelFrom = Number.POSITIVE_INFINITY
  for (const change of modelOrdered) {
    if (change.to > previousModelFrom) throw new RangeError("Visible changes overlap or are out of bounds")
    previousModelFrom = change.from
    next = replaceVisibleForEditor(next, change.from, change.to, change.insert)
  }

  if (
    !Number.isSafeInteger(interimSelection.anchor) ||
    !Number.isSafeInteger(interimSelection.head) ||
    interimSelection.anchor < 0 ||
    interimSelection.head < 0 ||
    interimSelection.anchor > interim.length ||
    interimSelection.head > interim.length
  ) throw new RangeError("Visible selection is out of bounds")

  const projectionChange = diffRange(interim, editorVisibleText(next))
  return {
    document: next,
    selection: {
      anchor: mapInterimPosition(interimSelection.anchor, projectionChange),
      head: mapInterimPosition(interimSelection.head, projectionChange),
    },
  }
}

function richTransactionFilter(transaction: Transaction): Transaction | TransactionSpec {
  const hasModelEffect = transaction.effects.some((effect) => effect.is(setRichDocumentEffect))
  if (hasModelEffect) {
    if (!transaction.docChanged && !transaction.annotation(ProgrammaticLoad)) {
      return {
        effects: transaction.effects,
        annotations: [RichSourceChange.of(true)],
        filter: false,
      }
    }
    return transaction
  }
  if (!transaction.docChanged || transaction.annotation(ProgrammaticLoad)) return transaction
  const document = fieldDocument(transaction.startState)
  if (!document) return transaction

  try {
    const result = applyRichVisibleChanges(
      document,
      visibleChangeFromTransaction(transaction),
      {
        anchor: transaction.newSelection.main.anchor,
        head: transaction.newSelection.main.head,
      },
    )
    const projectionChange = diffRange(transaction.startState.doc.toString(), editorVisibleText(result.document))
    const annotations: Annotation<unknown>[] = []
    const userEvent = transaction.annotation(Transaction.userEvent)
    if (userEvent !== undefined) annotations.push(Transaction.userEvent.of(userEvent))
    const addToHistory = transaction.annotation(Transaction.addToHistory)
    if (addToHistory !== undefined) annotations.push(Transaction.addToHistory.of(addToHistory))
    return {
      changes: projectionChange ?? [],
      selection: result.selection,
      effects: [...transaction.effects, setRichDocumentEffect.of(result.document)],
      annotations: [...annotations, RichSourceChange.of(true)],
      scrollIntoView: transaction.scrollIntoView,
      // The returned transaction already contains the source-model effect and
      // final visible change. Re-running this filter would apply the projected
      // text as a second model edit and corrupt one-history-unit conversion.
      filter: false,
    }
  } catch {
    // A normal visible edit must never leave a raw interim document behind when
    // it cannot be mapped losslessly. Returning an empty filter result cancels
    // the transaction and retains both the prior model and visible projection.
    return {
      changes: [],
      filter: false,
    }
  }
}

/** The primary editor extension. Raw editor mounts do not include it. */
export function richEditorExtension(): Extension {
  return [
    richDocumentField,
    EditorState.transactionFilter.of(richTransactionFilter),
    EditorView.domEventHandlers({
      blur(_event, view) {
        flushRichEditorInput(view, "blur")
        return false
      },
    }),
    invertedEffects.of((transaction) => {
      const document = fieldDocument(transaction.startState)
      return document && transaction.effects.some((effect) => effect.is(setRichDocumentEffect))
        ? [setRichDocumentEffect.of(document)]
        : []
    }),
  ]
}

function positionThroughChange(position: number, change: TextChange | null, assoc: -1 | 1): number {
  if (!change) return position
  const delta = change.insert.length - (change.to - change.from)
  if (position < change.from) return position
  if (position > change.to) return position + delta
  if (position === change.from) return change.from
  if (position === change.to) return change.from + change.insert.length
  return assoc < 0 ? change.from : change.from + change.insert.length
}

function checkedVisibleSelection(document: RichDocument, selection: RichVisibleSelection): void {
  if (
    !Number.isSafeInteger(selection.anchor) ||
    !Number.isSafeInteger(selection.head) ||
    selection.anchor < 0 ||
    selection.head < 0 ||
    selection.anchor > document.visible.length ||
    selection.head > document.visible.length
  ) throw new RangeError("Visible selection is out of bounds")
}

function checkedSourceSelection(document: RichDocument, selection: RichVisibleSelection): void {
  if (
    !Number.isSafeInteger(selection.anchor) ||
    !Number.isSafeInteger(selection.head) ||
    selection.anchor < 0 ||
    selection.head < 0 ||
    selection.anchor > document.source.length ||
    selection.head > document.source.length
  ) throw new RangeError("Source selection is out of bounds")
}

function sourcePositionForSelection(document: RichDocument, position: number): number {
  const startingRange = document.ranges.find((candidate) => candidate.visible && candidate.visibleFrom === position)
  if (startingRange?.marks.length) return startingRange.contentFrom
  const endingRange = document.ranges.find((candidate) => candidate.visible && candidate.visibleTo === position)
  if (endingRange?.marks.length) return endingRange.contentTo
  return visibleToSource(document, position)
}

/** Translate visible selection positions into UTF-16 source positions. */
export function richSelectionToSource(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichSourceSelection {
  checkedVisibleSelection(document, selection)
  const anchor = sourcePositionForSelection(document, selection.anchor)
  const head = sourcePositionForSelection(document, selection.head)
  const from = Math.min(anchor, head)
  const to = Math.max(anchor, head)
  return { anchor, head, text: document.source.slice(from, to) }
}

/** Translate UTF-16 source positions into visible positions. Hidden source
 * positions map to the nearest visible boundary; they never become hidden
 * caret stops in the CodeMirror document. */
export function richSourceSelectionToVisible(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichVisibleSelection {
  checkedSourceSelection(document, selection)
  return {
    anchor: sourceToVisible(document, selection.anchor),
    head: sourceToVisible(document, selection.head),
  }
}

/** Translate CodeMirror's LF-normalized visible positions to source offsets. */
export function richEditorSelectionToSource(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichSourceSelection {
  return richSelectionToSource(document, {
    anchor: modelPositionFromEditor(document, selection.anchor),
    head: modelPositionFromEditor(document, selection.head),
  })
}

/** Translate model-visible positions returned by the source map to CodeMirror
 * positions, accounting for CodeMirror's LF line-separator normalization. */
export function richSourceSelectionToEditor(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichVisibleSelection {
  const visible = richSourceSelectionToVisible(document, selection)
  return {
    anchor: editorPositionFromModel(document, visible.anchor),
    head: editorPositionFromModel(document, visible.head),
  }
}

/** Convert a model-visible selection to CodeMirror's LF-visible coordinates. */
export function richModelSelectionToEditor(
  document: RichDocument,
  selection: RichVisibleSelection,
): RichVisibleSelection {
  checkedVisibleSelection(document, selection)
  return {
    anchor: editorPositionFromModel(document, selection.anchor),
    head: editorPositionFromModel(document, selection.head),
  }
}

/** Map a visible selection and viewport through a source reload. */
export function mapRichReload(
  oldDocument: RichDocument,
  nextDocument: RichDocument,
  selection: RichVisibleSelection,
  viewport: RichViewportAnchor,
): RichReloadMapping {
  checkedVisibleSelection(oldDocument, selection)
  checkedVisibleSelection(oldDocument, { anchor: viewport.visiblePosition, head: viewport.visiblePosition })
  // Map through the visible projection, not a single raw-source diff. A
  // delimiter-only rewrite (for example `**word**` to `__word__`) has a large
  // source replacement but no visible replacement; source-coordinate mapping
  // would therefore jump a caret inside the word to the replacement end.
  // Visible coordinates are the user's stable frame, while the next model is
  // still authoritative for clamping the result.
  const visibleChange = diffRange(oldDocument.visible, nextDocument.visible)
  const nextAnchor = positionThroughChange(
    selection.anchor,
    visibleChange,
    selection.anchor <= selection.head ? 1 : -1,
  )
  const nextHead = positionThroughChange(
    selection.head,
    visibleChange,
    selection.head >= selection.anchor ? 1 : -1,
  )
  const nextViewport = positionThroughChange(viewport.visiblePosition, visibleChange, 1)
  return {
    selection: {
      anchor: Math.max(0, Math.min(nextAnchor, nextDocument.visible.length)),
      head: Math.max(0, Math.min(nextHead, nextDocument.visible.length)),
    },
    viewport: {
      visiblePosition: Math.max(0, Math.min(nextViewport, nextDocument.visible.length)),
    },
  }
}

function topViewportPosition(view: EditorView): number {
  const rect = view.scrollDOM.getBoundingClientRect()
  return view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 }) ?? view.viewport.from
}

/** Capture the model and visible-coordinate anchors without serializing away
 * transient pending/explicit projection state. */
export function captureRichEditorState(view: EditorView): RichEditorSnapshot {
  const document = fieldDocument(view.state)
  if (!document) throw new Error("Editor is not using the rich document boundary")
  const selection = view.state.selection.main
  return {
    document,
    selection: {
      anchor: modelPositionFromEditor(document, selection.anchor),
      head: modelPositionFromEditor(document, selection.head),
    },
    viewport: { visiblePosition: modelPositionFromEditor(document, topViewportPosition(view)) },
  }
}

/** Restore an exact rich snapshot as a programmatic, non-history transaction. */
export function restoreRichEditorState(view: EditorView, snapshot: RichEditorSnapshot): void {
  const current = fieldDocument(view.state)
  if (!current) throw new Error("Editor is not using the rich document boundary")
  const changes = diffRange(view.state.doc.toString(), editorVisibleText(snapshot.document))
  const selection = {
    anchor: editorPositionFromModel(snapshot.document, snapshot.selection.anchor),
    head: editorPositionFromModel(snapshot.document, snapshot.selection.head),
  }
  const visiblePosition = editorPositionFromModel(snapshot.document, snapshot.viewport.visiblePosition)
  view.dispatch({
    changes: changes ?? [],
    selection,
    effects: [
      setRichDocumentEffect.of(snapshot.document),
      EditorView.scrollIntoView(visiblePosition, { y: "start" }),
    ],
    annotations: [annotationsForProgrammaticLoad(), Transaction.addToHistory.of(false)],
    filter: false,
    scrollIntoView: true,
  })
}

/** Commit one complete rich model change and its visible projection. */
export function dispatchRichDocumentChange(
  view: EditorView,
  document: RichDocument,
  selection: RichVisibleSelection,
  userEvent = "input",
): void {
  const changes = diffRange(view.state.doc.toString(), editorVisibleText(document))
  view.dispatch({
    changes: changes ?? [],
    selection: {
      anchor: editorPositionFromModel(document, selection.anchor),
      head: editorPositionFromModel(document, selection.head),
    },
    effects: [setRichDocumentEffect.of(document)],
    annotations: [Transaction.userEvent.of(userEvent)],
    filter: false,
  })
}

function sourceCursorForVisible(document: RichDocument, cursor: number): number {
  return richSelectionToSource(document, { anchor: cursor, head: cursor }).anchor
}

function sameNumberList(left: readonly number[] | undefined, right: readonly number[] | undefined): boolean {
  const a = left ?? []
  const b = right ?? []
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function richProjectionChanged(left: RichDocument, right: RichDocument): boolean {
  if (left.source !== right.source || left.visible !== right.visible) return true
  if (!sameNumberList(left.pendingLineStarts, right.pendingLineStarts)) return true
  if (!sameNumberList(left.explicitAdjacentMarkerStarts, right.explicitAdjacentMarkerStarts)) return true
  if (!sameNumberList(left.explicitPunctuationLineStarts, right.explicitPunctuationLineStarts)) return true
  if (left.replacements.length !== right.replacements.length) return true
  return left.ranges.length !== right.ranges.length || left.ranges.some((range, index) => {
    const other = right.ranges[index]
    return range.sourceFrom !== other.sourceFrom
      || range.sourceTo !== other.sourceTo
      || range.contentFrom !== other.contentFrom
      || range.contentTo !== other.contentTo
      || range.visibleFrom !== other.visibleFrom
      || range.visibleTo !== other.visibleTo
      || range.visible !== other.visible
      || range.block !== other.block
      || range.marks.length !== other.marks.length
      || range.marks.some((mark, markIndex) => mark !== other.marks[markIndex])
  })
}

/** Flush pending inline syntax at a lifecycle/input boundary. */
export function flushRichEditorInput(view: EditorView, boundary: InlineBoundary): boolean {
  const document = fieldDocument(view.state)
  if (!document) return false
  const selection = view.state.selection.main
  if (selection.anchor !== selection.head && boundary !== "save" && boundary !== "blur" && boundary !== "eof") return false
  const cursor = modelPositionFromEditor(document, selection.head)
  const sourceCursor = boundary === "save" || boundary === "blur" || boundary === "eof"
    ? document.source.length
    : sourceCursorForVisible(document, cursor)
  const result = applyInlineInputRule(document, sourceCursor, boundary)
  if (!result.converted || !richProjectionChanged(document, result.document)) return false
  dispatchRichDocumentChange(view, result.document, { anchor: result.caret, head: result.caret })
  return true
}

/** Rich Enter: flush a pending inline marker, then apply model block behavior. */
export function richEnter(view: EditorView): boolean {
  const document = fieldDocument(view.state)
  if (!document) return false
  const selection = view.state.selection.main
  if (selection.anchor !== selection.head) return false
  const cursor = modelPositionFromEditor(document, selection.head)
  const sourceCursor = sourceCursorForVisible(document, cursor)
  const inline = applyInlineInputRule(document, sourceCursor, "enter")
  const flushed = inline.converted ? inline.document : document
  const flushedCursor = inline.converted ? inline.caret : cursor
  const block = applyBlockEnter(flushed, flushedCursor)
  if (block.changed) {
    dispatchRichDocumentChange(view, block.document, { anchor: block.anchor, head: block.head })
    return true
  }
  if (inline.converted) {
    const next = replaceVisibleForEditor(flushed, flushedCursor, flushedCursor, "\n")
    dispatchRichDocumentChange(view, next, { anchor: flushedCursor + 1, head: flushedCursor + 1 })
    return true
  }
  return false
}

/** Rich Backspace: remove a model block prefix only when its contract allows it. */
export function richBackspace(view: EditorView): boolean {
  const document = fieldDocument(view.state)
  if (!document) return false
  const selection = view.state.selection.main
  if (selection.anchor !== selection.head) return false
  const cursor = modelPositionFromEditor(document, selection.head)
  const result = applyBlockBackspace(document, cursor)
  if (!result.changed) return false
  dispatchRichDocumentChange(view, result.document, { anchor: result.anchor, head: result.head })
  return true
}

/** Tab is an inline boundary; without pending syntax the browser/keymap keeps
 * its normal focus behavior by returning false. */
export function richTab(view: EditorView): boolean {
  return flushRichEditorInput(view, "tab")
}

function annotationsForProgrammaticLoad(): Annotation<boolean> {
  return ProgrammaticLoad.of(true)
}

function dispatchSource(view: EditorView, source: string, selection: RichVisibleSelection, viewport?: RichViewportAnchor): void {
  const next = importMarkdown(source)
  const current = fieldDocument(view.state)
  if (!current) throw new Error("Editor is not using the rich document boundary")
  const changes = diffRange(view.state.doc.toString(), editorVisibleText(next))
  const effects: StateEffect<unknown>[] = [setRichDocumentEffect.of(next)]
  if (viewport) effects.push(EditorView.scrollIntoView(viewport.visiblePosition, { y: "start" }))
  view.dispatch({
    changes: changes ?? [],
    selection,
    effects,
    annotations: [annotationsForProgrammaticLoad(), Transaction.addToHistory.of(false)],
    filter: false,
    scrollIntoView: Boolean(viewport),
  })
}

/** Import source and commit source/model/visible text as one programmatic load. */
export function setRichEditorSource(view: EditorView, source: string): void {
  const current = fieldDocument(view.state)
  if (!current) throw new Error("Editor is not using the rich document boundary")
  const next = importMarkdown(source)
  if (current.source === source && view.state.doc.toString() === next.visible) return
  dispatchSource(view, source, { anchor: 0, head: 0 })
}

/** Re-import external source and map selection and viewport without autosave. */
export function reloadRichEditorSource(view: EditorView, source: string): void {
  const current = fieldDocument(view.state)
  if (!current) throw new Error("Editor is not using the rich document boundary")
  const next = importMarkdown(source)
  if (current.source === source && view.state.doc.toString() === next.visible) return
  const selection = view.state.selection.main
  const mapping = mapRichReload(
    current,
    next,
    {
      anchor: modelPositionFromEditor(current, selection.anchor),
      head: modelPositionFromEditor(current, selection.head),
    },
    { visiblePosition: modelPositionFromEditor(current, topViewportPosition(view)) },
  )
  dispatchSource(
    view,
    source,
    {
      anchor: editorPositionFromModel(next, mapping.selection.anchor),
      head: editorPositionFromModel(next, mapping.selection.head),
    },
    { visiblePosition: editorPositionFromModel(next, mapping.viewport.visiblePosition) },
  )
}
