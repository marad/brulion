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

test("runs an enabled local command in the sandbox and opens its workbench", async ({ page }) => {
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
  await expect(page.locator(".extensions-row")).toHaveCount(1)
  await expect(page.locator(".extensions-toggle")).toHaveText("Disable")
})
