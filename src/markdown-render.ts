import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view"
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateField,
} from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { syntaxTree } from "@codemirror/language"

/** A run of characters to hide entirely (the markdown markup). */
export interface HiddenRange {
  from: number
  to: number
}

/** A span of visible text to style as rich content. */
export interface MarkRange {
  from: number
  to: number
  /** CSS class(es) applied to the span. */
  cls: string
}

/** A whole line to style as a block (code block, blockquote, list item). */
export interface LineMark {
  /** The line-start position the line decoration attaches to. */
  from: number
  /** CSS class(es) applied to the line. */
  cls: string
}

export interface SyntaxRanges {
  /** Inline/heading markup runs (`#`, `*`, `**`, `` ` ``) to replace with nothing. */
  hidden: HiddenRange[]
  /** Content spans to decorate (heading sizes, bold, italic, code). */
  marks: MarkRange[]
}

/** Block-construct ranges (fenced code, blockquote, list) — fed to a StateField. */
export interface BlockRanges {
  /** Markup runs to hide (`>`, list markers, and whole fence lines). */
  hidden: HiddenRange[]
  /** Whole lines to decorate as blocks (blockquote, list item). */
  lines: LineMark[]
  /** Content spans to decorate (the code-block body — a span, not a line, so it
   * survives the fence-line collapse that merges the body into the fence's line). */
  marks: MarkRange[]
}

/** Container node name → class applied to its whole range. */
const CONTAINER_CLASS: Record<string, string> = {
  ATXHeading1: "cm-heading cm-h1",
  ATXHeading2: "cm-heading cm-h2",
  ATXHeading3: "cm-heading cm-h3",
  ATXHeading4: "cm-heading cm-h4",
  ATXHeading5: "cm-heading cm-h5",
  ATXHeading6: "cm-heading cm-h6",
  StrongEmphasis: "cm-strong",
  Emphasis: "cm-em",
  InlineCode: "cm-inline-code",
}

/** Markup-mark node names whose characters are hidden (inline + heading). */
const MARK_NODES = new Set(["HeaderMark", "EmphasisMark", "CodeMark"])

/**
 * Walk the markdown syntax tree over `[from, to)` and collect the inline/heading
 * markup runs to hide and the content spans to style. Pure: depends only on the
 * parsed document, never mutates it — so the on-disk bytes are untouched (the
 * file-fidelity moat). Block constructs are handled separately by
 * {@link blockSyntaxRanges}; see the module's two-layer note below.
 */
export function markdownSyntaxRanges(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): SyntaxRanges {
  const hidden: HiddenRange[] = []
  const marks: MarkRange[] = []
  const doc = state.doc

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      const cls = CONTAINER_CLASS[node.name]
      if (!cls) return // only container nodes carry styling; marks come via them

      // Collect this node's own markup-mark children (the `#`/`*`/`` ` `` runs).
      const markChildren = []
      for (let c = node.node.firstChild; c; c = c.nextSibling) {
        if (MARK_NODES.has(c.name)) markChildren.push(c)
      }
      if (!markChildren.length) return

      if (node.name.startsWith("ATXHeading")) {
        // One leading HeaderMark. Only collapse the heading once the marker is
        // completed by a trailing space: a bare `#`/`##` (no space yet) stays
        // visible so the user sees what they're typing and learns the space
        // finishes the heading — instead of the `#` vanishing into a blank line.
        const mark = markChildren[0]
        if (doc.sliceString(mark.to, mark.to + 1) !== " ") return
        const hideEnd = mark.to + 1 // hide the `#` run plus the single space
        // Style only the heading text — never the markers, so the styled span
        // contains no hidden runs (which would offset the drawn selection).
        hidden.push({ from: mark.from, to: hideEnd })
        if (node.to > hideEnd) marks.push({ from: hideEnd, to: node.to, cls })
        return
      }

      // Inline: hide the opening and closing marks; style only the text between.
      const open = markChildren[0]
      const close = markChildren[markChildren.length - 1]
      hidden.push({ from: open.from, to: open.to })
      hidden.push({ from: close.from, to: close.to })
      if (close.from > open.to) marks.push({ from: open.to, to: close.from, cls })
    },
  })

  return { hidden, marks }
}

