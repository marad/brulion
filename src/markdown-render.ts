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

export interface SyntaxRanges {
  /** Markup runs (`#`, `*`, `**`, `` ` ``) to replace with nothing. */
  hidden: HiddenRange[]
  /** Content spans to decorate (heading sizes, bold, italic, code). */
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

/** Markup-mark node names whose characters are hidden. */
const MARK_NODES = new Set(["HeaderMark", "EmphasisMark", "CodeMark"])

/**
 * Walk the markdown syntax tree over `[from, to)` and collect the markup runs to
 * hide and the content spans to style. Pure: depends only on the parsed document,
 * never mutates it — so the on-disk bytes are untouched (the file-fidelity moat).
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
      if (cls && node.to > node.from) {
        marks.push({ from: node.from, to: node.to, cls })
        return
      }
      if (!MARK_NODES.has(node.name)) return

      if (node.name === "HeaderMark") {
        // HeaderMark also occurs in Setext headings (the `===`/`---` underline),
        // which this phase doesn't style. Hiding only the ATX `#` run keeps
        // setext markup fully visible rather than hidden-but-unstyled.
        if (!node.node.parent?.name.startsWith("ATXHeading")) return
        let end = node.to
        // The `#`s own only themselves; hide the single space after them too so
        // the heading text starts flush.
        if (doc.sliceString(end, end + 1) === " ") end += 1
        hidden.push({ from: node.from, to: end })
        return
      }

      hidden.push({ from: node.from, to: node.to })
    },
  })

  return { hidden, marks }
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
})

/**
 * The hidden-syntax rendering extension: markdown parser + the decoration plugin
 * + styling. Add it to the editor to make markup invisible and text read as rich
 * content, on every line including the caret line.
 */
export const markdownRendering: Extension = [
  markdown(),
  renderPlugin,
  renderTheme,
]
