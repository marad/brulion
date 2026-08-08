import "./styles.css"
import {
  createScript,
  createScriptFile,
  deleteScript,
  deleteScriptFile,
  listScriptFiles,
  listScripts,
  readScriptFile,
  renameScriptFile,
  writeScriptFile,
  type ScriptDiscovery,
  type ScriptFileRecord,
} from "./script-storage"
import { parseScriptManifestText } from "./script-manifest"
import { getScriptEditorText, mountScriptEditor, setScriptEditorText } from "./script-editor"
import { loadSettings, saveSettings } from "./settings"
import { addVault, effectiveVaultName, markVaultAttached } from "./vaults"
import { attachWorkbenchVault } from "./workbench"
import {
  AUTHORING_KIT_VERSION,
  getAuthoringKitFile,
  listAuthoringKitFiles,
  serializeAuthoringKit,
} from "./authoring-kit"

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id)
  if (!node) throw new Error("Missing workbench mount point: " + id)
  return node as T
}

const status = byId<HTMLElement>("workbench-status")
const missing = byId<HTMLElement>("workbench-missing")
const missingMessage = byId<HTMLElement>("workbench-missing-message")
const chooseFolder = byId<HTMLButtonElement>("workbench-choose-folder")
const content = byId<HTMLElement>("workbench-content")
const vaultLabel = byId<HTMLElement>("workbench-vault")
const scriptSelect = byId<HTMLSelectElement>("workbench-script-select")
const fileList = byId<HTMLElement>("workbench-file-list")
const deleteScriptButton = byId<HTMLButtonElement>("workbench-delete-script")
const deleteFileShortcut = byId<HTMLButtonElement>("workbench-delete-file-shortcut")
const scriptContext = byId<HTMLElement>("workbench-script-context")
const editorMount = byId<HTMLElement>("workbench-editor")
const fileTitle = byId<HTMLElement>("workbench-file-title")
const fileIcon = byId<HTMLElement>("workbench-file-icon")
const languageStatus = byId<HTMLElement>("workbench-language")
const fileStatus = byId<HTMLElement>("workbench-file-status")
const diagnostic = byId<HTMLElement>("workbench-diagnostic")
const saveButton = byId<HTMLButtonElement>("workbench-save")
const renameFileButton = byId<HTMLButtonElement>("workbench-rename-file")
const deleteFileButton = byId<HTMLButtonElement>("workbench-delete-file")
const renameFileInput = byId<HTMLInputElement>("workbench-rename-file-input")
const createDialog = byId<HTMLElement>("workbench-create-dialog")
const createForm = createDialog.querySelector<HTMLFormElement>("form")!
const createTitle = byId<HTMLElement>("workbench-create-title")
const createDescription = byId<HTMLElement>("workbench-create-description")
const createLabel = byId<HTMLElement>("workbench-create-label")
const createInput = byId<HTMLInputElement>("workbench-create-input")
const createError = byId<HTMLElement>("workbench-create-error")
const createConfirm = byId<HTMLButtonElement>("workbench-create-confirm")
const kitPanel = byId<HTMLElement>("workbench-kit-panel")
const kitList = byId<HTMLElement>("workbench-kit-list")
const kitVersion = byId<HTMLElement>("workbench-kit-version")

let root: FileSystemDirectoryHandle | null = null
let scripts: ScriptDiscovery[] = []
let files: ScriptFileRecord[] = []
let selectedScriptId: string | null = null
let selectedFilePath: string | null = null
let selectedLastModified: number | null = null
let editor: ReturnType<typeof mountScriptEditor> | null = null
let refreshGeneration = 0
let busy = false
let dialogMode: "create-extension" | "create-file" | "delete-extension" | "delete-file" = "create-extension"
const drafts = new Map<string, string>()

const draftKey = (id: string, path: string) => id + ":" + path

function setStatus(message: string, error = false): void {
  status.textContent = message
  status.classList.toggle("is-error", error)
}

function setDiagnostic(message: string): void {
  diagnostic.textContent = message
  diagnostic.hidden = message.length === 0
}

function destroyEditor(): void {
  editor?.destroy()
  editor = null
  editorMount.replaceChildren()
  selectedLastModified = null
  saveButton.disabled = true
  renameFileButton.disabled = true
  deleteFileButton.disabled = true
  deleteFileShortcut.disabled = true
  renameFileInput.disabled = true
  fileTitle.textContent = "Select a file"
  fileIcon.textContent = "—"
  languageStatus.textContent = "Plain text"
  fileStatus.textContent = ""
}

