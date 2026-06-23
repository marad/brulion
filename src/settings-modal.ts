import { MIN_SIZE, MAX_SIZE, type Settings, type EditorWidth } from "./settings"
import type { FontChoices } from "./font-access"

/**
 * The settings modal (FEAT-0048): the visible surface over the P1 settings engine.
 * It owns no state — it reads the current settings to seed its controls and reports
 * every change as a patch, which the host applies + persists (`updateSettings`).
 * Hosts font / text-size / editor-width / Vim controls.
 */

export interface SettingsModalHandlers {
  /** The current settings, read to seed/refresh the controls. */
  getSettings: () => Settings
  /** Report a settings change; the host applies and persists it. */
  onChange: (patch: Partial<Settings>) => void
  /** Resolve the selectable font families (local or preset). */
  resolveFontChoices: () => Promise<FontChoices>
}

export interface SettingsModalHandle {
  /** Open the modal, seeding controls from the current settings and the font list. */
  open: () => void
  /** Re-seed the controls from `getSettings()` if the modal is open — used when a
   * setting changes elsewhere (e.g. the `Ctrl/Cmd+;` Vim shortcut) so the displayed
   * state never disagrees with the live state. A no-op while closed. */
  sync: () => void
}

/**
 * Build the settings modal into `backdrop` (an empty, hidden container) and wire its
 * controls to `handlers`. Returns a handle to open it and to re-sync it after an
 * external change. Esc, a backdrop click, and the close control all dismiss it.
 */
/** The default-stack option's value: an empty string maps to `font: []`. */
const DEFAULT_FONT_VALUE = ""

const WIDTHS: { value: EditorWidth; label: string }[] = [
  { value: "narrow", label: "Narrow" },
  { value: "wider", label: "Wider" },
  { value: "full", label: "Full" },
]

