import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { type EditorView } from "@codemirror/view"
import { markdownLanguage } from "@codemirror/lang-markdown"
import { withHeadingLevel } from "./markdown-transforms"

/**
 * Slash commands: type `/` (at the start of a line or after a space) to open a
 * menu that reshapes the line. The menu UI (filtering, keyboard nav,
 * positioning) is CodeMirror's existing autocomplete — we only provide the
 * source. The actions reuse the FEAT-0007 heading transform (`withHeadingLevel`),
 * so "make this an H2" has one definition. Only clean markdown is written; the
 * `/command` token is removed on accept and never reaches disk.
 */

/** Reshape the token's line to heading `level` (0 = plain paragraph). */
function applyLevel(level: number) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const line = view.state.doc.lineAt(from)
    // Drop just the `/command` token (from..to), keep the rest of the line, and
    // reshape what remains — so content before/after the token is preserved and
    // the row is never wiped.
    const withoutToken =
      line.text.slice(0, from - line.from) + line.text.slice(to - line.from)
    const text = withHeadingLevel(withoutToken, level)
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

/**
 * Open the slash menu for a `/word` token whose `/` sits at the start of the
 * line or right after whitespace — never mid-word or inside a URL (`http://`).
 * The completion replaces from the `/`, so accepting removes exactly the token.
 */
export function slashSource(context: CompletionContext): CompletionResult | null {
  // Match the `/word` (optionally preceded by the whitespace/line-start boundary).
  const match = context.matchBefore(/(?:^|\s)\/\w*/)
  if (!match) return null
  const slash = match.text.indexOf("/")
  const from = match.from + slash // start the token at the `/`, not the space
  return {
    from,
    options: SLASH_COMMANDS,
    validFor: /^\/\w*$/, // keep filtering while the token is still `/word`
  }
}

/** Register the slash source as markdown autocomplete (the editor drives the UI). */
export const slashCommands = markdownLanguage.data.of({ autocomplete: slashSource })
