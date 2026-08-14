import { EditorView } from "@codemirror/view"
import { Vim, getCM, type CodeMirrorV } from "@replit/codemirror-vim"
import { applyRichPaste, applyRichSourceBoundaryChange } from "./rich-adapters"
import { hasRichEditor, richDocumentFromState, richEditorRangeToModel } from "./rich-editor"
import { serializeCopy } from "./copy-markdown"
import { visibleToSource } from "./rich-markdown"

/**
 * Route Vim's yank through the FEAT-0045 markdown serializer (FEAT-0046). Vim's
 * stock `yank` operator stores the raw `getSelection()` text in its own register and
 * never fires a DOM `copy` event, so the FEAT-0045 clipboard handler can't reach it:
 * a visual-mode `y` on a heading's visible text drops the hidden `# `, and `p`
 * pastes plain text. We override the `yank` operator (the package's public
 * `Vim.defineOperator`), mirroring the stock operator exactly — same register
 * routing, same post-yank cursor — except the stored text is re-serialized with the
 * same boundary repairs the clipboard path uses. The package guarantees the live
 * editor selection matches the operator's input range, so serializing
 * `view.state.selection.ranges` yanks neither more nor less than the stock operator.
 *
 * Only `yank` is touched; delete/change and paste are unchanged. The override is
 * global and idempotent — it installs once and is only ever invoked while Vim mode
 * is active.
 */
let installed = false

export function installVimMarkdownYank(): void {
  if (installed) return
  installed = true

  Vim.defineOperator("yank", (cm, args, ranges, oldAnchor) => {
    const vim = cm.state.vim
    const view = cm.cm6
    // The package sets the live selection to the operator's range before calling,
    // so this is exactly what the stock `cm.getSelection()` would yank — repaired.
    const text = serializeCopy(view.state, view.state.selection.ranges)
    const endPos = vim.visualMode
      ? cursorMin(vim.sel.anchor, vim.sel.head, ranges[0].head, ranges[0].anchor)
      : oldAnchor
    Vim.getRegisterController().pushText(
      args.registerName,
      "yank",
      text,
      args.linewise,
      vim.visualBlock,
    )
    return endPos
  })
}

interface RichVimInputState {
  registerName?: string | null
  prefixRepeat?: string[]
  motionRepeat?: string[]
  keyBuffer?: string[]
  getRepeat?: () => number
}

interface RichVimState {
  insertMode?: boolean
  visualMode?: boolean
  visualLine?: boolean
  inputState?: RichVimInputState
}

/** Handle character/linewise Vim paste on the rich projection before the Vim
 * adapter dispatches a raw `replaceRange`. Raw editors return false and keep
 * the package's stock behavior. */
