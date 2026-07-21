import { MIN_SIZE, MAX_SIZE, type Settings, type EditorWidth, type Theme } from "./settings"
import type { FontChoices } from "./font-access"
import { togglePinned, reorderPinned } from "./actions"
import { applyAntiAutofillAttrs } from "./anti-autofill"

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
  /** The granted workspaces (id + folder name + whether it's the open one), for the
   * Workspaces section (FEAT-0060). Async — reads the vault set. */
  getWorkspaces: () => Promise<WorkspaceMeta[]>
  /** Forget (remove from the set) the workspace with `id`; the host removes the vault.
   * Awaited before the section re-renders, so the removed row is actually gone. Never
   * offered for the open workspace. */
  onForgetWorkspace: (id: string) => void | Promise<void>
}

/** A workspace row in the settings Workspaces section (FEAT-0060). */
export interface WorkspaceMeta {
  id: string
  name: string
  /** Whether this is the currently-open workspace (can't be forgotten). */
  open: boolean
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

const THEMES: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
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

  // Theme — a Light/Dark/System radio group (FEAT-0065). System follows the OS via
  // the stylesheet's prefers-color-scheme query; light/dark force that palette.
  const themeControl = document.createElement("div")
  themeControl.className = "settings-theme"
  const themeRadios: HTMLInputElement[] = THEMES.map(({ value, label }) => {
    const wrap = document.createElement("label")
    wrap.className = "settings-theme-option"
    const radio = document.createElement("input")
    radio.type = "radio"
    radio.name = "settings-theme"
    radio.value = value
    const text = document.createElement("span")
    text.textContent = label
    wrap.append(radio, text)
    themeControl.append(wrap)
    radio.addEventListener("change", () => {
      if (radio.checked) emit({ theme: value })
    })
    return radio
  })
  const themeRow = labeledRow("Theme", themeControl)

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

  // Weekly journal path (FEAT-0062): a date-templated note path. A text input plus a
  // hint listing the placeholders; emits on input so the value persists.
  const journalInput = document.createElement("input")
  journalInput.type = "text"
  journalInput.className = "settings-journal"
  journalInput.placeholder = "e.g. Journal/Week/{mondayOfTheWeek}"
  applyAntiAutofillAttrs(journalInput)
  journalInput.addEventListener("input", () => emit({ journalPath: journalInput.value }))
  const journalHint = document.createElement("p")
  journalHint.className = "settings-section-hint"
  journalHint.textContent = "Placeholders: {year} {month} {day} {mondayOfTheWeek}"
  const journalControl = document.createElement("div")
  journalControl.className = "settings-journal-control"
  journalControl.append(journalInput, journalHint)
  const journalRow = labeledRow("Weekly journal", journalControl)

  // Workspace name (FEAT-0080): the stable name that keys a cross-device permalink
  // (?ws). A text input plus a hint; empty means "use the folder name" (shown as the
  // placeholder, seeded in seed()). Emits on input so the host persists + re-stamps.
  const workspaceInput = document.createElement("input")
  workspaceInput.type = "text"
  workspaceInput.className = "settings-workspace"
  applyAntiAutofillAttrs(workspaceInput)
  workspaceInput.addEventListener("input", () => emit({ workspace: workspaceInput.value }))
  const workspaceHint = document.createElement("p")
  workspaceHint.className = "settings-section-hint"
  workspaceHint.textContent =
    "Names this vault for cross-device note links; leave empty to use the folder name."
  const workspaceControl = document.createElement("div")
  workspaceControl.className = "settings-workspace-control"
  workspaceControl.append(workspaceInput, workspaceHint)
  const workspaceRow = labeledRow("Workspace name", workspaceControl)

  // Action bar (FEAT-0058) — its own distinct section (own heading + scrollable
  // list), set off from the appearance controls so a growing action set doesn't
  // crowd the dialog. Rebuilt by seed() from the current settings; placed last so the
  // earlier control queries (e.g. the Vim checkbox) are unaffected by its inputs.
  const actionBarControl = document.createElement("div")
  actionBarControl.className = "settings-actionbar"
  const actionBarSection = document.createElement("section")
  actionBarSection.className = "settings-section"
  const actionBarTitle = document.createElement("h3")
  actionBarTitle.className = "settings-section-title"
  actionBarTitle.textContent = "Action bar"
  const actionBarHint = document.createElement("p")
  actionBarHint.className = "settings-section-hint"
  actionBarHint.textContent = "Pin actions to the header; drag to reorder."
  actionBarSection.append(actionBarTitle, actionBarHint, actionBarControl)

  // Workspaces (FEAT-0060) — the granted folders, each forgettable except the open
  // one. Rendered async on open (and after a forget) from getWorkspaces().
  const workspacesControl = document.createElement("div")
  workspacesControl.className = "settings-workspaces"
  const workspacesSection = document.createElement("section")
  workspacesSection.className = "settings-section"
  const workspacesTitle = document.createElement("h3")
  workspacesTitle.className = "settings-section-title"
  workspacesTitle.textContent = "Workspaces"
  const workspacesHint = document.createElement("p")
  workspacesHint.className = "settings-section-hint"
  workspacesHint.textContent = "Folders you've opened; forget the ones you no longer use."
  workspacesSection.append(workspacesTitle, workspacesHint, workspacesControl)

