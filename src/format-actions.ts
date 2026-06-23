import { type EditorState, type TransactionSpec } from "@codemirror/state"
import {
  BOLD,
  ITALIC,
  CODE,
  toggleInline,
  setHeadingLines,
  clearFormatting,
} from "./markdown-transforms"

/**
 * The shared formatting actions (FEAT-0052) reused by every formatting surface — the
 * right-click context menu (FEAT-0008) and the touch selection toolbar (FEAT-0052) —
 * so each produces the same clean markdown (one definition of what each action does).
 * Each `run` returns a {@link TransactionSpec} to dispatch, or `null` when it doesn't
 * apply. Bold/italic/code toggle the inline span around the selection; the headings
 * set the level of the selected line(s); clear strips formatting.
 */
export interface MenuItem {
  label: string
  run: (state: EditorState) => TransactionSpec | null
}

export const FORMAT_ITEMS: MenuItem[] = [
  { label: "Bold", run: (s) => toggleInline(s, BOLD) },
  { label: "Italic", run: (s) => toggleInline(s, ITALIC) },
  { label: "Code", run: (s) => toggleInline(s, CODE) },
  { label: "Heading 1", run: (s) => setHeadingLines(s, 1) },
  { label: "Heading 2", run: (s) => setHeadingLines(s, 2) },
  { label: "Heading 3", run: (s) => setHeadingLines(s, 3) },
  { label: "Clear formatting", run: (s) => clearFormatting(s) },
]
