import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "./fs"
import * as session from "./session"
import { closeTreeMenu } from "./tree-menu"
import {
  openFolder,
  restoreVault,
  wireOpenFolder,
  renderNoteList,
  buildNoteTree,
  derivedFolderPaths,
  wireToggle,
  showWorkspace,
  mountNoteIdentity,
  mountMissingNoteBanner,
  clampSidebarWidth,
  wireSidebarResize,
  renderActionBar,
  markMotionReady,
  SIDEBAR_MIN_PX,
} from "./ui"
import type { Action } from "./actions"
import type { IconNode } from "lucide"

// A minimal valid Lucide IconNode (array of [tag, attrs] children) for icon assertions.
const FAKE_ICON = [["path", { d: "M0 0h24v24H0z" }]] as unknown as IconNode

vi.mock("./fs", () => ({ pickFolder: vi.fn() }))
vi.mock("./session", () => ({
  hasPermission: vi.fn(),
  requestAccess: vi.fn(),
}))

const pickFolder = vi.mocked(fs.pickFolder)
const hasPermission = vi.mocked(session.hasPermission)
const requestAccess = vi.mocked(session.requestAccess)

const HANDLE = { kind: "directory", name: "root" } as unknown as FileSystemDirectoryHandle
const VAULT = { id: "v1", handle: HANDLE, name: "root" }

function fixture() {
  return {
    resume: document.createElement("button"),
    onOpen: vi.fn().mockResolvedValue(undefined),
    onAttach: vi.fn().mockResolvedValue(undefined),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  closeTreeMenu()
  document.body.innerHTML = ""
})

// FEAT-0071: every row action now lives behind a right-click/long-press
// context menu (tree-menu.ts) rather than an inline button.
function openMenuOn(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
}
function menuLabels(): (string | null)[] {
  return [...document.querySelectorAll<HTMLElement>(".cm-context-menu button[role=menuitem]")].map(
    (b) => b.textContent,
  )
}
function clickMenuItem(label: string): void {
  const item = [...document.querySelectorAll<HTMLElement>(".cm-context-menu button[role=menuitem]")].find(
    (b) => b.textContent === label,
  )
  item!.click()
}
// happy-dom has no native TouchEvent — a plain Event with a `touches` array
// attached is enough for the long-press wiring, which only ever reads it.
function touchEvent(type: string, points: Array<{ clientX: number; clientY: number }>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "touches", { value: points, configurable: true })
  return event
}

