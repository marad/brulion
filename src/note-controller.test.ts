import { describe, it, expect, vi, beforeEach } from "vitest"
import { EditorView } from "codemirror"
import * as note from "./note"
import * as session from "./session"
import { createNoteController, pickActiveNote, classifyDiskCheck } from "./note-controller"

vi.mock("./note", () => ({
  readNote: vi.fn(),
  saveNote: vi.fn(),
  listNotes: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  statNote: vi.fn(),
  moveNote: vi.fn(),
}))
vi.mock("./session", () => ({ saveActiveNote: vi.fn(), loadActiveNote: vi.fn() }))
const readNote = vi.mocked(note.readNote)
const saveNote = vi.mocked(note.saveNote)
const listNotes = vi.mocked(note.listNotes)
const createNote = vi.mocked(note.createNote)
const deleteNote = vi.mocked(note.deleteNote)
const statNote = vi.mocked(note.statNote)
const moveNote = vi.mocked(note.moveNote)
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
  statNote.mockResolvedValue(null)
  moveNote.mockResolvedValue({ status: "moved" })
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

  it("keeps the previously open note when re-opening a folder whose listing fails", async () => {
    const view = mountView()
    listNotes.mockResolvedValueOnce(["apple.md", "start.md"])
    readNote.mockResolvedValue({ content: "apple body", lastModified: 5 })
    loadActiveNote.mockResolvedValue("apple.md")
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged })
    await controller.open(DIR)
    expect(view.state.doc.toString()).toBe("apple body")
    onListChanged.mockClear()

    // A second folder that's gone from disk (a dead vault) → listNotes throws. The
    // controller must commit nothing, leaving the first folder's note open so a
    // failed vault switch falls back cleanly instead of half-pointing at the dead one.
    const DEAD = {} as FileSystemDirectoryHandle
    listNotes.mockRejectedValueOnce(new Error("NotFoundError"))
    await expect(controller.open(DEAD)).rejects.toThrow()

    expect(view.state.doc.toString()).toBe("apple body") // editor unchanged
    expect(onListChanged).not.toHaveBeenCalled() // no list reported for the dead folder
  })

  it("reads the likely active note concurrently with the listing, not after it", async () => {
    const view = mountView()
    loadActiveNote.mockResolvedValue("apple.md")
    readNote.mockResolvedValue({ content: "apple body", lastModified: 5 })
    let resolveListing: (names: string[]) => void = () => {}
    listNotes.mockReturnValue(new Promise((resolve) => (resolveListing = resolve)))
    const controller = createNoteController(view)

    const opening = controller.open(DIR)
    // The listing is still pending, but the guessed active note's read should
    // already have been kicked off — not queued behind the listing.
    await vi.waitFor(() => expect(readNote).toHaveBeenCalledWith(DIR, "apple.md"))

    resolveListing(["apple.md", "start.md"])
    await opening

    expect(view.state.doc.toString()).toBe("apple body")
  })

  it("falls back to the real active note when the speculative guess no longer exists", async () => {
    const view = mountView()
    loadActiveNote.mockResolvedValue("gone.md") // persisted, but deleted since last session
    listNotes.mockResolvedValue(["start.md"])
    readNote.mockImplementation(async (_dir, name) =>
      name === "gone.md" ? { content: "stale guess", lastModified: 1 } : { content: "real start", lastModified: 2 },
    )
    const controller = createNoteController(view)

    await controller.open(DIR)

    expect(view.state.doc.toString()).toBe("real start") // not the wrongly-guessed content
  })

  it("doesn't serve a different vault's cached content for a same-named note (M33 multi-vault)", async () => {
    const view = mountView()
    const VAULT_A = {} as FileSystemDirectoryHandle
    const VAULT_B = {} as FileSystemDirectoryHandle
    loadActiveNote.mockResolvedValue("start.md")
    listNotes.mockResolvedValue(["start.md"])
    readNote.mockImplementation(async (dir) =>
      dir === VAULT_A ? { content: "vault A's start", lastModified: 1 } : { content: "vault B's start", lastModified: 1 },
    )
    const controller = createNoteController(view)

    await controller.open(VAULT_A)
    expect(view.state.doc.toString()).toBe("vault A's start")

    // Same relative path, different vault — the cache is keyed on path only,
    // so without a clear this would wrongly serve vault A's cached content.
    await controller.open(VAULT_B)
    expect(view.state.doc.toString()).toBe("vault B's start")
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

    // `bad/name` is now a valid subfolder path (FEAT-0023); use a name that is
    // still unsafe — a `..` segment must never reach the folder.
    const result = await controller.addNote("../escape")

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

describe("renameActive (FEAT-0034)", () => {
  async function open(active: string, names: string[]) {
    const view = mountView()
    listNotes.mockResolvedValue(names)
    loadActiveNote.mockResolvedValue(active)
    readNote.mockImplementation(async (_dir, name) => ({ content: `${name} body`, lastModified: 1 }))
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)
    return { view, controller, onListChanged }
  }

  it("moves the file and makes the new path active (AC-6)", async () => {
    const { controller, onListChanged } = await open("a.md", ["a.md"])
    listNotes.mockResolvedValue(["b.md"]) // listing after the move

    const result = await controller.renameActive("b")

    expect(result).toEqual({ ok: true })
    expect(moveNote).toHaveBeenCalledWith(DIR, "a.md", "b.md")
    expect(onListChanged.mock.calls.at(-1)).toEqual([["b.md"], "b.md"])
    expect(saveActiveNote).toHaveBeenLastCalledWith("b.md")
  })

  it("flushes pending edits before moving, so the moved file has them (AC-7)", async () => {
    const order: string[] = []
    saveNote.mockImplementation(async (_dir, name) => {
      order.push(`save:${name}`)
      return { status: "saved", lastModified: 2 }
    })
    moveNote.mockImplementation(async (_dir, from, to) => {
      order.push(`move:${from}->${to}`)
      return { status: "moved" }
    })
    const { view, controller } = await open("a.md", ["a.md"])
    listNotes.mockResolvedValue(["b.md"])

    type(view, " edited")
    controller.handleChange()
    await controller.renameActive("b")

    // The pending edit is written to a.md before the file is moved to b.md.
    expect(saveNote).toHaveBeenCalledWith(DIR, "a.md", "a.md body edited", 1)
    expect(order.indexOf("save:a.md")).toBeLessThan(order.indexOf("move:a.md->b.md"))
  })

  it("refuses to rename onto an existing note's path (AC-8)", async () => {
    const { view, controller } = await open("a.md", ["a.md", "b.md"])
    moveNote.mockResolvedValue({ status: "exists" })

    const result = await controller.renameActive("b")

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/exist/i)
    expect(view.state.doc.toString()).toBe("a.md body") // still on a
  })

  it("rejects an invalid name without moving (AC-9)", async () => {
    const { controller } = await open("a.md", ["a.md"])

    const result = await controller.renameActive("../escape")

    expect(result.ok).toBe(false)
    expect(moveNote).not.toHaveBeenCalled()
  })

  it("refuses to rename while a conflict stands (AC-10)", async () => {
    const onConflict = vi.fn()
    const view = mountView()
    listNotes.mockResolvedValue(["a.md"])
    loadActiveNote.mockResolvedValue("a.md")
    readNote.mockResolvedValue({ content: "a.md body", lastModified: 1 })
    const controller = createNoteController(view, { onConflict, debounceMs: 10_000 })
    await controller.open(DIR)

    // Force a standing conflict: an edit, then a refused save (mtime moved on disk).
    saveNote.mockResolvedValue({ status: "conflict" })
    type(view, " edit")
    controller.handleChange()
    controller.flush()
    await vi.waitFor(() => expect(onConflict).toHaveBeenCalled())

    const result = await controller.renameActive("b")

    expect(result.ok).toBe(false)
    expect(moveNote).not.toHaveBeenCalled()
  })

  it("is a no-op success when renaming to the current path (AC-11)", async () => {
    const { controller } = await open("a.md", ["a.md"])

    const result = await controller.renameActive("a")

    expect(result).toEqual({ ok: true })
    expect(moveNote).not.toHaveBeenCalled()
  })

  it("reports a vanished file plainly when it had been saved (AC-6 edge)", async () => {
    const { controller } = await open("a.md", ["a.md"]) // open() reads lastModified: 1
    moveNote.mockResolvedValue({ status: "missing" })

    const result = await controller.renameActive("b")

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/no longer exists/i)
  })

  it("explains a never-saved note instead of 'no longer exists' (AC-6 edge)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "", lastModified: null }) // never materialized
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)
    moveNote.mockResolvedValue({ status: "missing" })

    const result = await controller.renameActive("journal")

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/saved|type something/i)
    expect(result.ok === false && result.reason).not.toMatch(/no longer exists/i)
  })
})

