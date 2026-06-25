import { test, expect, type Page } from "@playwright/test"

// FEAT-0057 (M30 P1): the command palette (Ctrl/Cmd+Shift+K) — fuzzy-find an action
// and run it. Needs real key handling, the real Lucide icon render, and the live
// action registry, which happy-dom can't exercise.

const FOLDER = "e2e-palette-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeNote(page: Page, name: string, text: string) {
  await page.evaluate(
    async ([folder, file, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    },
    [FOLDER, name, text] as const,
  )
}

async function fileCount(page: Page): Promise<number> {
  return await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    let n = 0
    // @ts-expect-error async iterator over a directory handle
    for await (const _ of dir.values()) n++
    return n
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")
const backdrop = (page: Page) => page.locator("#palette-backdrop")
const input = (page: Page) => page.locator("#palette-input")
const rows = (page: Page) => page.locator(".palette-row")
const open = (page: Page) => page.keyboard.press("Control+Shift+K")

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(2)
})

test("Ctrl+Shift+K opens the palette focused, listing the actions (AC-1)", async ({ page }) => {
  await editor(page).click() // focus in the editor — the shortcut must still fire
  await open(page)

  await expect(backdrop(page)).toBeVisible()
  await expect(input(page)).toBeFocused()
  // Eight registered actions: go to note, switch folder, vim, note list, settings, switch workspace, open palette, this week's journal.
  await expect(rows(page)).toHaveCount(8)
})

test("each row renders its Lucide icon beside the label (AC-7)", async ({ page }) => {
  await open(page)
  await expect(rows(page)).toHaveCount(8)
  // Every action in the initial registry carries an icon → an <svg> per row.
  await expect(rows(page).locator("svg")).toHaveCount(8)
  await expect(rows(page).first()).toContainText("Go to note")
})

test("typing fuzzily filters the actions by label (AC-2)", async ({ page }) => {
  await open(page)
  await input(page).fill("vim")

  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText("Toggle Vim mode")
})

test("Arrow keys + Enter run the highlighted action (AC-3, AC-6: Vim toggle)", async ({ page }) => {
  await editor(page).click()
  await open(page)
  // Registry order: goto(0), switch-folder(1), vim(2), note-list(3), settings(4).
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")

  await expect(backdrop(page)).toBeHidden()
  await expect(page.locator(".cm-vimMode")).toBeVisible() // Vim toggled on from the palette
})

test("clicking the 'Toggle note list' action runs it (AC-4)", async ({ page }) => {
  await expect(page.locator(".workspace")).not.toHaveClass(/sidebar-collapsed/)
  await open(page)
  await input(page).fill("note list")
  await rows(page).first().click()

  await expect(backdrop(page)).toBeHidden()
  await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/)
})

test("running 'Go to note…' opens the quick switcher (AC-6: folder/note actions wired)", async ({
  page,
}) => {
  await open(page)
  await input(page).fill("go to note")
  await rows(page).first().click()

  await expect(backdrop(page)).toBeHidden()
  await expect(page.locator("#switcher-backdrop")).toBeVisible()
})

test("Esc closes the palette without running anything (AC-5)", async ({ page }) => {
  await expect(editor(page)).toHaveText("alpha body")
  await editor(page).click() // focus the editor so close() should restore to it
  await open(page)
  await input(page).fill("vim")
  await page.keyboard.press("Escape")

  await expect(backdrop(page)).toBeHidden()
  await expect(page.locator(".cm-vimMode")).toHaveCount(0) // nothing ran
  await expect(editor(page)).toBeFocused() // focus restored to the editor (AC-5)
})

test("the palette does not open before a folder is open (AC-9)", async ({ page }) => {
  // beforeEach opened (and persisted) a folder; forget the handle so the reload
  // lands on the welcome screen — the genuine no-folder state. idb-keyval's default
  // db/store is "keyval-store"/"keyval".
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("keyval-store")
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction("keyval", "readwrite")
          tx.objectStore("keyval").clear()
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
        req.onerror = () => reject(req.error)
      }),
  )
  await page.goto("/brulion/")
  await expect(page.locator("#welcome")).toBeVisible()

  await open(page)

  await expect(backdrop(page)).toBeHidden() // gated on workspaceShown
})

test("the palette opens under Vim and does not stack over the switcher (AC-8, AC-9)", async ({
  page,
}) => {
  // AC-8: opens with Vim on.
  await page.keyboard.press("Control+;")
  await expect(page.locator(".cm-vimMode")).toBeVisible()
  await editor(page).click() // Vim normal mode, focus in the editor
  await open(page)
  await expect(backdrop(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(backdrop(page)).toBeHidden()

  // AC-9: with the switcher open, the palette shortcut must not stack a second modal.
  await page.keyboard.press("Control+k")
  await expect(page.locator("#switcher-backdrop")).toBeVisible()
  await open(page)
  await expect(backdrop(page)).toBeHidden() // palette suppressed…
  await expect(page.locator("#switcher-backdrop")).toBeVisible() // …and the switcher is untouched
})

test("with the palette open, Ctrl+K does not stack the switcher over it (AC-9)", async ({
  page,
}) => {
  await open(page)
  await expect(backdrop(page)).toBeVisible()

  await page.keyboard.press("Control+k")

  await expect(page.locator("#switcher-backdrop")).toBeHidden() // switcher suppressed…
  await expect(backdrop(page)).toBeVisible() // …palette stays the only modal
})

test("opening, filtering, and closing the palette writes nothing (AC-10)", async ({ page }) => {
  const before = await fileCount(page)
  await open(page)
  await input(page).fill("toggle")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Escape")

  await expect(backdrop(page)).toBeHidden()
  expect(await fileCount(page)).toBe(before)
})