describe("openFolder", () => {
  it("picks the folder and hands it to onOpen, hiding the resume button (AC-1)", async () => {
    const { resume, onOpen } = fixture()
    resume.hidden = false
    pickFolder.mockResolvedValue(HANDLE)

    await openFolder(resume, onOpen)

    expect(onOpen).toHaveBeenCalledWith(HANDLE)
    expect(resume.hidden).toBe(true)
  })

  it("is a no-op when the picker is dismissed (AC-4)", async () => {
    const { resume, onOpen } = fixture()
    pickFolder.mockResolvedValue(null)

    await openFolder(resume, onOpen)

    expect(onOpen).not.toHaveBeenCalled()
  })

  it("does not throw when opening fails", async () => {
    const { resume, onOpen } = fixture()
    resume.hidden = false
    pickFolder.mockResolvedValue(HANDLE)
    onOpen.mockRejectedValue(new Error("read failure"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(openFolder(resume, onOpen)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe("restoreVault (FEAT-0059)", () => {
  it("attaches with zero clicks when permission is still granted (AC-2)", async () => {
    const { resume, onAttach } = fixture()
    resume.hidden = true
    hasPermission.mockResolvedValue(true)

    await restoreVault(VAULT, resume, onAttach)

    expect(onAttach).toHaveBeenCalledWith(VAULT)
    expect(resume.hidden).toBe(true)
    expect(requestAccess).not.toHaveBeenCalled()
  })

  it("reveals the resume button when permission must be re-granted (AC-7)", async () => {
    const { resume, onAttach } = fixture()
    resume.hidden = true
    hasPermission.mockResolvedValue(false)

    await restoreVault(VAULT, resume, onAttach)

    expect(resume.hidden).toBe(false)
    expect(onAttach).not.toHaveBeenCalled()
  })

  it("attaches on a resume click that is granted (AC-7)", async () => {
    const { resume, onAttach } = fixture()
    resume.hidden = true
    hasPermission.mockResolvedValue(false)
    requestAccess.mockResolvedValue(true)

    await restoreVault(VAULT, resume, onAttach)
    expect(resume.hidden).toBe(false) // restoreVault revealed it

    resume.click()
    await vi.waitFor(() => expect(onAttach).toHaveBeenCalledWith(VAULT))

    expect(resume.hidden).toBe(true)
  })

  it("keeps the resume button when a resume click is declined", async () => {
    const { resume, onAttach } = fixture()
    hasPermission.mockResolvedValue(false)
    requestAccess.mockResolvedValue(false)

    await restoreVault(VAULT, resume, onAttach)
    resume.click()
    await vi.waitFor(() => expect(requestAccess).toHaveBeenCalled())

    expect(resume.hidden).toBe(false)
    expect(onAttach).not.toHaveBeenCalled()
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

  it("gives each row a full-path tooltip (titles, since rows ellipsize)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["sub/diablo.md", "ideas.md"], "ideas.md", handlers())

    const titles = [...container.querySelectorAll<HTMLElement>(".note-name")].map((r) => r.title)
    expect(titles).toEqual(["sub/diablo", "ideas"])
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

  it("calls onDelete with the filename when Delete is picked from the row's context menu (AC-5, FEAT-0071 AC-1)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["apple.md", "banana.md"], "apple.md", h)

    openMenuOn(container.querySelectorAll<HTMLElement>(".note-row")[1])
    clickMenuItem("Delete")
    expect(h.onDelete).toHaveBeenCalledWith("banana.md")
    expect(h.onSelect).not.toHaveBeenCalled() // delete is not a select
  })

  it("a note row has no inline action buttons (FEAT-0071)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["apple.md"], "apple.md", handlers())

    expect(container.querySelector(".note-delete")).toBeNull()
    expect(container.querySelector(".note-move")).toBeNull()
  })

  it("replaces previous rows on re-render", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["a.md", "b.md"], "a.md", handlers())
    renderNoteList(container, ["c.md"], "c.md", handlers())

    expect([...container.querySelectorAll(".note-name")].map((r) => r.textContent)).toEqual(["c"])
  })
})

describe("buildNoteTree (AC-1)", () => {
  it("groups a sorted flat path list into a nested tree, preserving order", () => {
    expect(buildNoteTree(["a.md", "sub/b.md", "sub/d.md", "sub/deep/c.md"])).toEqual([
      { kind: "note", name: "a", path: "a.md" },
      {
        kind: "folder",
        name: "sub",
        path: "sub",
        children: [
          { kind: "note", name: "b", path: "sub/b.md" },
          { kind: "note", name: "d", path: "sub/d.md" },
          {
            kind: "folder",
            name: "deep",
            path: "sub/deep",
            children: [{ kind: "note", name: "c", path: "sub/deep/c.md" }],
          },
        ],
      },
    ])
  })

  it("returns a flat list of notes when there are no folders", () => {
    expect(buildNoteTree(["apple.md", "banana.md"])).toEqual([
      { kind: "note", name: "apple", path: "apple.md" },
      { kind: "note", name: "banana", path: "banana.md" },
    ])
  })
})

describe("buildNoteTree with empty folders (FEAT-0069 AC-1, AC-2)", () => {
  it("includes a folder with no notes in it", () => {
    expect(buildNoteTree([], ["ideas"])).toEqual([
      { kind: "folder", name: "ideas", path: "ideas", children: [] },
    ])
  })

  it("materializes a nested empty folder's ancestor chain", () => {
    expect(buildNoteTree([], ["projects/ideas"])).toEqual([
      {
        kind: "folder",
        name: "projects",
        path: "projects",
        children: [{ kind: "folder", name: "ideas", path: "projects/ideas", children: [] }],
      },
    ])
  })

  it("interleaves an empty folder alphabetically with populated siblings, not trailing after them", () => {
    const tree = buildNoteTree(["projects/a.md"], ["apples"])
    expect(tree.map((n) => n.name)).toEqual(["apples", "projects"])
  })

  it("does not duplicate a folder that already has notes in it", () => {
    const tree = buildNoteTree(["projects/a.md"], ["projects"])
    expect(tree).toEqual([
      {
        kind: "folder",
        name: "projects",
        path: "projects",
        children: [{ kind: "note", name: "a", path: "projects/a.md" }],
      },
    ])
  })
})

describe("derivedFolderPaths (FEAT-0070)", () => {
  it("collects every folder prefix implied by note paths", () => {
    expect(derivedFolderPaths(["a.md", "sub/b.md", "sub/deep/c.md"], [])).toEqual(["sub", "sub/deep"])
  })

  it("unions in the explicit empty-folders list, deduped and sorted", () => {
    expect(derivedFolderPaths(["projects/a.md"], ["apples", "projects"])).toEqual(["apples", "projects"])
  })

  it("returns an empty list when there are no folders at all", () => {
    expect(derivedFolderPaths(["a.md", "b.md"], [])).toEqual([])
  })
})

describe("renderNoteList tree (FEAT-0024)", () => {
  const handlers = () => ({ onSelect: vi.fn(), onDelete: vi.fn(), onToggleFolder: vi.fn() })

  const folderHeader = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll<HTMLElement>(".folder-header")].find(
      (h) => h.textContent?.trim() === name,
    )
  const rowFor = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll<HTMLElement>(".note-row")].find(
      (r) => r.querySelector(".note-name")?.textContent === name,
    )

  it("renders a folder header with its note nested, root notes at top level (AC-2)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["root.md", "sub/b.md"], "root.md", handlers())

    expect(folderHeader(container, "sub")).toBeTruthy()
    // the root note is a direct child of the container, not inside a folder
    const root = rowFor(container, "root")!
    expect(root.parentElement).toBe(container)
    expect(root.closest(".folder-children")).toBeNull()
    // the nested note lives inside the sub folder's children
    expect(rowFor(container, "b")!.closest(".folder-children")).not.toBeNull()
  })

  it("selects and deletes a nested note by its full path (AC-3)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    rowFor(container, "b")!.querySelector<HTMLElement>(".note-name")!.click()
    expect(h.onSelect).toHaveBeenCalledWith("sub/b.md")
    openMenuOn(rowFor(container, "b")!)
    clickMenuItem("Delete")
    expect(h.onDelete).toHaveBeenCalledWith("sub/b.md")
  })

  it("renders a folder collapsed by default when absent from the expanded set (FEAT-0043 AC-1)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["root.md", "sub/b.md"], "root.md", handlers())

    expect(container.querySelector<HTMLElement>(".folder-children")!.hidden).toBe(true)
  })

  it("renders a folder expanded when its path is in the expanded set (FEAT-0043 AC-2)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["root.md", "sub/b.md"], "root.md", handlers(), new Set(["sub"]))

    expect(container.querySelector<HTMLElement>(".folder-children")!.hidden).toBe(false)
  })

  it("collapsing an expanded folder reports onToggleFolder(path, true) (FEAT-0043 AC-5)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["root.md", "sub/b.md"], "root.md", h, new Set(["sub"]))
    const children = container.querySelector<HTMLElement>(".folder-children")!
    expect(children.hidden).toBe(false)

    folderHeader(container, "sub")!.click()
    expect(children.hidden).toBe(true)
    expect(h.onToggleFolder).toHaveBeenCalledWith("sub", true)
  })

  it("expanding a collapsed folder reports onToggleFolder(path, false) (FEAT-0043 AC-4)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["root.md", "sub/b.md"], "root.md", h)
    const children = container.querySelector<HTMLElement>(".folder-children")!
    expect(children.hidden).toBe(true)

    folderHeader(container, "sub")!.click()
    expect(children.hidden).toBe(false)
    expect(h.onToggleFolder).toHaveBeenCalledWith("sub", false)
  })

  it("force-expands ancestors of the active note despite absence from the set, without mutating it (FEAT-0043 AC-3)", () => {
    const container = document.createElement("div")
    const expanded = new Set<string>()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", handlers(), expanded)

    expect(container.querySelector<HTMLElement>(".folder-children")!.hidden).toBe(false)
    expect([...expanded]).toEqual([]) // render reads, never writes, the set
  })

  it("marks exactly the active note's row wherever it sits (AC-6)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["root.md", "sub/b.md"], "sub/b.md", handlers())

    const active = container.querySelectorAll(".note-row.active")
    expect(active).toHaveLength(1)
    expect(active[0].querySelector(".note-name")?.textContent).toBe("b")
    expect(active[0].getAttribute("aria-current")).toBe("true")
  })
})