/**
 * Walk the syntax tree over `[from, to)` and collect the block constructs M2 left
 * raw (FEAT-0016): fenced code, blockquotes, unordered lists. Returns the markup
 * to hide — including whole fence lines, whose hide ranges cross a line break —
 * and the whole lines to style as blocks. Pure, like {@link markdownSyntaxRanges}.
 *
 * Kept separate because collapsing a fence *line* replaces a line break, which
 * changes the editor's vertical layout; CodeMirror forbids such decorations from a
 * ViewPlugin (they must come from a StateField, computed before layout). So inline
 * markup renders viewport-scoped via a plugin, and these blocks render whole-doc
 * via a field — see {@link markdownRendering}.
 */
export function blockSyntaxRanges(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): BlockRanges {
  const hidden: HiddenRange[] = []
  const lines: LineMark[] = []
  const marks: MarkRange[] = []
  const doc = state.doc

  // Emit a `cm-` line decoration for every line a block spans, within the scan
  // window. Used for the (possibly multi-line) blockquote; a single line gets a
  // direct push at its call site.
  const markLines = (start: number, end: number, cls: string) => {
    const first = doc.lineAt(Math.max(start, from)).number
    const last = doc.lineAt(Math.min(end, to)).number
    for (let n = first; n <= last; n++) lines.push({ from: doc.line(n).from, cls })
  }

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === "FencedCode") {
        const codeMarks = []
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name === "CodeMark") codeMarks.push(c)
        }
        // Only collapse a *closed* block (open + close fence). An unclosed block
        // being typed stays visible — don't vanish the ``` the user just typed.
        if (codeMarks.length < 2) return
        const openLine = doc.lineAt(codeMarks[0].from)
        const closeLine = doc.lineAt(codeMarks[codeMarks.length - 1].from)
        const openHideTo = Math.min(openLine.to + 1, doc.length)
        const closeHideFrom = Math.max(closeLine.from - 1, 0)
        if (closeHideFrom <= openHideTo) {
          // No body line between the fences — collapse the whole block as one run.
          hidden.push({ from: node.from, to: node.to })
        } else {
          hidden.push({ from: openLine.from, to: openHideTo })
          hidden.push({ from: closeHideFrom, to: closeLine.to })
          // Style the body as a span, not a line: collapsing the opening fence
          // merges the first body line into the fence's (now empty) line, so a
          // line decoration anchored at the body line start would no longer sit
          // at a visual line start and silently drop. A mark survives the merge.
          marks.push({ from: openHideTo, to: closeHideFrom, cls: "cm-code-block" })
        }
        return
      }

      if (node.name === "Blockquote") {
        // A nested blockquote is already covered by its enclosing one's subtree
        // walk and line span — skip it to avoid duplicate hides and line decos.
        for (let p = node.node.parent; p; p = p.parent) {
          if (p.name === "Blockquote") return
        }
        // QuoteMarks nest inside the inner Paragraph on continuation lines, so
        // walk the whole subtree, not just direct children.
        node.node.cursor().iterate((c) => {
          if (c.name !== "QuoteMark") return
          const hasSpace = doc.sliceString(c.to, c.to + 1) === " "
          hidden.push({ from: c.from, to: hasSpace ? c.to + 1 : c.to })
        })
        markLines(node.from, node.to, "cm-blockquote")
        return
      }

      if (node.name === "ListItem" && node.node.parent?.name === "BulletList") {
        let mark = node.node.firstChild
        while (mark && mark.name !== "ListMark") mark = mark.nextSibling
        if (!mark) return
        const hasSpace = doc.sliceString(mark.to, mark.to + 1) === " "
        hidden.push({ from: mark.from, to: hasSpace ? mark.to + 1 : mark.to })
        lines.push({ from: doc.lineAt(mark.from).from, cls: "cm-list-item" })
      }
    },
  })

  return { hidden, lines, marks }
}

const hideMark = Decoration.replace({})

/** Build the display decorations and the (separate) atomic hidden set for a view. */
function buildDecorations(view: EditorView): {
  all: DecorationSet
  hidden: DecorationSet
} {
  const all: Range<Decoration>[] = []
  const hidden: Range<Decoration>[] = []
  // A node straddling the gap between two visible ranges is reported (with its
  // full bounds) by both iterations; dedupe so the same run isn't decorated
  // twice — duplicate replace ranges would otherwise overlap and throw.
  const seen = new Set<string>()

  for (const { from, to } of view.visibleRanges) {
    const { hidden: hides, marks } = markdownSyntaxRanges(view.state, from, to)
    for (const m of marks) {
      const key = `m:${m.from}:${m.to}:${m.cls}`
      if (seen.has(key)) continue
      seen.add(key)
      all.push(Decoration.mark({ class: m.cls }).range(m.from, m.to))
    }
    for (const h of hides) {
      const key = `h:${h.from}:${h.to}`
      if (seen.has(key)) continue
      seen.add(key)
      const r = hideMark.range(h.from, h.to)
      all.push(r)
      hidden.push(r)
    }
  }

  return {
    all: Decoration.set(all, true),
    hidden: Decoration.set(hidden, true),
  }
}

