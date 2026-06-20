import { describe, it, expect, vi, beforeEach } from "vitest"
import { EditorView } from "codemirror"
import * as note from "./note"
import * as session from "./session"
import { createNoteController, pickActiveNote } from "./note-controller"

vi.mock("./note", () => ({
  readNote: vi.fn(),
  saveNote: vi.fn(),
  listNotes: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
}))
vi.mock("./session", () => ({ saveActiveNote: vi.fn(), loadActiveNote: vi.fn() }))
const readNote = vi.mocked(note.readNote)
const saveNote = vi.mocked(note.saveNote)
const listNotes = vi.mocked(note.listNotes)
const createNote = vi.mocked(note.createNote)
const deleteNote = vi.mocked(note.deleteNote)
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
  createNote.mockResolvedValue({ status: "created" })
  deleteNote.mockResolvedValue(undefined)
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

  it("serializes overlapping switches so content and active note stay in sync", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["a.md", "b.md", "c.md"])
    loadActiveNote.mockResolvedValue("a.md")
    // b.md reads slowly, c.md fast: without serialization the slow b could land last.
    readNote.mockImplementation(async (_dir, name) => {
      if (name === "b.md") {
        await new Promise((r) => setTimeout(r, 30))
        return { content: "B body", lastModified: 2 }
      }
      if (name === "c.md") return { content: "C body", lastModified: 3 }
      return { content: "A body", lastModified: 1 }
    })
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)

    const first = controller.switchTo("b.md")
    const second = controller.switchTo("c.md")
    await Promise.all([first, second])

    expect(view.state.doc.toString()).toBe("C body") // last switch wins, not the slow one
    expect(onListChanged).toHaveBeenLastCalledWith(["a.md", "b.md", "c.md"], "c.md")
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

describe("addNote (FEAT-0012)", () => {
  it("creates a valid note, opens it, and lists it (AC-1)", async () => {
    const view = mountView()
    listNotes.mockResolvedValueOnce(["start.md"]).mockResolvedValue(["Diablo builds.md", "start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)

    const result = await controller.addNote("  Diablo builds  ")

    expect(result).toEqual({ ok: true })
    expect(createNote).toHaveBeenCalledWith(DIR, "Diablo builds.md")
    expect(onListChanged).toHaveBeenLastCalledWith(
      ["Diablo builds.md", "start.md"],
      "Diablo builds.md",
    )
    expect(saveActiveNote).toHaveBeenLastCalledWith("Diablo builds.md")
  })

  it("flushes the previously open note before opening the new one (AC-2)", async () => {
    const order: string[] = []
    saveNote.mockImplementation(async (_dir, name) => {
      order.push(`save:${name}`)
      return { status: "saved", lastModified: 9 }
    })
    readNote.mockImplementation(async (_dir, name) => {
      order.push(`read:${name}`)
      return {
        content: name === "a.md" ? "A body" : "",
        lastModified: name === "a.md" ? 1 : null,
      }
    })
    const view = mountView()
    listNotes.mockResolvedValueOnce(["a.md"]).mockResolvedValue(["a.md", "new.md"])
    loadActiveNote.mockResolvedValue("a.md")
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    type(view, " edited")
    controller.handleChange()
    await controller.addNote("new")

    // A's pending edits land in A's file, and that flush happens before the new
    // note is loaded into the editor (no keystrokes lost on the way out of A).
    expect(saveNote).toHaveBeenCalledWith(DIR, "a.md", "A body edited", 1)
    expect(order.indexOf("save:a.md")).toBeLessThan(order.indexOf("read:new.md"))
    expect(view.state.doc.toString()).toBe("")
  })

  it("refuses a duplicate name and leaves the editor untouched (AC-3)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "start body", lastModified: 1 })
    createNote.mockResolvedValue({ status: "exists" })
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    const result = await controller.addNote("start")

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/exist/i)
    expect(view.state.doc.toString()).toBe("start body") // editor unchanged
  })

  it("refuses an invalid name without touching the folder (AC-4)", async () => {
    const view = mountView()
    const controller = createNoteController(view)
    await controller.open(DIR)

    const result = await controller.addNote("bad/name")

    expect(result.ok).toBe(false)
    expect(createNote).not.toHaveBeenCalled()
  })
})

