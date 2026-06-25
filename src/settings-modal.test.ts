import { describe, it, expect, vi, beforeEach } from "vitest"
import { mountSettingsModal } from "./settings-modal"
import type { SettingsModalHandlers } from "./settings-modal"
import { DEFAULT_SETTINGS, MIN_SIZE, MAX_SIZE } from "./settings"
import type { Settings } from "./settings"
import type { FontChoices } from "./font-access"

// DOM contract these tests assume (structure is JS-built, so controls are queried
// generically inside `backdrop`, not by tag/class name):
//   - backdrop visibility is driven by the [hidden] attribute.
//   - the text size is adjusted with two increment/decrement controls (buttons),
//     and the current size is shown as text somewhere in the modal (a "readout").
//   - the editor-width preset is chosen from a set of radio inputs whose `value`
//     is one of "narrow" | "wider" | "full".
//   - the Vim toggle is a checkbox input.
//   - the font family is chosen from a <select>; its option values are family
//     names, with an empty-value option meaning "the default stack".
//   - Esc keydown anywhere in the modal, and a click on the backdrop itself, both
//     dismiss it.

const FONT_CHOICES: FontChoices = { source: "preset", families: ["Georgia", "Menlo"] }

// The registry meta the host hands the modal (FEAT-0058): id + label per action.
const ACTION_META = [
  { id: "goto", label: "Go to note…" },
  { id: "switch-folder", label: "Switch folder…" },
  { id: "toggle-vim", label: "Toggle Vim mode" },
]

function makeHandlers(initial: Settings, folderName = "vault") {
  const state: { current: Settings; folderName: string } = {
    current: { ...initial },
    folderName,
  }
  const onChange = vi.fn((patch: Partial<Settings>) => {
    state.current = { ...state.current, ...patch }
  })
  const onSwitchFolder = vi.fn()
  const handlers: SettingsModalHandlers = {
    getSettings: () => state.current,
    onChange,
    resolveFontChoices: () => Promise.resolve(FONT_CHOICES),
    getFolderName: () => state.folderName,
    onSwitchFolder,
    getActions: () => ACTION_META,
  }
  return { handlers, onChange, onSwitchFolder, state }
}

function mount(initial: Settings = DEFAULT_SETTINGS, folderName = "vault") {
  const backdrop = document.createElement("div")
  backdrop.hidden = true
  document.body.append(backdrop)
  const { handlers, onChange, onSwitchFolder, state } = makeHandlers(initial, folderName)
  const handle = mountSettingsModal(backdrop, handlers)
  return { backdrop, handle, onChange, onSwitchFolder, state }
}

// --- generic control queries (no class/tag pinning) ---

const checkbox = (root: HTMLElement) =>
  root.querySelector<HTMLInputElement>('input[type="checkbox"]')!

const fontSelect = (root: HTMLElement) => root.querySelector<HTMLSelectElement>("select")!

const buttons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>("button")]

const widthRadios = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')]

const widthRadio = (root: HTMLElement, value: string) =>
  widthRadios(root).find((r) => r.value === value)!

// True if some leaf element's exact text is `text` (used to assert the folder name
// and the Vim shortcut chip without pinning their class/tag).
const hasLeafText = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLElement>("*")].some(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim() === text,
  )

// The "Switch folder…" button, found by its label rather than a class.
const switchFolderButton = (root: HTMLElement) =>
  buttons(root).find((b) => /switch folder/i.test(b.textContent ?? ""))!

const selectedWidth = (root: HTMLElement) =>
  widthRadios(root).find((r) => r.checked)?.value

// The size readout: the element whose text is exactly the current size number.
function sizeReadout(root: HTMLElement, size: number): boolean {
  return [...root.querySelectorAll<HTMLElement>("*")].some(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim() === String(size),
  )
}

// The +/- size controls. Pressing the up control should raise the size by one,
// the down control lower it. We discover them behaviorally rather than by label:
// fire each button and see which one emits a one-greater vs one-less textSize.
function pressEachButton(
  root: HTMLElement,
  onChange: ReturnType<typeof vi.fn>,
): { button: HTMLButtonElement; patch: Partial<Settings> | undefined }[] {
  const out: { button: HTMLButtonElement; patch: Partial<Settings> | undefined }[] = []
  for (const button of buttons(root)) {
    onChange.mockClear()
    button.click()
    const call = onChange.mock.calls.at(-1)
    out.push({ button, patch: call?.[0] as Partial<Settings> | undefined })
  }
  return out
}

