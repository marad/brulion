import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "./fs"
import * as session from "./session"
import { renderFileList, openFolder, restoreFolder, wireOpenFolder } from "./ui"

vi.mock("./fs", () => ({
  pickFolder: vi.fn(),
  listMarkdownFiles: vi.fn(),
}))
vi.mock("./session", () => ({
  saveFolder: vi.fn(),
  loadFolder: vi.fn(),
  hasPermission: vi.fn(),
  requestAccess: vi.fn(),
}))

const pickFolder = vi.mocked(fs.pickFolder)
const listMarkdownFiles = vi.mocked(fs.listMarkdownFiles)
const saveFolder = vi.mocked(session.saveFolder)
const loadFolder = vi.mocked(session.loadFolder)
const hasPermission = vi.mocked(session.hasPermission)
const requestAccess = vi.mocked(session.requestAccess)

const HANDLE = { kind: "directory", name: "root" } as unknown as FileSystemDirectoryHandle

const liTexts = (ul: HTMLUListElement) =>
  [...ul.querySelectorAll("li")].map((li) => li.textContent)

function elements() {
  return {
    list: document.createElement("ul"),
    resume: document.createElement("button"),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  listMarkdownFiles.mockResolvedValue([])
})

describe("renderFileList", () => {
  it("renders one li per name", () => {
    const ul = document.createElement("ul")
    renderFileList(ul, ["a.md", "b.md"])
    expect(liTexts(ul)).toEqual(["a.md", "b.md"])
  })

  it("clears a previously rendered list when given an empty array", () => {
    const ul = document.createElement("ul")
    renderFileList(ul, ["old.md"])
    renderFileList(ul, [])
    expect(liTexts(ul)).toEqual([])
  })
})

describe("openFolder", () => {
  it("persists and lists the picked folder, hiding the resume button (AC-1)", async () => {
    const { list, resume } = elements()
    resume.hidden = false
    pickFolder.mockResolvedValue(HANDLE)
    listMarkdownFiles.mockResolvedValue(["x.md", "y.md"])

    await openFolder(list, resume)

    expect(saveFolder).toHaveBeenCalledWith(HANDLE)
    expect(resume.hidden).toBe(true)
    expect(liTexts(list)).toEqual(["x.md", "y.md"])
  })

  it("leaves an existing list unchanged when the picker is dismissed", async () => {
    const { list, resume } = elements()
    renderFileList(list, ["keep.md"])
    pickFolder.mockResolvedValue(null)

    await openFolder(list, resume)

    expect(liTexts(list)).toEqual(["keep.md"])
    expect(saveFolder).not.toHaveBeenCalled()
  })

  it("does not throw, preserves the list, and does not persist when listing fails", async () => {
    const { list, resume } = elements()
    resume.hidden = false
    renderFileList(list, ["keep.md"])
    pickFolder.mockResolvedValue(HANDLE)
    listMarkdownFiles.mockRejectedValue(new Error("io failure"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(openFolder(list, resume)).resolves.toBeUndefined()

    expect(liTexts(list)).toEqual(["keep.md"])
    expect(saveFolder).not.toHaveBeenCalled() // an unreadable handle is not persisted
    expect(resume.hidden).toBe(true) // a fresh pick supersedes the resume flow
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe("restoreFolder", () => {
  it("does nothing when no folder is persisted (AC-4)", async () => {
    const { list, resume } = elements()
    resume.hidden = true // initial state from index.html
    loadFolder.mockResolvedValue(undefined)

    await restoreFolder(list, resume)

    expect(resume.hidden).toBe(true) // not revealed
    expect(liTexts(list)).toEqual([])
    expect(hasPermission).not.toHaveBeenCalled()
  })

  it("lists files with zero clicks when permission is still granted (AC-2)", async () => {
    const { list, resume } = elements()
    resume.hidden = true
    loadFolder.mockResolvedValue(HANDLE)
    hasPermission.mockResolvedValue(true)
    listMarkdownFiles.mockResolvedValue(["note.md"])

    await restoreFolder(list, resume)

    expect(liTexts(list)).toEqual(["note.md"])
    expect(listMarkdownFiles).toHaveBeenCalledWith(HANDLE)
    expect(resume.hidden).toBe(true)
    expect(requestAccess).not.toHaveBeenCalled()
  })

  it("shows the resume button when permission must be re-granted (AC-3)", async () => {
    const { list, resume } = elements()
    resume.hidden = true
    loadFolder.mockResolvedValue(HANDLE)
    hasPermission.mockResolvedValue(false)

    await restoreFolder(list, resume)

    expect(resume.hidden).toBe(false)
    expect(liTexts(list)).toEqual([])
  })

  it("restores access on a resume click that is granted (AC-3)", async () => {
    const { list, resume } = elements()
    resume.hidden = true // initial state from index.html
    loadFolder.mockResolvedValue(HANDLE)
    hasPermission.mockResolvedValue(false)
    requestAccess.mockResolvedValue(true)
    listMarkdownFiles.mockResolvedValue(["note.md"])

    await restoreFolder(list, resume)
    expect(resume.hidden).toBe(false) // restoreFolder revealed the button

    resume.click()
    await vi.waitFor(() => expect(liTexts(list)).toEqual(["note.md"]))

    expect(resume.hidden).toBe(true)
  })

  it("keeps the resume button when a resume click is declined (AC-3)", async () => {
    const { list, resume } = elements()
    loadFolder.mockResolvedValue(HANDLE)
    hasPermission.mockResolvedValue(false)
    requestAccess.mockResolvedValue(false)

    await restoreFolder(list, resume)
    resume.click()
    await vi.waitFor(() => expect(requestAccess).toHaveBeenCalled())

    expect(resume.hidden).toBe(false)
    expect(liTexts(list)).toEqual([]) // nothing rendered
    expect(listMarkdownFiles).not.toHaveBeenCalled() // declined => never lists
  })
})

describe("wireOpenFolder", () => {
  it("calls pickFolder on click, never on load", async () => {
    const { list, resume } = elements()
    const button = document.createElement("button")
    pickFolder.mockResolvedValue(null)

    wireOpenFolder(button, list, resume)
    expect(pickFolder).not.toHaveBeenCalled()

    button.click()
    await Promise.resolve()

    expect(pickFolder).toHaveBeenCalledOnce()
  })
})
