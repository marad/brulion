import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-folder-crud-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeNote(page: Page, path: string, content: string) {
  await page.evaluate(
    async ([folder, rel, text]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      const segments = rel.split("/")
      for (const seg of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true })
      const handle = await dir.getFileHandle(segments[segments.length - 1], { create: true })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
    [FOLDER, path, content] as const,
  )
}

async function folderExists(page: Page, path: string): Promise<boolean> {
  return await page.evaluate(
    async ([folder, rel]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      try {
        for (const seg of rel.split("/")) dir = await dir.getDirectoryHandle(seg)
        return true
      } catch {
        return false
      }
    },
    [FOLDER, path] as const,
  )
}

async function noteExists(page: Page, path: string): Promise<boolean> {
  return await page.evaluate(
    async ([folder, rel]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      const segments = rel.split("/")
      try {
        for (const seg of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(seg)
        await dir.getFileHandle(segments[segments.length - 1])
        return true
      } catch {
        return false
      }
    },
    [FOLDER, path] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")
const folderHeader = (page: Page, name: string) => page.locator(".folder-header", { hasText: name })

// The confirm/prompt/alert dialog (M35/FEAT-0073) replaces window.confirm/
// prompt/alert — interact with its DOM instead of Playwright's page.on("dialog").
async function submitPrompt(page: Page, value: string) {
  await page.locator("#dialog-input").fill(value)
  await page.locator("#dialog-confirm").click()
}
async function confirmDialog(page: Page) {
  await page.locator("#dialog-confirm").click()
}
async function cancelDialog(page: Page) {
  await page.locator("#dialog-cancel").click()
}
// After a prompt is submitted and refused, the same dialog re-opens as a
// one-button alert (input and Cancel hidden) carrying the failure reason.
async function expectAlert(page: Page) {
  await expect(page.locator("#dialog-cancel")).toBeHidden()
  await expect(page.locator("#dialog-message")).not.toBeEmpty()
}

// Every folder action lives behind the header's context menu now
// (M35/FEAT-0071), not an inline button — right-click it, then pick the item.
async function createSubfolder(page: Page, parentName: string) {
  await folderHeader(page, parentName).click({ button: "right" })
  await page.locator(".cm-context-menu button[role=menuitem]", { hasText: "New subfolder…" }).click()
}
async function deleteFolder(page: Page, name: string) {
  await folderHeader(page, name).click({ button: "right" })
  await page.locator(".cm-context-menu button[role=menuitem]", { hasText: "Delete" }).click()
}

test("creates an empty folder at the root (AC-1)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await page.locator("#sidebar-new-folder").click()
  await submitPrompt(page, "ideas")

  await expect(folderHeader(page, "ideas")).toBeVisible()
  expect(await folderExists(page, "ideas")).toBe(true)
})

test("creates a subfolder inside an existing folder (AC-2)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()
  await folderHeader(page, "projects").click() // collapsed by default — expand it

  await createSubfolder(page, "projects")
  await submitPrompt(page, "ideas")

  const nestedFolder = page.locator(".folder-children .folder-header", { hasText: "ideas" })
  await expect(nestedFolder).toBeVisible()
  expect(await folderExists(page, "projects/ideas")).toBe(true)
})

test("an invalid folder name is refused with a message, nothing created (AC-3)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await page.locator("#sidebar-new-folder").click()
  await submitPrompt(page, "../escape")

  await expectAlert(page)
  await confirmDialog(page)
  await expect(page.locator(".folder-header")).toHaveCount(0)
})

test("a duplicate folder name is refused with a message (AC-4)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/a.md", "a body") // materializes projects/
  await page.locator("#open-folder").click()
  await expect(folderHeader(page, "projects")).toBeVisible()

  await page.locator("#sidebar-new-folder").click()
  await submitPrompt(page, "projects")

  await expectAlert(page)
  await confirmDialog(page)
  await expect(page.locator(".folder-header", { hasText: "projects" })).toHaveCount(1) // no duplicate
})

test("deleting a folder asks for confirmation; declining leaves it untouched (AC-5)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()

  await deleteFolder(page, "projects")
  await cancelDialog(page)

  await expect(folderHeader(page, "projects")).toBeVisible()
  expect(await folderExists(page, "projects")).toBe(true)
  expect(await noteExists(page, "projects/a.md")).toBe(true)
})

test("confirmed deletion removes the folder and every note beneath it (AC-6)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/a.md", "a body")
  await writeNote(page, "projects/ideas/b.md", "b body")
  await page.locator("#open-folder").click()

  await deleteFolder(page, "projects")
  await confirmDialog(page)

  await expect(folderHeader(page, "projects")).toHaveCount(0)
  expect(await folderExists(page, "projects")).toBe(false)
  expect(await noteExists(page, "projects/a.md")).toBe(false)
  expect(await noteExists(page, "projects/ideas/b.md")).toBe(false)
})

test("deleting the active note's folder falls back to another note (AC-7)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "start.md", "start body")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(2)

  await folderHeader(page, "projects").click() // collapsed by default — expand it
  await page.locator(".folder-children .note-row", { hasText: "a" }).locator(".note-name").click()
  await expect(editor(page)).toHaveText("a body")

  await deleteFolder(page, "projects")
  await confirmDialog(page)

  await expect(editor(page)).toHaveText("start body") // fell back to start.md
})

test("leaves the editor in place when the active note is outside the deleted folder (AC-8)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "start.md", "start body")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("start body") // start.md picked active by default

  await deleteFolder(page, "projects")
  await confirmDialog(page)

  await expect(folderHeader(page, "projects")).toHaveCount(0)
  await expect(editor(page)).toHaveText("start body") // unchanged
})
