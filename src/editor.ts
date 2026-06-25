import { EditorView, keymap, highlightSpecialChars, drawSelection } from "@codemirror/view"
import { ChangeSet, Compartment, EditorState } from "@codemirror/state"
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands"
import { autocompletion, completionKeymap } from "@codemirror/autocomplete"
import { deleteMarkupBackward } from "@codemirror/lang-markdown"
import { vim } from "@replit/codemirror-vim"
import { markdownRendering, linkContext, type LinkContext } from "./markdown-render"
import { frontmatterRendering } from "./frontmatter"
import { headingSlug } from "./note-name"
import { mermaidRendering } from "./mermaid-render"
import { tableRendering } from "./table-render"
import { ProgrammaticLoad } from "./editor-load"
import { diffRange } from "./text-diff"
import {
  markdownCommands,
  continueOrExitMarkup,
  deleteMarkerSpaceBackward,
} from "./markdown-commands"
import { slashCommands } from "./slash-commands"
import { wikilinkCompletions } from "./link-complete"
import { contextMenu } from "./context-menu"
import { selectionToolbar } from "./selection-toolbar"
import { vimCaretGuard } from "./vim-caret"
import { copyMarkdown } from "./copy-markdown"
import { installVimMarkdownYank } from "./vim-yank"

// Route Vim's yank through the same markdown serializer as clipboard copy/cut
// (FEAT-0046). Global + idempotent; only ever invoked while Vim mode is active.
installVimMarkdownYank()

/** Clean, prose-friendly typography: proportional font, readable measure,
 * comfortable spacing, no code-like gutter. No syntax hiding — that is M2.
 * `--font-stack` is defined in styles.css (loaded by main.ts). */
const typography = EditorView.theme({
  // Base size is settings-driven via `--editor-font-size` (M16/FEAT-0047); the
  // fallback is the historical 16px, used before a folder (hence settings) loads.
  // Headings are `em`-relative, so this one knob scales the whole hierarchy.
  // Background + text track the theme tokens (M18/FEAT-0065) so the editing surface
  // themes with the app chrome.
  "&": {
    height: "100%",
    fontSize: "var(--editor-font-size, 16px)",
    color: "var(--text)",
    backgroundColor: "var(--bg)",
  },
  // The caret defaults to a black border — invisible on a dark background; track the
  // text color so it's visible in both themes.
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  // `drawSelection`'s default fill is a fixed light color — washed-out behind the
  // light text in dark mode (the selected text becomes unreadable). Track a
  // theme-aware token so the selection fill has real contrast in both themes; the
  // text keeps its `--text` color (the fill is drawn behind it). `::selection`
  // covers native selection over rendered widgets the drawn layer doesn't paint.
  ".cm-selectionBackground": { backgroundColor: "var(--selection-bg)" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--selection-bg)" },
  "::selection": { backgroundColor: "var(--selection-bg)" },
  ".cm-scroller": {
    fontFamily: "var(--font-stack)",
    lineHeight: "1.6",
    overflow: "auto",
    // NB: no `scrollbar-gutter` here. Reserving the gutter throws off
    // `drawSelection`'s coordinate math (the real cause of the M2 selection
    // offset — see the drawSelection note below), so the gutter is given up to
    // keep the selection correct. The centered column may shift slightly when a
    // vertical scrollbar appears; that's the accepted trade.
  },
  ".cm-content": {
    // Column width is settings-driven via `--editor-measure` (M16/FEAT-0047):
    // Narrow→68ch, Wider→90ch, Full→none. Fallback is the historical 68ch.
    maxWidth: "var(--editor-measure, 68ch)",
    margin: "0 auto",
    padding: "2.5rem 1.25rem",
  },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" }, // no code-editor line highlight
  "&.cm-focused": { outline: "none" },
})

/** Toggles the editor between writable and read-only (used to lock it while a
 * conflict is being resolved — FEAT-0015). */
const editable = new Compartment()

/** Holds the opt-in Vim layer (FEAT-0021): `vim()` when on, nothing when off. */
const vimMode = new Compartment()

/** Holds the link context (FEAT-0025): the active note + known note paths, so
 * the renderer can tell a valid internal link from a broken one. */
const linkCtx = new Compartment()

export interface EditorOptions {
  /** Called on a user edit (the document text is read from the view on save). */
  onChange?: () => void
  /** Called when the user presses Ctrl/Cmd+S. */
  onSave?: () => void
  /** Called when the user follows a link with a raw `href` — a markdown/autolink
   * (resolved relative to the open note) or an external URL (FEAT-0025/0026). For an
   * internal link, `anchor` is the section anchor after `#`, if any (FEAT-0061). */
  onFollowLink?: (href: string, anchor: string | null) => void
  /** Called when the user follows a wikilink, with the already-resolved absolute
   * note path it points at (or the path to create if missing) (FEAT-0027); `anchor`
   * is the section anchor after `#`, if any (FEAT-0061). */
  onFollowNote?: (path: string, anchor: string | null) => void
}