function updateSelectionLabel(): void {
  const selected = scripts.find((item) => item.id === selectedScriptId)
  scriptContext.textContent = selected?.manifest?.name ?? selected?.id ?? "No extension selected"
}

function renderScripts(): void {
  scriptSelect.replaceChildren()
  if (scripts.length === 0) {
    const empty = document.createElement("option")
    empty.value = ""
    empty.textContent = "No extensions"
    scriptSelect.append(empty)
    scriptSelect.disabled = true
  } else {
    scriptSelect.disabled = false
    for (const item of scripts) {
      const option = document.createElement("option")
      option.value = item.id
      option.textContent = item.manifest?.name ?? item.id
      if (item.error) option.textContent += " (invalid)"
      scriptSelect.append(option)
    }
    scriptSelect.value = selectedScriptId ?? scripts[0].id
  }
  deleteScriptButton.disabled = selectedScriptId === null || busy
  updateSelectionLabel()
}

function setCreateError(message: string): void {
  createError.textContent = message
  createError.hidden = message.length === 0
}

function closeCreateDialog(): void {
  createDialog.hidden = true
  setCreateError("")
}

function openCreateDialog(mode: "extension" | "file"): void {
  if (mode === "file" && !selectedScriptId) return
  dialogMode = mode === "extension" ? "create-extension" : "create-file"
  createTitle.textContent = mode === "extension" ? "New extension" : "New file"
  createDescription.hidden = true
  createLabel.hidden = false
  createInput.hidden = false
  createLabel.textContent = mode === "extension" ? "Extension id" : "File path"
  createInput.placeholder = mode === "extension" ? "daily-tools" : "helper.js"
  createInput.value = ""
  createConfirm.textContent = "Create"
  createConfirm.classList.remove("workbench-button-danger")
  setCreateError("")
  createDialog.hidden = false
  createInput.focus()
}

function openDeleteDialog(mode: "extension" | "file"): void {
  if (mode === "extension" && !selectedScriptId) return
  if (mode === "file" && !selectedFilePath) return
  dialogMode = mode === "extension" ? "delete-extension" : "delete-file"
  const target = mode === "extension" ? selectedScriptId : selectedFilePath
  createTitle.textContent = mode === "extension" ? "Delete extension?" : "Delete file?"
  const hasDraft = mode === "file" && selectedScriptId && selectedFilePath
    ? drafts.has(draftKey(selectedScriptId, selectedFilePath))
    : false
  createDescription.textContent = mode === "extension"
    ? `Delete ${target} and all of its files from this workspace?`
    : `Delete ${target} from ${selectedScriptId}?${hasDraft ? " Its unsaved changes will be lost." : ""}`
  createDescription.hidden = false
  createLabel.hidden = true
  createInput.hidden = true
  createConfirm.textContent = "Delete"
  createConfirm.classList.add("workbench-button-danger")
  setCreateError("")
  createDialog.hidden = false
  createConfirm.focus()
}

function renderFiles(): void {
  fileList.replaceChildren()
  for (const file of files) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "workbench-list-row workbench-file-row"
    row.classList.toggle("is-selected", file.path === selectedFilePath)
    row.dataset.filePath = file.path
    const label = document.createElement("span")
    label.textContent = file.path
    const dirty = drafts.has(draftKey(selectedScriptId ?? "", file.path))
    if (dirty) label.textContent += " *"
    row.append(label)
    row.addEventListener("click", () => void selectFile(file.path))
    fileList.append(row)
  }
  if (files.length === 0) {
    const empty = document.createElement("p")
    empty.className = "workbench-muted workbench-empty-list"
    empty.textContent = selectedScriptId ? "No JavaScript or JSON files." : "Choose an extension first."
    fileList.append(empty)
  }
}

function renderKit(): void {
  kitVersion.textContent = "v" + AUTHORING_KIT_VERSION
  kitList.replaceChildren()
  for (const file of listAuthoringKitFiles()) {
    const row = document.createElement("div")
    row.className = "workbench-kit-row"
    const name = document.createElement("span")
    name.textContent = file.path
    const copy = document.createElement("button")
    copy.type = "button"
    copy.textContent = "Copy"
    copy.addEventListener("click", () => void copyKitFile(file.path))
    const download = document.createElement("button")
    download.type = "button"
    download.textContent = "Download"
    download.addEventListener("click", () => downloadText(file.path.replaceAll("/", "-"), file.content))
    row.append(name, copy, download)
    kitList.append(row)
  }
  const all = document.createElement("button")
  all.type = "button"
  all.textContent = "Download complete kit"
  all.addEventListener("click", () =>
    downloadText("brulion-authoring-kit-" + AUTHORING_KIT_VERSION + ".txt", serializeAuthoringKit()),
  )
  kitList.append(all)
}

