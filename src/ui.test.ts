import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "./fs"
import * as session from "./session"
import {
  openFolder,
  restoreFolder,
  wireOpenFolder,
  renderNoteList,
  wireNewNote,
  wireSidebarToggle,
} from "./ui"

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
  const handlers = () => ({ onSelect: vi.fn(), onDelete: vi.fn() })

  it("renders one row per note, by name without the .md extension (AC-1)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["apple.md", "Banana.md"], "apple.md", handlers())

    const rows = container.querySelectorAll(".note-name")
    expect([...rows].map((r) => r.textContent)).toEqual(["apple", "Banana"])
  })

  it("marks exactly the active note's row (AC-2)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["apple.md", "banana.md"], "banana.md", handlers())

    const active = container.querySelectorAll(".note-row.active")
    expect(active).toHaveLength(1)
    expect(active[0].querySelector(".note-name")?.textContent).toBe("banana")
    expect(active[0].getAttribute("aria-current")).toBe("true")
  })

  it("calls onSelect with the filename when a row is clicked (AC-3)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["apple.md", "banana.md"], "apple.md", h)

    container.querySelectorAll<HTMLElement>(".note-name")[1].click()
    expect(h.onSelect).toHaveBeenCalledWith("banana.md")
  })

  it("calls onDelete with the filename when a row's delete button is clicked (AC-5)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["apple.md", "banana.md"], "apple.md", h)

    container.querySelectorAll<HTMLElement>(".note-delete")[1].click()
    expect(h.onDelete).toHaveBeenCalledWith("banana.md")
    expect(h.onSelect).not.toHaveBeenCalled() // delete is not a select
  })

  it("replaces previous rows on re-render", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["a.md", "b.md"], "a.md", handlers())
    renderNoteList(container, ["c.md"], "c.md", handlers())

    expect([...container.querySelectorAll(".note-name")].map((r) => r.textContent)).toEqual(["c"])
  })
})

describe("wireNewNote", () => {
  it("submits the trimmed input value and clears the field", () => {
    const form = document.createElement("form")
    const input = document.createElement("input")
    form.append(input)
    const onCreate = vi.fn()
    wireNewNote(form, input, onCreate)

    input.value = "  My note  "
    form.requestSubmit()

    expect(onCreate).toHaveBeenCalledWith("My note")
    expect(input.value).toBe("")
  })

  it("ignores an empty submission", () => {
    const form = document.createElement("form")
    const input = document.createElement("input")
    form.append(input)
    const onCreate = vi.fn()
    wireNewNote(form, input, onCreate)

    input.value = "   "
    form.requestSubmit()

    expect(onCreate).not.toHaveBeenCalled()
  })
})

describe("wireSidebarToggle", () => {
  function sidebarFixture(initialCollapsed = false) {
    const button = document.createElement("button")
    const workspace = document.createElement("div")
    workspace.className = "workspace"
    const onChange = vi.fn()
    const handle = wireSidebarToggle(button, workspace, { initialCollapsed, onChange })
    return { button, workspace, onChange, handle }
  }

  it("reflects the restored state on wire, untouched by interaction (AC-4)", () => {
    const { workspace, button } = sidebarFixture(true)
    expect(workspace.classList.contains("sidebar-collapsed")).toBe(true)
    expect(button.getAttribute("aria-pressed")).toBe("true")
  })

  it("a click collapses, another restores, notifying onChange each time (AC-1)", () => {
    const { button, workspace, onChange } = sidebarFixture(false)
    expect(workspace.classList.contains("sidebar-collapsed")).toBe(false)

    button.click()
    expect(workspace.classList.contains("sidebar-collapsed")).toBe(true)
    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(onChange).toHaveBeenLastCalledWith(true)

    button.click()
    expect(workspace.classList.contains("sidebar-collapsed")).toBe(false)
    expect(button.getAttribute("aria-pressed")).toBe("false")
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it("the returned toggle() flips the state like a click (AC-3 — keyboard path)", () => {
    const { handle, workspace, onChange } = sidebarFixture(false)
    handle.toggle()
    expect(workspace.classList.contains("sidebar-collapsed")).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith(true)
  })

  it("toggling never touches the sidebar's `hidden` attribute (AC-6)", () => {
    // Collapse is orthogonal to folder-open. The toggle only flips the workspace
    // class; the `#sidebar[hidden]` (folder-open) state is owned elsewhere.
    const { button, workspace } = sidebarFixture(false)
    const sidebar = document.createElement("aside")
    sidebar.hidden = true
    workspace.append(sidebar)

    button.click() // collapse
    expect(sidebar.hidden).toBe(true) // unchanged by the toggle
    button.click() // restore
    expect(sidebar.hidden).toBe(true) // still owned by folder-open, not the toggle
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
