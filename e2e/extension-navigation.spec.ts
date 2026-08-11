import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-extension-navigation-folder"
const EXTENSION_ID = "navigation-tools"

test.describe.configure({ timeout: 60_000 })

const manifest = JSON.stringify({
  schemaVersion: 1,
  apiVersion: 1,
  id: EXTENSION_ID,
  name: "Navigation tools",
  version: "0.1.0",
  entry: "main.js",
  permissions: ["commands", "navigation:read", "navigation:write", "notes:write"],
})

const source = `export default async function activate(api) {
  const active = await api.navigation.getActiveNote()
  await api.commands.register({
    id: "active",
    label: "Active "+(active ? active.path : "none"),
  }, async () => {})

  await api.commands.register({ id: "open-beta", label: "Open beta at done" }, async () => {
    const result = await api.navigation.openNote("beta", { anchor: "done" })
    await api.commands.register({
      id: "opened-result",
      label: "Navigation "+result.status+" "+result.path+" "+(result.anchorStatus || ""),
    }, async () => {})
  })

  await api.commands.register({ id: "open-missing", label: "Open missing note" }, async () => {
    const result = await api.navigation.openNote("missing")
    await api.commands.register({
      id: "missing-result",
      label: "Navigation "+result.status+" "+result.path,
    }, async () => {})
  })

  await api.commands.register({ id: "create-then-open", label: "Create then open" }, async () => {
    const created = await api.notes.create("created")
    const result = await api.navigation.openNote("created")
    await api.commands.register({
      id: "created-result",
      label: "Navigation "+created.status+" then "+result.status+" "+result.path,
    }, async () => {})
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

const paletteRows = (page: Page) => page.locator(".palette-row")

async function runCommand(page: Page, query: string) {
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill(query)
  await expect(paletteRows(page).first()).toBeVisible()
  await paletteRows(page).first().click()
}

async function seedVault(page: Page) {
  await writeFile(page, "alpha.md", "# Alpha\n\nalpha body")
  await writeFile(page, "beta.md", "# Beta\n\n## Done\n\nbeta body")
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
      extensions: [EXTENSION_ID],
    }),
  )
  await writeFile(page, `.brulion/scripts/${EXTENSION_ID}/manifest.json`, manifest)
  await writeFile(page, `.brulion/scripts/${EXTENSION_ID}/main.js`, source)
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedVault(page)
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(2)
  await expect(page.locator(".cm-content")).toContainText("Alpha")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Active alpha.md")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
})

test("reads the active note, opens a heading, and returns a missing result without creating", async ({ page }) => {
  await runCommand(page, "Open beta at done")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Navigation opened beta.md found")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-content")).toContainText("Done")

  await runCommand(page, "Open missing note")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Navigation missing missing.md")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-content")).toContainText("Done")
  await expect.poll(async () => {
    try {
      await readFile(page, "missing.md")
      return true
    } catch {
      return false
    }
  }).toBe(false)
})

test("opens an explicitly extension-created note without waiting for the sidebar snapshot", async ({ page }) => {
  await runCommand(page, "Create then open")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Navigation created then opened created.md")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-content")).toHaveText("")
  await expect.poll(async () => {
    try {
      return await readFile(page, "created.md")
    } catch {
      return null
    }
  }).toBe("")
})
