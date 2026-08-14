import { EditorView } from "@codemirror/view"
import { invertedEffects } from "@codemirror/commands"
import {
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Annotation,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state"
import {
  importMarkdown,
  replaceVisibleForEditor,
  serializeMarkdown,
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

/** CodeMirror stores LF line separators. The pure model keeps source line
 * endings, so the rich boundary maps only the visible projection here. */
function editorVisibleText(document: RichDocument): string {
  return document.visible.replace(/\r\n?/g, "\n")
}

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

/** Apply a set of visible CodeMirror changes against the model, not against
 * Markdown source. Changes use the pre-transaction visible coordinates. */
export function applyRichVisibleChanges(
  document: RichDocument,
  changes: readonly RichVisibleChange[],
  interimSelection: RichVisibleSelection,
): RichVisibleChangeResult {
  const ordered = [...changes]
    .map((change) => ({
      ...change,
      from: modelPositionFromEditor(document, change.from),
      to: modelPositionFromEditor(document, change.to),
    }))
    .sort((left, right) => right.from - left.from || right.to - left.to)
  let interim = editorVisibleText(document)
  let next = document
  let previousFrom = Number.POSITIVE_INFINITY
  for (const change of ordered) {
    if (
      !Number.isSafeInteger(change.from) ||
      !Number.isSafeInteger(change.to) ||
      change.from < 0 ||
      change.to < change.from ||
      change.to > document.visible.length ||
      change.to > previousFrom
    ) throw new RangeError("Visible changes overlap or are out of bounds")
    previousFrom = change.from
    interim = interim.slice(0, change.from) + change.insert + interim.slice(change.to)
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
  if (
    !transaction.docChanged ||
    transaction.annotation(ProgrammaticLoad) ||
    transaction.effects.some((effect) => effect.is(setRichDocumentEffect))
  ) return transaction
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
      annotations,
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
    invertedEffects.of((transaction) => {
      const document = fieldDocument(transaction.startState)
      return document && transaction.effects.some((effect) => effect.is(setRichDocumentEffect))
        ? [setRichDocumentEffect.of(document)]
        : []
    }),
  ]
}

function sourcePositionThroughChange(position: number, change: TextChange | null, assoc: -1 | 1): number {
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

/** Map a visible selection and viewport through a source reload. */
export function mapRichReload(
  oldDocument: RichDocument,
  nextDocument: RichDocument,
  selection: RichVisibleSelection,
  viewport: RichViewportAnchor,
): RichReloadMapping {
  checkedVisibleSelection(oldDocument, selection)
  checkedVisibleSelection(oldDocument, { anchor: viewport.visiblePosition, head: viewport.visiblePosition })
  const sourceChange = diffRange(oldDocument.source, nextDocument.source)
  const sourceSelection = richSelectionToSource(oldDocument, selection)
  const sourceAnchor = sourcePositionThroughChange(sourceSelection.anchor, sourceChange, sourceSelection.anchor <= sourceSelection.head ? 1 : -1)
  const sourceHead = sourcePositionThroughChange(sourceSelection.head, sourceChange, sourceSelection.head >= sourceSelection.anchor ? 1 : -1)
  const oldViewportSource = visibleToSource(oldDocument, viewport.visiblePosition)
  const nextViewportSource = sourcePositionThroughChange(oldViewportSource, sourceChange, 1)
  return {
    selection: {
      anchor: sourceToVisible(nextDocument, Math.max(0, Math.min(sourceAnchor, nextDocument.source.length))),
      head: sourceToVisible(nextDocument, Math.max(0, Math.min(sourceHead, nextDocument.source.length))),
    },
    viewport: {
      visiblePosition: sourceToVisible(nextDocument, Math.max(0, Math.min(nextViewportSource, nextDocument.source.length))),
    },
  }
}

function topViewportPosition(view: EditorView): number {
  const rect = view.scrollDOM.getBoundingClientRect()
  return view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 }) ?? view.viewport.from
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