describe("renameActive — inbound link rewriting (FEAT-0040)", () => {
  // Open with `active` selected and a fixed listing; `n.md` carries whatever links
  // a scenario needs. The post-move listing is set by each test before renaming.
  async function open(active: string, names: string[], links: Record<string, string>) {
    const view = mountView()
    listNotes.mockResolvedValue(names)
    loadActiveNote.mockResolvedValue(active)
    readNote.mockImplementation(async (_dir, name) => ({
      content: links[name] ?? `${name} body`,
      lastModified: 7,
    }))
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)
    return { view, controller }
  }

  it("silently rewrites a wikilink and a markdown link in another note (AC-9)", async () => {
    const { controller } = await open("diablo.md", ["diablo.md", "n.md"], {
      "n.md": "wiki [[diablo]] and md [d](diablo.md)",
    })
    listNotes.mockResolvedValue(["diablo-2.md", "n.md"]) // listing after the move

    const result = await controller.renameActive("diablo-2")

    expect(result).toEqual({ ok: true })
    expect(moveNote).toHaveBeenCalledWith(DIR, "diablo.md", "diablo-2.md")
    expect(saveNote).toHaveBeenCalledWith(
      DIR,
      "n.md",
      "wiki [[diablo-2]] and md [d](diablo-2.md)",
      7,
    )
  })

  it("writes nothing extra when no note links to the renamed one (AC-11)", async () => {
    const { controller } = await open("diablo.md", ["diablo.md", "n.md"], {
      "n.md": "no links here, just prose",
    })
    listNotes.mockResolvedValue(["diablo-2.md", "n.md"])

    const result = await controller.renameActive("diablo-2")

    expect(result).toEqual({ ok: true })
    expect(saveNote).not.toHaveBeenCalledWith(DIR, "n.md", expect.anything(), expect.anything())
  })

  it("does not fail the rename when the inbound pass throws (AC-10, best-effort)", async () => {
    const { controller } = await open("diablo.md", ["diablo.md", "n.md"], {
      "n.md": "[[diablo]]",
    })
    listNotes.mockResolvedValue(["diablo-2.md", "n.md"])
    // A guarded inbound write blows up part-way (e.g. an I/O error).
    saveNote.mockImplementation(async (_dir, name) => {
      if (name === "n.md") throw new Error("disk gone")
      return { status: "saved", lastModified: 2 }
    })

    const result = await controller.renameActive("diablo-2")

    expect(result).toEqual({ ok: true }) // the move stands; the rewrite is best-effort
    expect(moveNote).toHaveBeenCalledWith(DIR, "diablo.md", "diablo-2.md")
  })

  it("skips an inbound write that would clobber an externally-changed file (AC-12)", async () => {
    const { controller } = await open("diablo.md", ["diablo.md", "n.md"], {
      "n.md": "[d](diablo.md)",
    })
    listNotes.mockResolvedValue(["diablo-2.md", "n.md"])
    // The guarded write of n.md races an external edit → conflict; it must not throw
    // or abort the rename, and n.md is simply not overwritten.
    saveNote.mockImplementation(async (_dir, name) =>
      name === "n.md" ? { status: "conflict" } : { status: "saved", lastModified: 2 },
    )

    const result = await controller.renameActive("diablo-2")

    expect(result).toEqual({ ok: true }) // the move + other files still complete
    expect(saveNote).toHaveBeenCalledWith(DIR, "n.md", "[d](diablo-2.md)", 7) // attempted, then skipped on conflict
  })

  it("rebases the moved note's own outbound links across a folder move (FEAT-0041 AC-5)", async () => {
    const { controller } = await open("proj/diablo.md", ["proj/diablo.md", "proj/other.md"], {
      "proj/diablo.md": "[x](other.md)", // resolves to proj/other.md from proj/
    })
    // After the move the file's bytes live at the new path (move preserves them).
    readNote.mockImplementation(async (_dir, name) => ({
      content: name === "archive/diablo.md" ? "[x](other.md)" : `${name} body`,
      lastModified: 7,
    }))
    listNotes.mockResolvedValue(["archive/diablo.md", "proj/other.md"])

    const result = await controller.renameActive("archive/diablo")

    expect(result).toEqual({ ok: true })
    // The moved note's own relative link is rebased from the new folder, written back.
    expect(saveNote).toHaveBeenCalledWith(DIR, "archive/diablo.md", "[x](../proj/other.md)", 7)
  })

  it("does not rewrite the moved note's body on a same-folder rename (FEAT-0041 AC-6)", async () => {
    const { controller } = await open("diablo.md", ["diablo.md", "other.md"], {
      "diablo.md": "[x](other.md)",
    })
    listNotes.mockResolvedValue(["diablo-2.md", "other.md"])

    const result = await controller.renameActive("diablo-2")

    expect(result).toEqual({ ok: true })
    // No rebasing write of the moved note (same folder → its relative links still resolve).
    expect(saveNote).not.toHaveBeenCalledWith(DIR, "diablo-2.md", expect.anything(), expect.anything())
  })

  it("never rewrites the renamed note's own bytes (it is excluded from the scan)", async () => {
    // diablo.md links to itself; after the move it is `diablo-2.md` and must not be
    // read or written by the inbound pass.
    const { controller } = await open("diablo.md", ["diablo.md"], {})
    listNotes.mockResolvedValue(["diablo-2.md"])

    const result = await controller.renameActive("diablo-2")

    expect(result).toEqual({ ok: true })
    expect(saveNote).not.toHaveBeenCalledWith(DIR, "diablo-2.md", expect.anything(), expect.anything())
  })
})

