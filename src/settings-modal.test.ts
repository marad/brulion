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

function makeHandlers(initial: Settings) {
  const state: { current: Settings } = { current: { ...initial } }
  const onChange = vi.fn((patch: Partial<Settings>) => {
    state.current = { ...state.current, ...patch }
  })
  const handlers: SettingsModalHandlers = {
    getSettings: () => state.current,
    onChange,
    resolveFontChoices: () => Promise.resolve(FONT_CHOICES),
  }
  return { handlers, onChange, state }
}

function mount(initial: Settings = DEFAULT_SETTINGS) {
  const backdrop = document.createElement("div")
  backdrop.hidden = true
  document.body.append(backdrop)
  const { handlers, onChange, state } = makeHandlers(initial)
  const handle = mountSettingsModal(backdrop, handlers)
  return { backdrop, handle, onChange, state }
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
})
