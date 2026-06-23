import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view"
import {
  type EditorState,
  type Extension,
  type Range,
  RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state"
import { ProgrammaticLoad } from "./editor-load"

/** The byte range of a leading frontmatter block: the document start through the
 * end of the closing delimiter line. */
export interface FrontmatterRange {
  from: number
  to: number
}

/**
 * Detect a leading YAML frontmatter block (FEAT-0042). A block is recognised
 * structurally — not via the markdown parser — by the Obsidian/Jekyll/pandoc
 * convention: the document's first line is exactly `---`, closed by a later line
 * that is exactly `---` or `...`. Returns the range from the document start
 * through the end of that closing line, or `null` when there is no leading `---`
 * or no closing delimiter yet (an unclosed block stays raw). Pure: reads the
 * document only, mutates nothing.
 */
export function frontmatterRange(state: EditorState): FrontmatterRange | null {
  const doc = state.doc
  if (doc.lines < 2) return null // need an opening and a closing line
  // `trimEnd` tolerates a trailing `\r` (CRLF files) and stray trailing spaces;
  // a leading-space line is left as-is so an indented `---` is not a delimiter.
  if (doc.line(1).text.trimEnd() !== "---") return null
  for (let n = 2; n <= doc.lines; n++) {
    const t = doc.line(n).text.trimEnd()
    if (t === "---" || t === "...") return { from: 0, to: doc.line(n).to }
  }
  return null // no closing delimiter yet — stays raw, like an unclosed fence
}

/** Effect that toggles the frontmatter region between collapsed and expanded. */
export const toggleFrontmatter = StateEffect.define<void>()

/** Class shared by the collapsed chip and the expanded header — the click hook. */
const TOGGLE_CLASS = "cm-frontmatter-toggle"

/**
 * The clickable `metadata` control. Collapsed it is the chip that *replaces* the
 * whole block (`▸ metadata`); expanded it is the header above the revealed raw
 * text (`▾ metadata`) that collapses it again. Both carry {@link TOGGLE_CLASS} so
 * one mousedown handler drives the toggle.
 */
class ToggleWidget extends WidgetType {
  constructor(readonly expanded: boolean) {
    super()
  }

  eq(other: ToggleWidget) {
    return other.expanded === this.expanded
  }

  toDOM() {
    const span = document.createElement("span")
    span.className =
      TOGGLE_CLASS + (this.expanded ? " cm-frontmatter-header" : " cm-frontmatter-chip")
    span.textContent = (this.expanded ? "▾ " : "▸ ") + "metadata"
    return span
  }

  // Let the click reach the editor's mousedown handler (which dispatches the
  // toggle); a widget swallows its own events by default.
  ignoreEvent() {
    return false
  }
}

interface FrontmatterState {
  collapsed: boolean
  deco: DecorationSet
  /** The collapsed chip's range, made atomic so the caret steps over it. */
  atomic: DecorationSet
}

/** Build the decorations for the current document at the given collapse state. */
function buildFrontmatter(state: EditorState, collapsed: boolean): FrontmatterState {
  const r = frontmatterRange(state)
  if (!r) return { collapsed, deco: Decoration.none, atomic: RangeSet.empty }

  if (collapsed) {
    // Replace the whole block with one block-level chip; same range made atomic
    // so the caret never lands inside the hidden frontmatter (AC-8).
    const chip = Decoration.replace({ widget: new ToggleWidget(false), block: true }).range(
      r.from,
      r.to,
    )
    return { collapsed, deco: Decoration.set([chip]), atomic: Decoration.set([chip]) }
  }

  // Expanded: a collapse header above the block, plus a subtle box on each raw
  // line. Nothing is hidden or made atomic — the user edits the raw text (AC-5).
  const deco: Range<Decoration>[] = [
    Decoration.widget({ widget: new ToggleWidget(true), block: true, side: -1 }).range(r.from),
  ]
  const last = state.doc.lineAt(r.to).number
  for (let n = state.doc.lineAt(r.from).number; n <= last; n++) {
    deco.push(Decoration.line({ class: "cm-frontmatter-line" }).range(state.doc.line(n).from))
  }
  return { collapsed, deco: Decoration.set(deco, true), atomic: RangeSet.empty }
}

/**
 * Renders a leading frontmatter block as a collapsed/expandable region. A
 * `StateField` (not a viewport plugin) because the collapsed chip is a
 * block-level, layout-changing decoration — which CodeMirror only accepts from a
 * field. Starts collapsed, flips on {@link toggleFrontmatter}, and resets to
 * collapsed whenever a note is loaded programmatically (so switching notes never
 * carries one note's expanded state to the next — AC-9).
 */
const frontmatterField = StateField.define<FrontmatterState>({
  create: (state) => buildFrontmatter(state, true),
  update(value, tr) {
    let collapsed = value.collapsed
    if (tr.annotation(ProgrammaticLoad)) collapsed = true
    for (const e of tr.effects) if (e.is(toggleFrontmatter)) collapsed = !collapsed
    if (tr.docChanged || collapsed !== value.collapsed) {
      return buildFrontmatter(tr.state, collapsed)
    }
    return value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (v) => v.deco),
    EditorView.atomicRanges.of(
      (view) => view.state.field(field, false)?.atomic ?? RangeSet.empty,
    ),
  ],
})

/** Plain left-click on the chip/header toggles the region. A modifier or a
 * non-left button falls through so caret placement / context menu still work. */
const frontmatterClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey) return false
    const target = event.target as HTMLElement | null
    if (!target?.closest("." + TOGGLE_CLASS)) return false
    event.preventDefault()
    view.dispatch({ effects: toggleFrontmatter.of() })
    return true
  },
})

const frontmatterTheme = EditorView.baseTheme({
  // A small, muted, clickable pill so the metadata reads as chrome, not content.
  ".cm-frontmatter-toggle": {
    display: "inline-block",
    cursor: "pointer",
    fontSize: "0.8em",
    color: "rgba(0,0,0,0.55)",
    background: "rgba(0,0,0,0.04)",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: "6px",
    padding: "0.1em 0.6em",
    margin: "0.15em 0",
    userSelect: "none",
  },
  ".cm-frontmatter-toggle:hover": { background: "rgba(0,0,0,0.07)" },
  // The expanded raw lines, set off as a region.
  ".cm-frontmatter-line": {
    background: "rgba(0,0,0,0.03)",
    borderLeft: "2px solid rgba(0,0,0,0.12)",
  },
})

/**
 * The frontmatter rendering extension: the collapse/expand state field, the click
 * handler, and the styling. Add it to the editor to render a leading frontmatter
 * block as a discreet, expandable "metadata" region. Decoration only — the
 * document bytes are untouched (the file-fidelity moat).
 */
export const frontmatterRendering: Extension = [
  frontmatterField,
  frontmatterClick,
  frontmatterTheme,
]
