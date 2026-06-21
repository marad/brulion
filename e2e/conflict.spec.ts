import { test, expect, type Page } from "@playwright/test"

async function stubPicker(page: Page, folder: string) {
  await page.addInitScript((f) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(f, { create: true })
    }
  }, folder)
}

// Write a note from outside the app's UI — another tool touching the folder.
async function writeNote(page: Page, folder: string, name: string, text: string) {
  await page.evaluate(
    async ([f, file, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    },
    [folder, name, text] as const,
  )
}

async function readFile(page: Page, folder: string, name: string) {
  return await page.evaluate(
    async ([f, file]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f)
      const handle = await dir.getFileHandle(file)
      return await (await handle.getFile()).text()
    },
    [folder, name] as const,
  )
}

// Scope to #editor: while the conflict diff is open, its two panes are also
// `.cm-content`, so the bare class would match three elements.
const editor = (page: Page) => page.locator("#editor .cm-content")
const conflict = (page: Page) => page.locator("#conflict")
const diff = (page: Page) => page.locator("#conflict-diff .conflict-diff")

test("keep my version writes the buffer over the external change", async ({ page }) => {
  const folder = "e2e-conflict-keep"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "log.md", "original")

  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("original")

  await editor(page).click()
  await page.keyboard.type(" mine") // unsaved local edit
  // Another tool changes the same file before the autosave settles — the
  // stale-write guard refuses to clobber and surfaces the conflict.
  await writeNote(page, folder, "log.md", "theirs from outside")

  await expect(conflict(page)).toBeVisible()

  await page.locator("#conflict-keep").click()
  await expect(conflict(page)).toBeHidden()

  expect(await readFile(page, folder, "log.md")).toBe("original mine")
})

test("the conflict is modal: the editor is locked until resolved", async ({ page }) => {
  const folder = "e2e-conflict-modal"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "log.md", "original")

  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("original")

  await editor(page).click()
  await page.keyboard.type(" mine")
  await writeNote(page, folder, "log.md", "theirs from outside")
  await expect(conflict(page)).toBeVisible()

  // The editor is read-only while the conflict stands: keystrokes do nothing.
  await page.keyboard.type("XYZ")
  await expect(editor(page)).not.toContainText("XYZ")
  await expect(conflict(page)).toBeVisible() // still modal

  // Resolving unlocks editing again.
  await page.locator("#conflict-keep").click()
  await expect(conflict(page)).toBeHidden()
  await editor(page).click()
  await page.keyboard.type(" again")
  await expect(editor(page)).toContainText("again")
})

test("the conflict shows a diff of both versions, cleared on resolve (FEAT-0022)", async ({
  page,
}) => {
  const folder = "e2e-conflict-diff"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "log.md", "original")

  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("original")

  await editor(page).click()
  await page.keyboard.type(" mine")
  await writeNote(page, folder, "log.md", "theirs from outside")

  await expect(conflict(page)).toBeVisible()

  // The diff is shown: two labelled panes with each side's content.
  await expect(diff(page)).toBeVisible()
  await expect(page.locator(".conflict-diff-labels")).toContainText("Your version")
  await expect(page.locator(".conflict-diff-labels")).toContainText("On disk")
  const panes = page.locator(".conflict-diff .cm-content")
  await expect(panes.first()).toContainText("original mine") // your version
  await expect(panes.last()).toContainText("theirs from outside") // on disk

  // Resolving clears the diff along with the modal.
  await page.locator("#conflict-disk").click()
  await expect(conflict(page)).toBeHidden()
  await expect(diff(page)).toHaveCount(0)
  await expect(editor(page)).toHaveText("theirs from outside")
})

test("use the version on disk discards local edits", async ({ page }) => {
  const folder = "e2e-conflict-disk"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "log.md", "original")

  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("original")

  await editor(page).click()
  await page.keyboard.type(" mine")
  await writeNote(page, folder, "log.md", "theirs from outside")

  await expect(conflict(page)).toBeVisible()

  await page.locator("#conflict-disk").click()
  await expect(conflict(page)).toBeHidden()
  await expect(editor(page)).toHaveText("theirs from outside")
})
