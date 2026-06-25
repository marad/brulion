import { EditorView } from "@codemirror/view"
import { classHighlighter, highlightTree } from "@lezer/highlight"
import { syntaxTree } from "@codemirror/language"
import type { EditorState } from "@codemirror/state"

/**
 * Syntax highlighting for fenced code blocks (FEAT-0049), scoped **by range** to the
 * blocks themselves. Markdown prose and nested code share one highlight-tag
 * namespace (both use `string`/`comment`/`escape`/…), so a *global* highlighter would
 * recolour prose escapes (`\*`), HTML comments, and link titles. Instead we run the
 * tree highlighter only over each fenced block's range and emit `tok-*` class marks —
 * so prose is never touched (AC-4), while the block's tokens get coloured by the
 * `.tok-*` CSS below.
 */

/** A highlight mark over `[from, to)` carrying space-separated `tok-*` classes. */
export interface CodeMark {
  from: number
  to: number
  cls: string
}

/**
 * Collect highlight marks for every fenced code block intersecting `[from, to)`.
 * Only ranges inside a `FencedCode` node are highlighted; prose outside code blocks
 * yields nothing. Returns the marks (the caller turns them into decorations). Pure.
 */
export function collectCodeMarks(state: EditorState, from: number, to: number): CodeMark[] {
  const marks: CodeMark[] = []
  const tree = syntaxTree(state)
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "FencedCode") return
      highlightTree(
        tree,
        classHighlighter,
        (f, t, cls) => marks.push({ from: f, to: t, cls }),
        node.from,
        node.to,
      )
    },
  })
  return marks
}

/**
 * Token colours for code blocks, keyed on the stable `tok-*` classes
 * `classHighlighter` produces. Colours come from the M18 syntax palette tokens
 * (`--tok-*`, FEAT-0066) so they flip light↔dark with the theme; the light values
 * are the original GitHub-light-ish palette. Classes that shared a colour keep
 * sharing one token (property/escape = number's blue, meta = comment grey). Only
 * code-relevant token classes are styled; the marks only ever land inside fenced
 * blocks, so markdown prose rendering is unaffected regardless.
 */
export const codeTokenTheme = EditorView.baseTheme({
  ".tok-keyword, .tok-controlKeyword, .tok-operatorKeyword, .tok-definitionKeyword, .tok-moduleKeyword":
    { color: "var(--tok-keyword)" },
  ".tok-string, .tok-special, .tok-attributeValue": { color: "var(--tok-string)" },
  ".tok-number, .tok-integer, .tok-float, .tok-bool, .tok-null, .tok-atom": {
    color: "var(--tok-number)",
  },
  ".tok-comment, .tok-lineComment, .tok-blockComment": {
    color: "var(--tok-comment)",
    fontStyle: "italic",
  },
  ".tok-function": { color: "var(--tok-function)" },
  ".tok-propertyName, .tok-attributeName": { color: "var(--tok-number)" },
  ".tok-typeName, .tok-className, .tok-namespace": { color: "var(--tok-type)" },
  ".tok-tagName, .tok-regexp": { color: "var(--tok-tag)" },
  ".tok-escape": { color: "var(--tok-number)" },
  ".tok-meta, .tok-annotation": { color: "var(--tok-comment)" },
})
