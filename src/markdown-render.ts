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
  Facet,
  type Range,
  RangeSet,
  StateField,
  type Text,
} from "@codemirror/state"
import { markdown } from "@codemirror/lang-markdown"
import { languages } from "@codemirror/language-data"
import { Autolink } from "@lezer/markdown"
import { collectCodeMarks, codeTokenTheme } from "./code-highlight"
import { syntaxTree } from "@codemirror/language"
import type { SyntaxNode } from "@lezer/common"
import {
  isExternalLink,
  normalizeNoteName,
  resolveNotePath,
  resolveWikilink,
  splitAnchor,
} from "./note-name"
import { WIKILINK_RE } from "./wikilink"
import { type FrontmatterRange, frontmatterRange } from "./frontmatter"

/**
 * What the link decorator needs to tell a valid internal link from a broken one
 * (FEAT-0025): the note currently open (to resolve a link relative to its folder)
 * and the set of existing note paths. Supplied by the app via the {@link
 * linkContext} facet; defaults to "nothing known" (every internal link broken)
 * when unset.
 */
export interface LinkContext {
  activeNote: string
  notePaths: ReadonlySet<string>
}

/** Facet carrying the {@link LinkContext}; the inline renderer reads the first
 * provided value (the app configures exactly one), else an empty default. */
export const linkContext = Facet.define<LinkContext, LinkContext>({
  combine: (values) => values[0] ?? { activeNote: "", notePaths: new Set() },
})

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
  /** Extra DOM attributes for the span (e.g. a link's `data-href`). */
  attrs?: Record<string, string>
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
  const links = state.facet(linkContext)
  const sel = state.selection.main

  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name === "Link") {
        collectLink(node.node, doc, links, sel, hidden, marks)
        return
      }

      // A bare autolink (FEAT-0026): a `URL` node sitting directly in text. A
      // Link's own `(url)` and an Image's `(src)` carry a `URL` child too, so
      // exclude those parents — only standalone URLs autolink. Web URLs only;
      // emails the parser also matches are left as plain text.
      if (node.name === "URL") {
        const parent = node.node.parent?.name
        if (parent !== "Link" && parent !== "Image") collectAutolink(node.node, doc, marks)
        return
      }

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

  // Wikilinks (FEAT-0027) aren't CommonMark, so the tree above doesn't see them —
  // scan the text for `[[…]]` separately.
  collectWikilinks(doc.sliceString(from, to), from, sel, links, hidden, marks)

  return { hidden, marks }
}

/**
 * Scan `slice` (the text of `[offset, offset+slice.length)`) for wikilinks and
 * decorate each (FEAT-0027): hide `[[` (through the `|` when aliased) and the
 * trailing `]]`, and style the label (`alias` else `target`) as a link, broken
 * when the target resolves to no known note. The link carries the resolved note
 * path (or the create path when missing) in `data-note`, so a follow acts on it
 * directly. A wikilink the selection touches is left raw for editing (FEAT-0026).
 */