describe("renderNoteList folder context menu (FEAT-0069/FEAT-0071)", () => {
  const handlers = () => ({
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onCreateFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
  })

  it("calls onCreateFolder with the folder's path when New subfolder… is picked (AC-1, AC-2)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    openMenuOn(container.querySelector<HTMLElement>(".folder-header")!)
    clickMenuItem("New subfolder…")
    expect(h.onCreateFolder).toHaveBeenCalledWith("sub")
  })

  it("calls onDeleteFolder with the folder's path when Delete is picked (AC-5, AC-6)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    openMenuOn(container.querySelector<HTMLElement>(".folder-header")!)
    clickMenuItem("Delete")
    expect(h.onDeleteFolder).toHaveBeenCalledWith("sub")
  })

  it("leaves the existing folder-header toggle untouched (no regression)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    container.querySelector<HTMLElement>(".folder-header")!.click()
    expect(container.querySelector<HTMLElement>(".folder-children")!.hidden).toBe(true)
    expect(h.onCreateFolder).not.toHaveBeenCalled()
    expect(h.onDeleteFolder).not.toHaveBeenCalled()
  })

  it("renders an empty folder passed via the folders argument (AC-1, AC-2)", () => {
    const container = document.createElement("div")
    renderNoteList(container, [], "", handlers(), new Set(), ["ideas"])

    expect([...container.querySelectorAll(".folder-header")].map((el) => el.textContent)).toEqual(["ideas"])
  })

  it("a folder row has no inline action buttons (FEAT-0071)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["sub/b.md"], "sub/b.md", handlers())

    expect(container.querySelector(".folder-create")).toBeNull()
    expect(container.querySelector(".folder-move")).toBeNull()
    expect(container.querySelector(".folder-delete")).toBeNull()
  })
})

describe("renderNoteList move via context menu (FEAT-0070/FEAT-0071)", () => {
  const handlers = () => ({
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onMoveNote: vi.fn(),
    onMoveFolder: vi.fn(),
  })

  it("calls onMoveNote with the note's path when Move… is picked (AC-1)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    openMenuOn(container.querySelector<HTMLElement>(".note-row")!)
    clickMenuItem("Move…")
    expect(h.onMoveNote).toHaveBeenCalledWith("sub/b.md")
  })

  it("calls onMoveFolder with the folder's path when Move… is picked on the folder row (AC-3)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    openMenuOn(container.querySelector<HTMLElement>(".folder-header")!)
    clickMenuItem("Move…")
    expect(h.onMoveFolder).toHaveBeenCalledWith("sub")
  })
})

