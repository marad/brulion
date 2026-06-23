import { Vim } from "@replit/codemirror-vim"
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
