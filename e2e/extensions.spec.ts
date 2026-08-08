import { test, expect, type Page } from "@playwright/test"

// FEAT-0084: exercise the real iframe runner, OPFS script discovery, command
// palette integration, and the explicit extension workbench in Chromium.
const FOLDER = "e2e-extension-folder"

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

  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("edit extensions")
  const popup = page.waitForEvent("popup")
  await paletteRows(page).first().click()
  const workbench = await popup
  await workbench.waitForLoadState()
  await expect(workbench.locator("#workbench-content")).toBeVisible()
  const apiPopupPromise = workbench.waitForEvent("popup")
  await workbench.locator("#workbench-api-docs").click()
  const apiDocs = await apiPopupPromise
  await apiDocs.waitForLoadState()
  await expect(apiDocs).toHaveTitle("Brulion Extension API")
  await expect(apiDocs.locator("#api-docs-content")).toContainText("brulion.commands")
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
  await expect(workbench.locator("#workbench-kit-version")).toHaveText("v1.0.0")
  await expect(workbench.locator("#workbench-kit-list .workbench-kit-row")).toHaveCount(10)
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