describe("tree row context menu shape (FEAT-0071)", () => {
  const handlers = () => ({
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onCreateFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onMoveNote: vi.fn(),
    onMoveFolder: vi.fn(),
  })

  it("a note row's context menu has exactly Move… and Delete (AC-1)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["a.md"], "a.md", handlers())

    openMenuOn(container.querySelector<HTMLElement>(".note-row")!)

    expect(menuLabels()).toEqual(["Rename…", "Move…", "Delete"])
  })

  it("a folder row's context menu has exactly New subfolder…, Move…, and Delete (AC-2)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["sub/a.md"], "sub/a.md", handlers())

    openMenuOn(container.querySelector<HTMLElement>(".folder-header")!)

    expect(menuLabels()).toEqual(["New subfolder…", "New note…", "Rename…", "Move…", "Delete"])
  })

  it("the contextmenu event does not bubble to the native menu (preventDefault)", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["a.md"], "a.md", handlers())
    const row = container.querySelector<HTMLElement>(".note-row")!
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })

    row.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
  })

  it("opens the same menu via long-press on a note row (AC-5)", () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    renderNoteList(container, ["a.md"], "a.md", handlers())
    const row = container.querySelector<HTMLElement>(".note-row")!

    row.dispatchEvent(touchEvent("touchstart", [{ clientX: 5, clientY: 5 }]))
    vi.advanceTimersByTime(500)

    expect(menuLabels()).toEqual(["Rename…", "Move…", "Delete"])
    vi.useRealTimers()
  })

  it("opens the same menu via long-press on a folder row (AC-5)", () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    renderNoteList(container, ["sub/a.md"], "sub/a.md", handlers())
    const header = container.querySelector<HTMLElement>(".folder-header")!

    header.dispatchEvent(touchEvent("touchstart", [{ clientX: 5, clientY: 5 }]))
    vi.advanceTimersByTime(500)

    expect(menuLabels()).toEqual(["New subfolder…", "New note…", "Rename…", "Move…", "Delete"])
    vi.useRealTimers()
  })

  it("a long-press suppresses the row's own tap action (no onSelect alongside the menu, AC-5)", () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["a.md"], "a.md", h)
    const row = container.querySelector<HTMLElement>(".note-row")!

    row.dispatchEvent(touchEvent("touchstart", [{ clientX: 5, clientY: 5 }]))
    vi.advanceTimersByTime(500)
    row.dispatchEvent(touchEvent("touchend", []))

    expect(h.onSelect).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("moving past the tolerance cancels a long-press; the lift behaves as an ordinary tap (AC-6)", () => {
    vi.useFakeTimers()
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["a.md"], "a.md", h)
    const row = container.querySelector<HTMLElement>(".note-row")!

    row.dispatchEvent(touchEvent("touchstart", [{ clientX: 5, clientY: 5 }]))
    row.dispatchEvent(touchEvent("touchmove", [{ clientX: 40, clientY: 5 }]))
    vi.advanceTimersByTime(500)

    expect(menuLabels()).toEqual([])
    vi.useRealTimers()
  })
})

describe("renderNoteList create-in-folder and rename menu items (FEAT-0072)", () => {
  const handlers = () => ({
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onCreateFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onMoveNote: vi.fn(),
    onMoveFolder: vi.fn(),
    onCreateNoteIn: vi.fn(),
    onRenameNote: vi.fn(),
    onRenameFolder: vi.fn(),
  })

  it("calls onCreateNoteIn with the folder's path when New note… is picked (AC-1)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    openMenuOn(container.querySelector<HTMLElement>(".folder-header")!)
    clickMenuItem("New note…")
    expect(h.onCreateNoteIn).toHaveBeenCalledWith("sub")
  })

  it("calls onRenameNote with the note's path when Rename… is picked (AC-4)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    openMenuOn(container.querySelector<HTMLElement>(".note-row")!)
    clickMenuItem("Rename…")
    expect(h.onRenameNote).toHaveBeenCalledWith("sub/b.md")
  })

  it("calls onRenameFolder with the folder's path when Rename… is picked (AC-3)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/b.md"], "sub/b.md", h)

    openMenuOn(container.querySelector<HTMLElement>(".folder-header")!)
    clickMenuItem("Rename…")
    expect(h.onRenameFolder).toHaveBeenCalledWith("sub")
  })
})

