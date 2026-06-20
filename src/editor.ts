import { EditorView, keymap, highlightSpecialChars } from "@codemirror/view"
import { Annotation } from "@codemirror/state"
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands"
import { autocompletion, completionKeymap } from "@codemirror/autocomplete"
import { markdownRendering } from "./markdown-render"
import { markdownCommands } from "./markdown-commands"
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
    scrollbarGutter: "stable both-edges", // keep the text column centered when a scrollbar appears
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

export interface EditorOptions {
  /** Called on a user edit (the document text is read from the view on save). */
  onChange?: () => void
  /** Called when the user presses Ctrl/Cmd+S. */
  onSave?: () => void
}

/**
 * Mount a CodeMirror 6 editor. `onChange` fires on user edits only (not on
 * programmatic loads via {@link setEditorText}); `Ctrl/Cmd+S` invokes `onSave`.
 */
export function mountEditor(
  parent: HTMLElement,
  opts: EditorOptions = {},
): EditorView {
  return new EditorView({
    doc: "",
    extensions: [
      // A curated, prose-friendly base — deliberately NOT CodeMirror's
      // `basicSetup`. We drop `drawSelection` (its custom selection layer
      // mismeasures positions after hidden `Decoration.replace` runs, so the
      // highlight drew offset from the text — the browser's native selection is
      // correct) along with all the code-editor chrome (line numbers, gutters,
      // bracket matching, active-line highlight). We keep undo history and
      // autocomplete (the slash-command menu rides on it).
      history(),
      autocompletion(),
      highlightSpecialChars(),
      keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping, // wrap long lines at the column width — prose, not code
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
}

/** Replace the whole document with `text` without it counting as a user edit. */
export function setEditorText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    annotations: External.of(true),
  })
}
