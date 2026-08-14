import { EditorView } from "@codemirror/view"
import { Vim, getCM, type CodeMirrorV } from "@replit/codemirror-vim"
import { applyRichPaste } from "./rich-adapters"
import { hasRichEditor } from "./rich-editor"
import { serializeCopy } from "./copy-markdown"

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

interface RichVimState {
  insertMode?: boolean
  visualMode?: boolean
  inputState?: { registerName?: string | null }
}

/** Handle character/linewise Vim paste on the rich projection before the Vim
 * adapter dispatches a raw `replaceRange`. Raw editors return false and keep
 * the package's stock behavior. */
export function handleRichVimPaste(view: EditorView, event: KeyboardEvent): boolean {
  if (!hasRichEditor(view.state) || (event.key !== "p" && event.key !== "P")) return false
  const cm = getCM(view)
  if (!cm) return false
  const vim = (cm.state as unknown as { vim?: RichVimState }).vim
  if (!vim || vim.insertMode) return false
  const register = Vim.getRegisterController().getRegister(vim.inputState?.registerName ?? undefined)
  const text = register.toString()
  if (!text) return true

  const previous = view.state.selection.main
  let from = previous.from
  let to = previous.to
  if (!vim.visualMode) {
    const line = view.state.doc.lineAt(previous.head)
    if (register.linewise) {
      const position = event.key === "p" && line.to < view.state.doc.length ? line.to + 1 : event.key === "P" ? line.from : view.state.doc.length
      from = position
      to = position
    } else {
      const position = event.key === "p" ? Math.min(line.to, previous.head + 1) : previous.head
      from = position
      to = position
    }
  }

  try {
    view.dispatch({ selection: { anchor: from, head: to } })
    if (!applyRichPaste(view, text)) {
      view.dispatch({ selection: { anchor: previous.anchor, head: previous.head } })
      return true
    }
    if (vim.visualMode) Vim.exitVisualMode(cm as CodeMirrorV)
    return true
  } catch {
    view.dispatch({ selection: { anchor: previous.anchor, head: previous.head } })
    return true
  }
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