describe("renderNoteList drag-and-drop (FEAT-0072)", () => {
  const handlers = () => ({
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onDropNote: vi.fn(),
    onDropFolder: vi.fn(),
  })

  // happy-dom has no real DataTransfer — a plain object with the methods our
  // wiring calls (only `setData`, on dragstart, for browser compliance) is enough;
  // the actual "what's being dragged" state lives in ui.ts's own module scope.
  function dragEvent(type: string): Event {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, "dataTransfer", {
      value: { setData: vi.fn(), getData: vi.fn(), types: [] },
      configurable: true,
    })
    return event
  }

  it("marks note rows and folder headers as draggable", () => {
    const container = document.createElement("div")
    renderNoteList(container, ["sub/b.md"], "sub/b.md", handlers())

    expect(container.querySelector(".note-row")!.getAttribute("draggable")).toBe("true")
    expect(container.querySelector(".folder-header")!.getAttribute("draggable")).toBe("true")
  })

  it("dropping a dragged note onto a folder calls onDropNote(path, destination) (AC-5)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["a.md", "sub/b.md"], "a.md", h)
    const noteRow = container.querySelector<HTMLElement>(".note-row")!
    const folderHeader = container.querySelector<HTMLElement>(".folder-header")!

    noteRow.dispatchEvent(dragEvent("dragstart"))
    folderHeader.dispatchEvent(dragEvent("dragover"))
    folderHeader.dispatchEvent(dragEvent("drop"))

    expect(h.onDropNote).toHaveBeenCalledWith("a.md", "sub")
  })

  it("dropping a dragged folder onto another folder calls onDropFolder(path, destination) (AC-6)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/a.md", "archive/b.md"], "sub/a.md", h)
    const subHeader = [...container.querySelectorAll<HTMLElement>(".folder-header")].find(
      (el) => el.textContent === "sub",
    )!
    const archiveHeader = [...container.querySelectorAll<HTMLElement>(".folder-header")].find(
      (el) => el.textContent === "archive",
    )!

    subHeader.dispatchEvent(dragEvent("dragstart"))
    archiveHeader.dispatchEvent(dragEvent("dragover"))
    archiveHeader.dispatchEvent(dragEvent("drop"))

    expect(h.onDropFolder).toHaveBeenCalledWith("sub", "archive")
  })

  it("dropping onto the root zone calls the handler with an empty destination", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/a.md"], "sub/a.md", h)
    const noteRow = container.querySelector<HTMLElement>(".note-row")!

    noteRow.dispatchEvent(dragEvent("dragstart"))
    container.dispatchEvent(dragEvent("dragover"))
    container.dispatchEvent(dragEvent("drop"))

    expect(h.onDropNote).toHaveBeenCalledWith("sub/a.md", "")
  })

  it("dropping onto a nested note row does not bubble to the root zone (a note isn't a container)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["todo.md", "archive/keep.md"], "todo.md", h)
    const rows = [...container.querySelectorAll<HTMLElement>(".note-row")]
    const todoRow = rows.find((el) => el.textContent === "todo")!
    const keepRow = rows.find((el) => el.textContent === "keep")! // inside "archive"

    todoRow.dispatchEvent(dragEvent("dragstart"))
    keepRow.dispatchEvent(dragEvent("dragover"))
    keepRow.dispatchEvent(dragEvent("drop"))

    expect(h.onDropNote).not.toHaveBeenCalled()
  })

  it("a row's own drop does not also trigger the root zone's drop", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["a.md", "sub/b.md"], "a.md", h)
    const noteRow = container.querySelector<HTMLElement>(".note-row")!
    const folderHeader = container.querySelector<HTMLElement>(".folder-header")!

    noteRow.dispatchEvent(dragEvent("dragstart"))
    folderHeader.dispatchEvent(dragEvent("dragover"))
    folderHeader.dispatchEvent(dragEvent("drop"))

    expect(h.onDropNote).toHaveBeenCalledTimes(1)
    expect(h.onDropNote).toHaveBeenCalledWith("a.md", "sub") // not "" (root)
  })

  it("dragging a folder onto itself does not call onDropFolder (self-nest guard)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/a.md"], "sub/a.md", h)
    const header = container.querySelector<HTMLElement>(".folder-header")!

    header.dispatchEvent(dragEvent("dragstart"))
    header.dispatchEvent(dragEvent("dragover"))
    header.dispatchEvent(dragEvent("drop"))

    expect(h.onDropFolder).not.toHaveBeenCalled()
  })

  it("dragging a folder onto its own descendant does not call onDropFolder (AC-7)", () => {
    const container = document.createElement("div")
    const h = handlers()
    renderNoteList(container, ["sub/ideas/a.md"], "sub/ideas/a.md", h)
    const subHeader = [...container.querySelectorAll<HTMLElement>(".folder-header")].find(
      (el) => el.textContent === "sub",
    )!
    const ideasHeader = [...container.querySelectorAll<HTMLElement>(".folder-header")].find(
      (el) => el.textContent === "ideas",
    )!

    subHeader.dispatchEvent(dragEvent("dragstart"))
    ideasHeader.dispatchEvent(dragEvent("dragover"))
    ideasHeader.dispatchEvent(dragEvent("drop"))

    expect(h.onDropFolder).not.toHaveBeenCalled()
  })
})

