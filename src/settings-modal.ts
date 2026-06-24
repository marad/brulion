import { MIN_SIZE, MAX_SIZE, type Settings, type EditorWidth } from "./settings"
import type { FontChoices } from "./font-access"
import { togglePinned, movePinned } from "./command-palette"

/** The minimal action metadata the modal needs to list pinnable actions (FEAT-0058);
 * the host maps the full action registry down to this. */
export interface ActionMeta {
  id: string
  label: string
}

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
  /** The open folder's name, shown in the Folder section (FEAT-0054). */
  getFolderName: () => string
  /** The user asked to switch folder; the host runs the open-folder flow
   * (FEAT-0054). The modal has already dismissed itself by the time this fires. */
  onSwitchFolder: () => void
  /** The registered actions (id + label) offered for pinning to the action bar
   * (FEAT-0058); the host maps its FEAT-0057 action registry to this. */
  getActions: () => readonly ActionMeta[]
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

  // Vim — a checkbox plus a key-chip documenting the toggle shortcut (FEAT-0054).
  // The chord is layout-correct per platform, matching the app's other <kbd> hints.
  const vimCheckbox = document.createElement("input")
  vimCheckbox.type = "checkbox"
  vimCheckbox.className = "settings-vim"
  const isMac = /mac/i.test(navigator.platform)
  const vimHint = document.createElement("kbd")
  vimHint.className = "settings-shortcut"
  vimHint.textContent = isMac ? "⌘;" : "Ctrl+;"
  vimHint.title = "Toggle Vim mode"
  const vimControl = document.createElement("div")
  vimControl.className = "settings-vim-control"
  vimControl.append(vimCheckbox, vimHint)
  const vimRow = labeledRow("Vim mode", vimControl)

  // Folder — the open folder's name + a button that switches folders (FEAT-0054).
  // Switching reloads the workspace and this folder's settings, so the click closes
  // the modal (below) before handing off to the host's open-folder flow.
  const folderName = document.createElement("span")
  folderName.className = "settings-folder-name"
  const switchFolder = document.createElement("button")
  switchFolder.type = "button"
  switchFolder.className = "settings-switch-folder"
  switchFolder.textContent = "Switch folder…"
  const folderControl = document.createElement("div")
  folderControl.className = "settings-folder"
  folderControl.append(folderName, switchFolder)
  const folderRow = labeledRow("Folder", folderControl)

  // Action bar (FEAT-0058) — pin/unpin + reorder the actions shown in the header.
  // Rebuilt by seed() from the current settings; placed last so the earlier control
  // queries (e.g. the Vim checkbox) are unaffected by its inputs.
  const actionBarControl = document.createElement("div")
  actionBarControl.className = "settings-actionbar"
  const actionBarRow = labeledRow("Action bar", actionBarControl)

  dialog.append(titleBar, fontRow, sizeRow, widthRow, vimRow, folderRow, actionBarRow)
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

  // Rebuild the Action bar section from the current settings (FEAT-0058): pinned
  // actions first, in their pinned order with move-up/down controls, then the rest
  // unpinned (registry order). A pinned id with no matching registered action is
  // skipped (can't show a label) — consistent with the bar ignoring unknown ids.
  const renderActionBarSection = () => {
    const pinned = handlers.getSettings().actionBar
    const all = handlers.getActions()
    // Preserve keyboard focus across the rebuild (replaceChildren detaches the very
    // control that fired the change): remember which control (action id + kind) was
    // focused, then restore the equivalent one — so repeated reorder/pin keystrokes
    // don't drop focus to <body>.
    const focused = focusKeyWithin(actionBarControl)
    const ordered: { meta: ActionMeta; isPinned: boolean }[] = [
      ...pinned
        .map((id) => all.find((a) => a.id === id))
        .filter((a): a is ActionMeta => a !== undefined)
        .map((meta) => ({ meta, isPinned: true })),
      ...all.filter((a) => !pinned.includes(a.id)).map((meta) => ({ meta, isPinned: false })),
    ]
    actionBarControl.replaceChildren()
    for (const { meta, isPinned } of ordered) {
      const row = document.createElement("div")
      row.className = "settings-action-row"
      row.dataset.actionId = meta.id

      const pin = document.createElement("input")
      pin.type = "checkbox"
      pin.checked = isPinned
      pin.addEventListener("change", () =>
        emit({ actionBar: togglePinned(handlers.getSettings().actionBar, meta.id) }),
      )
      const label = document.createElement("span")
      label.className = "settings-action-label"
      label.textContent = meta.label
      row.append(pin, label)

      if (isPinned) {
        const move = (glyph: string, aria: string, dir: -1 | 1) => {
          const b = document.createElement("button")
          b.type = "button"
          b.className = "settings-action-move"
          b.setAttribute("aria-label", aria)
          b.textContent = glyph
          b.addEventListener("click", () =>
            emit({ actionBar: movePinned(handlers.getSettings().actionBar, meta.id, dir) }),
          )
          return b
        }
        row.append(move("↑", "Move up", -1), move("↓", "Move down", 1))
      }
      actionBarControl.append(row)
    }
    restoreActionFocus(actionBarControl, focused)
  }

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
    folderName.textContent = handlers.getFolderName()
    const family = s.font[0] ?? DEFAULT_FONT_VALUE
    // Keep the select honest if the active family isn't (yet) an option — e.g. a
    // font set on another machine. Without this the value would snap to "Default".
    if (family && ![...fontSelect.options].some((o) => o.value === family)) {
      fontSelect.append(option(family, family))
    }
    fontSelect.value = family
    renderActionBarSection()
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
  // Switching folders reloads the very settings this modal shows, so dismiss it
  // first, then hand off to the host's open-folder flow (FEAT-0054). A cancelled
  // picker is a no-op there, leaving the open folder untouched — the modal just
  // stays closed.
  switchFolder.addEventListener("click", () => {
    close()
    handlers.onSwitchFolder()
  })
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

/** Which action-bar control currently holds focus, as an `(action id, kind)` key —
 * so the section rebuild can restore the equivalent control. `null` when focus is
 * outside the section. */
type ActionFocusKind = "pin" | "up" | "down"
function focusKeyWithin(container: HTMLElement): { id: string; kind: ActionFocusKind } | null {
  const active = document.activeElement as HTMLElement | null
  if (!active || !container.contains(active)) return null
  const row = active.closest<HTMLElement>("[data-action-id]")
  const id = row?.dataset.actionId
  if (!id) return null
  const kind: ActionFocusKind =
    active.getAttribute("aria-label") === "Move up"
      ? "up"
      : active.getAttribute("aria-label") === "Move down"
        ? "down"
        : "pin"
  return { id, kind }
}

/** Restore focus to the rebuilt control matching `key` (the same kind if it still
 * exists, else that row's pin checkbox); a no-op if the row is gone or `key` null. */
function restoreActionFocus(
  container: HTMLElement,
  key: { id: string; kind: ActionFocusKind } | null,
): void {
  if (!key) return
  const row = container.querySelector<HTMLElement>(`[data-action-id="${key.id}"]`)
  if (!row) return
  const byKind =
    key.kind === "pin"
      ? row.querySelector<HTMLElement>('input[type="checkbox"]')
      : row.querySelector<HTMLElement>(`[aria-label="${key.kind === "up" ? "Move up" : "Move down"}"]`)
  ;(byKind ?? row.querySelector<HTMLElement>('input[type="checkbox"]'))?.focus()
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
