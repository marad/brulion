import { beforeEach, describe, expect, it, vi } from "vitest"
import { EditorView } from "codemirror"
import * as note from "./note"
import * as session from "./session"
import { createNoteController } from "./note-controller"

vi.mock("./note", () => ({
  readNote: vi.fn(),
  saveNote: vi.fn(),
  listNotes: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  statNote: vi.fn(),
  moveNote: vi.fn(),
  startSweep: vi.fn(),
  continueSweep: vi.fn(),
  sweepResult: vi.fn(),
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
  listFolders: vi.fn(),
  isFolderEmpty: vi.fn(),
}))
vi.mock("./session", () => ({ saveActiveNote: vi.fn(), loadActiveNote: vi.fn() }))

const readNote = vi.mocked(note.readNote)
const saveNote = vi.mocked(note.saveNote)
const listNotes = vi.mocked(note.listNotes)
const statNote = vi.mocked(note.statNote)
const startSweep = vi.mocked(note.startSweep)
const continueSweep = vi.mocked(note.continueSweep)
const sweepResult = vi.mocked(note.sweepResult)
const saveActiveNote = vi.mocked(session.saveActiveNote)

const DIR = {} as FileSystemDirectoryHandle

function mountView(): EditorView {
  return new EditorView({ parent: document.createElement("div") })
}

function defaults(): void {
  readNote.mockImplementation(async (_dir, path) => ({
    content: path === "start.md" ? "start body" : `${path} body`,
    lastModified: path === "missing.md" ? null : path === "start.md" ? 1 : 2,
  }))
  saveNote.mockResolvedValue({ status: "saved", lastModified: 3 })
  listNotes.mockResolvedValue(["start.md"])
  statNote.mockImplementation(async (_dir, path) =>
    path === "missing.md" ? null : path === "start.md" ? 1 : 2,
  )
  startSweep.mockReturnValue({ pending: [], files: [] })
  continueSweep.mockResolvedValue(true)
  sweepResult.mockReturnValue(["start.md"])
  saveActiveNote.mockResolvedValue(undefined)
}

beforeEach(() => {
  vi.clearAllMocks()
  defaults()
})

describe("extension-driven active-note navigation", () => {
  it("revalidates the filesystem and opens a note absent from the stale list", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    listNotes.mockResolvedValue(["new.md", "start.md"])
    const controller = createNoteController(view, { onListChanged })
    await controller.open(DIR)
    onListChanged.mockClear()
    saveActiveNote.mockClear()

    await expect(controller.openNote("new.md")).resolves.toEqual({
      status: "opened",
      path: "new.md",
    })

    expect(view.state.doc.toString()).toBe("new.md body")
    expect(onListChanged).toHaveBeenCalledWith(["new.md", "start.md"], "new.md")
    expect(saveActiveNote).toHaveBeenLastCalledWith("new.md")
    expect(saveNote).not.toHaveBeenCalled()
  })

  it("returns missing without creating or changing the active view", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged })
    await controller.open(DIR)
    onListChanged.mockClear()
    saveActiveNote.mockClear()

    await expect(controller.openNote("missing.md")).resolves.toEqual({
      status: "missing",
      path: "missing.md",
    })

    expect(view.state.doc.toString()).toBe("start body")
    expect(onListChanged).not.toHaveBeenCalled()
    expect(saveActiveNote).not.toHaveBeenCalled()
    expect(saveNote).not.toHaveBeenCalled()
  })

  it("returns already-open without flushing or adding another active-note event", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged })
    await controller.open(DIR)
    onListChanged.mockClear()
    saveActiveNote.mockClear()

    await expect(controller.openNote("start")).resolves.toEqual({
      status: "already-open",
      path: "start.md",
    })

    expect(onListChanged).not.toHaveBeenCalled()
    expect(saveActiveNote).not.toHaveBeenCalled()
    expect(saveNote).not.toHaveBeenCalled()
  })

  it("returns the active path when a guarded flush conflicts", async () => {
    const view = mountView()
    const onConflict = vi.fn()
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onConflict, onListChanged })
    await controller.open(DIR)
    view.dispatch({ changes: { from: view.state.doc.length, insert: " local" } })
    controller.handleChange()
    saveNote.mockResolvedValue({ status: "conflict" })
    onListChanged.mockClear()

    await expect(controller.openNote("other.md")).resolves.toEqual({
      status: "conflict",
      path: "start.md",
    })

    expect(view.state.doc.toString()).toBe("start body local")
    expect(onConflict).toHaveBeenCalledWith({ mine: "start body local", theirs: "start body" })
    expect(onListChanged).not.toHaveBeenCalledWith(expect.anything(), "other.md")
  })

  it("serializes concurrent opens and leaves the editor on the last queued target", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    listNotes.mockResolvedValue(["a.md", "b.md", "start.md"])
    const controller = createNoteController(view, { onListChanged })
    await controller.open(DIR)
    onListChanged.mockClear()

    const results = await Promise.all([controller.openNote("a.md"), controller.openNote("b.md")])

    expect(results).toEqual([
      { status: "opened", path: "a.md" },
      { status: "opened", path: "b.md" },
    ])
    expect(view.state.doc.toString()).toBe("b.md body")
    expect(saveActiveNote).toHaveBeenLastCalledWith("b.md")
    expect(onListChanged).toHaveBeenLastCalledWith(["a.md", "b.md", "start.md"], "b.md")
  })

  it("does not commit a target after its application vault guard becomes stale", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    listNotes.mockResolvedValue(["start.md", "target.md"])
    const controller = createNoteController(view, { onListChanged })
    await controller.open(DIR)
    onListChanged.mockClear()

    let releaseTarget!: () => void
    const targetRead = new Promise<void>((resolve) => {
      releaseTarget = resolve
    })
    readNote.mockImplementation(async (_dir, path) => {
      if (path === "target.md") {
        await targetRead
        return { content: "target body", lastModified: 2 }
      }
      return { content: "start body", lastModified: 1 }
    })
    let current = true
    const pending = controller.openNote("target.md", DIR, () => {
      if (!current) throw new Error("Extension vault is no longer active")
    })
    await vi.waitFor(() => expect(readNote).toHaveBeenCalledWith(DIR, "target.md"))

    current = false
    releaseTarget()
    await expect(pending).rejects.toThrow("Extension vault is no longer active")
    expect(view.state.doc.toString()).toBe("start body")
    expect(saveActiveNote).not.toHaveBeenLastCalledWith("target.md")
    expect(onListChanged).not.toHaveBeenCalledWith(expect.anything(), "target.md")
  })
})
