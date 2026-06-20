import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { type EditorView } from "@codemirror/view"
import { markdownLanguage } from "@codemirror/lang-markdown"
import { withHeadingLevel } from "./markdown-transforms"

/**
 * Slash commands: type `/` at the start of a line to open a menu that reshapes
 * the line. The menu UI (filtering, keyboard nav, positioning) is CodeMirror's
 * existing autocomplete — we only provide the source. The actions reuse the
 * FEAT-0007 heading transform (`withHeadingLevel`), so "make this an H2" has one
 * definition. Only clean markdown is written; the `/command` token is removed on
 * accept and never reaches disk.
 */

/**
 * Strip a leading `/command` token (and one following space) from a line — what
 * stays is the line's real content, which the slash action then reshapes. Keyed
 * to the line text, not the caret, so it works wherever the caret sits.
 */
export function stripSlashToken(line: string): string {
  return line.replace(/^\/\w* ?/, "")
}

/** Reshape the command's line to heading `level` (0 = plain paragraph). */
function applyLevel(level: number) {
  return (view: EditorView, _completion: Completion, from: number) => {
    const line = view.state.doc.lineAt(from)
    const text = withHeadingLevel(stripSlashToken(line.text), level)
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: text },
      selection: { anchor: line.from + text.length },
    })
  }
}

const SLASH_COMMANDS: Completion[] = [
  { label: "/h1", detail: "Heading 1", type: "keyword", apply: applyLevel(1) },
  { label: "/h2", detail: "Heading 2", type: "keyword", apply: applyLevel(2) },
  { label: "/h3", detail: "Heading 3", type: "keyword", apply: applyLevel(3) },
  { label: "/clear", detail: "Plain paragraph", type: "keyword", apply: applyLevel(0) },
]

/** Open the slash menu only for a `/word` token at the very start of a line. */
export function slashSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos)
  const before = line.text.slice(0, context.pos - line.from)
  if (!/^\/\w*$/.test(before)) return null
  return {
    from: line.from, // the token spans the whole `/command` at line start
    options: SLASH_COMMANDS,
    validFor: /^\/\w*$/, // keep filtering while the token is still `/word`
  }
}

/** Register the slash source as markdown autocomplete (basicSetup drives the UI). */
export const slashCommands = markdownLanguage.data.of({ autocomplete: slashSource })
