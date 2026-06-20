import { type Command, keymap } from "@codemirror/view"
import { Prec, type EditorState, type TransactionSpec } from "@codemirror/state"
import {
  BOLD,
  ITALIC,
  CODE,
  type InlineMarker,
  toggleInline,
  promoteHeading,
  demoteHeading,
  setHeading,
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
