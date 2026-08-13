import { test, expect, type Page } from "@playwright/test"

// FEAT-0104/AC-7: this fixture deliberately uses a real OPFS directory and the
// production extension iframe/RPC path. No host callbacks or application imports
// are used to arrange the notification.
const FOLDER = "e2e-extension-interactions-folder"
const NOTE = "unchanged note bytes"

const manifest = JSON.stringify({
  schemaVersion: 1,
  apiVersion: 1,
  id: "daily-tools",
  name: "Daily <tools>",
  version: "0.1.0",
  entry: "main.js",
  permissions: ["commands", "notifications"],
})

const source = `export default async function activate(api) {
  await api.commands.register({ id: "notify", label: "Show formatted notification" }, async () => {
    await api.notifications.show([
      { type: "text", text: "plain\nline" },
      { type: "strong", text: "strong" },
      { type: "code", text: "code" },
    ], { level: "success" })
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
  await writeFile(page, "alpha.md", NOTE)
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

test.describe.configure({ timeout: 60_000 })

test("AC-7 crosses the real extension RPC path without changing the note", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedVault(page)
  await page.locator("#open-folder").click()
  const editor = page.locator(".cm-content")
  await expect(editor).toHaveText(NOTE)

  // The command is user-visible and is invoked from the real command palette.
  await editor.click()
  await page.keyboard.press("Control+Shift+K")
  await expect.poll(async () => {
    await page.locator("#palette-input").fill("show formatted notification")
    return page.locator(".palette-row").count()
  }).toBe(1)
  await page.locator(".palette-row").first().click()

  const toast = page.locator(".notification-toast").first()
  await expect(toast).toBeVisible()
  await expect(toast).toHaveAttribute("data-level", "success")
  const message = toast.locator(".notification-message")
  await expect(message.locator("strong")).toHaveText("strong")
  await expect(message.locator("code")).toHaveText("code")
  await expect(message.locator("br")).toHaveCount(1)
  await expect(message).toContainText("plain")
  await expect(message).toContainText("line")
  await expect(toast.locator(".notification-source")).toHaveText("daily-tools")
  await expect(toast.locator("script")).toHaveCount(0)
  await expect(toast.locator(".notification-close")).toHaveAttribute("aria-label", "Dismiss notification")
  await expect.poll(() => page.evaluate(() => document.activeElement?.className)).toContain("cm-content")

  expect(await readFile(page, "alpha.md")).toBe(NOTE)
  await toast.locator(".notification-close").click()
  await expect(toast).toBeHidden()
})
