import { describe, it, expect, vi, beforeEach } from "vitest"
import { EditorView } from "codemirror"
import * as note from "./note"
import { createNoteController } from "./note-controller"

vi.mock("./note", () => ({ readNote: vi.fn(), saveNote: vi.fn() }))
const readNote = vi.mocked(note.readNote)
const saveNote = vi.mocked(note.saveNote)

const DIR = {} as FileSystemDirectoryHandle

function mountView(): EditorView {
  return new EditorView({ parent: document.createElement("div") })
}

function type(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } })
}

beforeEach(() => {
  vi.clearAllMocks()
  readNote.mockResolvedValue({ content: "", lastModified: null })
  saveNote.mockResolvedValue({ status: "saved", lastModified: 1 })
})

describe("open", () => {
  it("loads the note's content into the editor (AC-1)", async () => {
    const view = mountView()
    readNote.mockResolvedValue({ content: "hello", lastModified: 5 })
    const controller = createNoteController(view)

    await controller.open(DIR)

    expect(view.state.doc.toString()).toBe("hello")
  })
})

describe("autosave", () => {
  it("saves an edit after the debounce, with the last-seen lastModified (AC-3)", async () => {
    const view = mountView()
    readNote.mockResolvedValue({ content: "", lastModified: 42 })
    const controller = createNoteController(view, { debounceMs: 10 })
    await controller.open(DIR)

    type(view, "hi")
    controller.handleChange()

    await vi.waitFor(() => expect(saveNote).toHaveBeenCalledWith(DIR, "start.md", "hi", 42))
  })

  it("does not save when there are no pending changes", async () => {
    const view = mountView()
    const controller = createNoteController(view, { debounceMs: 10 })
    await controller.open(DIR)

    controller.flush()
    await new Promise((r) => setTimeout(r, 20))

    expect(saveNote).not.toHaveBeenCalled()
  })
})

describe("concurrency", () => {
  it("never runs two saves at once and persists edits made mid-save", async () => {
    const view = mountView()
    let inFlight = 0
    let maxInFlight = 0
    const resolvers: Array<() => void> = [] // one per saveNote call, released by index
    saveNote.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>((resolve) => resolvers.push(resolve))
      inFlight -= 1
      return { status: "saved", lastModified: 1 }
    })
    const controller = createNoteController(view, { debounceMs: 5 })
    await controller.open(DIR)

    type(view, "first")
    controller.handleChange()
    await vi.waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1)) // save #1 in flight

    // Edit again and flush while save #1 is still blocked. Without the saving
    // guard, flush() would synchronously start a second concurrent saveNote
    // (saveNote's body bumps inFlight before its await) — these assertions catch
    // exactly that regression.
    type(view, " second")
    controller.handleChange()
    controller.flush()
    expect(saveNote).toHaveBeenCalledTimes(1) // no second save started concurrently
    expect(maxInFlight).toBe(1)

    resolvers[0]() // finish save #1; the loop should now save the newer content
    await vi.waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2))
    expect(maxInFlight).toBe(1) // the second save started only after the first ended

    resolvers[1]()
    expect(saveNote).toHaveBeenLastCalledWith(DIR, "start.md", "first second", 1)
  })
})

describe("flush", () => {
  it("saves immediately (AC-4)", async () => {
    const view = mountView()
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    type(view, "x")
    controller.handleChange()
    controller.flush()

    await vi.waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1))
  })
})

describe("conflict (AC-5)", () => {
  it("calls onConflict and stops saving once a save is refused", async () => {
    const view = mountView()
    const onConflict = vi.fn()
    saveNote.mockResolvedValue({ status: "conflict" })
    const controller = createNoteController(view, { onConflict, debounceMs: 10 })
    await controller.open(DIR)

    type(view, "x")
    controller.handleChange()
    await vi.waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1))

    // Further edits must not attempt another save (no silent clobber).
    saveNote.mockClear()
    type(view, "y")
    controller.handleChange()
    controller.flush()
    await new Promise((r) => setTimeout(r, 20))
    expect(saveNote).not.toHaveBeenCalled()
  })
})
