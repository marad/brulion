import "./styles.css"
import {
  createScript,
  createScriptFile,
  deleteScript,
  deleteScriptFile,
  listScriptFiles,
  listScripts,
  readScriptFile,
  renameScript,
  renameScriptFile,
  writeScriptFile,
  type ScriptDiscovery,
  type ScriptFileRecord,
} from "./script-storage"
import { parseScriptManifestText } from "./script-manifest"
import { getScriptEditorText, mountScriptEditor, setScriptEditorText } from "./script-editor"
import { loadSettings, saveSettings, type Settings } from "./settings"
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
const scriptList = byId<HTMLElement>("workbench-script-list")
const fileList = byId<HTMLElement>("workbench-file-list")
const selectedScriptLabel = byId<HTMLElement>("workbench-selected-script")
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
const renameScriptInput = byId<HTMLInputElement>("workbench-rename-script-input")
const renameScriptButton = byId<HTMLButtonElement>("workbench-rename-script")
const deleteScriptButton = byId<HTMLButtonElement>("workbench-delete-script")
const toggleScriptButton = byId<HTMLButtonElement>("workbench-toggle-script")
const newIdInput = byId<HTMLInputElement>("workbench-new-id")
const newFileInput = byId<HTMLInputElement>("workbench-new-file")
const kitPanel = byId<HTMLElement>("workbench-kit-panel")
const kitList = byId<HTMLElement>("workbench-kit-list")
const kitVersion = byId<HTMLElement>("workbench-kit-version")

let root: FileSystemDirectoryHandle | null = null
let currentVaultName = ""
let currentSettings: Settings | null = null
let scripts: ScriptDiscovery[] = []
let files: ScriptFileRecord[] = []
let selectedScriptId: string | null = null
let selectedFilePath: string | null = null
let selectedLastModified: number | null = null
let editor: ReturnType<typeof mountScriptEditor> | null = null
let refreshGeneration = 0
let busy = false
const drafts = new Map<string, string>()
let deleteScriptArmed = false
let deleteFileArmed = false

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
  renameFileInput.disabled = true
  fileTitle.textContent = "Select a file"
  fileIcon.textContent = "—"
  languageStatus.textContent = "Plain text"
  fileStatus.textContent = ""
}

function updateScriptControls(): void {
  const selected = selectedScriptId !== null
  renameScriptInput.disabled = !selected
  renameScriptButton.disabled = !selected || busy
  deleteScriptButton.disabled = !selected || busy
  toggleScriptButton.disabled = !selected || busy
  if (selected) {
    const enabled = currentSettings?.extensions?.includes(selectedScriptId!) ?? false
    toggleScriptButton.textContent = enabled ? "Disable extension" : "Enable extension"
  } else {
    toggleScriptButton.textContent = "Enable extension"
  }
}

function updateSelectionLabels(): void {
  const selected = scripts.find((item) => item.id === selectedScriptId)
  const label = selected?.manifest?.name ?? selected?.id ?? "No extension selected"
  selectedScriptLabel.textContent = label
  scriptContext.textContent = selected ? label : "No extension selected"
}

function renderScripts(): void {
  scriptList.replaceChildren()
  for (const item of scripts) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = "workbench-list-row"
    row.classList.toggle("is-selected", item.id === selectedScriptId)
    row.dataset.scriptId = item.id
    const label = document.createElement("strong")
    label.textContent = item.manifest?.name ?? item.id
    const detail = document.createElement("span")
    const enabled = currentSettings?.extensions?.includes(item.id) ?? false
    detail.textContent = item.error
      ? "Invalid: " + item.error
      : (enabled ? "Enabled" : "Disabled") + " · " + item.id
    row.append(label, detail)
    row.addEventListener("click", () => void selectScript(item.id))
    scriptList.append(row)
  }
  if (scripts.length === 0) {
    const empty = document.createElement("p")
    empty.className = "workbench-muted"
    empty.textContent = "No extensions found."
    scriptList.append(empty)
  }
  updateSelectionLabels()
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
  updateScriptControls()
  setDiagnostic("")
  setStatus("Reading " + id + "…")
  await refreshFiles(false)
  await refreshSettings()
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
    if (generation !== refreshGeneration && selectedScriptId !== id) return
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
    renameFileInput.disabled = false
    renderFiles()
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to read the selected file.")
  }
}

async function refreshSettings(): Promise<void> {
  if (!root) return
  currentSettings = await loadSettings(root)
  updateScriptControls()
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
    updateScriptControls()
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
  const id = newIdInput.value.trim()
  if (!id) return
  let created = false
  busy = true
  try {
    const result = await createScript(
      root,
      JSON.parse(scaffoldManifest(id)) as unknown,
      "export default async function activate(api) {\n  // Review before enabling.\n}\n",
    )
    if (result.status === "exists") {
      setDiagnostic("An extension with this id already exists.")
      return
    }
    newIdInput.value = ""
    setDiagnostic("")
    await refresh()
    created = true
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to create extension.")
  } finally {
    busy = false
    updateScriptControls()
  }
  if (created) await selectScript(id)
}