describe("removeNote (FEAT-0012)", () => {
  async function open(active: string, names: string[]) {
    const view = mountView()
    listNotes.mockResolvedValue(names)
    loadActiveNote.mockResolvedValue(active)
    readNote.mockImplementation(async (_dir, name) => ({
      content: `${name} body`,
      lastModified: 1,
    }))
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)
    return { view, controller, onListChanged }
  }

  it("deletes the file and removes it from the list (AC-6)", async () => {
    const { controller, onListChanged } = await open("a.md", ["a.md", "b.md"])
    listNotes.mockResolvedValue(["b.md"])

    await controller.removeNote("a.md")

    expect(deleteNote).toHaveBeenCalledWith(DIR, "a.md")
    expect(onListChanged.mock.calls.at(-1)?.[0]).toEqual(["b.md"])
  })

  it("switches to another note when the active one is deleted (AC-7)", async () => {
    const { view, controller } = await open("a.md", ["a.md", "b.md"])
    listNotes.mockResolvedValue(["b.md"])

    await controller.removeNote("a.md")

    expect(view.state.doc.toString()).toBe("b.md body")
  })

  it("falls back to an empty start buffer when the last note is deleted (AC-7)", async () => {
    const { view, controller, onListChanged } = await open("only.md", ["only.md"])
    listNotes.mockResolvedValue([])
    readNote.mockResolvedValue({ content: "", lastModified: null })

    await controller.removeNote("only.md")

    expect(view.state.doc.toString()).toBe("")
    expect(onListChanged.mock.calls.at(-1)).toEqual([[], "start.md"])
  })

  it("leaves the editor in place when a non-active note is deleted (AC-8)", async () => {
    const { view, controller, onListChanged } = await open("a.md", ["a.md", "b.md"])
    listNotes.mockResolvedValue(["a.md"])

    await controller.removeNote("b.md")

    expect(deleteNote).toHaveBeenCalledWith(DIR, "b.md")
    expect(view.state.doc.toString()).toBe("a.md body") // still on A
    expect(onListChanged.mock.calls.at(-1)).toEqual([["a.md"], "a.md"])
  })

  it("drops the active note's pending edits instead of resurrecting it", async () => {
    const { view, controller } = await open("a.md", ["a.md", "b.md"])
    listNotes.mockResolvedValue(["b.md"])

    type(view, " unsaved edit") // a.md is now dirty
    controller.handleChange()
    await controller.removeNote("a.md")

    // The deleted note must not be written back by a flush.
    expect(saveNote).not.toHaveBeenCalledWith(DIR, "a.md", expect.anything(), expect.anything())
  })

  it("waits for an in-flight save to settle before deleting (no resurrection)", async () => {
    const order: string[] = []
    let release: () => void = () => {}
    saveNote.mockImplementation(async (_dir, name) => {
      order.push(`save-start:${name}`)
      await new Promise<void>((resolve) => (release = resolve))
      order.push(`save-end:${name}`)
      return { status: "saved", lastModified: 9 }
    })
    deleteNote.mockImplementation(async (_dir, name) => {
      order.push(`delete:${name}`)
    })
    const view = mountView()
    listNotes.mockResolvedValueOnce(["a.md", "b.md"]).mockResolvedValue(["b.md"])
    loadActiveNote.mockResolvedValue("a.md")
    readNote.mockImplementation(async (_dir, name) => ({ content: `${name} body`, lastModified: 1 }))
    const controller = createNoteController(view, { debounceMs: 5 })
    await controller.open(DIR)

    type(view, " edit")
    controller.handleChange()
    await vi.waitFor(() => expect(order).toContain("save-start:a.md")) // autosave in flight

    const removed = controller.removeNote("a.md") // must not delete until the save settles
    await Promise.resolve()
    expect(order).not.toContain("delete:a.md") // still waiting on the in-flight write

    release()
    await removed
    // The in-flight write of a.md completes BEFORE the delete, so the file ends deleted.
    expect(order.indexOf("save-end:a.md")).toBeLessThan(order.indexOf("delete:a.md"))
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