describe("wireToggle", () => {
  function toggleFixture(initialOn = false) {
    const button = document.createElement("button")
    const apply = vi.fn()
    const onChange = vi.fn()
    const handle = wireToggle(button, { initialOn, apply, onChange })
    return { button, apply, onChange, handle }
  }

  it("applies the restored state on wire and mirrors it in aria-pressed (FEAT-0020/0021 AC-4/AC-3)", () => {
    const { button, apply, onChange } = toggleFixture(true)
    // `apply` runs on wire (so the page loads in the saved mode); `onChange`
    // (persistence) does NOT — only a user flip should write back.
    expect(apply).toHaveBeenCalledOnce()
    expect(apply).toHaveBeenCalledWith(true)
    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("a click flips the state, re-applying and notifying onChange each time (AC-1/AC-2)", () => {
    const { button, apply, onChange } = toggleFixture(false)
    expect(apply).toHaveBeenLastCalledWith(false)

    button.click()
    expect(apply).toHaveBeenLastCalledWith(true)
    expect(button.getAttribute("aria-pressed")).toBe("true")
    expect(onChange).toHaveBeenLastCalledWith(true)

    button.click()
    expect(apply).toHaveBeenLastCalledWith(false)
    expect(button.getAttribute("aria-pressed")).toBe("false")
    expect(onChange).toHaveBeenLastCalledWith(false)
  })

  it("the returned toggle() flips the state like a click (the keyboard path, AC-3)", () => {
    const { handle, apply, onChange } = toggleFixture(false)
    handle.toggle()
    expect(apply).toHaveBeenLastCalledWith(true)
    expect(onChange).toHaveBeenLastCalledWith(true)
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

describe("showWorkspace (FEAT-0031)", () => {
  it("hides the welcome hero and reveals the in-note controls (AC-2)", () => {
    const el = () => document.createElement("div")
    const welcome = el()
    const sidebar = el()
    const toggleSidebar = el()
    const settings = el()
    const identity = el()
    const resizer = el()
    const actionBar = el()
    // Pre-folder state: hero shown, controls hidden.
    welcome.hidden = false
    sidebar.hidden = true
    toggleSidebar.hidden = true
    settings.hidden = true
    identity.hidden = true
    resizer.hidden = true
    actionBar.hidden = true

    showWorkspace({ welcome, sidebar, toggleSidebar, settings, identity, resizer, actionBar })

    expect(welcome.hidden).toBe(true)
    expect(sidebar.hidden).toBe(false)
    expect(toggleSidebar.hidden).toBe(false)
    expect(settings.hidden).toBe(false)
    expect(identity.hidden).toBe(false)
    expect(resizer.hidden).toBe(false)
    expect(actionBar.hidden).toBe(false)
  })
})

describe("renderActionBar (FEAT-0058 AC-2)", () => {
  it("renders one icon-only button per action, label as tooltip + aria-label, wired to run", () => {
    const container = document.createElement("div")
    const run = vi.fn()
    const list: Action[] = [
      { id: "a", label: "Action A", icon: FAKE_ICON, run },
      { id: "b", label: "Action B", icon: FAKE_ICON, run: vi.fn() },
    ]
    renderActionBar(container, list)

    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".action-bar-button")]
    expect(buttons).toHaveLength(2)
    // Icon-only: an <svg> is present, the label is NOT visible text…
    expect(buttons[0].querySelector("svg")).not.toBeNull()
    expect(buttons[0].textContent).toBe("")
    // …but it is the tooltip and the accessible name.
    expect(buttons[0].title).toBe("Action A")
    expect(buttons[0].getAttribute("aria-label")).toBe("Action A")
    buttons[0].click()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("clears on re-render (replace, not append) and renders nothing for an empty list", () => {
    const container = document.createElement("div")
    renderActionBar(container, [
      { id: "a", label: "A", icon: FAKE_ICON, run: vi.fn() },
      { id: "b", label: "B", icon: FAKE_ICON, run: vi.fn() },
    ])
    expect(container.querySelectorAll(".action-bar-button")).toHaveLength(2)
    renderActionBar(container, [])
    expect(container.querySelectorAll(".action-bar-button")).toHaveLength(0)
  })

  it("falls back to a visible label for an action with no icon (never a blank button)", () => {
    const container = document.createElement("div")
    renderActionBar(container, [{ id: "x", label: "No icon", run: vi.fn() }])
    const button = container.querySelector<HTMLButtonElement>(".action-bar-button")
    expect(button?.querySelector("svg")).toBeNull()
    expect(button?.textContent).toContain("No icon")
  })
})

describe("clampSidebarWidth (FEAT-0044)", () => {
  it("returns a width at or above the minimum unchanged — no upper bound (AC-1)", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_PX)).toBe(SIDEBAR_MIN_PX)
    expect(clampSidebarWidth(300)).toBe(300)
    expect(clampSidebarWidth(99999)).toBe(99999) // no fixed max — the editor's min-width caps the render
  })

  it("clamps a too-small width up to the minimum (AC-2)", () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_PX - 1)).toBe(SIDEBAR_MIN_PX)
    expect(clampSidebarWidth(0)).toBe(SIDEBAR_MIN_PX)
    expect(clampSidebarWidth(-50)).toBe(SIDEBAR_MIN_PX)
  })

  it("floors any non-finite width to the minimum (corrupt stored value) (AC-2)", () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_MIN_PX)
    expect(clampSidebarWidth(Infinity)).toBe(SIDEBAR_MIN_PX)
    expect(clampSidebarWidth(-Infinity)).toBe(SIDEBAR_MIN_PX)
  })
})