async function createFile(): Promise<void> {
  if (busy || !root || !selectedScriptId) return
  const path = newFileInput.value.trim()
  if (!path) return
  busy = true
  try {
    const result = await createScriptFile(root, selectedScriptId, path, "")
    if (result.status === "exists") {
      setDiagnostic("That file already exists.")
      return
    }
    newFileInput.value = ""
    await refreshFiles(false)
    await selectFile(path)
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to create file.")
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
    const oldKey = draftKey(selectedScriptId, selectedFilePath)
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
  const entry = scripts.find((script) => script.id === selectedScriptId)?.manifest?.entry
  if (selectedFilePath === "manifest.json" || selectedFilePath === entry) {
    setDiagnostic("The manifest and declared entry are required and cannot be deleted.")
    return
  }
  if (!deleteFileArmed) {
    deleteFileArmed = true
    deleteFileButton.textContent = "Confirm delete"
    setDiagnostic("Press Delete file again to remove " + selectedFilePath + ".")
    return
  }
  busy = true
  try {
    const result = await deleteScriptFile(root, selectedScriptId, selectedFilePath, selectedLastModified)
    if (result.status === "conflict") {
      setDiagnostic("The file changed on disk.")
      return
    }
    drafts.delete(draftKey(selectedScriptId, selectedFilePath))
    selectedFilePath = null
    await refreshFiles(false)
    setDiagnostic("")
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to delete file.")
  } finally {
    busy = false
    deleteFileArmed = false
    deleteFileButton.textContent = "Delete file"
  }
}

async function renameExtension(): Promise<void> {
  if (busy || !root || !selectedScriptId) return
  const from = selectedScriptId
  const to = renameScriptInput.value.trim()
  if (!to) return
  busy = true
  try {
    const result = await renameScript(root, from, to)
    if (result.status === "exists") {
      setDiagnostic("An extension with that id already exists.")
      return
    }
    if (currentSettings?.extensions?.includes(from)) {
      const extensions = currentSettings.extensions.map((id) => id === from ? to : id)
      currentSettings = { ...currentSettings, extensions }
      await saveSettings(root, currentSettings)
    }
    selectedScriptId = to
    renameScriptInput.value = ""
    await refresh()
    await selectScript(to)
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to rename extension.")
  } finally {
    busy = false
    updateScriptControls()
  }
}

async function deleteExtension(): Promise<void> {
  if (busy || !root || !selectedScriptId) return
  if (!deleteScriptArmed) {
    deleteScriptArmed = true
    deleteScriptButton.textContent = "Confirm delete"
    setDiagnostic("Press Delete extension again to remove " + selectedScriptId + ".")
    return
  }
  const id = selectedScriptId
  busy = true
  try {
    await deleteScript(root, id)
    if (currentSettings?.extensions?.includes(id)) {
      currentSettings = {
        ...currentSettings,
        extensions: currentSettings.extensions.filter((candidate) => candidate !== id),
      }
      await saveSettings(root, currentSettings)
    }
    selectedScriptId = null
    selectedFilePath = null
    await refresh()
    setDiagnostic("")
  } catch (error) {
    setDiagnostic(error instanceof Error ? error.message : "Unable to delete extension.")
  } finally {
    busy = false
    deleteScriptArmed = false
    deleteScriptButton.textContent = "Delete extension"
    updateScriptControls()
  }
}

async function toggleExtension(): Promise<void> {
  if (busy || !root || !selectedScriptId) return
  const id = selectedScriptId
  const settings = currentSettings ?? await loadSettings(root)
  const enabled = settings.extensions?.includes(id) ?? false
  const extensions = new Set(settings.extensions ?? [])
  if (enabled) extensions.delete(id)
  else extensions.add(id)
  currentSettings = { ...settings, extensions: [...extensions] }
  await saveSettings(root, currentSettings)
  updateScriptControls()
  setStatus(
    (enabled ? "Disabled " : "Enabled ") + id + ". Return to the notes window to run its commands.",
  )
}

async function refresh(): Promise<void> {
  const generation = ++refreshGeneration
  if (!root) return
  setStatus("Refreshing filesystem…")
  try {
    const found = await listScripts(root)
    if (generation !== refreshGeneration) return
    scripts = found
    await refreshSettings()
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
      updateScriptControls()
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
  currentVaultName = effectiveVaultName(attachment.vault)
  currentSettings = await loadSettings(root)
  vaultLabel.textContent = "Workspace: " + currentVaultName
  missing.hidden = true
  content.hidden = false
  await refresh()
}

byId<HTMLButtonElement>("workbench-refresh").addEventListener("click", () => void refresh())
byId<HTMLButtonElement>("workbench-kit").addEventListener("click", () => {
  kitPanel.hidden = false
  renderKit()
})
byId<HTMLButtonElement>("workbench-kit-close").addEventListener("click", () => {
  kitPanel.hidden = true
})
chooseFolder.addEventListener("click", () => void choose())
byId<HTMLButtonElement>("workbench-create-script").addEventListener("click", () => newIdInput.focus())
byId<HTMLButtonElement>("workbench-create-script-confirm").addEventListener("click", () => void createExtension())
byId<HTMLButtonElement>("workbench-create-file").addEventListener("click", () => newFileInput.focus())
byId<HTMLButtonElement>("workbench-create-file-confirm").addEventListener("click", () => void createFile())
saveButton.addEventListener("click", () => void saveFile())
renameFileButton.addEventListener("click", () => void renameFile())
deleteFileButton.addEventListener("click", () => void deleteFile())
renameScriptButton.addEventListener("click", () => void renameExtension())
deleteScriptButton.addEventListener("click", () => void deleteExtension())
toggleScriptButton.addEventListener("click", () => void toggleExtension())
window.addEventListener("focus", () => void refresh())
const refreshTimer = window.setInterval(() => void refresh(), 3000)
window.addEventListener("beforeunload", () => {
  window.clearInterval(refreshTimer)
  editor?.destroy()
})
void start(new URLSearchParams(location.search).get("ws"))
