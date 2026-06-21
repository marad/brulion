import { EditorView } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { MergeView } from "@codemirror/merge"

/** A mounted conflict diff; call {@link ConflictDiff.destroy} to tear it down. */
export interface ConflictDiff {
  destroy(): void
}

// Read-only panes: the diff is for seeing, not editing (FEAT-0022 AC-6). Line
// wrapping keeps long prose lines visible without horizontal scrolling.
const readOnly = [
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
  EditorView.lineWrapping,
]

/**
 * Render the standing conflict as a read-only side-by-side diff: the unsaved
 * buffer (`mine`) on the left under "Your version", the on-disk content
 * (`theirs`) on the right under "On disk", with the differing lines highlighted
 * (FEAT-0022). `theirs === null` means the file was deleted on disk: the right
 * pane shows empty content labelled "(deleted on disk)" and the whole buffer
 * reads as removed. The view is mounted into `parent`; `destroy()` removes it.
 */
export function mountConflictDiff(
  parent: HTMLElement,
  mine: string,
  theirs: string | null,
): ConflictDiff {
  const container = document.createElement("div")
  container.className = "conflict-diff"

  const labels = document.createElement("div")
  labels.className = "conflict-diff-labels"
  const mineLabel = document.createElement("span")
  mineLabel.textContent = "Your version"
  const theirsLabel = document.createElement("span")
  theirsLabel.textContent = theirs === null ? "On disk (deleted)" : "On disk"
  labels.append(mineLabel, theirsLabel)
  container.append(labels)

  const merge = new MergeView({
    a: { doc: mine, extensions: readOnly },
    b: { doc: theirs ?? "", extensions: readOnly },
    parent: container,
  })

  parent.append(container)

  return {
    destroy() {
      merge.destroy()
      container.remove()
    },
  }
}