beforeEach(() => {
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

const flush = () => Promise.resolve()

describe("mountSettingsModal open/seed (FEAT-0048 AC-1)", () => {
  it("open() reveals the modal and seeds controls from getSettings()", async () => {
    const initial: Settings = {
      font: ["Menlo"],
      textSize: 20,
      editorWidth: "wider",
      vim: true,
      actionBar: [],
    }
    const { backdrop, handle } = mount(initial)

    handle.open()
    await flush()

    expect(backdrop.hidden).toBe(false)
    expect(sizeReadout(backdrop, 20)).toBe(true)
    expect(selectedWidth(backdrop)).toBe("wider")
    expect(checkbox(backdrop).checked).toBe(true)
    expect(fontSelect(backdrop).value).toBe("Menlo")
  })

  it("open() with defaults reflects the default state", async () => {
    const { backdrop, handle } = mount(DEFAULT_SETTINGS)

    handle.open()
    await flush()

    expect(backdrop.hidden).toBe(false)
    expect(sizeReadout(backdrop, DEFAULT_SETTINGS.textSize)).toBe(true)
    expect(selectedWidth(backdrop)).toBe("narrow")
    expect(checkbox(backdrop).checked).toBe(false)
    // empty font means the default-stack option is selected (empty value)
    expect(fontSelect(backdrop).value).toBe("")
  })
})

describe("mountSettingsModal text size (FEAT-0048 AC-3)", () => {
  it("the increment control emits textSize one greater, the decrement one less", async () => {
    const { backdrop, handle, onChange } = mount({ ...DEFAULT_SETTINGS, textSize: 16 })
    handle.open()
    await flush()

    const results = pressEachButton(backdrop, onChange)
    const up = results.find((r) => r.patch?.textSize === 17)
    const down = results.find((r) => r.patch?.textSize === 15)

    expect(up, "an increment control should emit textSize 17").toBeTruthy()
    expect(down, "a decrement control should emit textSize 15").toBeTruthy()
  })

  it("does not emit a textSize above MAX_SIZE when already at the maximum", async () => {
    const { backdrop, handle, onChange } = mount({ ...DEFAULT_SETTINGS, textSize: MAX_SIZE })
    handle.open()
    await flush()

    const results = pressEachButton(backdrop, onChange)
    // No button may emit a textSize beyond the max.
    for (const r of results) {
      if (r.patch?.textSize !== undefined) {
        expect(r.patch.textSize).toBeLessThanOrEqual(MAX_SIZE)
      }
    }
  })

  it("does not emit a textSize below MIN_SIZE when already at the minimum", async () => {
    const { backdrop, handle, onChange } = mount({ ...DEFAULT_SETTINGS, textSize: MIN_SIZE })
    handle.open()
    await flush()

    const results = pressEachButton(backdrop, onChange)
    for (const r of results) {
      if (r.patch?.textSize !== undefined) {
        expect(r.patch.textSize).toBeGreaterThanOrEqual(MIN_SIZE)
      }
    }
  })
})

describe("mountSettingsModal editor width (FEAT-0048 AC-4)", () => {
  it("selecting a width option emits onChange with that editorWidth", async () => {
    const { backdrop, handle, onChange } = mount({ ...DEFAULT_SETTINGS, editorWidth: "narrow" })
    handle.open()
    await flush()

    const wider = widthRadio(backdrop, "wider")
    wider.checked = true
    wider.dispatchEvent(new Event("change", { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith({ editorWidth: "wider" })

    onChange.mockClear()
    const full = widthRadio(backdrop, "full")
    full.checked = true
    full.dispatchEvent(new Event("change", { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith({ editorWidth: "full" })
  })
})

describe("mountSettingsModal vim (FEAT-0048 AC-5)", () => {
  it("toggling the vim control emits onChange with the new boolean", async () => {
    const { backdrop, handle, onChange } = mount({ ...DEFAULT_SETTINGS, vim: false })
    handle.open()
    await flush()

    const box = checkbox(backdrop)
    box.checked = true
    box.dispatchEvent(new Event("change", { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith({ vim: true })

    onChange.mockClear()
    box.checked = false
    box.dispatchEvent(new Event("change", { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith({ vim: false })
  })
})

describe("mountSettingsModal font (FEAT-0048 AC-8)", () => {
  it("selecting a font family emits onChange({font:[family]})", async () => {
    const { backdrop, handle, onChange } = mount(DEFAULT_SETTINGS)
    handle.open()
    await flush()

    const sel = fontSelect(backdrop)
    sel.value = "Georgia"
    sel.dispatchEvent(new Event("change", { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith({ font: ["Georgia"] })
  })

  it("selecting the default/empty option emits onChange({font:[]})", async () => {
    const { backdrop, handle, onChange } = mount({ ...DEFAULT_SETTINGS, font: ["Menlo"] })
    handle.open()
    await flush()

    const sel = fontSelect(backdrop)
    sel.value = ""
    sel.dispatchEvent(new Event("change", { bubbles: true }))
    expect(onChange).toHaveBeenLastCalledWith({ font: [] })
  })
})

describe("mountSettingsModal sync (FEAT-0048 AC-9)", () => {
  it("sync() re-seeds the controls from getSettings() while open", async () => {
    const { backdrop, handle, state } = mount({ ...DEFAULT_SETTINGS, vim: false })
    handle.open()
    await flush()
    expect(checkbox(backdrop).checked).toBe(false)

    state.current = { ...state.current, vim: true }
    handle.sync()

    expect(checkbox(backdrop).checked).toBe(true)
  })

  it("sync() while closed is a no-op and does not reveal the modal", async () => {
    const { backdrop, handle, state } = mount({ ...DEFAULT_SETTINGS, vim: false })

    state.current = { ...state.current, vim: true }
    handle.sync()

    expect(backdrop.hidden).toBe(true)
  })
})

describe("mountSettingsModal folder section (FEAT-0054 AC-1, AC-3)", () => {
  it("shows the open folder's name from getFolderName()", async () => {
    const { backdrop, handle } = mount(DEFAULT_SETTINGS, "diablo-notes")
    handle.open()
    await flush()

    expect(hasLeafText(backdrop, "diablo-notes")).toBe(true)
    expect(switchFolderButton(backdrop)).toBeTruthy()
  })

  it("re-seeds the folder name on sync()", async () => {
    const { backdrop, handle, state } = mount(DEFAULT_SETTINGS, "old-folder")
    handle.open()
    await flush()
    expect(hasLeafText(backdrop, "old-folder")).toBe(true)

    state.folderName = "new-folder"
    handle.sync()

    expect(hasLeafText(backdrop, "new-folder")).toBe(true)
  })

  it("clicking Switch folder… calls onSwitchFolder once and closes the modal", async () => {
    const { backdrop, handle, onSwitchFolder } = mount(DEFAULT_SETTINGS)
    handle.open()
    await flush()
    expect(backdrop.hidden).toBe(false)

    switchFolderButton(backdrop).click()

    expect(onSwitchFolder).toHaveBeenCalledTimes(1)
    expect(backdrop.hidden).toBe(true) // dismissed before the picker appears
  })
})

describe("mountSettingsModal vim shortcut hint (FEAT-0054 AC-8)", () => {
  it("shows the platform-correct toggle chord beside the Vim control", async () => {
    const { backdrop, handle } = mount(DEFAULT_SETTINGS)
    handle.open()
    await flush()

    // happy-dom reports a non-Mac platform, so the chord is the Ctrl form.
    expect(hasLeafText(backdrop, "Ctrl+;") || hasLeafText(backdrop, "⌘;")).toBe(true)
  })
})

describe("mountSettingsModal dismiss (FEAT-0048 AC-1)", () => {
  it("Esc keydown hides the modal", async () => {
    const { backdrop, handle } = mount(DEFAULT_SETTINGS)
    handle.open()
    await flush()
    expect(backdrop.hidden).toBe(false)

    backdrop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

    expect(backdrop.hidden).toBe(true)
  })

  it("a click on the backdrop hides the modal", async () => {
    const { backdrop, handle } = mount(DEFAULT_SETTINGS)
    handle.open()
    await flush()
    expect(backdrop.hidden).toBe(false)

    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(backdrop.hidden).toBe(true)
  })

  it("restores focus to the previously-focused element on close", async () => {
    const { backdrop, handle } = mount(DEFAULT_SETTINGS)
    const opener = document.createElement("button")
    document.body.append(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    handle.open()
    await flush()
    expect(document.activeElement).not.toBe(opener) // focus moved into the modal

    backdrop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(document.activeElement).toBe(opener) // and is handed back on close
  })
})

describe("Action bar section (FEAT-0058 AC-4, AC-5)", () => {
  // DOM contract: each registered action is a row identified by `data-action-id`,
  // with a pin checkbox (checked === pinned). A pinned row is `draggable` and
  // reorders on a native drag-and-drop (dragstart on the dragged row, drop on the
  // target). The dragged id is held in the modal's closure, not on the DataTransfer,
  // so plain Events (no DataTransfer) suffice to drive it.
  const actionRow = (root: HTMLElement, id: string) =>
    root.querySelector<HTMLElement>(`[data-action-id="${id}"]`)!
  const rowCheckbox = (root: HTMLElement, id: string) =>
    actionRow(root, id).querySelector<HTMLInputElement>('input[type="checkbox"]')!

  it("pins a previously-unpinned action when its checkbox is checked", () => {
    const { backdrop, handle, onChange } = mount(DEFAULT_SETTINGS) // actionBar: []
    handle.open()

    const box = rowCheckbox(backdrop, "goto")
    expect(box.checked).toBe(false)
    box.checked = true
    box.dispatchEvent(new Event("change", { bubbles: true }))

    expect(onChange).toHaveBeenCalledWith({ actionBar: ["goto"] })
  })

  it("unpins a pinned action when its checkbox is unchecked", () => {
    const { backdrop, handle, onChange } = mount({ ...DEFAULT_SETTINGS, actionBar: ["toggle-vim"] })
    handle.open()

    const box = rowCheckbox(backdrop, "toggle-vim")
    expect(box.checked).toBe(true)
    box.checked = false
    box.dispatchEvent(new Event("change", { bubbles: true }))

    expect(onChange).toHaveBeenCalledWith({ actionBar: [] })
  })

  it("reorders pinned actions by dragging one onto another", () => {
    const { backdrop, handle, onChange } = mount({
      ...DEFAULT_SETTINGS,
      actionBar: ["goto", "toggle-vim"],
    })
    handle.open()

    // Drag toggle-vim (2nd) onto goto (1st): toggle-vim lands first.
    actionRow(backdrop, "toggle-vim").dispatchEvent(new Event("dragstart", { bubbles: true }))
    actionRow(backdrop, "goto").dispatchEvent(new Event("drop", { bubbles: true }))

    expect(onChange).toHaveBeenCalledWith({ actionBar: ["toggle-vim", "goto"] })
  })

  it("makes pinned rows draggable and unpinned rows not", () => {
    const { backdrop, handle } = mount({ ...DEFAULT_SETTINGS, actionBar: ["goto"] })
    handle.open()
    expect(actionRow(backdrop, "goto").draggable).toBe(true) // pinned
    expect(actionRow(backdrop, "toggle-vim").draggable).toBeFalsy() // unpinned (no draggable set)
  })

  it("keeps focus on the pinned action's checkbox across a section rebuild (sync)", () => {
    const { backdrop, handle } = mount({ ...DEFAULT_SETTINGS, actionBar: ["goto", "toggle-vim"] })
    handle.open()
    const box = rowCheckbox(backdrop, "goto")
    box.focus()
    expect(document.activeElement).toBe(box)

    handle.sync() // what updateSettings triggers after a change — rebuilds the section

    const rebuilt = rowCheckbox(backdrop, "goto")
    expect(rebuilt).not.toBe(box) // it really is a fresh node
    expect(document.activeElement).toBe(rebuilt) // …and focus followed it
  })
})
