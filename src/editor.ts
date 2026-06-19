import { EditorView, basicSetup } from "codemirror"
import { keymap } from "@codemirror/view"
import { Annotation } from "@codemirror/state"

/** Marks transactions that load content programmatically, so they aren't
 * mistaken for user edits (which would trigger an autosave of just-loaded text). */
const External = Annotation.define<boolean>()

export interface EditorOptions {
  /** Called on a user edit with the new document text. */
  onChange?: (doc: string) => void
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
      basicSetup,
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
        opts.onChange?.(update.state.doc.toString())
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
