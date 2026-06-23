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
 * `classHighlighter` produces. A GitHub-light-ish palette for the editor's light
 * background. Only code-relevant token classes are styled; the marks only ever land
 * inside fenced blocks, so markdown prose rendering is unaffected regardless.
 */
export const codeTokenTheme = EditorView.baseTheme({
  ".tok-keyword, .tok-controlKeyword, .tok-operatorKeyword, .tok-definitionKeyword, .tok-moduleKeyword":
    { color: "#cf222e" },
  ".tok-string, .tok-special, .tok-attributeValue": { color: "#0a3069" },
  ".tok-number, .tok-integer, .tok-float, .tok-bool, .tok-null, .tok-atom": { color: "#0550ae" },
  ".tok-comment, .tok-lineComment, .tok-blockComment": {
    color: "#6e7781",
    fontStyle: "italic",
  },
  ".tok-function": { color: "#8250df" },
  ".tok-propertyName, .tok-attributeName": { color: "#0550ae" },
  ".tok-typeName, .tok-className, .tok-namespace": { color: "#953800" },
  ".tok-tagName, .tok-regexp": { color: "#116329" },
  ".tok-escape": { color: "#0550ae" },
  ".tok-meta, .tok-annotation": { color: "#6e7781" },
})
