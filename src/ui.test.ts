import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "./fs"
import * as session from "./session"
import {
  openFolder,
  restoreVault,
  wireOpenFolder,
  renderNoteList,
  buildNoteTree,
  wireToggle,
  showWorkspace,
  mountNoteIdentity,
  mountMissingNoteBanner,
  clampSidebarWidth,
  wireSidebarResize,
  renderActionBar,
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
})

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
    rowFor(container, "b")!.querySelector<HTMLElement>(".note-delete")!.click()
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