describe("wireSidebarResize (FEAT-0044)", () => {
  const varOf = (sidebar: HTMLElement) => sidebar.style.getPropertyValue("--sidebar-width")

  it("applies a clamped initial width to the sidebar's CSS basis var (AC-5)", () => {
    const handle = document.createElement("div")
    const sidebar = document.createElement("aside")
    wireSidebarResize(handle, sidebar, { initialWidth: 300, onChange: vi.fn() })
    expect(varOf(sidebar)).toBe("300px")
  })

  it("floors a too-small stored width to the minimum before applying it (AC-2)", () => {
    const handle = document.createElement("div")
    const sidebar = document.createElement("aside")
    wireSidebarResize(handle, sidebar, { initialWidth: 10, onChange: vi.fn() })
    expect(varOf(sidebar)).toBe(`${SIDEBAR_MIN_PX}px`)
  })

  it("leaves the basis var unset when there is no stored width (default 14rem applies)", () => {
    const handle = document.createElement("div")
    const sidebar = document.createElement("aside")
    wireSidebarResize(handle, sidebar, { initialWidth: null, onChange: vi.fn() })
    expect(varOf(sidebar)).toBe("")
  })

  it("flags the sidebar `resizing` for the duration of a drag so the transition is off (FEAT-0068/AC-7)", () => {
    const handle = document.createElement("div")
    const sidebar = document.createElement("aside")
    handle.setPointerCapture = vi.fn() // not implemented in happy-dom
    wireSidebarResize(handle, sidebar, { initialWidth: 300, onChange: vi.fn() })

    const down = new Event("pointerdown") as Event & { clientX: number; pointerId: number }
    down.clientX = 0
    down.pointerId = 1
    handle.dispatchEvent(down)
    expect(sidebar.classList.contains("resizing")).toBe(true)

    handle.dispatchEvent(new Event("lostpointercapture"))
    expect(sidebar.classList.contains("resizing")).toBe(false)
  })
})

describe("markMotionReady (FEAT-0068)", () => {
  it("adds `motion-ready` to the root after the next frames (AC-2)", () => {
    const root = document.createElement("html")
    // Run scheduled frames synchronously so the double-rAF resolves in the test.
    const raf = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0)
      return 0
    })
    markMotionReady(root)
    expect(root.classList.contains("motion-ready")).toBe(true)
    raf.mockRestore()
  })
})