describe("classifyDiskCheck (pure)", () => {
  const base = {
    knownNotes: ["a.md"],
    diskNotes: ["a.md"],
    knownLastModified: 1,
    diskActiveLastModified: 1,
    dirty: false,
  }

  describe("listChanged", () => {
    it("is null when the sorted sets are identical", () => {
      expect(
        classifyDiskCheck({ ...base, knownNotes: ["a.md", "b.md"], diskNotes: ["a.md", "b.md"] })
          .listChanged,
      ).toBeNull()
    })

    it("is the new listing when a note was added", () => {
      expect(
        classifyDiskCheck({ ...base, knownNotes: ["a.md"], diskNotes: ["a.md", "b.md"] })
          .listChanged,
      ).toEqual(["a.md", "b.md"])
    })

    it("is the new listing when a note was removed", () => {
      expect(
        classifyDiskCheck({ ...base, knownNotes: ["a.md", "b.md"], diskNotes: ["a.md"] })
          .listChanged,
      ).toEqual(["a.md"])
    })
  })

  describe("active", () => {
    it("is deleted when the active file is absent and we had it before", () => {
      expect(
        classifyDiskCheck({ ...base, knownLastModified: 5, diskActiveLastModified: null }).active,
      ).toEqual({ kind: "deleted", dirty: false })
    })

    it("is null when the active file is absent and we never had it (unmaterialized seed)", () => {
      expect(
        classifyDiskCheck({ ...base, knownLastModified: null, diskActiveLastModified: null })
          .active,
      ).toBeNull()
    })

    it("is changed when present with a different mtime", () => {
      expect(
        classifyDiskCheck({ ...base, knownLastModified: 1, diskActiveLastModified: 2 }).active,
      ).toEqual({ kind: "changed", lastModified: 2, dirty: false })
    })

    it("is changed when a file appeared where we had none (null -> value)", () => {
      expect(
        classifyDiskCheck({ ...base, knownLastModified: null, diskActiveLastModified: 7 }).active,
      ).toEqual({ kind: "changed", lastModified: 7, dirty: false })
    })

    it("is null when present with the same mtime", () => {
      expect(
        classifyDiskCheck({ ...base, knownLastModified: 4, diskActiveLastModified: 4 }).active,
      ).toBeNull()
    })

    it("passes dirty through into a changed state", () => {
      expect(
        classifyDiskCheck({ ...base, knownLastModified: 1, diskActiveLastModified: 2, dirty: true })
          .active,
      ).toEqual({ kind: "changed", lastModified: 2, dirty: true })
    })

    it("passes dirty through into a deleted state", () => {
      expect(
        classifyDiskCheck({
          ...base,
          knownLastModified: 1,
          diskActiveLastModified: null,
          dirty: true,
        }).active,
      ).toEqual({ kind: "deleted", dirty: true })
    })
  })
})

