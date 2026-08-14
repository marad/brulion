import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view"
import { type Extension, type Range } from "@codemirror/state"
import {
  isExternalLink,
  resolveNotePath,
  resolveWikilink,
  splitAnchor,
} from "./note-name"
import { linkContext, type LinkContext } from "./markdown-render"
import {
  isRichDocumentTransaction,
  richDocumentFromState,
  richModelPositionToEditor,
} from "./rich-editor"
import type { RichDocument, SourceMapRange } from "./rich-markdown"

function headingLevel(document: RichDocument, range: SourceMapRange): number {
  const lineStart = document.source.lastIndexOf("\n", Math.max(0, range.sourceFrom - 1)) + 1
  const line = document.source.slice(lineStart, document.source.indexOf("\n", lineStart) < 0 ? document.source.length : document.source.indexOf("\n", lineStart))
  return /^(?:[ \t]*)(#{1,6})[ \t]+/.exec(line)?.[1].length ?? 0
}

function blockClass(document: RichDocument, range: SourceMapRange): string[] {
  if (range.block === "heading") {
    const level = headingLevel(document, range)
    return level > 0 ? ["cm-heading", `cm-h${level}`] : ["cm-heading"]
  }
  if (range.block === "quote") return ["cm-blockquote"]
  if (range.block === "unordered-list") return ["cm-list-item"]
  if (range.block === "fence" || range.block === "mermaid") return ["cm-code-block"]
  if (range.block === "table") return ["cm-table"]
  if (range.block === "frontmatter") return ["cm-frontmatter"]
  return []
}

function linkAttributes(
  range: SourceMapRange,
  context: LinkContext
): { className: string; attrs: Record<string, string> } | null {
  const link = range.link
  if (!link) return null
  if (link.kind === "autolink" || link.kind === "markdown") {
    const href = link.kind === "autolink" && /^www\./i.test(link.target) ? `https://${link.target}` : link.target
    const external = isExternalLink(href)
    const { path, anchor } = external ? { path: href, anchor: null } : splitAnchor(href)
    const target = external ? null : resolveNotePath(context.activeNote, path)
    const known = external || (path === "" ? Boolean(context.activeNote) : Boolean(target && context.notePaths.has(target)))
    const attrs: Record<string, string> = { "data-href": external ? href : path, title: external ? href : target ?? path }
    if (anchor) attrs["data-anchor"] = anchor
    return { className: known ? "cm-link" : "cm-link cm-link-broken", attrs }
  }
  const { path, anchor } = splitAnchor(link.target.trim())
  const resolved = path === "" ? context.activeNote || null : resolveWikilink(path, context.notePaths).resolved
  const createPath = path === "" ? context.activeNote : resolveWikilink(path, context.notePaths).createPath
  const attrs: Record<string, string> = { "data-note": resolved ?? createPath, title: resolved ?? createPath }
  if (anchor) attrs["data-anchor"] = anchor
  return { className: resolved ? "cm-link" : "cm-link cm-link-broken", attrs }
}

function modelRangeToEditor(document: RichDocument, range: SourceMapRange): { from: number; to: number } | null {
  if (!range.visible || range.visibleTo <= range.visibleFrom) return null
  try {
    return {
      from: richModelPositionToEditor(document, range.visibleFrom),
      to: richModelPositionToEditor(document, range.visibleTo),
    }
  } catch {
    return null
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const document = richDocumentFromState(view.state)
  if (!document) return Decoration.none
  const context = view.state.facet(linkContext)
  const marks: Range<Decoration>[] = []
  const lines: Range<Decoration>[] = []
  const seenLines = new Set<number>()
  for (const range of document.ranges) {
    const mapped = modelRangeToEditor(document, range)
    const classes = [...blockClass(document, range)]
    for (const mark of range.marks) {
      if (mark === "bold") classes.push("cm-strong")
      else if (mark === "italic") classes.push("cm-em")
      else if (mark === "code") classes.push("cm-inline-code")
    }
    const link = linkAttributes(range, context)
    if (link) classes.push(link.className)
    if (mapped && classes.length > 0) {
      marks.push(Decoration.mark({
        class: [...new Set(classes)].join(" "),
        attributes: link?.attrs,
      }).range(mapped.from, mapped.to))
    }
    if (mapped && classes.some((name) => name === "cm-heading" || name === "cm-blockquote" || name === "cm-list-item" || name === "cm-code-block" || name === "cm-table" || name === "cm-frontmatter")) {
      const lineFrom = view.state.doc.lineAt(mapped.from).from
      if (!seenLines.has(lineFrom)) {
        seenLines.add(lineFrom)
        lines.push(Decoration.line({ class: classes.filter((name) => name.startsWith("cm-") && !["cm-strong", "cm-em", "cm-inline-code", "cm-link", "cm-link-broken"].includes(name)).join(" ") }).range(lineFrom))
      }
    }
  }
  return Decoration.set([...lines, ...marks], true)
}

const richTheme = EditorView.baseTheme({
  ".cm-heading": { fontWeight: "600", lineHeight: "1.3" },
  ".cm-h1": { fontSize: "1.35em" },
  ".cm-h2": { fontSize: "1.15em" },
  ".cm-h3, .cm-h4, .cm-h5, .cm-h6": { fontSize: "1em" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-inline-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.9em",
    background: "var(--code-bg)",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  ".cm-link": { color: "var(--link)", textDecoration: "underline", cursor: "pointer" },
  ".cm-link-broken": { color: "var(--accent-text)", textDecorationStyle: "dashed" },
  ".cm-blockquote": { borderLeft: "3px solid var(--border-strong)", paddingLeft: "0.7em", color: "var(--text-muted)", fontStyle: "italic" },
  ".cm-list-item": { paddingLeft: "0.2em" },
  ".cm-code-block": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: "0.9em", background: "var(--code-bg)" },
})

class RichProjectionRenderer {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view)
  }

  update(update: ViewUpdate): void {
    const contextChanged = update.startState.facet(linkContext) !== update.state.facet(linkContext)
    const modelChanged = update.transactions.some((transaction) => isRichDocumentTransaction(transaction))
    if (update.docChanged || update.viewportChanged || contextChanged || modelChanged) this.decorations = buildDecorations(update.view)
  }
}

/** Decoration-only renderer for a primary rich view. */
export function richRendering(): Extension {
  return [richTheme, ViewPlugin.fromClass(RichProjectionRenderer, {
    decorations: (plugin) => plugin.decorations,
  })]
}