export function mountSettingsModal(
  backdrop: HTMLElement,
  handlers: SettingsModalHandlers,
): SettingsModalHandle {
  backdrop.hidden = true
  backdrop.classList.add("settings-backdrop")

  const dialog = document.createElement("div")
  dialog.className = "settings-dialog"
  dialog.setAttribute("role", "dialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.setAttribute("aria-label", "Settings")
  dialog.tabIndex = -1 // focusable on open so Esc lands inside the backdrop

  const titleBar = document.createElement("div")
  titleBar.className = "settings-titlebar"
  const title = document.createElement("h2")
  title.className = "settings-title"
  title.textContent = "Settings"
  const closeButton = document.createElement("button")
  closeButton.type = "button"
  closeButton.className = "settings-close"
  closeButton.setAttribute("aria-label", "Close settings")
  closeButton.textContent = "×"
  titleBar.append(title, closeButton)

  // Font — a select; the first option is the built-in default (empty value), then
  // the resolved families. Filled on open() from resolveFontChoices.
  const fontSelect = document.createElement("select")
  fontSelect.className = "settings-font"
  const fontRow = labeledRow("Font", fontSelect)

  // Text size — a −/readout/+ stepper, bounded to [MIN_SIZE, MAX_SIZE].
  const sizeDec = stepButton("−", "Decrease text size")
  const sizeInc = stepButton("+", "Increase text size")
  const sizeReadout = document.createElement("span")
  sizeReadout.className = "settings-size-readout"
  const sizeControl = document.createElement("div")
  sizeControl.className = "settings-stepper"
  sizeControl.append(sizeDec, sizeReadout, sizeInc)
  const sizeRow = labeledRow("Text size", sizeControl)

  // Editor width — a Narrow/Wider/Full radio group.
  const widthControl = document.createElement("div")
  widthControl.className = "settings-width"
  const widthRadios: HTMLInputElement[] = WIDTHS.map(({ value, label }) => {
    const wrap = document.createElement("label")
    wrap.className = "settings-width-option"
    const radio = document.createElement("input")
    radio.type = "radio"
    radio.name = "settings-width"
    radio.value = value
    const text = document.createElement("span")
    text.textContent = label
    wrap.append(radio, text)
    widthControl.append(wrap)
    radio.addEventListener("change", () => {
      if (radio.checked) emit({ editorWidth: value })
    })
    return radio
  })
  const widthRow = labeledRow("Editor width", widthControl)

  // Vim — a checkbox.
  const vimCheckbox = document.createElement("input")
  vimCheckbox.type = "checkbox"
  vimCheckbox.className = "settings-vim"
  const vimRow = labeledRow("Vim mode", vimCheckbox)

  dialog.append(titleBar, fontRow, sizeRow, widthRow, vimRow)
  backdrop.append(dialog)

  let isOpen = false
  // The element focused before the modal opened, restored on close — so dismissing
  // settings returns the keyboard to where it was (usually the editor), matching the
  // quick switcher. Without this, focus is stranded on <body> and typing goes nowhere.
  let restoreFocus: HTMLElement | null = null
  // The text size the stepper steps from. Set only by seed() (open + the host's
  // post-change sync) — never by a step itself — so two steps from one seeded value
  // are independent (+1 / −1), while the host re-seeding after each change lets
  // repeated clicks keep climbing.
  let baseSize = MIN_SIZE

  // Report a change to the host, which applies + persists it and then calls sync()
  // to refresh the controls. The modal owns no settings state, so emit does not
  // re-seed itself.
  const emit = (patch: Partial<Settings>) => handlers.onChange(patch)

  // Reflect the current settings onto every control. Font only sets if a matching
  // option exists (open() guarantees the current family is an option).
  const seed = () => {
    const s = handlers.getSettings()
    baseSize = s.textSize
    sizeReadout.textContent = String(s.textSize)
    sizeDec.disabled = s.textSize <= MIN_SIZE
    sizeInc.disabled = s.textSize >= MAX_SIZE
    for (const r of widthRadios) r.checked = r.value === s.editorWidth
    vimCheckbox.checked = s.vim
    const family = s.font[0] ?? DEFAULT_FONT_VALUE
    // Keep the select honest if the active family isn't (yet) an option — e.g. a
    // font set on another machine. Without this the value would snap to "Default".
    if (family && ![...fontSelect.options].some((o) => o.value === family)) {
      fontSelect.append(option(family, family))
    }
    fontSelect.value = family
  }

  const fillFontOptions = (families: string[]) => {
    const current = handlers.getSettings().font[0]
    const names = [...families]
    // Show a font chosen elsewhere (e.g. on another machine) even if it isn't in
    // the resolved list, so the select never silently drops the active choice.
    if (current && !names.includes(current)) names.unshift(current)
    fontSelect.replaceChildren()
    fontSelect.append(option(DEFAULT_FONT_VALUE, "Default"))
    for (const name of names) fontSelect.append(option(name, name))
  }

  const stepSize = (delta: number) => {
    const next = clampSize(baseSize + delta)
    if (next !== baseSize) emit({ textSize: next })
  }
  sizeDec.addEventListener("click", () => stepSize(-1))
  sizeInc.addEventListener("click", () => stepSize(1))
  vimCheckbox.addEventListener("change", () => emit({ vim: vimCheckbox.checked }))
  fontSelect.addEventListener("change", () => {
    const value = fontSelect.value
    emit({ font: value === DEFAULT_FONT_VALUE ? [] : [value] })
  })

  const close = () => {
    isOpen = false
    backdrop.hidden = true
    restoreFocus?.focus?.() // hand the keyboard back to where it was (the editor)
    restoreFocus = null
  }
  closeButton.addEventListener("click", close)
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close() // a click on the backdrop, not the dialog
  })
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      close()
    }
  })

  return {
    open() {
      isOpen = true
      restoreFocus = document.activeElement as HTMLElement | null
      seed() // size/width/vim immediately; font value set once options are filled
      backdrop.hidden = false
      dialog.focus() // so Esc (handled on the backdrop) works without a prior click
      void handlers.resolveFontChoices().then((choices) => {
        fillFontOptions(choices.families)
        if (isOpen) fontSelect.value = handlers.getSettings().font[0] ?? DEFAULT_FONT_VALUE
      })
    },
    sync() {
      if (isOpen) seed()
    },
  }
}

/** Round and clamp a size into the P1 [MIN_SIZE, MAX_SIZE] bounds. */
function clampSize(value: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)))
}

/** A labeled control row: a `<label>` text beside the control. */
function labeledRow(label: string, control: HTMLElement): HTMLElement {
  const row = document.createElement("div")
  row.className = "settings-row"
  const text = document.createElement("span")
  text.className = "settings-label"
  text.textContent = label
  row.append(text, control)
  return row
}

function stepButton(glyph: string, label: string): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "settings-step"
  button.setAttribute("aria-label", label)
  button.textContent = glyph
  return button
}

function option(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement("option")
  opt.value = value
  opt.textContent = label
  return opt
}