describe("checkDisk (AC-4..AC-7)", () => {
  it("is a no-op with no folder open", async () => {
    const view = mountView()
    const controller = createNoteController(view)

    expect(await controller.checkDisk()).toEqual({ listChanged: null, active: null })
  })

  it("reports a note added to the folder", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    listNotes.mockResolvedValue(["new.md", "start.md"])
    const result = await controller.checkDisk()

    expect(result.listChanged).toEqual(["new.md", "start.md"])
  })

  it("relists at a lower concurrency than a foreground open — nothing waits on the poll's own scan", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    expect(listNotes).toHaveBeenCalledWith(DIR) // open(): default (foreground) concurrency

    listNotes.mockClear()
    await controller.checkDisk()

    expect(listNotes).toHaveBeenCalledWith(DIR, 1) // the poll's relist: sequential
  })

  it("reports a note removed from the folder", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["a.md", "start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    listNotes.mockResolvedValue(["start.md"])
    const result = await controller.checkDisk()

    expect(result.listChanged).toEqual(["start.md"])
  })

  it("reports the active note changed on disk", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    statNote.mockResolvedValue(2) // mtime moved forward externally
    const result = await controller.checkDisk()

    expect(result.active).toEqual({ kind: "changed", lastModified: 2, dirty: false })
  })

  it("reports the active note deleted on disk", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    statNote.mockResolvedValue(null) // active file vanished
    listNotes.mockResolvedValue([])
    const result = await controller.checkDisk()

    expect(result.active).toEqual({ kind: "deleted", dirty: false })
  })

  it("is non-destructive: no write, no buffer change, and it does not adopt the new state", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)
    const bufferBefore = view.state.doc.toString()

    saveNote.mockClear()
    statNote.mockResolvedValue(2) // an unresolved external change

    const first = await controller.checkDisk()
    const second = await controller.checkDisk()

    // No write happened during detection.
    expect(saveNote).not.toHaveBeenCalled()
    // The editor buffer is untouched.
    expect(view.state.doc.toString()).toBe(bufferBefore)
    // It did not adopt the change: the same change is reported both times.
    expect(first.active).toEqual({ kind: "changed", lastModified: 2, dirty: false })
    expect(second.active).toEqual({ kind: "changed", lastModified: 2, dirty: false })
  })

  it("skips the check while our own save is in flight (no self-write false positive)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    // A save that never settles keeps savePromise in flight (doSave runs on its
    // own mutex, off the serialize queue, so checkDisk isn't blocked by it).
    saveNote.mockReturnValue(new Promise<never>(() => {}))
    type(view, "x")
    controller.handleChange()
    controller.flush() // starts doSave; savePromise is now non-null

    statNote.mockClear()
    statNote.mockResolvedValue(2) // an external change that we must NOT report mid-save
    listNotes.mockResolvedValue(["start.md", "new.md"])

    const result = await controller.checkDisk()

    expect(result).toEqual({ listChanged: null, active: null })
    expect(statNote).not.toHaveBeenCalled() // bailed before probing the disk
  })

  it("throttles the full relist to FULL_RELIST_MS, but stats the active note every call", async () => {
    vi.useFakeTimers()
    try {
      const view = mountView()
      listNotes.mockResolvedValue(["start.md"])
      loadActiveNote.mockResolvedValue("start.md")
      readNote.mockResolvedValue({ content: "body", lastModified: 1 })
      statNote.mockResolvedValue(1)
      const controller = createNoteController(view, { debounceMs: 10_000 })
      await controller.open(DIR)

      // The first check after open() always relists (verified above by every other
      // test in this block, which rely on exactly that) — spend it here so the
      // throttle window starts from a known point.
      await controller.checkDisk()

      listNotes.mockResolvedValue(["new.md", "start.md"]) // a file appears externally
      statNote.mockResolvedValue(2) // the active note also changes externally

      vi.advanceTimersByTime(1_000) // well inside the throttle window
      const soon = await controller.checkDisk()
      expect(soon.active).toEqual({ kind: "changed", lastModified: 2, dirty: false }) // checked every time
      expect(soon.listChanged).toBeNull() // relist throttled — not yet re-walked

      vi.advanceTimersByTime(15_000) // past FULL_RELIST_MS since the first check
      const later = await controller.checkDisk()
      expect(later.listChanged).toEqual(["new.md", "start.md"]) // now it re-walks and catches up
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("refreshFromDisk (FEAT-0014)", () => {
  it("relists at a lower concurrency than a foreground open (the real poller's own path)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    expect(listNotes).toHaveBeenCalledWith(DIR) // open(): default (foreground) concurrency

    listNotes.mockClear()
    await controller.refreshFromDisk()

    expect(listNotes).toHaveBeenCalledWith(DIR, 1) // the poll's relist: sequential
  })

  it("adopts an externally added note into the list, leaving the editor (AC-1)", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)
    onListChanged.mockClear()

    listNotes.mockResolvedValue(["new.md", "start.md"]) // appeared externally
    await controller.refreshFromDisk()

    expect(onListChanged).toHaveBeenCalledWith(["new.md", "start.md"], "start.md")
    expect(view.state.doc.toString()).toBe("body") // editor untouched
  })

  it("drops an externally removed non-active note from the list (AC-2)", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    listNotes.mockResolvedValue(["other.md", "start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)
    onListChanged.mockClear()

    listNotes.mockResolvedValue(["start.md"]) // other.md removed externally
    await controller.refreshFromDisk()

    expect(onListChanged).toHaveBeenCalledWith(["start.md"], "start.md")
    expect(view.state.doc.toString()).toBe("body")
  })

  it("reloads the open note's external edit and adopts the new mtime (AC-3)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    statNote.mockResolvedValue(2) // edited externally
    readNote.mockResolvedValue({ content: "new body", lastModified: 2 })
    await controller.refreshFromDisk()

    expect(view.state.doc.toString()).toBe("new body")

    // The adopted mtime means a later save bases off the new version (no false conflict).
    type(view, "!")
    controller.handleChange()
    controller.flush()
    await vi.waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith(DIR, "start.md", "new body!", 2),
    )
  })

  it("does not reload when there are unsaved local edits (AC-4)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    type(view, " local") // unsaved local edit
    controller.handleChange()
    readNote.mockClear()
    saveNote.mockClear()
    statNote.mockResolvedValue(2) // external edit collides with local edits

    await controller.refreshFromDisk()

    // readNote is now called once — to snapshot the disk content for the conflict
    // diff (FEAT-0022) — but never to reload the buffer: the buffer is preserved.
    expect(readNote).toHaveBeenCalledTimes(1)
    expect(saveNote).not.toHaveBeenCalled() // no silent overwrite
    expect(view.state.doc.toString()).toBe("body local") // buffer preserved
  })

  it("abandons the silent reload if the user types during the read (AC-4 race)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    statNote.mockResolvedValue(2) // external change detected by the probe
    // Hold the reload's read open so we can type mid-reload.
    let resolveRead: (v: { content: string; lastModified: number | null }) => void = () => {}
    readNote.mockClear()
    readNote.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve
      }),
    )

    const refreshing = controller.refreshFromDisk()
    await vi.waitFor(() => expect(readNote).toHaveBeenCalledTimes(1)) // reached the read
    type(view, " typed") // user starts editing during the reload window
    controller.handleChange()
    resolveRead({ content: "new body", lastModified: 2 })
    await refreshing

    expect(view.state.doc.toString()).toBe("body typed") // keystroke preserved, no clobber
  })

  it("switches to another note when the open note is deleted externally (AC-5)", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    listNotes.mockResolvedValue(["other.md", "start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)
    onListChanged.mockClear()

    statNote.mockResolvedValue(null) // active note deleted externally
    listNotes.mockResolvedValue(["other.md"])
    readNote.mockResolvedValue({ content: "other body", lastModified: 5 })
    await controller.refreshFromDisk()

    expect(view.state.doc.toString()).toBe("other body")
    expect(saveActiveNote).toHaveBeenCalledWith("other.md")
    expect(onListChanged).toHaveBeenCalledWith(["other.md"], "other.md")
  })

  it("falls back to an empty start buffer when the last note is deleted externally (AC-5)", async () => {
    const view = mountView()
    const onListChanged = vi.fn()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)
    onListChanged.mockClear()

    statNote.mockResolvedValue(null) // the only note deleted externally
    listNotes.mockResolvedValue([])
    readNote.mockResolvedValue({ content: "", lastModified: null })
    await controller.refreshFromDisk()

    expect(view.state.doc.toString()).toBe("")
    expect(onListChanged).toHaveBeenCalledWith([], "start.md")
  })

  it("is a no-op with no folder open (AC-6)", async () => {
    const view = mountView()
    const controller = createNoteController(view)

    await controller.refreshFromDisk()

    expect(listNotes).not.toHaveBeenCalled()
    expect(statNote).not.toHaveBeenCalled()
  })

  it("is a no-op while a save is in flight (AC-6)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR)

    saveNote.mockReturnValue(new Promise<never>(() => {})) // never settles
    type(view, "x")
    controller.handleChange()
    controller.flush() // savePromise now in flight

    listNotes.mockClear()
    statNote.mockClear()
    await controller.refreshFromDisk()

    expect(listNotes).not.toHaveBeenCalled()
    expect(statNote).not.toHaveBeenCalled()
  })

  it("doesn't block switchTo behind an in-flight relist", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["a.md", "start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, { debounceMs: 10_000 })
    await controller.open(DIR) // resets lastFullListAt, so the next relist is due

    let resolvePollList: (names: string[]) => void = () => {}
    listNotes.mockReturnValue(new Promise((resolve) => (resolvePollList = resolve)))
    const refreshing = controller.refreshFromDisk() // the relist is now in flight, slow

    readNote.mockClear()
    const switching = controller.switchTo("a.md")
    await switching // must settle without waiting for the relist

    expect(readNote).toHaveBeenCalledWith(DIR, "a.md")
    expect(view.state.doc.toString()).toBe("body")

    resolvePollList(["a.md", "start.md"]) // let the poll tick finish cleanly
    await refreshing
  })

  it("drops a stale relist instead of clobbering a newer list set while it was in flight", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const onListChanged = vi.fn()
    const controller = createNoteController(view, { onListChanged, debounceMs: 10_000 })
    await controller.open(DIR)
    onListChanged.mockClear()

    // The relist is slow and, unbeknownst to it, about to become stale.
    let resolvePollList: (names: string[]) => void = () => {}
    listNotes.mockImplementationOnce(() => new Promise((resolve) => (resolvePollList = resolve)))
    const refreshing = controller.refreshFromDisk()

    // Wait until the relist's own listNotes call has genuinely fired (open's
    // call plus this one) before queuing the next mock value — otherwise it's
    // a race over which call consumes which mocked value.
    await vi.waitFor(() => expect(listNotes).toHaveBeenCalledTimes(2))

    // A user create lands and completes entirely while the relist is still
    // in flight — its own listNotes call resolves with the up-to-date list.
    listNotes.mockResolvedValueOnce(["fresh.md", "start.md"])
    const created = await controller.addNote("fresh")
    expect(created).toEqual({ ok: true })

    // The relist's own (now-stale) listing finally resolves — missing the
    // note the addNote just created.
    resolvePollList(["start.md"])
    await refreshing

    // The stale relist must not have clobbered the newer list.
    expect(onListChanged).not.toHaveBeenCalledWith(["start.md"], expect.anything())

    // A dropped, stale relist must not have spent the throttle window either —
    // the very next tick should retry for real (not wait out FULL_RELIST_MS).
    listNotes.mockClear()
    listNotes.mockResolvedValue(["fresh.md", "start.md"])
    await controller.refreshFromDisk()
    expect(listNotes).toHaveBeenCalledTimes(1)
  })
})

