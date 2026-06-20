import { type Command, keymap } from "@codemirror/view"
import { Prec, type EditorState, type TransactionSpec } from "@codemirror/state"
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown"
import {
  BOLD,
  ITALIC,
  CODE,
  type InlineMarker,
  toggleInline,
  promoteHeading,
  demoteHeading,
  setHeading,
  isEmptyMarkerLine,
} from "./markdown-transforms"

/**
 * Wrap a pure transform into a CodeMirror command. Dispatches only when the
 * transform produces a change (a no-op heading cycle returns `null`), but always
 * consumes the key so it never falls through to a default binding (e.g. Ctrl+↑
 * on an H1 must not run CodeMirror's "cursor to document start").
 */
function command(build: (state: EditorState) => TransactionSpec | null): Command {
  return (view) => {
    const spec = build(view.state)
    if (spec) view.dispatch(spec)
    return true
  }
}

const toggle = (m: InlineMarker): Command => command((state) => toggleInline(state, m))

/**
 * Markdown-aware Enter (FEAT-0018). On an empty list/blockquote line — just the
 * marker, no content — remove the marker and leave a plain empty line (exit the
 * construct). Otherwise defer to `@codemirror/lang-markdown`'s continuation, which
 * carries the marker onto the next line; that returns `false` on a plain line, so
 * Enter there falls through to the editor's default newline. This makes exit
 * uniform for lists *and* quotes (the library command alone only exits lists
 * cleanly; a blockquote needs a second empty line).
 */
export const continueOrExitMarkup: Command = (view) => {
  const { state } = view
  const range = state.selection.main
  if (range.empty) {
    const line = state.doc.lineAt(range.head)
    // The whole line is just a marker (no content). The caret may sit at the line
    // start rather than its end — the hidden marker is an atomic range, so the
    // editor snaps the caret before it — so don't test the caret column, only that
    // it is on this empty marker line.
    if (isEmptyMarkerLine(line.text)) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "" },
        selection: { anchor: line.from },
        userEvent: "input",
      })
      return true
    }
  }
  return insertNewlineContinueMarkup(view)
}

/**
 * Keyboard shortcuts that create/remove formatting by editing the underlying
 * markdown. High precedence so they win over CodeMirror/browser defaults (notably
 * Ctrl+↑/↓). Underline (Ctrl+U) is intentionally absent — see DECISIONS.md.
 */
export const markdownCommands = Prec.high(
  keymap.of([
    { key: "Mod-b", preventDefault: true, run: toggle(BOLD) },
    { key: "Mod-i", preventDefault: true, run: toggle(ITALIC) },
    { key: "Mod-e", preventDefault: true, run: toggle(CODE) },
    { key: "Mod-ArrowUp", preventDefault: true, run: command(promoteHeading) },
    { key: "Mod-ArrowDown", preventDefault: true, run: command(demoteHeading) },
    { key: "Mod-Shift-1", preventDefault: true, run: command(setHeading(1)) },
    { key: "Mod-Shift-2", preventDefault: true, run: command(setHeading(2)) },
    { key: "Mod-Shift-3", preventDefault: true, run: command(setHeading(3)) },
  ]),
)