function collectWikilinks(
  slice: string,
  offset: number,
  sel: { from: number; to: number },
  links: LinkContext,
  hidden: HiddenRange[],
  marks: MarkRange[],
): void {
  WIKILINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = WIKILINK_RE.exec(slice)) !== null) {
    const start = offset + m.index
    const end = start + m[0].length
    if (sel.from < end && sel.to > start) continue // selection touches it — reveal for editing
    const [, rawTarget, rawAlias] = m
    // Split off a section anchor (FEAT-0061); the path part is the note, validated/
    // resolved as before. A bare `#sec` (empty path) is a same-note jump and skips
    // note validation. `normalizeNoteName` is the same validator note creation uses.
    const { path: wlPath, anchor } = splitAnchor(rawTarget.trim())
    if (wlPath !== "" && !normalizeNoteName(wlPath).ok) continue
    // The label is the alias when present, else the target; it runs after `[[`
    // (or `[[target|`) up to `]]`. Trim its surrounding whitespace into the hidden
    // runs so `[[foo| bar ]]` doesn't render padding inside the styled link.
    const label = rawAlias ?? rawTarget
    const runStart = rawAlias === undefined ? start + 2 : start + 2 + rawTarget.length + 1
    const labelStart = runStart + (label.length - label.trimStart().length)
    const labelEnd = end - 2 - (label.length - label.trimEnd().length)
    if (labelEnd <= labelStart) continue // label is all whitespace
    // Empty path → the open note (a same-note `[[#sec]]` jump); else resolve normally.
    let resolved: string | null
    let note: string
    if (wlPath === "") {
      resolved = links.activeNote || null
      note = links.activeNote
    } else {
      const r = resolveWikilink(wlPath, links.notePaths)
      resolved = r.resolved
      note = r.resolved ?? r.createPath
    }
    hidden.push({ from: start, to: labelStart })
    hidden.push({ from: labelEnd, to: end })
    const attrs: Record<string, string> = { "data-note": note, title: note }
    if (anchor) attrs["data-anchor"] = anchor
    marks.push({
      from: labelStart,
      to: labelEnd,
      cls: resolved ? "cm-link" : "cm-link cm-link-broken",
      attrs,
    })
  }
}

/**
 * Render an inline markdown link `[text](url)` (FEAT-0025): hide the `[` and the
 * `](url)` runs and style the text as a link, carrying the raw `url` in
 * `data-href` so a Ctrl/Cmd+click can act on it. An internal link whose resolved
 * target is not a known note is styled broken. Shortcut/reference links (no URL
 * child) and empty-text links are left raw — there'd be nothing to click.
 */
function collectLink(
  node: SyntaxNode,
  doc: Text,
  links: LinkContext,
  sel: { from: number; to: number },
  hidden: HiddenRange[],
  marks: MarkRange[],
): void {
  const linkMarks: SyntaxNode[] = []
  let url: SyntaxNode | null = null
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === "LinkMark") linkMarks.push(c)
    else if (c.name === "URL") url = c
  }
  if (!url || linkMarks.length < 4) return // not an inline [text](url) link
  const open = linkMarks[0] // "["
  const closeBracket = linkMarks[1] // "]"
  const lastMark = linkMarks[linkMarks.length - 1] // ")"
  if (closeBracket.from <= open.to) return // empty link text — leave it raw
  // Reveal for editing (FEAT-0026): while the selection touches the link's span,
  // emit nothing so the raw `[text](url)` shows and the URL can be edited. Using
  // overlap (not just the caret head) means a selection that *ends* outside the
  // link still reveals it, so you never delete hidden markup you can't see. An
  // empty caret exactly at `open.from`/`lastMark.to` is adjacent, not overlapping.
  if (sel.from < lastMark.to && sel.to > open.from) return

  const href = doc.sliceString(url.from, url.to)
  // Split off a section anchor for internal links only (FEAT-0061); an external
  // URL's `#fragment` is a real fragment, not a note anchor — leave it whole.
  const { path, anchor } = isExternalLink(href) ? { path: href, anchor: null } : splitAnchor(href)
  const { cls, title } = linkInfo(path, links)
  hidden.push({ from: open.from, to: open.to }) // "["
  hidden.push({ from: closeBracket.from, to: lastMark.to }) // "](url)"
  const attrs: Record<string, string> = { "data-href": path, title }
  if (anchor) attrs["data-anchor"] = anchor
  marks.push({ from: open.to, to: closeBracket.from, cls, attrs })
}

/**
 * Render a bare autolink (FEAT-0026): a `URL` node sitting directly in text. Only
 * web URLs (`http(s)://`, `www.`) are linkified — emails the parser also matches
 * are left plain. A `www.` url is normalized to `https://www.…` in the stored
 * href so the follow path treats it as external. No markup is hidden: the URL
 * text is the visible link.
 */
