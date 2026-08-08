import { test, expect, type Page } from "@playwright/test"

// FEAT-0084/0090: exercise the real iframe runner, OPFS script discovery,
// workbench lifecycle, freshness, conflict handling, and command integration in Chromium.
const FOLDER = "e2e-extension-folder"

test.describe.configure({ timeout: 60_000 })

const manifest = JSON.stringify({
  schemaVersion: 1,
  apiVersion: 1,
  id: "daily-tools",
  name: "Daily tools",
  version: "0.1.0",
  entry: "main.js",
  permissions: ["commands", "editor:write"],
})

const source = `export default async function activate(api) {
  await api.commands.register({ id: "ping", label: "Ping extension" }, async () => {
    await api.editor.replaceSelection("pong")
  })
}`

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeFile(page: Page, path: string, content: string) {
  await page.evaluate(
    async ([folder, relativePath, text]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      const parts = relativePath.split("/")
      const file = parts.pop()
      if (!file) throw new Error("Missing file name")
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
    [FOLDER, path, content] as const,
  )
}

async function readFile(page: Page, path: string): Promise<string> {
  return page.evaluate(
    async ([folder, relativePath]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder)
      const parts = relativePath.split("/")
      const file = parts.pop()
      if (!file) throw new Error("Missing file name")
      for (const part of parts) dir = await dir.getDirectoryHandle(part)
      return (await dir.getFileHandle(file)).getFile().then((item) => item.text())
    },
    [FOLDER, path] as const,
  )
}

async function seedVault(page: Page) {
  await writeFile(page, "alpha.md", "alpha body")
  await writeFile(
    page,
    ".brulion.json",
    JSON.stringify({
      font: [],
      textSize: 16,
      editorWidth: "narrow",
      vim: false,
      actionBar: [],
      journalPath: "",
      theme: "system",
      workspace: "",
      extensions: ["daily-tools"],
    }),
  )
  await writeFile(page, ".brulion/scripts/daily-tools/manifest.json", manifest)
  await writeFile(page, ".brulion/scripts/daily-tools/main.js", source)
}

const paletteRows = (page: Page) => page.locator(".palette-row")

async function openWorkbench(page: Page) {
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("edit extensions")
  const popup = page.waitForEvent("popup")
  await paletteRows(page).first().click()
  const workbench = await popup
  await workbench.waitForLoadState()
  await expect(workbench.locator("#workbench-content")).toBeVisible()
  return workbench
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedVault(page)
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(1)
  await expect(page.locator(".cm-content")).toHaveText("alpha body")
})

