import { deleteScript, listScripts, type ScriptDiscovery } from "./script-storage"

export interface ExtensionManagerHandlers {
  getRoot: () => FileSystemDirectoryHandle | null
  onScriptsChanged?: () => void | Promise<void>
  isEnabled?: (id: string) => boolean
  onEnabledChange?: (id: string, enabled: boolean) => void | Promise<void>
  confirmDelete?: (label: string) => boolean | Promise<boolean>
}

export interface ExtensionManagerHandle {
  open: () => void
  close: () => void
  refresh: () => Promise<void>
}

/** A compact lifecycle manager; authoring belongs to the separate workbench. */
export function mountExtensionManager(
  backdrop: HTMLElement,
  handlers: ExtensionManagerHandlers,
): ExtensionManagerHandle {
  backdrop.hidden = true
  backdrop.classList.add("extensions-backdrop")

  const dialog = document.createElement("div")
  dialog.className = "extensions-dialog"
  dialog.setAttribute("role", "dialog")
  dialog.setAttribute("aria-modal", "true")
  dialog.setAttribute("aria-label", "Extensions")
  dialog.tabIndex = -1

  const titleBar = document.createElement("div")
  titleBar.className = "extensions-titlebar"
  const title = document.createElement("h2")
  title.className = "extensions-title"
  title.textContent = "Extensions"
  const closeButton = button("×")
  closeButton.className = "extensions-close"
  closeButton.setAttribute("aria-label", "Close extensions")
  titleBar.append(title, closeButton)

  const hint = document.createElement("p")
  hint.className = "extensions-hint"
  hint.textContent = "Manage extensions installed in .brulion/scripts/<id> next to your notes."
  const status = document.createElement("p")
  status.className = "extensions-status"
  status.setAttribute("role", "status")
  const list = document.createElement("div")
  list.className = "extensions-list"
  list.setAttribute("aria-label", "Installed extensions")
  dialog.append(titleBar, hint, status, list)
  backdrop.append(dialog)

  let open = false
  let restoreFocus: HTMLElement | null = null
  let busy = false
  let refreshGeneration = 0

  const setStatus = (message: string, error = false) => {
    status.textContent = message
    status.classList.toggle("is-error", error)
  }

  const close = () => {
    open = false
    backdrop.hidden = true
    restoreFocus?.focus?.()
    restoreFocus = null
  }

  const refresh = async () => {
    const root = handlers.getRoot()
    const generation = ++refreshGeneration
    if (!root) {
      renderList([])
      setStatus("Open a notes folder before managing extensions.", true)
      return
    }
    setStatus("Loading extensions…")
    try {
      const items = await listScripts(root)
      if (generation !== refreshGeneration) return
      if (open) renderList(items)
      if (open) setStatus(items.length > 0 ? `${items.length} extension(s)` : "No extensions installed.")
    } catch (error) {
      if (generation !== refreshGeneration) return
      if (open) renderList([])
      if (open) setStatus(error instanceof Error ? error.message : "Unable to read extensions.", true)
    }
  }

  const remove = async (id: string, removeButton: HTMLButtonElement) => {
    if (busy) return
    const root = handlers.getRoot()
    if (!root) return
    const confirm = handlers.confirmDelete ?? ((label: string) => window.confirm(`Remove ${label}?`))
    const wasOpen = open
    if (wasOpen) backdrop.hidden = true
    let confirmed: boolean
    try {
      confirmed = await confirm(id)
    } catch (error) {
      if (open) setStatus(error instanceof Error ? error.message : "Unable to confirm extension removal.", true)
      return
    } finally {
      if (wasOpen && open) {
        backdrop.hidden = false
        dialog.focus()
      }
    }
    if (!confirmed) return

    busy = true
    removeButton.disabled = true
    try {
      await deleteScript(root, id)
      await handlers.onEnabledChange?.(id, false)
      await handlers.onScriptsChanged?.()
      await refresh()
    } catch (error) {
      if (open) setStatus(error instanceof Error ? error.message : "Unable to remove extension.", true)
    } finally {
      busy = false
      removeButton.disabled = false
    }
  }

  const renderList = (items: ScriptDiscovery[]) => {
    list.replaceChildren()
    if (items.length === 0) {
      const empty = document.createElement("p")
      empty.className = "extensions-empty"
      empty.textContent = "No extensions found in .brulion/scripts/."
      list.append(empty)
      return
    }
    for (const item of items) {
      const row = document.createElement("div")
      row.className = "extensions-row"
      row.dataset.scriptId = item.id

      const label = document.createElement("div")
      label.className = "extensions-row-label"
      const name = document.createElement("strong")
      name.textContent = item.manifest?.name ?? item.id
      const detail = document.createElement("span")
      detail.textContent = item.error
        ? `Invalid: ${item.error}`
        : `${item.id} · ${item.manifest?.version ?? "unknown"}`
      label.append(name, detail)
      row.append(label)

      if (item.manifest) {
        const enabled = handlers.isEnabled?.(item.id) ?? false
        const toggle = button(enabled ? "Disable" : "Enable")
        toggle.classList.add("extensions-toggle")
        toggle.setAttribute("aria-pressed", String(enabled))
        toggle.addEventListener("click", async () => {
          if (busy) return
          busy = true
          toggle.disabled = true
          try {
            await handlers.onEnabledChange?.(item.id, !enabled)
            await refresh()
          } catch (error) {
            if (open) setStatus(error instanceof Error ? error.message : "Unable to update extension.", true)
          } finally {
            busy = false
            toggle.disabled = false
          }
        })
        row.append(toggle)
      }

      const removeButton = button("Remove")
      removeButton.classList.add("extensions-remove")
      removeButton.addEventListener("click", () => void remove(item.id, removeButton))
      row.append(removeButton)
      list.append(row)
    }
  }

  closeButton.addEventListener("click", close)
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close()
  })
  backdrop.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault()
      close()
    }
  })

  return {
    open() {
      open = true
      restoreFocus = document.activeElement as HTMLElement | null
      backdrop.hidden = false
      dialog.focus()
      void refresh()
    },
    close,
    refresh,
  }
}

function button(label: string): HTMLButtonElement {
  const element = document.createElement("button")
  element.type = "button"
  element.textContent = label
  return element
}