  dialog.append(
    titleBar,
    fontRow,
    sizeRow,
    widthRow,
    themeRow,
    vimRow,
    folderRow,
    workspaceRow,
    journalRow,
    actionBarSection,
    workspacesSection,
  )
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

  // The id being dragged within the pinned list (FEAT-0058 reorder); null when no
  // drag is in flight. Held here (not on the DataTransfer) so the dragover/drop logic
  // works uniformly across browsers and happy-dom.
  let draggingId: string | null = null

  // Rebuild the Action bar section from the current settings (FEAT-0058): pinned
  // actions first, in their pinned order (draggable, to reorder), then the rest
  // unpinned (registry order). A pinned id with no matching registered action is
  // skipped (can't show a label) — consistent with the bar ignoring unknown ids.
  const renderActionBarSection = () => {
    const pinned = handlers.getSettings().actionBar
    const all = handlers.getActions()
    // Preserve keyboard focus across the rebuild (replaceChildren detaches the very
    // checkbox that fired the change): remember which row's pin was focused, then
    // restore it — so repeated keyboard pinning doesn't drop focus to <body>.
    const focused = focusedRowId(actionBarControl)
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

      // Pinned rows are draggable to reorder (native HTML5 DnD, no library). Dropping
      // a dragged pinned action onto another pinned row moves it to that slot; a drop
      // onto an unpinned row is a no-op (reorderPinned guards the target).
      if (isPinned) {
        row.classList.add("is-pinned")
        row.draggable = true
        row.addEventListener("dragstart", (e) => {
          draggingId = meta.id
          e.dataTransfer?.setData("text/plain", meta.id)
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"
        })
        row.addEventListener("dragover", (e) => {
          if (draggingId === null || draggingId === meta.id) return
          e.preventDefault() // allow the drop
          row.classList.add("drag-over")
        })
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"))
        row.addEventListener("drop", (e) => {
          e.preventDefault()
          row.classList.remove("drag-over")
          if (draggingId !== null && draggingId !== meta.id) {
            emit({ actionBar: reorderPinned(handlers.getSettings().actionBar, draggingId, meta.id) })
          }
          draggingId = null
        })
        row.addEventListener("dragend", () => {
          draggingId = null
        })
      }
      actionBarControl.append(row)
    }
    restoreRowFocus(actionBarControl, focused)
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
    for (const r of themeRadios) r.checked = r.value === s.theme
    vimCheckbox.checked = s.vim
    // Only reassign when it actually differs: the input emits per keystroke and the
    // host's updateSettings calls sync()→seed() right back, and reassigning `.value`
    // to the string just typed would jump the caret to the end mid-edit.
    if (journalInput.value !== s.journalPath) journalInput.value = s.journalPath
    // Workspace name (FEAT-0080): same caret-guard as the journal field; the
    // placeholder is the folder name, so an empty field reads as "using the folder".
    if (workspaceInput.value !== s.workspace) workspaceInput.value = s.workspace
    workspaceInput.placeholder = handlers.getFolderName()
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

  // Rebuild the Workspaces section (FEAT-0060) from the vault set: each workspace by
  // name, with a Forget control except the open one. Async (reads the vault set);
  // bails if the modal closed while awaiting.
  const renderWorkspaces = async () => {
    const workspaces = await handlers.getWorkspaces()
    if (!isOpen) return
    workspacesControl.replaceChildren()
    for (const w of workspaces) {
      const row = document.createElement("div")
      row.className = "settings-workspace-row"
      row.dataset.workspaceId = w.id
      const name = document.createElement("span")
      name.className = "settings-workspace-name"
      name.textContent = w.name
      row.append(name)
      if (w.open) {
        const tag = document.createElement("span")
        tag.className = "settings-workspace-open"
        tag.textContent = "open"
        row.append(tag) // the open workspace can't be forgotten
      } else {
        const forget = document.createElement("button")
        forget.type = "button"
        forget.className = "settings-workspace-forget"
        forget.setAttribute("aria-label", `Forget ${w.name}`)
        forget.textContent = "Forget"
        forget.addEventListener("click", async () => {
          await handlers.onForgetWorkspace(w.id)
          await renderWorkspaces()
        })
        row.append(forget)
      }
      workspacesControl.append(row)
    }
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
      void renderWorkspaces() // async — populates the Workspaces section
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

/** The action id of the row whose pin checkbox currently holds focus, or `null` when
 * focus is outside the section — so the section rebuild can restore it. */
function focusedRowId(container: HTMLElement): string | null {
  const active = document.activeElement as HTMLElement | null
  if (!active || !container.contains(active)) return null
  return active.closest<HTMLElement>("[data-action-id]")?.dataset.actionId ?? null
}

/** Re-focus the pin checkbox of the row for `id` after a rebuild; a no-op if the row
 * is gone or `id` is null. */
function restoreRowFocus(container: HTMLElement, id: string | null): void {
  if (!id) return
  container
    .querySelector<HTMLElement>(`[data-action-id="${id}"] input[type="checkbox"]`)
    ?.focus()
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