async function copyKitFile(path: string): Promise<void> {
  const file = getAuthoringKitFile(path)
  if (!file) return
  try {
    await navigator.clipboard.writeText(file.content)
    setStatus("Copied " + path + ".")
  } catch {
    setDiagnostic("Clipboard access was unavailable. Use Download instead.")
  }
}

function downloadText(name: string, text: string): void {
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}

function openApiDocs(): void {
  const url = new URL("api.html", location.href).href
  const child = window.open(url, "brulion-extension-api", "popup,width=1000,height=800")
  if (child) {
    child.focus()
    return
  }
  const fallback = document.createElement("a")
  fallback.href = url
  fallback.target = "_blank"
  fallback.rel = "noopener noreferrer"
  fallback.click()
}

async function refreshFiles(preserveSelection = true): Promise<void> {
  if (!root || !selectedScriptId) {
    files = []
    renderFiles()
    destroyEditor()
    return
  }
  try {
    const currentId = selectedScriptId
    const next = await listScriptFiles(root, currentId)
    if (currentId !== selectedScriptId) return
    files = next
    renderFiles()
    const wanted = preserveSelection && selectedFilePath && next.some((file) => file.path === selectedFilePath)
      ? selectedFilePath
      : next[0]?.path ?? null
    if (wanted !== selectedFilePath) {
      await selectFile(wanted)
    } else if (wanted) {
      const selected = next.find((file) => file.path === wanted)
      const dirty = drafts.has(draftKey(currentId, wanted))
      const editorText = editor ? getScriptEditorText(editor) : null
      const contentChanged = !dirty && editorText !== null && selected?.text !== editorText
      if (
        selected &&
        ((selectedLastModified !== null && selected.lastModified !== selectedLastModified) || contentChanged)
      ) {
        if (dirty) {
          setDiagnostic("This file changed on disk; the preserved draft will conflict until reloaded.")
        } else {
          await selectFile(wanted)
        }
      }
    } else {
      destroyEditor()
    }
  } catch (error) {
    files = []
    renderFiles()
    destroyEditor()
    setDiagnostic(error instanceof Error ? error.message : "Unable to read extension files.")
  }
}

async function selectScript(id: string): Promise<void> {
  if (busy || !root) return
  selectedScriptId = id
  selectedFilePath = null
  files = []
  renderScripts()
  setDiagnostic("")
  setStatus("Reading " + id + "…")
  await refreshFiles(false)
  if (selectedScriptId === id) {
    const label = scripts.find((item) => item.id === id)?.manifest?.name ?? id
    setStatus("Editing " + label + ".")
  }
}

async function selectFile(path: string | null): Promise<void> {
  if (!root || !selectedScriptId || !path) {
    selectedFilePath = null
    destroyEditor()
    return
  }
  const id = selectedScriptId
  selectedFilePath = path
  const generation = refreshGeneration
  try {
    const record = files.find((file) => file.path === path) ?? await readScriptFile(root, id, path)
    if (generation !== refreshGeneration || selectedScriptId !== id || selectedFilePath !== path) return
    destroyEditor()
    selectedLastModified = record.lastModified
    fileTitle.textContent = path
    const isJson = path.toLowerCase().endsWith(".json")
    fileIcon.textContent = isJson ? "{}" : "JS"
    languageStatus.textContent = isJson ? "JSON" : "JavaScript"
    const key = draftKey(id, path)
    const draft = drafts.get(key)
    fileStatus.textContent = draft === undefined ? "Loaded from disk." : "Unsaved changes preserved."
    editor = mountScriptEditor(editorMount, {
      language: isJson ? "json" : "javascript",
      onChange: (text) => {
        drafts.set(key, text)
        fileStatus.textContent = "Unsaved changes."
        renderFiles()
      },
      onSave: () => void saveFile(),
    })
    setScriptEditorText(editor, draft ?? record.text)
    saveButton.disabled = false
    renameFileButton.disabled = false
    deleteFileButton.disabled = false
    deleteFileShortcut.disabled = false
    renameFileInput.disabled = false
    renderFiles()
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to read the selected file.")
  }
}