/**
 * Mount a CodeMirror 6 editor. `onChange` fires on user edits only (not on
 * programmatic loads via {@link setEditorText}); `Ctrl/Cmd+S` invokes `onSave`.
 */
export function mountEditor(
  parent: HTMLElement,
  opts: EditorOptions = {},
): EditorView {
  const view = new EditorView({
    doc: "",
    extensions: [
      // Vim layer (FEAT-0021), off by default. First in the array → highest
      // precedence, so the Vim plugin's keydown handler runs before our keymaps:
      // in normal mode Vim owns the keys (the point of opting in); in insert mode
      // Vim binds none of `/`, Enter, or Ctrl+B/I/E, so they fall through to our
      // slash/format/Enter commands unchanged.
      vimMode.of([]),
      // A curated, prose-friendly base — deliberately NOT CodeMirror's
      // `basicSetup`. We drop the code-editor chrome (line numbers, gutters,
      // bracket matching, active-line highlight) but keep undo history and
      // autocomplete (the slash-command menu rides on it).
      history(),
      autocompletion(),
      highlightSpecialChars(),
      // `drawSelection` paints CodeMirror's own selection/cursor. It's needed so
      // Vim's visual-mode selection is visible (Vim hides the native selection),
      // and it renders correctly everywhere now that the scroller has no
      // `scrollbar-gutter` — that gutter, not the hidden-markup `Decoration.replace`
      // runs, was the real cause of the M2 selection offset (`coordsAtPos` is
      // accurate over hidden runs). See DECISIONS.md.
      drawSelection(),
      keymap.of([
        ...completionKeymap,
        // Markdown-aware Enter (FEAT-0018): continue a list/blockquote, and on an
        // empty item remove the marker to exit. After completionKeymap so the
        // slash menu still accepts on Enter; before defaultKeymap, to which it
        // falls through on a plain line (the command returns false there).
        { key: "Enter", run: continueOrExitMarkup },
        // Backspace right after a completed marker (`* `/`- `, `# `, `> `) removes
        // only the trailing space, leaving the bare marker — the inverse of typing
        // the space that completed it (FEAT-0019). Falls through when it doesn't
        // apply.
        { key: "Backspace", run: deleteMarkerSpaceBackward },
        // Backspace at the start of a list/quote marker removes the marker — the
        // counterpart the language keymap used to provide (now off, see
        // markdownRendering). Falls through to the default delete otherwise.
        { key: "Backspace", run: deleteMarkupBackward },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      editable.of([]), // writable by default; toggled by setEditorEditable
      EditorView.lineWrapping, // wrap long lines at the column width — prose, not code
      linkCtx.of([]), // link context (FEAT-0025); set via setLinkContext once a folder opens
      // Click model (FEAT-0026): a plain click on a link follows it; Ctrl/Cmd+click
      // falls through (returns false) so CodeMirror places the caret instead — the
      // edit escape hatch, which also reveals the link's markup (markdown-render).
      EditorView.domEventHandlers({
        mousedown(event) {
          // Only a plain left-button press follows: a modifier places the caret
          // (edit), and middle/right buttons fall through so the browser /
          // context-menu (right-click formatting) still work on a link.
          if (event.button !== 0 || event.metaKey || event.ctrlKey) return false
          const target = event.target as HTMLElement | null
          const el = target?.closest("[data-href],[data-note]")
          if (!el) return false
          event.preventDefault()
          // A wikilink carries an already-resolved note path (data-note); a
          // markdown/autolink/external link carries a raw href (data-href).
          const anchor = el.getAttribute("data-anchor") // section anchor (FEAT-0061), if any
          const note = el.getAttribute("data-note")
          if (note !== null) {
            opts.onFollowNote?.(note, anchor)
          } else {
            const href = el.getAttribute("data-href")
            if (href !== null) opts.onFollowLink?.(href, anchor)
          }
          return true
        },
      }),
      markdownRendering, // hide markdown markup; render text as rich content
      mermaidRendering, // render ```mermaid blocks as diagrams (lazy-loaded)
      tableRendering, // render pipe tables as aligned tables (FEAT-0063)
      frontmatterRendering, // collapse a leading `---…---` block into a metadata chip
      markdownCommands, // Ctrl+B/I/E and heading shortcuts reshape the markdown
      slashCommands, // "/" at line start opens a menu to reshape the line
      wikilinkCompletions, // "[[" opens a list of existing notes, ranked like Ctrl+K
      contextMenu, // right-click opens a formatting popup over the selection
      selectionToolbar, // touch/narrow: a floating format toolbar over a selection (FEAT-0052)
      copyMarkdown, // copy/cut re-serialize the selection to valid markdown (FEAT-0045)
      typography,
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            opts.onSave?.()
            return true
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        if (update.transactions.some((tr) => tr.annotation(ProgrammaticLoad))) return
        opts.onChange?.()
      }),
    ],
    parent,
  })

  // Reflect whether Ctrl/Cmd is held on the editor root, so the cursor over a link
  // can switch from `pointer` (follow) to a text caret (edit) — FEAT-0026. Synced
  // from each key event's live modifier state (so a missed keyup self-corrects on
  // the next key) and cleared on window blur.
  const setModHeld = (held: boolean) => view.dom.classList.toggle("cm-mod-held", held)
  const syncMod = (event: KeyboardEvent) => setModHeld(event.ctrlKey || event.metaKey)
  window.addEventListener("keydown", syncMod)
  window.addEventListener("keyup", syncMod)
  window.addEventListener("blur", () => setModHeld(false))

  return view
}

