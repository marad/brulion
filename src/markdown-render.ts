import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
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

/** An unordered-list marker run to replace with a fixed-width bullet widget. */
export interface BulletMark {
  /** Start of the marker run (the `*`/`-`). */
  from: number
  /** End of the run, past the single trailing space (the whole `* `/`- ` run). */
  to: number
  /** The marker character that was typed — selects the glyph (`•` vs `–`). */
  marker: "*" | "-"
}

/** Block-construct ranges (fenced code, blockquote, list) — fed to a StateField. */
export interface BlockRanges {
  /** Markup runs to hide (`>`, the fence text on each fence line). */
  hidden: HiddenRange[]
  /** Whole lines to decorate as blocks (code block, blockquote). */
  lines: LineMark[]
  /**
   * List-marker runs to replace with a bullet widget. Replacing the run (rather
   * than hiding it and drawing a `::before` glyph over the emptied line) keeps the
   * caret and the glyph in sync as the marker is typed — FEAT-0019.
   */
  bullets: BulletMark[]
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
 * to hide and the whole lines to style as blocks. Pure, like
 * {@link markdownSyntaxRanges}. None of the hides cross a line break (fence lines
 * are emptied in place, not collapsed), so the line decorations always anchor at a
 * real visual line start.
 *
 * Kept separate from the inline plugin so the (rare, small) block scan can run over
 * the whole document — letting it style every line of a block — while inline markup
 * stays viewport-scoped for responsiveness; see {@link markdownRendering}.
 */
export function blockSyntaxRanges(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): BlockRanges {
  const hidden: HiddenRange[] = []
  const lines: LineMark[] = []
  const bullets: BulletMark[] = []
  const doc = state.doc

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === "FencedCode") {
        const codeMarks = []
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name === "CodeMark") codeMarks.push(c)
        }
        // Only render a *closed* block (open + close fence). An unclosed block
        // being typed stays visible — don't vanish the ``` the user just typed.
        if (codeMarks.length < 2) return
        const openLine = doc.lineAt(codeMarks[0].from)
        const closeLine = doc.lineAt(codeMarks[codeMarks.length - 1].from)
        // Hide each fence's text in place (no newline eaten), leaving the fence
        // lines as empty styled rows — the top/bottom padding of the code box.
        hidden.push({ from: openLine.from, to: openLine.to })
        hidden.push({ from: closeLine.from, to: closeLine.to })
        for (let n = openLine.number; n <= closeLine.number; n++) {
          const edge =
            n === openLine.number
              ? " cm-code-top"
              : n === closeLine.number
                ? " cm-code-bottom"
                : ""
          lines.push({ from: doc.line(n).from, cls: "cm-code-block" + edge })
        }
        return
      }

      if (node.name === "Blockquote") {
        // A nested blockquote sits on lines the enclosing one already scans — skip
        // it so each `>` isn't hidden twice (which would overlap and throw).
        for (let p = node.node.parent; p; p = p.parent) {
          if (p.name === "Blockquote") return
        }
        // Hide the leading `>` run on each line structurally rather than by
        // QuoteMark node: the grammar sometimes drops the node (e.g. a `-`
        // continuation folds the line into a Setext heading), but inside a
        // confirmed blockquote the leading `>` is always the marker.
        const last = doc.lineAt(node.to).number
        for (let n = doc.lineAt(node.from).number; n <= last; n++) {
          const line = doc.line(n)
          let p = line.from
          while (p < line.to && doc.sliceString(p, p + 1) === " ") p++
          while (p < line.to && doc.sliceString(p, p + 1) === ">") {
            const space = doc.sliceString(p + 1, p + 2) === " "
            const end = space ? p + 2 : p + 1
            hidden.push({ from: p, to: end })
            p = end
            while (p < line.to && doc.sliceString(p, p + 1) === " ") p++
          }
          lines.push({ from: line.from, cls: "cm-blockquote" })
        }
        return
      }

      if (node.name === "ListItem" && node.node.parent?.name === "BulletList") {
        let mark = node.node.firstChild
        while (mark && mark.name !== "ListMark") mark = mark.nextSibling
        if (!mark) return
        // Only render once a trailing space completes the marker — a bare `*`/`-`
        // stays a literal visible char (the bare-`#` heading rule, FEAT-0019 AC-2);
        // that's also when there's nothing drawn over the marker to disagree with
        // the caret as it's typed.
        if (doc.sliceString(mark.to, mark.to + 1) !== " ") return
        // Replace the whole `* `/`- ` run with a bullet widget (not hide-plus-
        // `::before`) so caret and glyph stay in sync — FEAT-0019.
        const marker = doc.sliceString(mark.from, mark.to) === "*" ? "*" : "-"
        bullets.push({ from: mark.from, to: mark.to + 1, marker })
      }
    },
  })

  return { hidden, lines, bullets }
}

