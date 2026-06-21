import { EditorView, keymap, highlightSpecialChars, drawSelection } from "@codemirror/view"
import { Annotation, Compartment, EditorState } from "@codemirror/state"
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands"
import { autocompletion, completionKeymap } from "@codemirror/autocomplete"
import { deleteMarkupBackward } from "@codemirror/lang-markdown"
import { vim } from "@replit/codemirror-vim"
import { markdownRendering, linkContext, type LinkContext } from "./markdown-render"
import {
  markdownCommands,
  continueOrExitMarkup,
  deleteMarkerSpaceBackward,
} from "./markdown-commands"
import { slashCommands } from "./slash-commands"
import { contextMenu } from "./context-menu"

/** Clean, prose-friendly typography: proportional font, readable measure,
 * comfortable spacing, no code-like gutter. No syntax hiding — that is M2.
 * `--font-stack` is defined in styles.css (loaded by main.ts). */
const typography = EditorView.theme({
  "&": { height: "100%", fontSize: "16px", color: "#1a1a1a" },
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
    maxWidth: "68ch",
    margin: "0 auto",
    padding: "2.5rem 1.25rem",
  },
  ".cm-gutters": { display: "none" },
  ".cm-activeLine": { backgroundColor: "transparent" }, // no code-editor line highlight
  "&.cm-focused": { outline: "none" },
})

/** Marks transactions that load content programmatically, so they aren't
 * mistaken for user edits (which would trigger an autosave of just-loaded text). */
const External = Annotation.define<boolean>()

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
  /** Called when the user Ctrl/Cmd+clicks a link, with its raw `href` (FEAT-0025). */
  onFollowLink?: (href: string) => void
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
          const href = target?.closest("[data-href]")?.getAttribute("data-href")
          if (!href) return false
          event.preventDefault()
          opts.onFollowLink?.(href)
          return true
        },
      }),
      markdownRendering, // hide markdown markup; render text as rich content
      markdownCommands, // Ctrl+B/I/E and heading shortcuts reshape the markdown
      slashCommands, // "/" at line start opens a menu to reshape the line
      contextMenu, // right-click opens a formatting popup over the selection
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
        if (update.transactions.some((tr) => tr.annotation(External))) return
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

/** Replace the whole document with `text` without it counting as a user edit. */
export function setEditorText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: External.of(true),
  })
}

/** Lock or unlock the editor for typing (locked while a conflict is unresolved). */
export function setEditorEditable(view: EditorView, value: boolean): void {
  view.dispatch({
    effects: editable.reconfigure(
      value ? [] : [EditorState.readOnly.of(true), EditorView.editable.of(false)],
    ),
  })
}

/** Turn the opt-in Vim keybinding layer on or off in place (FEAT-0021). */
export function setVimMode(view: EditorView, on: boolean): void {
  view.dispatch({ effects: vimMode.reconfigure(on ? vim() : []) })
}

/** Tell the editor which note is open and which notes exist, so links render
 * valid-vs-broken correctly (FEAT-0025). */
export function setLinkContext(view: EditorView, ctx: LinkContext): void {
  view.dispatch({ effects: linkCtx.reconfigure(linkContext.of(ctx)) })
}
