import { getScriptEditorText, mountScriptEditor, setScriptEditorText } from "./script-editor"
import {
  deleteScript,
  listScripts,
  readScript,
  writeScriptSource,
  type ScriptDiscovery,
} from "./script-storage"

export interface ExtensionManagerHandlers {
  getRoot: () => FileSystemDirectoryHandle | null
  onScriptsChanged?: () => void | Promise<void>
  isEnabled?: (id: string) => boolean
  onEnabledChange?: (id: string, enabled: boolean) => void | Promise<void>
  confirmDelete?: (label: string) => boolean
}

export interface ExtensionManagerHandle {
  open: () => void
  close: () => void
  refresh: () => Promise<void>
}

/** A deliberately small local script workbench (FEAT-0082/P1). */
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
  const closeButton = document.createElement("button")
  closeButton.type = "button"
  closeButton.className = "extensions-close"
  closeButton.setAttribute("aria-label", "Close extensions")
  closeButton.textContent = "×"
  titleBar.append(title, closeButton)

  const hint = document.createElement("p")
  hint.className = "extensions-hint"
  hint.textContent = "Scripts live in .brulion/scripts/<id>/ next to your notes."
  const status = document.createElement("p")
  status.className = "extensions-status"
  status.setAttribute("role", "status")
  const list = document.createElement("div")
  list.className = "extensions-list"
  list.setAttribute("aria-label", "Installed extensions")
  const editorPanel = document.createElement("section")
  editorPanel.className = "extensions-editor-panel"
  editorPanel.hidden = true
  const editorTitle = document.createElement("h3")
  editorTitle.className = "extensions-editor-title"
  const editorMount = document.createElement("div")
  editorMount.className = "extensions-editor"
  const editorActions = document.createElement("div")
  editorActions.className = "extensions-editor-actions"
  const saveButton = button("Save script")
  const deleteButton = button("Delete script")
  deleteButton.classList.add("extensions-delete")
  editorActions.append(saveButton, deleteButton)
  editorPanel.append(editorTitle, editorMount, editorActions)
  dialog.append(titleBar, hint, status, list, editorPanel)
  backdrop.append(dialog)

  let open = false
  let selectedId: string | null = null
  let selectedMtime: number | null = null
  let editor: ReturnType<typeof mountScriptEditor> | null = null
  let restoreFocus: HTMLElement | null = null
  let busy = false
  let refreshGeneration = 0
  // Every selection teardown invalidates reads that are still in flight. Without
  // this generation guard, two quick Edit clicks can mount the older response
  // last and silently put the editor on a different script than the user's choice.
  let selectionGeneration = 0

  const setStatus = (message: string, error = false) => {
    status.textContent = message
    status.classList.toggle("is-error", error)
  }

  const destroyEditor = () => {
    selectionGeneration++
    editor?.destroy()
    editor = null
    selectedId = null
    selectedMtime = null
    editorPanel.hidden = true
    editorMount.replaceChildren()
  }

  const close = () => {
    open = false
    backdrop.hidden = true
    destroyEditor()
    restoreFocus?.focus?.()
    restoreFocus = null
  }

  const renderList = (items: ScriptDiscovery[]) => {
    list.replaceChildren()
    if (items.length === 0) {
      const empty = document.createElement("p")
      empty.className = "extensions-empty"
      empty.textContent = "No scripts found. Add a manifest.json and main.js in .brulion/scripts/."
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
          toggle.disabled = true
          try {
            await handlers.onEnabledChange?.(item.id, !enabled)
            await refresh()
          } finally {
            toggle.disabled = false
          }
        })
        row.append(toggle)
        const edit = button("Edit")
        edit.classList.add("extensions-edit")
        edit.addEventListener("click", () => void select(item.id))
        row.append(edit)
      }
      list.append(row)
    }
  }

  const refresh = async () => {
    const root = handlers.getRoot()
    const generation = ++refreshGeneration
    if (!root) {
      renderList([])
      setStatus("Open a notes folder before managing extensions.", true)
      return
    }
    setStatus("Loading scripts…")
    try {
      const items = await listScripts(root)
      if (generation !== refreshGeneration) return
      if (open) renderList(items)
      if (open) setStatus(items.length > 0 ? `${items.length} script folder(s)` : "No scripts installed.")
    } catch (error) {
      if (generation !== refreshGeneration) return
      if (open) renderList([])
      if (open) setStatus(error instanceof Error ? error.message : "Unable to read scripts.", true)
    }
  }

  const select = async (id: string) => {
    const root = handlers.getRoot()
    if (!root) return
    destroyEditor()
    const generation = selectionGeneration
    setStatus(`Reading ${id}…`)
    try {
      const record = await readScript(root, id)
      if (!open || generation !== selectionGeneration) return
      selectedId = id
      selectedMtime = record.sourceLastModified
      editorTitle.textContent = `${record.manifest.name} · ${record.manifest.entry}`
      editor = mountScriptEditor(editorMount, {
        onSave: () => void save(),
      })
      setScriptEditorText(editor, record.source)
      editorPanel.hidden = false
      setStatus(`Editing ${id}`)
    } catch (error) {
      if (open && generation === selectionGeneration) {
        setStatus(error instanceof Error ? error.message : "Unable to read script.", true)
      }
    }
  }

  const save = async () => {
    if (busy || !editor || !selectedId || selectedMtime === null) return
    const root = handlers.getRoot()
    if (!root) return
    const generation = selectionGeneration
    const currentEditor = editor
    const currentId = selectedId
    const currentMtime = selectedMtime
    busy = true
    saveButton.disabled = true
    try {
      const result = await writeScriptSource(
        root,
        currentId,
        getScriptEditorText(currentEditor),
        currentMtime,
      )
      if (result.status === "conflict") {
        if (generation === selectionGeneration && open) {
          setStatus("The script changed on disk. Reload it before saving.", true)
        }
        return
      }
      if (generation === selectionGeneration && selectedId === currentId) {
        selectedMtime = result.lastModified
        if (open) setStatus("Saved. Reloading extension…")
      }
      await handlers.onScriptsChanged?.()
      if (generation === selectionGeneration && open) setStatus("Saved and reloaded.")
    } catch (error) {
      if (open && generation === selectionGeneration) {
        setStatus(error instanceof Error ? error.message : "Unable to save script.", true)
      }
    } finally {
      busy = false
      saveButton.disabled = false
    }
  }

  const remove = async () => {
    if (busy || !selectedId) return
    const root = handlers.getRoot()
    if (!root) return
    const id = selectedId
    const generation = selectionGeneration
    const confirm = handlers.confirmDelete ?? ((label: string) => window.confirm(`Delete ${label}?`))
    if (!confirm(id)) return
    busy = true
    deleteButton.disabled = true
    try {
      await deleteScript(root, id)
      // A different script may have been selected while the delete was in
      // flight. Only tear down the editor that initiated this operation.
      if (generation === selectionGeneration && open && selectedId === id) destroyEditor()
      await handlers.onEnabledChange?.(id, false)
      await handlers.onScriptsChanged?.()
      await refresh()
    } catch (error) {
      if (open && generation === selectionGeneration) {
        setStatus(error instanceof Error ? error.message : "Unable to delete script.", true)
      }
    } finally {
      busy = false
      deleteButton.disabled = false
    }
  }

  closeButton.addEventListener("click", close)
  saveButton.addEventListener("click", () => void save())
  deleteButton.addEventListener("click", () => void remove())
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