describe("mountNoteIdentity (FEAT-0035)", () => {
  const display = (c: HTMLElement) => c.querySelector<HTMLElement>(".note-identity-display")!
  const input = (c: HTMLElement) => c.querySelector<HTMLInputElement>(".note-identity-edit")!
  const error = (c: HTMLElement) => c.querySelector<HTMLElement>(".note-identity-error")!
  const press = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it("shows the active note's name without .md (AC-1)", () => {
    const c = document.createElement("div")
    const id = mountNoteIdentity(c, vi.fn())
    id.update("diablo.md")
    expect(display(c).textContent).toContain("diablo")
    expect(display(c).textContent).not.toContain(".md")
  })

  it("shows a nested note's path and name (AC-2)", () => {
    const c = document.createElement("div")
    mountNoteIdentity(c, vi.fn()).update("projects/diablo.md")
    const text = display(c).textContent ?? ""
    expect(text).toContain("projects")
    expect(text).toContain("diablo")
  })

  it("tracks the active note as it changes (AC-4)", () => {
    const c = document.createElement("div")
    const id = mountNoteIdentity(c, vi.fn())
    id.update("a.md")
    id.update("b.md")
    expect(display(c).textContent).toContain("b")
    expect(display(c).textContent).not.toContain("a.md")
  })

  it("opens an inline editor prefilled with the full path, no .md (AC-5)", () => {
    const c = document.createElement("div")
    mountNoteIdentity(c, vi.fn()).update("projects/diablo.md")
    display(c).click()
    expect(input(c).hidden).toBe(false)
    expect(display(c).hidden).toBe(true)
    expect(input(c).value).toBe("projects/diablo")
  })

  it("commits a valid rename and returns to the display (AC-6)", async () => {
    const c = document.createElement("div")
    const onRename = vi.fn().mockResolvedValue({ ok: true })
    const id = mountNoteIdentity(c, onRename)
    id.update("a.md")
    display(c).click()
    input(c).value = "renamed"
    press(input(c), "Enter")
    await flush()

    expect(onRename).toHaveBeenCalledWith("renamed")
    expect(input(c).hidden).toBe(true) // back to display
    id.update("renamed.md") // the controller's announce drives the new display
    expect(display(c).textContent).toContain("renamed")
  })

  it("keeps the editor open and shows the reason on a rejected rename (AC-7)", async () => {
    const c = document.createElement("div")
    const onRename = vi.fn().mockResolvedValue({
      ok: false,
      reason: "A note with that name already exists.",
    })
    const id = mountNoteIdentity(c, onRename)
    id.update("a.md")
    display(c).click()
    input(c).value = "b"
    press(input(c), "Enter")
    await flush()

    expect(input(c).hidden).toBe(false) // still editing
    expect(input(c).value).toBe("b") // typed text preserved
    expect(error(c).textContent).toMatch(/exist/i)
  })

  it("surfaces a thrown error inline instead of leaving the editor stuck (AC-7)", async () => {
    const c = document.createElement("div")
    const onRename = vi.fn().mockRejectedValue(new TypeError("handle.move is not a function"))
    const id = mountNoteIdentity(c, onRename)
    id.update("a.md")
    display(c).click()
    input(c).value = "renamed"
    press(input(c), "Enter")
    await flush()

    expect(input(c).hidden).toBe(false) // still editing — not silently stuck/closed
    expect(error(c).textContent).toMatch(/move is not a function/)
  })

  it("ignores a second Enter while a rename is in flight (AC-6)", async () => {
    const c = document.createElement("div")
    let resolve: (r: { ok: true }) => void = () => {}
    const onRename = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)))
    const id = mountNoteIdentity(c, onRename)
    id.update("a.md")
    display(c).click()
    input(c).value = "renamed"
    press(input(c), "Enter") // first commit, awaiting onRename
    press(input(c), "Enter") // second Enter must not fire a duplicate rename
    resolve({ ok: true })
    await flush()

    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it("reverts on Escape without renaming (AC-8)", () => {
    const c = document.createElement("div")
    const onRename = vi.fn()
    const id = mountNoteIdentity(c, onRename)
    id.update("a.md")
    display(c).click()
    input(c).value = "changed"
    press(input(c), "Escape")

    expect(onRename).not.toHaveBeenCalled()
    expect(input(c).hidden).toBe(true)
    expect(display(c).textContent).toContain("a")
  })

  it("commits on blur — tapping away is 'done', not 'cancel' (AC-9)", async () => {
    const c = document.createElement("div")
    const onRename = vi.fn().mockResolvedValue({ ok: true })
    const id = mountNoteIdentity(c, onRename)
    id.update("a.md")
    display(c).click()
    input(c).value = "changed"
    input(c).dispatchEvent(new FocusEvent("blur"))
    await flush()

    expect(onRename).toHaveBeenCalledWith("changed")
    expect(input(c).hidden).toBe(true) // back to display after the commit
  })

  it("does not re-commit when Esc closes the editor and then blurs (AC-8)", () => {
    const c = document.createElement("div")
    const onRename = vi.fn()
    const id = mountNoteIdentity(c, onRename)
    id.update("a.md")
    display(c).click()
    input(c).value = "changed"
    press(input(c), "Escape") // cancels: showDisplay() clears `editing`
    input(c).dispatchEvent(new FocusEvent("blur")) // the focus-away that follows must be inert

    expect(onRename).not.toHaveBeenCalled()
    expect(display(c).textContent).toContain("a")
  })
})

describe("mountMissingNoteBanner (FEAT-0036)", () => {
  const msg = (c: HTMLElement) => c.querySelector<HTMLElement>(".missing-note-message")!
  const createBtn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".missing-note-create")!
  const dismissBtn = (c: HTMLElement) =>
    c.querySelector<HTMLButtonElement>(".missing-note-dismiss")!

  it("is hidden until shown (AC-13)", () => {
    const c = document.createElement("div")
    mountMissingNoteBanner(c, { onCreate: vi.fn(), onDismiss: vi.fn() })
    expect(c.querySelector<HTMLElement>(".missing-note-banner")!.hidden).toBe(true)
  })

  it("show reveals the banner naming the missing note (AC-13)", () => {
    const c = document.createElement("div")
    const banner = mountMissingNoteBanner(c, { onCreate: vi.fn(), onDismiss: vi.fn() })
    banner.show("projects/ghost")
    expect(c.querySelector<HTMLElement>(".missing-note-banner")!.hidden).toBe(false)
    expect(msg(c).textContent).toContain("projects/ghost")
  })

  it("the Create button fires onCreate (AC-14)", () => {
    const c = document.createElement("div")
    const onCreate = vi.fn()
    const banner = mountMissingNoteBanner(c, { onCreate, onDismiss: vi.fn() })
    banner.show("ghost")
    createBtn(c).click()
    expect(onCreate).toHaveBeenCalledOnce()
  })

  it("the dismiss button fires onDismiss (AC-15)", () => {
    const c = document.createElement("div")
    const onDismiss = vi.fn()
    const banner = mountMissingNoteBanner(c, { onCreate: vi.fn(), onDismiss })
    banner.show("ghost")
    dismissBtn(c).click()
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it("hide conceals the banner", () => {
    const c = document.createElement("div")
    const banner = mountMissingNoteBanner(c, { onCreate: vi.fn(), onDismiss: vi.fn() })
    banner.show("ghost")
    banner.hide()
    expect(c.querySelector<HTMLElement>(".missing-note-banner")!.hidden).toBe(true)
  })
})
