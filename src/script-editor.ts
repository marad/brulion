import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { basicSetup } from "codemirror"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { ProgrammaticLoad } from "./editor-load"

export interface ScriptEditorOptions {
  /** Syntax mode for the selected workbench file. */
  language?: "javascript" | "json"
  /** Called for a user edit with the complete current JavaScript source. */
  onChange?: (source: string) => void
  /** Called by Mod-s with the complete current JavaScript source. */
  onSave?: (source: string) => void
}

/** Mount the standalone JavaScript editor used by the future script settings UI. */
export function mountScriptEditor(
  parent: HTMLElement,
  opts: ScriptEditorOptions = {},
): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        opts.language === "json" ? json() : javascript(),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: (editor) => {
              opts.onSave?.(editor.state.doc.toString())
              return true
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          if (update.transactions.some((transaction) => transaction.annotation(ProgrammaticLoad))) return
          opts.onChange?.(update.state.doc.toString())
        }),
      ],
    }),
    parent,
  })
  return view
}

/** Return the current unmodified JavaScript source. */
export function getScriptEditorText(view: EditorView): string {
  return view.state.doc.toString()
}

/** Load source without reporting it as a user edit. */
export function setScriptEditorText(view: EditorView, source: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: source },
    annotations: ProgrammaticLoad.of(true),
  })
}