async function saveFile(): Promise<void> {
  if (busy || !root || !selectedScriptId || !selectedFilePath || !editor || selectedLastModified === null) return
  const id = selectedScriptId
  const path = selectedFilePath
  const text = getScriptEditorText(editor)
  if (path === "manifest.json") {
    const parsed = parseScriptManifestText(text)
    if (!parsed.ok || parsed.manifest.id !== id) {
      setDiagnostic(parsed.ok ? "Manifest id must match its script folder." : parsed.error)
      return
    }
  }
  busy = true
  saveButton.disabled = true
  try {
    const result = await writeScriptFile(root, id, path, text, selectedLastModified)
    if (result.status === "conflict") {
      setDiagnostic("This file changed on disk. Refresh it before saving.")
      return
    }
    drafts.delete(draftKey(id, path))
    selectedLastModified = result.lastModified
    fileStatus.textContent = "Saved at " + result.lastModified + "."
    setDiagnostic("")
    await refreshFiles(true)
    setStatus("Saved " + path + ".")
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to save file.")
  } finally {
    busy = false
    saveButton.disabled = !editor
  }
}

function scaffoldManifest(id: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    apiVersion: 1,
    id,
    name: id,
    version: "0.1.0",
    entry: "main.js",
    permissions: ["commands"],
  }, null, 2)
}

async function createExtension(): Promise<void> {
  if (busy || !root) return
  const id = createInput.value.trim()
  if (!id) {
    setCreateError("Enter an extension id.")
    return
  }
  let created = false
  busy = true
  try {
    const result = await createScript(
      root,
      JSON.parse(scaffoldManifest(id)) as unknown,
      "export default async function activate(api) {\n  // Review before enabling.\n}\n",
    )
    if (result.status === "exists") {
      setCreateError("An extension with this id already exists.")
      return
    }
    setDiagnostic("")
    await refresh()
    created = true
  } catch (error) {
    setCreateError(error instanceof Error ? error.message : "Unable to create extension.")
  } finally {
    busy = false
  }
  if (created) {
    closeCreateDialog()
    await selectScript(id)
  }
}

async function createFile(): Promise<void> {
  if (busy || !root || !selectedScriptId) return
  const path = createInput.value.trim()
  if (!path) {
    setCreateError("Enter a file path.")
    return
  }
  busy = true
  try {
    const result = await createScriptFile(root, selectedScriptId, path, "")
    if (result.status === "exists") {
      setCreateError("That file already exists.")
      return
    }
    await refreshFiles(false)
    await selectFile(path)
    closeCreateDialog()
  } catch (error) {
    setCreateError(error instanceof Error ? error.message : "Unable to create file.")
  } finally {
    busy = false
  }
}

async function renameFile(): Promise<void> {
  if (busy || !root || !selectedScriptId || !selectedFilePath || selectedLastModified === null) return
  const entry = scripts.find((script) => script.id === selectedScriptId)?.manifest?.entry
  if (selectedFilePath === "manifest.json" || selectedFilePath === entry) {
    setDiagnostic("The manifest and declared entry cannot be renamed from the file editor.")
    return
  }
  const to = renameFileInput.value.trim()
  if (!to) return
  busy = true
  try {
    const result = await renameScriptFile(root, selectedScriptId, selectedFilePath, to, selectedLastModified)
    if (result.status !== "renamed") {
      setDiagnostic(
        result.status === "conflict"
          ? "The file changed on disk."
          : result.status === "missing"
            ? "The file is no longer on disk."
            : "The destination already exists.",
      )
      return
    }
    const oldPath = selectedFilePath
    const oldKey = draftKey(selectedScriptId, oldPath)
    const draft = drafts.get(oldKey)
    drafts.delete(oldKey)
    if (draft !== undefined) drafts.set(draftKey(selectedScriptId, to), draft)
    selectedFilePath = to
    renameFileInput.value = ""
    await refreshFiles(false)
    await selectFile(to)
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to rename file.")
  } finally {
    busy = false
  }
}

async function deleteFile(): Promise<void> {
  if (busy || !root || !selectedScriptId || !selectedFilePath || selectedLastModified === null) return
  const id = selectedScriptId
  const path = selectedFilePath
  const entry = scripts.find((script) => script.id === id)?.manifest?.entry
  if (path === "manifest.json" || path === entry) {
    setCreateError("The manifest and declared entry are required and cannot be deleted.")
    return
  }
  busy = true
  try {
    const result = await deleteScriptFile(root, id, path, selectedLastModified)
    if (result.status !== "deleted") {
      setCreateError(result.status === "conflict" ? "The file changed on disk." : "The file is no longer on disk.")
      return
    }
    drafts.delete(draftKey(id, path))
    selectedFilePath = null
    closeCreateDialog()
    await refreshFiles(false)
    setDiagnostic("")
  } catch (error) {
    setCreateError(error instanceof Error ? error.message : "Unable to delete file.")
  } finally {
    busy = false
  }
}