describe("conflict resolution (FEAT-0015)", () => {
  // Drive the controller into a conflict: open a note, make an unsaved edit,
  // then a poll sees the file changed on disk underneath it.
  async function enterConflict(
    view: EditorView,
    onConflict = vi.fn(),
    onConflictResolved = vi.fn(),
  ) {
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, {
      onConflict,
      onConflictResolved,
      onListChanged: vi.fn(),
      debounceMs: 10_000,
    })
    await controller.open(DIR)
    type(view, " mine") // unsaved local edit
    controller.handleChange()
    statNote.mockResolvedValue(2) // external edit lands while we have edits
    await controller.refreshFromDisk()
    return controller
  }

  it("surfaces a conflict without clobbering when edits collide (AC-1, AC-6)", async () => {
    const view = mountView()
    const onConflict = vi.fn()
    saveNote.mockClear()

    await enterConflict(view, onConflict)

    expect(onConflict).toHaveBeenCalledTimes(1)
    expect(saveNote).not.toHaveBeenCalled() // nothing written before the user chooses
    expect(view.state.doc.toString()).toBe("body mine") // buffer preserved
  })

  it("hands the UI both versions, reading the disk content fresh (FEAT-0022 AC-2)", async () => {
    const view = mountView()
    const onConflict = vi.fn()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, {
      onConflict,
      onListChanged: vi.fn(),
      debounceMs: 10_000,
    })
    await controller.open(DIR)
    type(view, " mine")
    controller.handleChange()

    // The external change lands; raiseConflict reads the disk content for the diff.
    statNote.mockResolvedValue(2)
    readNote.mockResolvedValue({ content: "theirs from outside", lastModified: 2 })
    await controller.refreshFromDisk()

    expect(onConflict).toHaveBeenCalledWith({
      mine: "body mine",
      theirs: "theirs from outside",
    })
  })

  it("reports theirs=null when the file was deleted on disk (FEAT-0022 AC-2/AC-3)", async () => {
    const view = mountView()
    const onConflict = vi.fn()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, {
      onConflict,
      onListChanged: vi.fn(),
      debounceMs: 10_000,
    })
    await controller.open(DIR)
    type(view, " mine")
    controller.handleChange()

    // Deleted on disk: readNote reports an absent file (null mtime).
    statNote.mockResolvedValue(null)
    listNotes.mockResolvedValue([])
    readNote.mockResolvedValue({ content: "", lastModified: null })
    await controller.refreshFromDisk()

    expect(onConflict).toHaveBeenCalledWith({ mine: "body mine", theirs: null })
  })

  it("still surfaces the conflict if the disk read fails (FEAT-0022 AC-2)", async () => {
    const view = mountView()
    const onConflict = vi.fn()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, {
      onConflict,
      onListChanged: vi.fn(),
      debounceMs: 10_000,
    })
    await controller.open(DIR)
    type(view, " mine")
    controller.handleChange()

    // The diff read throws (e.g. a permission lapse) — the conflict must still
    // surface (modal + editor lock) rather than freeze the editor silently.
    statNote.mockResolvedValue(2)
    readNote.mockRejectedValue(new Error("read failed"))
    await controller.refreshFromDisk()

    expect(onConflict).toHaveBeenCalledWith({ mine: "body mine", theirs: null })
  })

  it("keeps my version: writes the buffer over the disk and clears the conflict (AC-2)", async () => {
    const view = mountView()
    const onConflictResolved = vi.fn()
    const controller = await enterConflict(view, vi.fn(), onConflictResolved)

    statNote.mockResolvedValue(2) // current on-disk mtime to re-base on
    saveNote.mockResolvedValue({ status: "saved", lastModified: 3 })
    await controller.resolveKeepMine()

    // Re-based on the disk's current mtime so the guarded write goes through.
    expect(saveNote).toHaveBeenCalledWith(DIR, "start.md", "body mine", 2)
    expect(onConflictResolved).toHaveBeenCalledTimes(1)
  })

  it("uses the disk version: loads it and drops local edits (AC-3)", async () => {
    const view = mountView()
    const onConflictResolved = vi.fn()
    const controller = await enterConflict(view, vi.fn(), onConflictResolved)

    statNote.mockResolvedValue(2) // present on disk → the "changed" resolution
    readNote.mockResolvedValue({ content: "their version", lastModified: 2 })
    await controller.resolveTakeTheirs()

    expect(view.state.doc.toString()).toBe("their version")
    expect(onConflictResolved).toHaveBeenCalledTimes(1)
  })

  it("re-enables autosave after keep-mine (AC-4)", async () => {
    const view = mountView()
    const controller = await enterConflict(view)

    statNote.mockResolvedValue(2)
    saveNote.mockResolvedValue({ status: "saved", lastModified: 3 })
    await controller.resolveKeepMine()

    saveNote.mockClear()
    type(view, "!")
    controller.handleChange()
    controller.flush()
    await vi.waitFor(() => expect(saveNote).toHaveBeenCalled())
  })

  it("re-enables autosave after take-theirs (AC-4)", async () => {
    const view = mountView()
    const controller = await enterConflict(view)

    statNote.mockResolvedValue(2)
    readNote.mockResolvedValue({ content: "their version", lastModified: 2 })
    await controller.resolveTakeTheirs()

    saveNote.mockClear()
    saveNote.mockResolvedValue({ status: "saved", lastModified: 9 })
    type(view, "!")
    controller.handleChange()
    controller.flush()
    // The save bases off the adopted disk mtime (2), proving it was taken.
    await vi.waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith(DIR, "start.md", "their version!", 2),
    )
  })

  it("treats the open note deleted under unsaved edits as the same conflict (AC-5)", async () => {
    const view = mountView()
    const onConflict = vi.fn()
    listNotes.mockResolvedValue(["start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, {
      onConflict,
      onListChanged: vi.fn(),
      debounceMs: 10_000,
    })
    await controller.open(DIR)
    type(view, " mine")
    controller.handleChange()

    statNote.mockResolvedValue(null) // deleted on disk while we have edits
    listNotes.mockResolvedValue([])
    await controller.refreshFromDisk()

    expect(onConflict).toHaveBeenCalledTimes(1)

    // keep-mine re-creates the file from the buffer.
    statNote.mockResolvedValue(null)
    saveNote.mockResolvedValue({ status: "saved", lastModified: 5 })
    listNotes.mockResolvedValue(["start.md"])
    await controller.resolveKeepMine()

    expect(saveNote).toHaveBeenCalledWith(DIR, "start.md", "body mine", null)
  })

  it("is modal: blocks switch / create / delete until resolved (AC-7)", async () => {
    const view = mountView()
    const onConflictResolved = vi.fn()
    listNotes.mockResolvedValue(["other.md", "start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, {
      onConflict: vi.fn(),
      onConflictResolved,
      onListChanged: vi.fn(),
      debounceMs: 10_000,
    })
    await controller.open(DIR)
    type(view, " mine")
    controller.handleChange()
    statNote.mockResolvedValue(2)
    await controller.refreshFromDisk() // conflict raised

    readNote.mockClear()
    deleteNote.mockClear()
    createNote.mockClear()
    readNote.mockResolvedValue({ content: "other body", lastModified: 3 })

    // Every navigation is refused while the conflict stands.
    await controller.switchTo("other.md")
    const addResult = await controller.addNote("fresh")
    await controller.removeNote("other.md")

    expect(view.state.doc.toString()).toBe("body mine") // still on the conflicted note
    expect(addResult.ok).toBe(false)
    expect(createNote).not.toHaveBeenCalled()
    expect(deleteNote).not.toHaveBeenCalled()
    expect(readNote).not.toHaveBeenCalled() // no re-point of the editor
    expect(onConflictResolved).not.toHaveBeenCalled() // conflict still standing
  })

  it("take-theirs on a deleted open note switches off it (AC-5)", async () => {
    const view = mountView()
    listNotes.mockResolvedValue(["other.md", "start.md"])
    loadActiveNote.mockResolvedValue("start.md")
    readNote.mockResolvedValue({ content: "body", lastModified: 1 })
    statNote.mockResolvedValue(1)
    const controller = createNoteController(view, {
      onListChanged: vi.fn(),
      debounceMs: 10_000,
    })
    await controller.open(DIR)
    type(view, " mine")
    controller.handleChange()

    statNote.mockResolvedValue(null) // start.md deleted under edits
    listNotes.mockResolvedValue(["other.md"])
    await controller.refreshFromDisk()

    statNote.mockResolvedValue(null)
    readNote.mockResolvedValue({ content: "other body", lastModified: 7 })
    await controller.resolveTakeTheirs()

    expect(view.state.doc.toString()).toBe("other body")
    expect(saveActiveNote).toHaveBeenCalledWith("other.md")
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