function collectAutolink(node: SyntaxNode, doc: Text, marks: MarkRange[]): void {
  const text = doc.sliceString(node.from, node.to)
  if (!/^(https?:\/\/|www\.)/i.test(text)) return // email or other — leave plain
  const href = /^www\./i.test(text) ? "https://" + text : text
  marks.push({
    from: node.from,
    to: node.to,
    cls: "cm-link",
    attrs: { "data-href": href, title: href },
  })
}

/**
 * The class and hover-title for an inline link, resolved once. An external link
 * is `cm-link` with the url as its title; an internal one resolves against the
 * folder — its title is the resolved note path and it gains `cm-link-broken` when
 * that path isn't a known note (FEAT-0025 styling, FEAT-0026 title).
 */
function linkInfo(href: string, links: LinkContext): { cls: string; title: string } {
  if (isExternalLink(href)) return { cls: "cm-link", title: href }
  if (href === "") return { cls: "cm-link", title: "this note" } // same-note anchor (FEAT-0061)
  const target = resolveNotePath(links.activeNote, href)
  const known = !!target && links.notePaths.has(target)
  return { cls: known ? "cm-link" : "cm-link cm-link-broken", title: target ?? href }
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
  // Any selection range overlapping a block reveals it (strict, like the link/Mermaid
  // reveals); checks all ranges so a multi-cursor reveals each block it touches.
  const revealed = (a: number, b: number) =>
    state.selection.ranges.some((r) => r.from < b && r.to > a)

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
        // Hide each fence's text in place (no newline eaten), leaving the fence lines
        // as empty styled rows — the top/bottom padding of the code box. But while the
        // selection is inside the block (FEAT-0064), reveal the fence text so the info
        // string is editable in place. The code-box line styling below stays either way.
        if (!revealed(openLine.from, closeLine.to)) {
          hidden.push({ from: openLine.from, to: openLine.to })
          hidden.push({ from: closeLine.from, to: closeLine.to })
        }
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

/** True when `[from, to)` overlaps a detected frontmatter block — those bytes are
 * the frontmatter renderer's (FEAT-0042), so the markdown layer leaves them raw
 * (else its emphasis/heading hiding would leak into the expanded raw YAML). */
function inFrontmatter(fm: FrontmatterRange | null, from: number, to: number): boolean {
  return fm !== null && from < fm.to && to > fm.from
}

/** Build the display decorations and the (separate) atomic hidden set for a view. */
function buildDecorations(view: EditorView): {
  all: DecorationSet
  hidden: DecorationSet
} {
  const all: Range<Decoration>[] = []
  const hidden: Range<Decoration>[] = []
  const fm = frontmatterRange(view.state)
  // A node straddling the gap between two visible ranges is reported (with its
  // full bounds) by both iterations; dedupe so the same run isn't decorated
  // twice — duplicate replace ranges would otherwise overlap and throw.
  const seen = new Set<string>()

  for (const { from, to } of view.visibleRanges) {
    const { hidden: hides, marks } = markdownSyntaxRanges(view.state, from, to)
    for (const m of marks) {
      if (inFrontmatter(fm, m.from, m.to)) continue
      const key = `m:${m.from}:${m.to}:${m.cls}`
      if (seen.has(key)) continue
      seen.add(key)
      all.push(Decoration.mark({ class: m.cls, attributes: m.attrs }).range(m.from, m.to))
    }
    // Code-block syntax colours (FEAT-0049): mark decorations over the nested code
    // tokens, scoped to each fenced block's range so prose is never recoloured.
    for (const c of collectCodeMarks(view.state, from, to)) {
      if (inFrontmatter(fm, c.from, c.to)) continue
      if (c.from >= c.to) continue
      const key = `c:${c.from}:${c.to}:${c.cls}`
      if (seen.has(key)) continue
      seen.add(key)
      all.push(Decoration.mark({ class: c.cls }).range(c.from, c.to))
    }
    for (const h of hides) {
      if (inFrontmatter(fm, h.from, h.to)) continue
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
 * viewport. Rebuilds on document, viewport, link-context, and selection change.
 * The selection trigger exists only for the link caret-reveal (FEAT-0026); all
 * other markup (headings, emphasis) ignores the caret and stays always-hidden, so
 * there is no Obsidian-style reveal-on-cursor for them.
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
      // Also rebuild when the link context changes (active note / known notes),
      // so a link's broken-vs-valid styling tracks the real folder (FEAT-0025);
      // and on selection change, so a link reveals its markup when the caret
      // enters it and re-hides when it leaves (FEAT-0026). The reveal is
      // links-only — heading/emphasis hiding ignores the caret — so the M2
      // "no reveal on the cursor line" rule still holds for everything else.
      const linkCtxChanged =
        update.startState.facet(linkContext) !== update.state.facet(linkContext)
      // A fenced block's language loads lazily (FEAT-0049): when it resolves the
      // parser re-parses and `syntaxTree` changes without a doc/viewport edit, so
      // rebuild on a tree change too — else the code colours wouldn't appear until
      // the next keystroke or scroll.
      const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        linkCtxChanged ||
        treeChanged
      ) {
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
  const fm = frontmatterRange(state)
  const all: Range<Decoration>[] = []
  const hidden: Range<Decoration>[] = []
  for (const l of lines) {
    // A line decoration attaches at one offset (the line start); it's inside the
    // block when that offset falls within the range.
    if (fm !== null && l.from >= fm.from && l.from < fm.to) continue
    all.push(Decoration.line({ class: l.cls }).range(l.from))
  }
  for (const h of hides) {
    if (inFrontmatter(fm, h.from, h.to)) continue
    const r = hideMark.range(h.from, h.to)
    all.push(r)
    hidden.push(r)
  }
  // Replace each list marker with its bullet widget, and make the run atomic so
  // the caret steps over it onto the item text (FEAT-0016 AC-7 / FEAT-0019).
  for (const b of bullets) {
    if (inFrontmatter(fm, b.from, b.to)) continue
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
    // Rebuild on selection too (FEAT-0064): the fenced-block fence lines reveal/hide
    // as the caret enters/leaves the block. This is a whole-doc scan per selection
    // move (unlike the viewport-scoped inline plugin), but block constructs are few so
    // it's cheap at notepad scale — and the Mermaid field already rebuilds on selection.
    return tr.docChanged || tr.selection ? buildBlockDecorations(tr.state) : value
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
  // Links (FEAT-0025): styled text, markup hidden. A broken internal link (no
  // such note) is muted red with a dashed underline so it reads as "go nowhere".
  ".cm-link": {
    color: "#2f6f9a",
    textDecoration: "underline",
    textDecorationColor: "rgba(47,111,154,0.4)",
    cursor: "pointer",
  },
  // While Ctrl/Cmd is held the click places the caret (edit), not follows, so the
  // cursor over a link reverts to the text caret to signal that (FEAT-0026).
  ".cm-mod-held .cm-link": { cursor: "text" },
  ".cm-link-broken": {
    color: "#9a3b2f",
    textDecorationStyle: "dashed",
    textDecorationColor: "rgba(154,59,47,0.5)",
  },
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
  // `Autolink`: the one GFM extension we want — bare web URLs become `URL` nodes
  // the renderer linkifies (FEAT-0026). Not the rest of GFM (tables, etc.).
  // `codeLanguages`: a fenced block whose info string names a known language
  // (FEAT-0049) is parsed by that language; parsers load lazily on first use.
  markdown({ addKeymap: false, extensions: [Autolink], codeLanguages: languages }),
  renderPlugin,
  blockRenderingField,
  renderTheme,
  codeTokenTheme, // colours for the code-token marks emitted in buildDecorations (FEAT-0049)
]
