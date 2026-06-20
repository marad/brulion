import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { type EditorView } from "@codemirror/view"
import { EditorState, type Line } from "@codemirror/state"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { withHeadingLevel, clearFormattingRanges } from "./markdown-transforms"

/**
 * Slash commands: type `/` (at the start of a line or after a space) to open a
 * menu that reshapes the line. The menu UI (filtering, keyboard nav,
 * positioning) is CodeMirror's existing autocomplete — we only provide the
 * source. The actions reuse the FEAT-0007 heading transform (`withHeadingLevel`),
 * so "make this an H2" has one definition. Only clean markdown is written; the
 * `/command` token is removed on accept and never reaches disk.
 */

/** The token's line with just the `/command` (from..to) removed, so content
 * before/after the token is preserved and the row is never wiped. */
function lineWithoutToken(line: Line, from: number, to: number): string {
  return line.text.slice(0, from - line.from) + line.text.slice(to - line.from)
}

/** Reshape the token's line to heading `level` (0 = plain paragraph). */
function applyLevel(level: number) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const line = view.state.doc.lineAt(from)
    const text = withHeadingLevel(lineWithoutToken(line, from, to), level)
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: text },
      selection: { anchor: line.from + text.length },
    })
  }
}

/**
 * Clear all formatting on the token's line and remove the `/clear` token itself.
 * The token is dropped from the line text *first*, then the de-tokened line is
 * parsed on its own and stripped via the FEAT-0017 `clearFormattingRanges` (the
 * same logic the right-click menu runs). Stripping after token removal is what
 * keeps it robust to where `/clear` was typed: a token sitting before a block
 * marker (e.g. `/clear` at the very start of `# Heading`) would otherwise push
 * the `#` off the line start and hide the heading from the parser.
 */
function applyClear(view: EditorView, _completion: Completion, from: number, to: number) {
  const line = view.state.doc.lineAt(from)
  const withoutToken = lineWithoutToken(line, from, to)
  // Parse the de-tokened line in isolation and delete its markup runs, descending
  // so earlier deletions don't shift later offsets.
  const tmp = EditorState.create({ doc: withoutToken, extensions: [markdown()] })
  let text = withoutToken
  for (const r of clearFormattingRanges(tmp, 0, withoutToken.length).sort(
    (a, b) => b.from - a.from,
  )) {
    text = text.slice(0, r.from) + text.slice(r.to)
  }
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: text },
    selection: { anchor: line.from + text.length },
  })
}

const SLASH_COMMANDS: Completion[] = [
  { label: "/h1", detail: "Heading 1", type: "keyword", apply: applyLevel(1) },
  { label: "/h2", detail: "Heading 2", type: "keyword", apply: applyLevel(2) },
  { label: "/h3", detail: "Heading 3", type: "keyword", apply: applyLevel(3) },
  { label: "/clear", detail: "Clear formatting", type: "keyword", apply: applyClear },
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
