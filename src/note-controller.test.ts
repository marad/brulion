import { describe, it, expect, vi, beforeEach } from "vitest"
import { EditorView } from "codemirror"
import * as note from "./note"
import * as session from "./session"
import { createNoteController, pickActiveNote } from "./note-controller"

vi.mock("./note", () => ({ readNote: vi.fn(), saveNote: vi.fn(), listNotes: vi.fn() }))
vi.mock("./session", () => ({ saveActiveNote: vi.fn(), loadActiveNote: vi.fn() }))
const readNote = vi.mocked(note.readNote)
const saveNote = vi.mocked(note.saveNote)
const listNotes = vi.mocked(note.listNotes)
const loadActiveNote = vi.mocked(session.loadActiveNote)
const saveActiveNote = vi.mocked(session.saveActiveNote)

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
  listNotes.mockResolvedValue([])
  loadActiveNote.mockResolvedValue(undefined)
})

describe("pickActiveNote (AC-6, AC-7)", () => {
  it("prefers the persisted note when it still exists", () => {
    expect(pickActiveNote(["a.md", "b.md"], "b.md")).toBe("b.md")
  })
  it("falls back to start.md when the persisted note is gone", () => {
    expect(pickActiveNote(["start.md", "a.md"], "gone.md")).toBe("start.md")
  })
  it("falls back to the first note when there is no start.md", () => {
    expect(pickActiveNote(["a.md", "b.md"], "gone.md")).toBe("a.md")
  })
  it("defaults to start.md for an empty folder", () => {
    expect(pickActiveNote([], undefined)).toBe("start.md")
  })
})

describe("open", () => {
  it("loads the picked active note and reports the list (AC-1, AC-2)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["apple.md", "start.md"])
    readNote.mockResolvedValue({ content: "apple body", lastModified: 5 })
    loadActiveNote.mockResolvedValue("apple.md")
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged })

    await controller.open(DIR)

    expect(readNote).toHaveBeenCalledWith(DIR, "apple.md")
    expect(view.state.doc.toString()).toBe("apple body")
    expect(onListChanged).toHaveBeenCalledWith(["apple.md", "start.md"], "apple.md")
    expect(saveActiveNote).toHaveBeenCalledWith("apple.md")
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
    const resolvers: Array<() => void> = []
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
    await vi.waitFor(() => expect(saveNote).toHaveBeenCalledTimes(1))

    type(view, " second")
    controller.handleChange()
    controller.flush()
    expect(saveNote).toHaveBeenCalledTimes(1)
    expect(maxInFlight).toBe(1)

    resolvers[0]()
    await vi.waitFor(() => expect(saveNote).toHaveBeenCalledTimes(2))
    expect(maxInFlight).toBe(1)

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

describe("switchTo", () => {
  function twoNoteController(onListChanged = vi.fn()) {
    const view = mountView()
    listNotes.mockResolvedValue(["a.md", "b.md"])
    loadActiveNote.mockResolvedValue("a.md")
    readNote.mockImplementation(async (_dir, name) =>
      name === "b.md"
        ? { content: "B body", lastModified: 2 }
        : { content: "A body", lastModified: 1 },
    )
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    return { view, controller, onListChanged }
  }

  it("flushes the open note before loading the new one (AC-4)", async () => {
    const order: string[] = []
    saveNote.mockImplementation(async (_dir, name) => {
      order.push(`save:${name}`)
      return { status: "saved", lastModified: 9 }
    })
    const { view, controller } = twoNoteController()
    readNote.mockImplementation(async (_dir, name) => {
      order.push(`read:${name}`)
      return name === "b.md"
        ? { content: "B body", lastModified: 2 }
        : { content: "A body", lastModified: 1 }
    })
    await controller.open(DIR) // loads A

    type(view, " edited") // A is now dirty, debounce won't fire (10s)
    controller.handleChange()
    await controller.switchTo("b.md")

    expect(saveNote).toHaveBeenCalledWith(DIR, "a.md", "A body edited", 1)
    expect(order).toEqual(["read:a.md", "save:a.md", "read:b.md"]) // flush A before load B
    expect(view.state.doc.toString()).toBe("B body")
  })

  it("saves edits made after the switch to the new note (AC-5)", async () => {
    const { view, controller } = twoNoteController()
    await controller.open(DIR)

    await controller.switchTo("b.md")
    type(view, " more")
    controller.handleChange()
    controller.flush()

    await vi.waitFor(() => expect(saveNote).toHaveBeenCalledWith(DIR, "b.md", "B body more", 2))
  })

  it("is a no-op when switching to the already-active note", async () => {
    const { controller } = twoNoteController()
    await controller.open(DIR)
    saveActiveNote.mockClear()

    await controller.switchTo("a.md")

    expect(saveActiveNote).not.toHaveBeenCalled()
    expect(readNote).toHaveBeenCalledTimes(1) // only the open() read, no reload
  })
})

describe("lazy start.md appears in the list (AC-8)", () => {
  it("re-lists after the first save materializes the active note", async () => {
    const view = mountView()
    listNotes.mockResolvedValueOnce([]).mockResolvedValue(["start.md"])
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged, debounceMs: 10 })
    await controller.open(DIR)
    expect(onListChanged).toHaveBeenLastCalledWith([], "start.md")

    type(view, "captured")
    controller.handleChange()

    await vi.waitFor(() =>
      expect(onListChanged).toHaveBeenLastCalledWith(["start.md"], "start.md"),
    )
  })
})

describe("conflict (AC-5 of FEAT-0004 preserved)", () => {
  it("calls onConflict and stops saving once a save is refused", async () => {
    const view = mountView()
    const onConflict = vi.fn()
    saveNote.mockResolvedValue({ status: "conflict" })
    const controller = createNoteController(view, { onConflict, debounceMs: 10 })
    await controller.open(DIR)

    type(view, "x")
    controller.handleChange()
    await vi.waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1))

    saveNote.mockClear()
    type(view, "y")
    controller.handleChange()
    controller.flush()
    await new Promise((r) => setTimeout(r, 20))
    expect(saveNote).not.toHaveBeenCalled()
  })
})