test("runs an enabled local command and keeps management separate from the workbench", async ({ page }) => {
  const editor = page.locator(".cm-content")
  await editor.click()
  await page.keyboard.press("Control+A")
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("ping extension")

  // The registry starts extensions asynchronously after the first editor paint;
  // re-fire the filter while waiting for the runner's command registration.
  await expect.poll(async () => {
    await page.locator("#palette-input").fill("ping extension")
    return paletteRows(page).count()
  }).toBe(1)
  await paletteRows(page).first().click()
  await expect(editor).toHaveText("pong")

  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("manage extensions")
  await paletteRows(page).first().click()
  await expect(page.locator("#extensions-backdrop")).toBeVisible()
  await expect(page.locator("#extensions-backdrop .extensions-row")).toHaveCount(1)
  await expect(page.locator("#extensions-backdrop .extensions-toggle")).toHaveText("Disable")
  await page.locator("#extensions-backdrop .extensions-close").click()

  const workbench = await openWorkbench(page)
  const apiPopupPromise = workbench.waitForEvent("popup")
  await workbench.locator("#workbench-api-docs").click()
  const apiDocs = await apiPopupPromise
  await apiDocs.waitForLoadState()
  await expect(apiDocs).toHaveTitle("Brulion Extension API")
  await expect(apiDocs.locator("#api-docs-content")).toContainText("brulion.commands")
  await expect(apiDocs.locator("#api-docs-reference")).toContainText("notes.write")
  await expect(apiDocs.locator("#api-docs-reference")).toContainText("expectedLastModified")
  await expect(apiDocs.locator("#api-docs-search")).toBeVisible()
  await expect(apiDocs.locator("#api-docs-toc")).toContainText("API reference")
  await expect(apiDocs.locator(".api-docs-copy-button")).not.toHaveCount(0)
  await apiDocs.locator("#api-docs-search").fill("notes.write")
  await expect(apiDocs.locator(".api-method-card:not([hidden])")).toHaveCount(1)
  await expect(apiDocs.locator("#api-docs-search-status")).toContainText("1 matching method")
  await expect(apiDocs.locator("#api-docs-declarations")).toContainText("BrulionApi")
  await expect(apiDocs.locator("#api-docs-declaration-source span[class^=\"tok-\"]")).not.toHaveCount(0)
  await expect(workbench.locator("#workbench-content")).toBeVisible()
  await apiDocs.close()
  await expect(workbench.locator("#workbench-script-select option")).toHaveCount(1)
  await expect(workbench.locator("#workbench-script-select")).toHaveValue("daily-tools")
  await expect(workbench.locator(".workbench-file-row")).toHaveCount(2)
  await expect(workbench.locator(".workbench-tabbar")).toHaveCount(0)
  await workbench.locator('[data-file-path="manifest.json"]').click()
  await expect(workbench.locator("#workbench-file-title")).toHaveText("manifest.json")
  await workbench.locator('[data-file-path="main.js"]').click()
  await workbench.locator('[data-file-path="manifest.json"]').dblclick()
  await expect(workbench.locator("#workbench-file-title")).toHaveText("manifest.json")
  await workbench.locator("#workbench-kit").click()
  await expect(workbench.locator("#workbench-kit-panel")).toBeVisible()
  await expect(workbench.locator("#workbench-kit-version")).toHaveText("v1.1.1")
  await expect(workbench.locator("#workbench-kit-list .workbench-kit-row")).toHaveCount(11)
  await workbench.locator("#workbench-kit-close").click()
  await expect(workbench.locator("#workbench-kit-panel")).toBeHidden()

  await workbench.locator("#workbench-create-script").click()
  await expect(workbench.locator("#workbench-create-dialog")).toBeVisible()
  await workbench.locator("#workbench-create-input").fill("daily-tools")
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator("#workbench-create-error")).toContainText("already exists")
  await expect(workbench.locator("#workbench-create-dialog")).toBeVisible()
  await workbench.locator("#workbench-create-input").fill("new-tools")
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator("#workbench-create-dialog")).toBeHidden()
  await expect(workbench.locator("#workbench-script-select option")).toHaveCount(2)
  await expect(workbench.locator("#workbench-script-select")).toHaveValue("new-tools")
  await expect(workbench.locator("#workbench-script-context")).toHaveText("new-tools")
  await expect(workbench.locator("#workbench-file-title")).toHaveText("main.js")

  await workbench.locator("#workbench-create-file").click()
  await workbench.locator("#workbench-create-input").fill("../bad.js")
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator("#workbench-create-error")).not.toBeEmpty()
  await workbench.locator("#workbench-create-input").fill("helper.js")
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator("#workbench-create-dialog")).toBeHidden()
  await expect(workbench.locator('[data-file-path="helper.js"]')).toBeVisible()
  await workbench.locator("#workbench-editor .cm-content").click()
  await workbench.keyboard.type("unsaved helper draft")
  await workbench.locator('[data-file-path="main.js"]').click()
  await workbench.locator('[data-file-path="helper.js"]').click()
  await expect(workbench.locator("#workbench-editor .cm-content")).toHaveText("unsaved helper draft")
  await workbench.locator("#workbench-delete-file-shortcut").click()
  await expect(workbench.locator("#workbench-create-dialog")).toBeVisible()
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator('[data-file-path="helper.js"]')).toHaveCount(0)
  await workbench.locator('[data-file-path="main.js"]').click()
  await workbench.locator("#workbench-delete-file-shortcut").click()
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator("#workbench-create-error")).toContainText("required")
  await expect(workbench.locator('[data-file-path="main.js"]')).toBeVisible()
  await workbench.locator("#workbench-create-cancel").click()

  await workbench.locator("#workbench-editor .cm-content").click()
  await workbench.keyboard.press("Control+A")
  await workbench.keyboard.type("export default async function activate(api) {}")
  await workbench.locator("#workbench-save").click()
  await expect(workbench.locator("#workbench-file-status")).toContainText("Saved")

  await workbench.waitForTimeout(25)
  await page.evaluate(
    async ([folder, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder)
      const scripts = await dir.getDirectoryHandle(".brulion")
      const sourceDir = await scripts.getDirectoryHandle("scripts")
      const ext = await sourceDir.getDirectoryHandle("new-tools")
      const file = await ext.getFileHandle("main.js")
      const writable = await file.createWritable()
      await writable.write(content)
      await writable.close()
    },
    [FOLDER, "external edit"] as const,
  )
  await workbench.locator("#workbench-refresh").click()
  await expect(workbench.locator("#workbench-editor .cm-content")).toHaveText("external edit")

  await workbench.locator("#workbench-delete-script").click()
  await expect(workbench.locator("#workbench-create-dialog")).toBeVisible()
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator("#workbench-script-select option")).toHaveCount(1)
  await expect(workbench.locator("#workbench-script-select")).toHaveValue("daily-tools")
})

