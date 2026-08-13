import { test, expect, type Page } from "@playwright/test"

// FEAT-0106/AC-5: the fixture mirrors the published selection-feedback example,
// then reaches it through the real OPFS discovery, sandbox iframe, RPC, palette,
// workbench, and API-reference paths.
const FOLDER = "e2e-extension-authoring-kit-folder"
const NOTE = "authoring kit bytes stay unchanged"
const EXTENSION_ID = "selection-feedback"

const manifest = JSON.stringify({
  schemaVersion: 1,
  apiVersion: 1,
  id: EXTENSION_ID,
  name: "Selection feedback",
  version: "0.1.0",
  entry: "main.js",
  permissions: ["commands", "editor:read", "editor:selection", "notifications"],
})

const source = String.raw`export default async function activate(api) {
  await api.commands.register({ id: "selection-feedback", label: "Show selection feedback" }, async () => {
    const selection = await api.editor.getSelection()
    await api.editor.setSelection({ anchor: selection.head, head: selection.anchor })
    await api.notifications.show([
      { type: "strong", text: "Selected" },
      { type: "text", text: ": " + selection.text },
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
  await writeFile(page, ".brulion.json", JSON.stringify({
    font: [], textSize: 16, editorWidth: "narrow", vim: false, actionBar: [],
    journalPath: "", theme: "system", workspace: "", extensions: [EXTENSION_ID],
  }))
  await writeFile(page, `.brulion/scripts/${EXTENSION_ID}/manifest.json`, manifest)
  await writeFile(page, `.brulion/scripts/${EXTENSION_ID}/main.js`, source)
}

async function openWorkbench(page: Page) {
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("Edit extensions")
  const row = page.locator(".palette-row").filter({ hasText: "Edit extensions" })
  await expect(row).toHaveCount(1)
  const popup = page.waitForEvent("popup")
  await row.click()
  const workbench = await popup
  await workbench.waitForLoadState()
  await expect(workbench.locator("#workbench-content")).toBeVisible()
  return workbench
}

test.describe.configure({ timeout: 60_000 })

test("publishes and runs the least-privilege interaction example", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedVault(page)
  await page.locator("#open-folder").click()
  const editor = page.locator(".cm-content")
  await expect(editor).toHaveText(NOTE)
  expect(JSON.parse(await readFile(page, `.brulion/scripts/${EXTENSION_ID}/manifest.json`)).permissions)
    .toEqual(["commands", "editor:read", "editor:selection", "notifications"])

  await editor.click()
  await page.keyboard.press("Control+A")
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("Show selection feedback")
  const command = page.locator(".palette-row").filter({ hasText: "Show selection feedback" })
  await expect(command).toHaveCount(1)
  await command.click()

  const toast = page.locator(".notification-toast").first()
  await expect(toast).toBeVisible()
  await expect(toast).toHaveAttribute("data-level", "success")
  await expect(toast.locator(".notification-message strong")).toHaveText("Selected")
  await expect(toast.locator(".notification-message")).toContainText(NOTE)
  await expect(page.locator(".cm-content")).toHaveText(NOTE)

  const workbench = await openWorkbench(page)
  await workbench.locator("#workbench-kit").click()
  await expect(workbench.locator("#workbench-kit-version")).toHaveText("v1.3.0")
  await expect(workbench.locator("#workbench-kit-list")).toContainText("examples/selection-feedback/manifest.json")
  await expect(workbench.locator("#workbench-kit-list")).toContainText("examples/dialog-lifecycle/main.js")

  const apiPopup = workbench.waitForEvent("popup")
  await workbench.locator("#workbench-api-docs").click()
  const apiDocs = await apiPopup
  await apiDocs.waitForLoadState()
  await expect(apiDocs.locator("#api-docs-reference")).toContainText("notifications.show")
  await expect(apiDocs.locator("#api-docs-reference")).toContainText("dialogs.prompt")
  await expect(apiDocs.locator(".api-docs-static-handoff")).toContainText("api-contract.json")

  const staticResponse = await page.request.get("/brulion/api.md")
  expect(staticResponse.ok()).toBe(true)
  expect(await staticResponse.text()).toContain("## Interaction")
  expect(await staticResponse.text()).toContain("dialog-lifecycle")

  await apiDocs.close()
  await workbench.close()
  expect(await readFile(page, "alpha.md")).toBe(NOTE)
})
