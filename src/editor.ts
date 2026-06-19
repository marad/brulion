import { EditorView, basicSetup } from "codemirror"

/**
 * Mount a CodeMirror 6 editor into `parent`. The M1 skeleton mounts an empty,
 * editable editor with CodeMirror's default setup — proof the toolchain wires
 * CM6 correctly. No styling or file logic yet (later phases).
 */
export function mountEditor(parent: HTMLElement): EditorView {
  return new EditorView({
    doc: "",
    extensions: [basicSetup],
    parent,
  })
}
