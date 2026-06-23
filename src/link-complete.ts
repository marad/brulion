import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete"
import { type EditorView } from "@codemirror/view"
import { markdownLanguage } from "@codemirror/lang-markdown"
import { displayName } from "./note-name"
import { searchNotes } from "./note-search"
import { linkContext } from "./markdown-render"

/**
 * Wikilink autocomplete (FEAT-0037): typing `[[` opens a list of existing notes,
 * ranked by the *same* `note-search.ts` scoring the Ctrl+K quick switcher uses, so
 * the order is consistent between the two surfaces. The candidate notes come from
 * the editor's existing `linkContext` facet (`notePaths`) — one source of truth for
 * "which notes exist", shared with valid-vs-broken link rendering. Accepting inserts
 * the note's full display path and closes the `]]`. Existing notes only: no
 * create-on-miss, and typing an unknown name is left untouched (a dangling wikilink,
 * which FEAT-0027 already handles). The completion only edits the buffer's link
 * text — nothing is read from or written to the folder (the moat).
 */

/** Accept handler for one suggested note `path`: replace the partial target with
 * the note's display path (no `.md`) and ensure the link is closed with `]]`,
 * leaving the caret after it. An existing `]]` right after the caret is reused, not
 * duplicated, so accepting inside `[[…]]` yields a single well-formed link. */
function applyWikilink(path: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number): void => {
    const insert = displayName(path)
    const hasClose = view.state.doc.sliceString(to, to + 2) === "]]"
    view.dispatch({
      changes: { from, to, insert: hasClose ? insert : `${insert}]]` },
      // After the closing `]]` either way: the reused `]]` sits right after `to`,
      // which now follows the inserted text — same offset as the appended one.
      selection: { anchor: from + insert.length + 2 },
    })
  }
}

/**
 * Open the wikilink suggestion list when the caret follows `[[` plus an optional
 * partial target (no `]`/newline between the `[[` and the caret). Notes are ranked
 * by `searchNotes` against the partial target over their display path; an empty
 * target lists all notes in name order. Returns `null` when not inside an open
 * wikilink or when no note matches. `filter: false` keeps the `note-search` order
 * authoritative (CodeMirror does not re-sort), and omitting `validFor` makes it
 * re-query per keystroke for a fresh ranking.
 */
export function wikilinkSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(/\[\[[^\]\n]*/)
  if (!match) return null
  const from = match.from + 2 // start the replacement right after the `[[`
  const query = match.text.slice(2)
  // A `[`/`]` in the name would break the `[[…]]` delimiters, so the renderer
  // (and any other tool) can't represent such a note as a wikilink — never suggest
  // a target we'd insert as a dead link. (`|` can't occur: it's rejected by
  // `normalizeNoteName`.) These names are valid on disk, just not wikilink-addressable.
  const paths = [...context.state.facet(linkContext).notePaths].filter((p) => !/[[\]]/.test(p))
  const { matches } = searchNotes(query, paths)
  if (matches.length === 0) return null
  const options: Completion[] = matches.map((path) => ({
    label: displayName(path),
    type: "text",
    apply: applyWikilink(path),
  }))
  return { from, options, filter: false }
}

/** Register the wikilink source as markdown autocomplete (peer to the slash source;
 * each returns null when its own trigger is absent, so they never collide). */
export const wikilinkCompletions = markdownLanguage.data.of({ autocomplete: wikilinkSource })
