import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "./fs"
import * as session from "./session"
import { openFolder, restoreFolder, wireOpenFolder, renderNoteList } from "./ui"

vi.mock("./fs", () => ({ pickFolder: vi.fn() }))
vi.mock("./session", () => ({
  saveFolder: vi.fn(),
  loadFolder: vi.fn(),
  hasPermission: vi.fn(),
  requestAccess: vi.fn(),
}))

const pickFolder = vi.mocked(fs.pickFolder)
const saveFolder = vi.mocked(session.saveFolder)
const loadFolder = vi.mocked(session.loadFolder)
const hasPermission = vi.mocked(session.hasPermission)
const requestAccess = vi.mocked(session.requestAccess)

const HANDLE = { kind: "directory", name: "root" } as unknown as FileSystemDirectoryHandle

function fixture() {
  return {
    resume: document.createElement("button"),
    onOpen: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("openFolder", () => {
  it("opens and persists the picked folder, hiding the resume button (AC-1)", async () => {
    const { resume, onOpen } = fixture()
    resume.hidden = false
    pickFolder.mockResolvedValue(HANDLE)

    await openFolder(resume, onOpen)

    expect(onOpen).toHaveBeenCalledWith(HANDLE)
    expect(saveFolder).toHaveBeenCalledWith(HANDLE)
    expect(resume.hidden).toBe(true)
  })

  it("is a no-op when the picker is dismissed (AC-4)", async () => {
    const { resume, onOpen } = fixture()
    pickFolder.mockResolvedValue(null)

    await openFolder(resume, onOpen)

    expect(onOpen).not.toHaveBeenCalled()
    expect(saveFolder).not.toHaveBeenCalled()
  })

  it("does not throw and does not persist when opening fails", async () => {
    const { resume, onOpen } = fixture()
    resume.hidden = false
    pickFolder.mockResolvedValue(HANDLE)
    onOpen.mockRejectedValue(new Error("read failure"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(openFolder(resume, onOpen)).resolves.toBeUndefined()

    expect(saveFolder).not.toHaveBeenCalled() // an unusable handle is not persisted
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe("restoreFolder", () => {
  it("does nothing when no folder is persisted", async () => {
    const { resume, onOpen } = fixture()
    resume.hidden = true
    loadFolder.mockResolvedValue(undefined)

    await restoreFolder(resume, onOpen)

    expect(resume.hidden).toBe(true)
    expect(onOpen).not.toHaveBeenCalled()
    expect(hasPermission).not.toHaveBeenCalled()
  })

  it("opens with zero clicks when permission is still granted", async () => {
    const { resume, onOpen } = fixture()
    resume.hidden = true
    loadFolder.mockResolvedValue(HANDLE)
    hasPermission.mockResolvedValue(true)

    await restoreFolder(resume, onOpen)

    expect(onOpen).toHaveBeenCalledWith(HANDLE)
    expect(resume.hidden).toBe(true)
    expect(requestAccess).not.toHaveBeenCalled()
  })

  it("reveals the resume button when permission must be re-granted", async () => {
    const { resume, onOpen } = fixture()
    resume.hidden = true
    loadFolder.mockResolvedValue(HANDLE)
    hasPermission.mockResolvedValue(false)

    await restoreFolder(resume, onOpen)

    expect(resume.hidden).toBe(false)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it("opens on a resume click that is granted", async () => {
    const { resume, onOpen } = fixture()
    resume.hidden = true
    loadFolder.mockResolvedValue(HANDLE)
    hasPermission.mockResolvedValue(false)
    requestAccess.mockResolvedValue(true)

    await restoreFolder(resume, onOpen)
    expect(resume.hidden).toBe(false) // restoreFolder revealed it

    resume.click()
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledWith(HANDLE))

    expect(resume.hidden).toBe(true)
  })

  it("keeps the resume button when a resume click is declined", async () => {
    const { resume, onOpen } = fixture()
    loadFolder.mockResolvedValue(HANDLE)
    hasPermission.mockResolvedValue(false)
    requestAccess.mockResolvedValue(false)

    await restoreFolder(resume, onOpen)
    resume.click()
    await vi.waitFor(() => expect(requestAccess).toHaveBeenCalled())

    expect(resume.hidden).toBe(false)
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe("renderNoteList", () => {
  it("renders one row per note, by name without the .md extension (AC-1)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["apple.md", "Banana.md"], "apple.md", vi.fn())

    const rows = container.querySelectorAll(".note-row")
    expect([...rows].map((r) => r.textContent)).toEqual(["apple", "Banana"])
  })

  it("marks exactly the active note's row (AC-2)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["apple.md", "banana.md"], "banana.md", vi.fn())

    const active = container.querySelectorAll(".note-row.active")
    expect(active).toHaveLength(1)
    expect(active[0].textContent).toBe("banana")
    expect(active[0].getAttribute("aria-current")).toBe("true")
  })

  it("calls onSelect with the filename when a row is clicked (AC-3)", () => {
    const container = document.createElement("div")
    const onSelect = vi.fn()
    renderNoteList(container, ["apple.md", "banana.md"], "apple.md", onSelect)

    container.querySelectorAll<HTMLElement>(".note-row")[1].click()
    expect(onSelect).toHaveBeenCalledWith("banana.md")
  })

  it("replaces previous rows on re-render", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["a.md", "b.md"], "a.md", vi.fn())
    renderNoteList(container, ["c.md"], "c.md", vi.fn())

    expect([...container.querySelectorAll(".note-row")].map((r) => r.textContent)).toEqual(["c"])
  })
})

describe("wireOpenFolder", () => {
  it("calls pickFolder on click, never on load (AC-1)", async () => {
    const { resume, onOpen } = fixture()
    const button = document.createElement("button")
    pickFolder.mockResolvedValue(null)

    wireOpenFolder(button, resume, onOpen)
    expect(pickFolder).not.toHaveBeenCalled()

    button.click()
    await Promise.resolve()

    expect(pickFolder).toHaveBeenCalledOnce()
  })
})