async function deleteExtension(): Promise<void> {
  if (busy || !root || !selectedScriptId) return
  const id = selectedScriptId
  busy = true
  try {
    await deleteScript(root, id)
  } catch (error) {
    setCreateError(error instanceof Error ? error.message : "Unable to delete extension.")
    busy = false
    return
  }

  let settingsWarning = ""
  try {
    const settings = await loadSettings(root)
    if (settings.extensions?.includes(id)) {
      await saveSettings(root, {
        ...settings,
        extensions: settings.extensions.filter((candidate) => candidate !== id),
      })
    }
  } catch {
    settingsWarning = "Extension files were deleted, but its enabled setting could not be updated."
  }
  for (const key of drafts.keys()) {
    if (key.startsWith(id + ":")) drafts.delete(key)
  }
  selectedScriptId = null
  selectedFilePath = null
  closeCreateDialog()
  busy = false
  await refresh()
  if (settingsWarning) setDiagnostic(settingsWarning)
}

async function refresh(): Promise<void> {
  const generation = ++refreshGeneration
  if (!root) return
  setStatus("Refreshing filesystem…")
  try {
    const found = await listScripts(root)
    if (generation !== refreshGeneration) return
    scripts = found
    renderScripts()
    if (selectedScriptId && found.some((item) => item.id === selectedScriptId)) {
      await refreshFiles(true)
    } else if (found[0]) {
      await selectScript(found[0].id)
    } else {
      selectedScriptId = null
      selectedFilePath = null
      files = []
      renderFiles()
      destroyEditor()
    }
    setStatus(
      found.length === 0
        ? "No extensions yet."
        : found.length === 1
          ? "1 extension"
          : found.length + " extensions",
    )
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to refresh the filesystem.")
  }
}

async function choose(): Promise<void> {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" })
    const added = await addVault(handle)
    await markVaultAttached(added.id, "")
    const reference = effectiveVaultName(added)
    const url = new URL(location.href)
    url.searchParams.set("ws", reference)
    history.replaceState(history.state, "", url.pathname + url.search)
    await start(reference)
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Folder selection was cancelled.")
  }
}

async function start(reference: string | null): Promise<void> {
  const attachment = await attachWorkbenchVault(reference)
  if (!attachment.ok) {
    root = null
    content.hidden = true
    missing.hidden = false
    missingMessage.textContent = attachment.message
    vaultLabel.textContent = reference ? "Workspace: " + reference : ""
    setStatus("Workbench is not attached.", true)
    return
  }
  root = attachment.root
  vaultLabel.textContent = "Workspace: " + effectiveVaultName(attachment.vault)
  missing.hidden = true
  content.hidden = false
  await refresh()
}

byId<HTMLButtonElement>("workbench-refresh").addEventListener("click", () => void refresh())
byId<HTMLButtonElement>("workbench-api-docs").addEventListener("click", openApiDocs)
byId<HTMLButtonElement>("workbench-kit").addEventListener("click", () => {
  kitPanel.hidden = false
  renderKit()
})
byId<HTMLButtonElement>("workbench-kit-close").addEventListener("click", () => {
  kitPanel.hidden = true
})
chooseFolder.addEventListener("click", () => void choose())
scriptSelect.addEventListener("change", () => void selectScript(scriptSelect.value))
byId<HTMLButtonElement>("workbench-create-script").addEventListener("click", () => openCreateDialog("extension"))
byId<HTMLButtonElement>("workbench-create-file").addEventListener("click", () => openCreateDialog("file"))
deleteScriptButton.addEventListener("click", () => openDeleteDialog("extension"))
deleteFileShortcut.addEventListener("click", () => openDeleteDialog("file"))
byId<HTMLButtonElement>("workbench-create-cancel").addEventListener("click", closeCreateDialog)
createDialog.addEventListener("click", (event) => {
  if (event.target === createDialog) closeCreateDialog()
})
createForm.addEventListener("submit", (event) => {
  event.preventDefault()
  if (dialogMode === "create-extension") void createExtension()
  else if (dialogMode === "create-file") void createFile()
  else if (dialogMode === "delete-extension") void deleteExtension()
  else void deleteFile()
})
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !createDialog.hidden) closeCreateDialog()
})
saveButton.addEventListener("click", () => void saveFile())
renameFileButton.addEventListener("click", () => void renameFile())
deleteFileButton.addEventListener("click", () => openDeleteDialog("file"))
window.addEventListener("focus", () => void refresh())
const refreshTimer = window.setInterval(() => void refresh(), 3000)
window.addEventListener("beforeunload", () => {
  window.clearInterval(refreshTimer)
  editor?.destroy()
})
void start(new URLSearchParams(location.search).get("ws"))
