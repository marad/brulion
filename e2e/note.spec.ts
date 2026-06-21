import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-note-folder"

// showDirectoryPicker returns a real OPFS directory — a genuine
// FileSystemDirectoryHandle the app reads/writes start.md against.
async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeStartMd(page: Page, text: string) {
  await page.evaluate(
    async ([folder, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const handle = await dir.getFileHandle("start.md", { create: true })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    },
    [FOLDER, text] as const,
  )
}

async function readStartMd(page: Page): Promise<string | null> {
  return await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    try {
      const handle = await dir.getFileHandle("start.md")
      return await (await handle.getFile()).text()
    } catch {
      return null
    }
  }, FOLDER)
}

// Scope to #editor: while a conflict diff is open, its two read-only panes are
// also `.cm-content`, so the bare class would match more than the editor.
const editor = (page: Page) => page.locator("#editor .cm-content")

async function typeInEditor(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.type(text)
}

test("loads an existing start.md into the editor (AC-1)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeStartMd(page, "hello from disk")

  await page.locator("#open-folder").click()

  await expect(editor(page)).toHaveText("hello from disk")
})

test("creates start.md on first edit, not on open (AC-2, AC-3)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")

  await page.locator("#open-folder").click()
  expect(await readStartMd(page)).toBeNull() // nothing written just by opening

  await typeInEditor(page, "captured text")

  await expect.poll(() => readStartMd(page)).toBe("captured text") // autosave wrote it
})

test("Ctrl+S flushes immediately (AC-4)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()

  await typeInEditor(page, "save me now")
  await page.keyboard.press("Control+s")

  await expect.poll(() => readStartMd(page)).toBe("save me now")
})

test("a save does not overwrite an externally changed start.md (AC-5)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeStartMd(page, "original")
  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("original")

  // Another writer changes the file after we loaded it.
  await page.waitForTimeout(20)
  await writeStartMd(page, "changed by someone else")

  await typeInEditor(page, " — my edit")
  await page.keyboard.press("Control+s")

  // M4 surfaces the refused save as the conflict banner (was the #status line).
  await expect(page.locator("#conflict")).toBeVisible()
  expect(await readStartMd(page)).toBe("changed by someone else") // not clobbered
  await expect(editor(page)).toContainText("my edit") // user's buffer preserved
})

test("saved content survives a reload (AC-6)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await typeInEditor(page, "persisted across reloads")
  await expect.poll(() => readStartMd(page)).toBe("persisted across reloads")

  await page.reload()
  // The folder auto-restores on reload (the remembered handle is still granted),
  // so the note reloads with no re-pick — the welcome screen never reappears.
  await expect(page.locator("#welcome")).toBeHidden()
  await expect(editor(page)).toHaveText("persisted across reloads")
})