/** Replace the whole document with `text` without it counting as a user edit. Used for
 * an initial note load / programmatic note-switch, where the prior buffer is unrelated.
 * For catching the *open* note up to an external change, prefer {@link reloadEditorText}
 * so the caret and scroll survive. */
export function setEditorText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: ProgrammaticLoad.of(true),
  })
}

/**
 * Catch the open note's buffer up to `text` (its new on-disk content) with a *minimal*
 * change — only the differing middle span is replaced (FEAT-0067), not the whole
 * document — so the caret and scroll position survive an external refresh instead of
 * jumping to the top/end. No explicit selection is dispatched, so CodeMirror maps the
 * existing caret through the change; the top-of-viewport line is captured, mapped
 * through the change, and scrolled back. A no-op when the buffer already equals `text`.
 * Carries the {@link ProgrammaticLoad} annotation so it isn't treated as a user edit.
 */
export function reloadEditorText(view: EditorView, text: string): void {
  const change = diffRange(view.state.doc.toString(), text)
  if (!change) return // already in sync — dispatch nothing
  const anchor = topViewportPos(view)
  const changes = ChangeSet.of(change, view.state.doc.length)
  view.dispatch({
    changes,
    effects: EditorView.scrollIntoView(changes.mapPos(anchor, 1), { y: "start" }),
    annotations: ProgrammaticLoad.of(true),
  })
}

/** The document position at the very top of the visible viewport — the line the reader
 * is anchored on — found from the scroller's top-edge screen coordinates. Falls back to
 * the rendered viewport start when coords don't resolve (e.g. an unmeasured view). */
function topViewportPos(view: EditorView): number {
  const rect = view.scrollDOM.getBoundingClientRect()
  return view.posAtCoords({ x: rect.left + 1, y: rect.top + 1 }) ?? view.viewport.from
}

/** Lock or unlock the editor for typing (locked while a conflict is unresolved). */
export function setEditorEditable(view: EditorView, value: boolean): void {
  view.dispatch({
    effects: editable.reconfigure(
      value ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)],
    ),
  })
}

/** Turn the opt-in Vim keybinding layer on or off in place (FEAT-0021). The caret
 * guard (FEAT-0032) rides in this compartment so it exists only while Vim does —
 * the default caret already steps over hidden markup via CodeMirror's atomic
 * ranges, so off-Vim the guard would only add a per-keystroke no-op. */
export function setVimMode(view: EditorView, on: boolean): void {
  view.dispatch({ effects: vimMode.reconfigure(on ? [vim(), vimCaretGuard] : []) })
}

/** Tell the editor which note is open and which notes exist, so links render
 * valid-vs-broken correctly (FEAT-0025). */
export function setLinkContext(view: EditorView, ctx: LinkContext): void {
  view.dispatch({ effects: linkCtx.reconfigure(linkContext.of(ctx)) })
}

/**
 * Scroll to the first heading whose slug matches `anchor` (M32/FEAT-0061): bring it
 * to the top of the view and place the caret there. Scans the document's lines for a
 * heading prefix (`#`–`######` + space) and compares {@link headingSlug}s — so it
 * works even for a heading below the just-loaded viewport that the incremental parser
 * hasn't reached. Lines inside a fenced code block are skipped, so a `# comment` in
 * code isn't mistaken for a heading. Returns whether a match was found; a miss is a
 * silent no-op.
 */
export function scrollEditorToHeading(view: EditorView, anchor: string): boolean {
  const wanted = headingSlug(anchor)
  if (!wanted) return false
  const doc = view.state.doc
  let inFence = false
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    if (/^\s*(```|~~~)/.test(line.text)) {
      inFence = !inFence // a ``` / ~~~ fence opens or closes a code block
      continue
    }
    if (inFence) continue
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line.text)
    if (m && headingSlug(m[1]) === wanted) {
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start" }),
      })
      return true
    }
  }
  return false
}