test("P5 polling refreshes external files and preserves a dirty draft on conflict", async ({ page }) => {
  const workbench = await openWorkbench(page)
  await workbench.locator('[data-file-path="main.js"]').click()

  await writeFile(page, ".brulion/scripts/daily-tools/main.js", "external polling edit")
  await expect.poll(() => workbench.locator("#workbench-editor .cm-content").textContent()).toBe("external polling edit")

  await workbench.locator("#workbench-editor .cm-content").click()
  await workbench.keyboard.press("Control+A")
  await workbench.keyboard.type("local unsaved draft")
  await writeFile(page, ".brulion/scripts/daily-tools/main.js", "external conflict edit")

  await expect(workbench.locator("#workbench-diagnostic")).toContainText("preserved draft", { timeout: 6_000 })
  await expect(workbench.locator("#workbench-editor .cm-content")).toHaveText("local unsaved draft")
  await workbench.locator("#workbench-save").click()
  await expect(workbench.locator("#workbench-diagnostic")).toContainText("changed on disk")
  expect(await readFile(page, ".brulion/scripts/daily-tools/main.js")).toBe("external conflict edit")
  await workbench.close()
})

test("P5 release path creates, edits, saves, enables, and runs a new extension", async ({ page }) => {
  const workbench = await openWorkbench(page)
  await workbench.locator("#workbench-create-script").click()
  await workbench.locator("#workbench-create-input").fill("new-tools")
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator("#workbench-script-select")).toHaveValue("new-tools")
  await workbench.locator("#workbench-create-file").click()
  await workbench.locator("#workbench-create-input").fill("helper.js")
  await workbench.locator("#workbench-create-confirm").click()
  await expect(workbench.locator('[data-file-path="helper.js"]')).toBeVisible()
  await workbench.locator('[data-file-path="main.js"]').click()

  const createdSource = `export default async function activate(api) {
  await api.commands.register({ id: "created", label: "Created extension command" }, async () => {})
}`
  await workbench.locator("#workbench-editor .cm-content").click()
  await workbench.keyboard.press("Control+A")
  await workbench.keyboard.insertText(createdSource)
  await workbench.locator("#workbench-save").click()
  await expect(workbench.locator("#workbench-file-status")).toContainText("Saved")
  expect(await readFile(page, ".brulion/scripts/new-tools/main.js")).toContain('id: "created"')
  await workbench.close()
  await page.bringToFront()

  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("manage extensions")
  await paletteRows(page).first().click()
  const newRow = page.locator('[data-script-id="new-tools"]')
  await expect(newRow.locator(".extensions-toggle")).toHaveText("Enable")
  await newRow.locator(".extensions-toggle").click()
  expect(await readFile(page, ".brulion.json")).toContain('"new-tools"')
  await page.locator(".extensions-close").click()

  await page.keyboard.press("Control+Shift+K")
  await expect.poll(async () => {
    await page.locator("#palette-input").fill("created extension command")
    return paletteRows(page).count()
  }).toBe(1)
  await paletteRows(page).first().click()
  await expect(page.locator(".cm-content")).toBeVisible()
})