const hideMark = Decoration.replace({})

/**
 * Draws a list bullet in place of the `*`/`- ` marker run it replaces. A
 * fixed-width inline-block so the content always starts at the same x and the
 * caret (which maps around the replaced range) lines up with the glyph — the
 * FEAT-0019 fix for the marker/caret drift. `*` renders as a filled disc, `-` as
 * an en-dash, so mixed markdown still reads distinctly.
 */
class BulletWidget extends WidgetType {
  constructor(readonly marker: "*" | "-") {
    super()
  }

  eq(other: BulletWidget) {
    return other.marker === this.marker
  }

  toDOM() {
    const span = document.createElement("span")
    span.className =
      this.marker === "*" ? "cm-bullet cm-bullet-disc" : "cm-bullet cm-bullet-dash"
    span.textContent = this.marker === "*" ? "•" : "–"
    return span
  }
}

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
  const { hidden: hides, lines, bullets } = blockSyntaxRanges(state)
  const all: Range<Decoration>[] = []
  const hidden: Range<Decoration>[] = []
  for (const l of lines) all.push(Decoration.line({ class: l.cls }).range(l.from))
  for (const h of hides) {
    const r = hideMark.range(h.from, h.to)
    all.push(r)
    hidden.push(r)
  }
  // Replace each list marker with its bullet widget, and make the run atomic so
  // the caret steps over it onto the item text (FEAT-0016 AC-7 / FEAT-0019).
  for (const b of bullets) {
    const r = Decoration.replace({ widget: new BulletWidget(b.marker) }).range(
      b.from,
      b.to,
    )
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
  // Block constructs (FEAT-0016). A fenced block reads as one full-width box:
  // every line shares the background; the (emptied) fence lines are its top/bottom
  // padding rows, which carry the rounded corners.
  ".cm-code-block": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.9em",
    background: "rgba(0,0,0,0.05)",
    paddingLeft: "0.8em",
    paddingRight: "0.8em",
  },
  ".cm-code-top": { borderRadius: "6px 6px 0 0" },
  ".cm-code-bottom": { borderRadius: "0 0 6px 6px" },
  ".cm-blockquote": {
    borderLeft: "3px solid rgba(0,0,0,0.2)",
    paddingLeft: "0.7em",
    color: "rgba(0,0,0,0.65)",
    fontStyle: "italic",
  },
  // The `*`/`- ` marker run is replaced by this widget (FEAT-0019). A fixed-width
  // inline-block sized to the marker keeps the content's left edge stable and the
  // caret aligned with the glyph; flush with the text's left edge (no negative
  // indent overhang). `*` and `-` get distinct glyphs so mixed markdown reads
  // unambiguously.
  ".cm-bullet": {
    display: "inline-block",
    width: "1.4em",
    opacity: "0.6",
  },
})

/**
 * The hidden-syntax rendering extension: markdown parser + the decoration plugin
 * + styling. Add it to the editor to make markup invisible and text read as rich
 * content, on every line including the caret line.
 */
export const markdownRendering: Extension = [
  // `addKeymap: false`: don't let the language install its own Prec.high Enter/
  // Backspace bindings — Enter is owned by our markdown-aware command (FEAT-0018,
  // wired in editor.ts), and a Prec.high library binding would shadow it.
  markdown({ addKeymap: false }),
  renderPlugin,
  blockRenderingField,
  renderTheme,
]
