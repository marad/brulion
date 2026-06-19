import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "./fs"
import { renderFileList, openFolder, wireOpenFolder } from "./ui"

vi.mock("./fs", () => ({
  pickFolder: vi.fn(),
  listMarkdownFiles: vi.fn(),
}))

const pickFolder = vi.mocked(fs.pickFolder)
const listMarkdownFiles = vi.mocked(fs.listMarkdownFiles)

const liTexts = (ul: HTMLUListElement) =>
  [...ul.querySelectorAll("li")].map((li) => li.textContent)

beforeEach(() => {
  vi.clearAllMocks()
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
  it("renders the picked folder's markdown files (AC-2)", async () => {
    const ul = document.createElement("ul")
    pickFolder.mockResolvedValue({} as FileSystemDirectoryHandle)
    listMarkdownFiles.mockResolvedValue(["x.md", "y.md"])

    await openFolder(ul)

    expect(liTexts(ul)).toEqual(["x.md", "y.md"])
  })

  it("leaves an existing list unchanged when the picker is dismissed (AC-4)", async () => {
    const ul = document.createElement("ul")
    renderFileList(ul, ["keep.md"])
    pickFolder.mockResolvedValue(null)

    await openFolder(ul)

    expect(liTexts(ul)).toEqual(["keep.md"])
    expect(listMarkdownFiles).not.toHaveBeenCalled()
  })

  it("does not throw and preserves the list when listing fails", async () => {
    const ul = document.createElement("ul")
    renderFileList(ul, ["keep.md"])
    pickFolder.mockResolvedValue({} as FileSystemDirectoryHandle)
    listMarkdownFiles.mockRejectedValue(new Error("io failure"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(openFolder(ul)).resolves.toBeUndefined()

    expect(liTexts(ul)).toEqual(["keep.md"])
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe("wireOpenFolder", () => {
  it("calls pickFolder on click, never on load (AC-1)", async () => {
    const button = document.createElement("button")
    const ul = document.createElement("ul")
    pickFolder.mockResolvedValue(null)

    wireOpenFolder(button, ul)
    expect(pickFolder).not.toHaveBeenCalled() // nothing fires on wiring

    button.click()
    await Promise.resolve()

    expect(pickFolder).toHaveBeenCalledOnce()
  })
})
