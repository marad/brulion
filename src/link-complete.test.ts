import { describe, it, expect } from "vitest"
import { EditorState } from "@codemirror/state"
import { EditorView } from "@codemirror/view"
import { markdown } from "@codemirror/lang-markdown"
import { CompletionContext, type Completion } from "@codemirror/autocomplete"
import { wikilinkSource } from "./link-complete"
import { linkContext } from "./markdown-render"
import { searchNotes } from "./note-search"
import { displayName } from "./note-name"

const NOTES = ["start.md", "diablo.md", "projects/diablo.md", "projects/journal.md"]

/** Run the wikilink source with the caret at the end of `before` on its own line,
 * with `notePaths` configured on the linkContext facet (the editor's note set). */
function sourceAt(before: string, notePaths: readonly string[] = NOTES) {
  const state = EditorState.create({
    doc: before,
    extensions: [markdown(), linkContext.of({ activeNote: "start.md", notePaths: new Set(notePaths) })],
  })
  const ctx = new CompletionContext(state, before.length, false)
  return wikilinkSource(ctx)
}

/** Apply `completion` to a fresh view holding `doc` (replacing the target span
 * `[from, to)`), returning the resulting document text and caret offset. */
function applyTo(doc: string, completion: Completion, from: number, to: number) {
  const view = new EditorView({ state: EditorState.create({ doc }) })
  ;(completion.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(
    view,
    completion,
    from,
    to,
  )
  const result = { text: view.state.doc.toString(), caret: view.state.selection.main.head }
  view.destroy()
  return result
}

describe("wikilinkSource", () => {
  it("AC-1: opens after `[[`, offering all notes, with no create row", () => {
    const result = sourceAt("[[")
    expect(result).not.toBeNull()
    expect(result!.from).toBe(2) // right after `[[`
    // every option maps to an existing note's display path; none is a "create" row
    const labels = result!.options.map((o) => o.label)
    expect(labels).toEqual(searchNotes("", NOTES).matches.map(displayName))
    expect(labels).not.toContain("Create")
  })

  it("AC-2: filters and ranks by the same note-search scoring as the switcher", () => {
    const result = sourceAt("[[dia")
    expect(result).not.toBeNull()
    expect(result!.from).toBe(2)
    expect(result!.filter).toBe(false) // our note-search order is authoritative
    expect(result!.options.map((o) => o.label)).toEqual(
      searchNotes("dia", NOTES).matches.map(displayName),
    )
  })

  it("AC-3/AC-9: accepting a unique nested note inserts its bare name, closes `]]`", () => {
    // `journal` is a unique basename → name-only (Obsidian-style), even though the
    // note lives in `projects/`. The partial query proves apply inserts the chosen
    // note's text, not what was typed.
    const result = sourceAt("[[jou")!
    const opt = result.options.find((o) => o.label === "projects/journal")!
    const { text, caret } = applyTo("[[jou", opt, 2, 5)
    expect(text).toBe("[[journal]]") // bare name, not `projects/journal`
    expect(caret).toBe(text.length) // after the closing `]]`
  })

  it("does not suggest a note whose name has `[`/`]` (not wikilink-addressable)", () => {
    const result = sourceAt("[[note", ["note.md", "note[1].md"])
    expect(result).not.toBeNull()
    // both fuzzily match "note", but the bracketed one can't be a wikilink target
    expect(result!.options.map((o) => o.label)).toEqual(["note"])
  })

  it("AC-4: reuses an existing `]]` instead of doubling it", () => {
    const result = sourceAt("[[diablo")!
    const opt = result.options.find((o) => o.label === "diablo")!
    // buffer "[[diablo]]", caret before the `]]` (offset 8), target is [2,8)
    const { text, caret } = applyTo("[[diablo]]", opt, 2, 8)
    expect(text).toBe("[[diablo]]")
    expect(caret).toBe(text.length)
  })

  it("AC-5: a no-match query yields no suggestions (and never a create row)", () => {
    expect(sourceAt("[[zzzzz")).toBeNull()
    expect(sourceAt("[[", [])).toBeNull() // no notes at all
  })

  it("AC-6: an ambiguous basename inserts the full path so it resolves to the chosen note", () => {
    // `diablo` is shared by `diablo.md` and `projects/diablo.md`, so the nested one
    // must insert its full path (the bare name would be ambiguous).
    const result = sourceAt("[[diablo")!
    const labels = result.options.map((o) => o.label)
    expect(labels).toContain("diablo") // root note
    expect(labels).toContain("projects/diablo") // nested, distinct full path
    const nested = result.options.find((o) => o.label === "projects/diablo")!
    const { text } = applyTo("[[diablo", nested, 2, 8)
    expect(text).toBe("[[projects/diablo]]")
  })

  it("AC-7: does not fire outside an open `[[` (slash/plain text)", () => {
    expect(sourceAt("/h")).toBeNull()
    expect(sourceAt("just typing")).toBeNull()
    expect(sourceAt("[[done]] then more")).toBeNull() // closed link, caret outside
  })

  it("does not fire once the target contains a `]` (link being closed)", () => {
    expect(sourceAt("[[diablo]")).toBeNull()
  })
})