export function handleRichVimPaste(view: EditorView, event: KeyboardEvent): boolean {
  if (!hasRichEditor(view.state) || view.state.readOnly || (event.key !== "p" && event.key !== "P")) return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  const cm = getCM(view)
  if (!cm) return false
  const vim = (cm.state as unknown as { vim?: RichVimState }).vim
  if (!vim || vim.insertMode) return false
  const input = vim.inputState
  const register = Vim.getRegisterController().getRegister(input?.registerName ?? undefined)
  const bufferedCount = /^(?:[1-9]\d*)/.exec(input?.keyBuffer?.join("") ?? "")?.[0]
  const parsedRepeat = bufferedCount ? Number(bufferedCount) : input?.getRepeat?.() ?? 1
  const repeat = Number.isSafeInteger(parsedRepeat) && parsedRepeat > 0 ? parsedRepeat : 1
  const text = register.toString().repeat(repeat)
  const finishInput = () => {
    if (!input) return
    input.prefixRepeat = []
    input.motionRepeat = []
    input.keyBuffer = []
    input.registerName = undefined
  }
  if (!text) {
    finishInput()
    return true
  }

  const previous = view.state.selection.main
  if (register.blockwise) {
    // Blockwise registers need a per-line rectangular source edit. The rich
    // boundary has no safe representation for splitting hidden prefixes in a
    // rectangle yet, so consume the command as an explicit no-op rather than
    // reintroducing raw Markdown through Vim's stock replaceRange path.
    finishInput()
    return true
  }
  const document = richDocumentFromState(view.state)
  let from = previous.from
  let to = previous.to
  let pasteText = text
  const defaultLineEnding = document?.source.includes("\r\n") ? "\r\n" : "\n"
  const rawLinewiseBody = register.linewise
    ? (() => {
      const normalized = text.replace(/\r\n?/g, "\n")
      return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized
    })()
    : text
  const linewiseBody = rawLinewiseBody.replace(/\n/g, defaultLineEnding)
  const linewiseText = register.linewise ? `${linewiseBody}${defaultLineEnding}` : text
  if (register.linewise && vim.visualMode && !vim.visualLine) {
    // Characterwise visual + linewise register is safe only for an unmarked
    // paragraph fragment. Splitting a hidden wrapper or block prefix would
    // otherwise create an invalid source island; this is a documented rich Vim
    // limitation and deliberately leaves the selection untouched.
    let applied = false
    if (document && !view.state.sliceDoc(previous.from, previous.to).includes("\n")) {
      try {
        const modelRange = richEditorRangeToModel(document, { from: previous.from, to: previous.to })
        const touched = document.ranges.filter((range) =>
          range.visible && range.visibleFrom < modelRange.to && range.visibleTo > modelRange.from,
        )
        if (touched.length === 1 && touched[0]!.marks.length === 0 && touched[0]!.block === "paragraph") {
          const sourceFrom = visibleToSource(document, modelRange.from)
          const sourceTo = visibleToSource(document, modelRange.to)
          const targetLine = sourceLineAt(document, view.state.doc.lineAt(previous.from).number)
          const ending = targetLine?.ending || defaultLineEnding
          const body = rawLinewiseBody.replace(/\n/g, ending)
          const sourceText = `${ending}${body}${ending}`
          applied = applyRichSourceBoundaryChange(view, sourceFrom, sourceTo, sourceText, sourceFrom + firstNonWhitespaceOffset(sourceText))
        }
      } catch {
        applied = false
      }
    }
    if (applied) Vim.exitVisualMode(cm as CodeMirrorV)
    finishInput()
    return true
  }
  if (register.linewise && document && (!vim.visualMode || vim.visualLine)) {
    let sourceFrom: number | null = null
    let sourceTo: number | null = null
    let sourceCaret: number | null = null
    let sourceText = linewiseText
    if (vim.visualMode) {
      const firstPosition = Math.min(previous.from, previous.to)
      const lastPosition = Math.max(previous.from, previous.to) - 1
      const first = sourceLineAt(document, view.state.doc.lineAt(firstPosition).number)
      const last = sourceLineAt(document, view.state.doc.lineAt(Math.max(firstPosition, lastPosition)).number)
      if (first && last) {
        const ending = last.ending || first.ending || defaultLineEnding
        const body = rawLinewiseBody.replace(/\n/g, ending)
        sourceFrom = first.from
        sourceTo = last.to
        sourceText = body + document.source.slice(last.contentTo, last.to)
        sourceCaret = sourceFrom + firstNonWhitespaceOffset(body)
      }
    } else {
      const line = view.state.doc.lineAt(previous.head)
      const sourceLine = sourceLineAt(document, line.number)
      if (sourceLine) {
        const ending = sourceLine.ending || defaultLineEnding
        const body = rawLinewiseBody.replace(/\n/g, ending)
        if (event.key === "p") {
          sourceFrom = sourceLine.to
          sourceTo = sourceLine.to
          sourceText = sourceLine.to < document.source.length
            ? `${body}${ending}`
            : `${ending}${body}${ending}`
          sourceCaret = sourceFrom + (sourceLine.to < document.source.length ? 0 : ending.length) + firstNonWhitespaceOffset(body)
        } else {
          sourceFrom = sourceLine.from
          sourceTo = sourceLine.from
          sourceText = `${body}${ending}`
          sourceCaret = sourceFrom + firstNonWhitespaceOffset(body)
        }
      }
    }
    const applied = sourceFrom !== null && sourceTo !== null && sourceCaret !== null
      && applyRichSourceBoundaryChange(view, sourceFrom, sourceTo, sourceText, sourceCaret)
    if (applied && vim.visualMode) Vim.exitVisualMode(cm as CodeMirrorV)
    finishInput()
    return true
  }
  if (vim.visualMode) {
    if (register.linewise) {
      pasteText = vim.visualLine ? linewiseBody : `\n${linewiseBody}\n`
    }
  } else {
    const line = view.state.doc.lineAt(previous.head)
    if (register.linewise) {
      if (event.key === "p") {
        from = line.to
        to = line.to
        pasteText = line.to < view.state.doc.length
          ? `\n${linewiseBody}`
          : `\n${linewiseBody}${defaultLineEnding}`
      } else {
        from = line.from
        to = line.from
        pasteText = linewiseText
      }
    } else {
      const position = event.key === "p" ? Math.min(line.to, previous.head + 1) : previous.head
      from = position
      to = position
    }
  }

  try {
    view.dispatch({ selection: { anchor: from, head: to } })
    if (!applyRichPaste(view, pasteText)) {
      view.dispatch({ selection: { anchor: previous.anchor, head: previous.head } })
      finishInput()
      return true
    }
    if (vim.visualMode) Vim.exitVisualMode(cm as CodeMirrorV)
    finishInput()
    return true
  } catch {
    view.dispatch({ selection: { anchor: previous.anchor, head: previous.head } })
    finishInput()
    return true
  }
}

interface SourceLineRange {
  from: number
  contentTo: number
  to: number
  ending: string
}

function sourceLineAt(document: NonNullable<ReturnType<typeof richDocumentFromState>>, lineNumber: number): SourceLineRange | null {
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 1) return null
  let from = 0
  for (let line = 1; line < lineNumber; line += 1) {
    const newline = document.source.indexOf("\n", from)
    if (newline < 0) return null
    from = newline + 1
  }
  const newline = document.source.indexOf("\n", from)
  const to = newline < 0 ? document.source.length : newline + 1
  const contentTo = newline < 0 ? document.source.length : newline > from && document.source[newline - 1] === "\r" ? newline - 1 : newline
  const ending = newline < 0 ? "" : document.source.slice(contentTo, to)
  return { from, contentTo, to, ending }
}

function firstNonWhitespaceOffset(text: string): number {
  return /\S/.exec(text)?.index ?? 0
}

interface VimPos {
  line: number
  ch: number
}

/** True when `a` precedes `b` (by line, then column). */
function cursorIsBefore(a: VimPos, b: VimPos): boolean {
  return a.line < b.line || (a.line === b.line && a.ch < b.ch)
}

/** The earliest of the given Vim positions — the post-yank cursor lands at the start
 * of the operated range, matching the stock operator's `cursorMin`. */
function cursorMin<T extends VimPos>(...cursors: T[]): T {
  return cursors.reduce((min, c) => (cursorIsBefore(c, min) ? c : min))
}