/**
 * ViewPlugin that hides markdown markup and styles its content across the visible
 * viewport. Rebuilds only on document or viewport change — never on caret moves,
 * because markup is hidden on every line (no Obsidian-style reveal-on-cursor).
 */
const renderPlugin = ViewPlugin.fromClass(
  class {
    all: DecorationSet
    hidden: DecorationSet

    constructor(view: EditorView) {
      this.all = Decoration.none
      this.hidden = Decoration.none
      this.rebuild(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.rebuild(update.view)
      }
    }

    rebuild(view: EditorView) {
      const built = buildDecorations(view)
      this.all = built.all
      this.hidden = built.hidden
    }
  },
  {
    decorations: (v) => v.all,
    // Hidden markup runs are atomic so the caret steps over the invisible
    // characters instead of landing between them.
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.hidden ?? RangeSet.empty,
      ),
  },
)

/** Build the block decorations (line styles + fence/marker hides) for a state. */
function buildBlockDecorations(state: EditorState): {
  all: DecorationSet
  hidden: DecorationSet
} {
  const { hidden: hides, lines, marks } = blockSyntaxRanges(state)
  const all: Range<Decoration>[] = []
  const hidden: Range<Decoration>[] = []
  for (const l of lines) all.push(Decoration.line({ class: l.cls }).range(l.from))
  for (const m of marks) all.push(Decoration.mark({ class: m.cls }).range(m.from, m.to))
  for (const h of hides) {
    const r = hideMark.range(h.from, h.to)
    all.push(r)
    hidden.push(r)
  }
  return {
    all: Decoration.set(all, true),
    hidden: Decoration.set(hidden, true),
  }
}

/**
 * StateField that renders the block constructs (FEAT-0016) over the whole
 * document. A field (not a plugin) because collapsing a fence line replaces a line
 * break — a layout-changing decoration CodeMirror only accepts from a field.
 * Recomputes on document change; block constructs are few, so a whole-doc scan is
 * cheap. Its hide runs are atomic, like the inline plugin's, so the caret steps
 * over collapsed markers.
 */
const blockRenderingField = StateField.define<{
  all: DecorationSet
  hidden: DecorationSet
}>({
  create: (state) => buildBlockDecorations(state),
  update(value, tr) {
    return tr.docChanged ? buildBlockDecorations(tr.state) : value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.all),
    EditorView.atomicRanges.of(
      (view) => view.state.field(field, false)?.hidden ?? RangeSet.empty,
    ),
  ],
})

/** Visual styling for the rendered rich-text spans. */
const renderTheme = EditorView.baseTheme({
  ".cm-heading": { fontWeight: "600", lineHeight: "1.3" },
  ".cm-h1": { fontSize: "1.8em" },
  ".cm-h2": { fontSize: "1.5em" },
  ".cm-h3": { fontSize: "1.25em" },
  ".cm-h4": { fontSize: "1.1em" },
  ".cm-h5": { fontSize: "1em" },
  ".cm-h6": { fontSize: "0.9em", opacity: "0.8" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-inline-code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.9em",
    background: "rgba(0,0,0,0.05)",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
  },
  // Block constructs (FEAT-0016). Code-block lines read as one monospace slab;
  // contiguous lines share the background so the block looks continuous.
  ".cm-code-block": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.9em",
    background: "rgba(0,0,0,0.05)",
  },
  ".cm-blockquote": {
    borderLeft: "3px solid rgba(0,0,0,0.2)",
    paddingLeft: "0.8em",
    color: "rgba(0,0,0,0.65)",
    fontStyle: "italic",
  },
  // The `*`/`-` marker is hidden; draw a real bullet in its place.
  ".cm-list-item": { paddingLeft: "1.4em", textIndent: "-1.4em" },
  ".cm-list-item::before": { content: '"•  "', opacity: "0.6" },
})

/**
 * The hidden-syntax rendering extension: markdown parser + the decoration plugin
 * + styling. Add it to the editor to make markup invisible and text read as rich
 * content, on every line including the caret line.
 */
export const markdownRendering: Extension = [
  markdown(),
  renderPlugin,
  blockRenderingField,
  renderTheme,
]
