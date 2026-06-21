import { test, expect, type Page } from "@playwright/test"

// FEAT-0033: the quick switcher (Ctrl/Cmd+K) — fuzzy-find a note and open it, or
// create one by name. These need real key handling + the real FSA create path
// (an OPFS handle), which happy-dom can't exercise.

const FOLDER = "e2e-switcher-folder"

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

async function noteExists(page: Page, name: string): Promise<boolean> {
  return await page.evaluate(
    async ([folder, file]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      try {
        await dir.getFileHandle(file)
        return true
      } catch {
        return false
      }
    },
    [FOLDER, name] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")
const backdrop = (page: Page) => page.locator("#switcher-backdrop")
const input = (page: Page) => page.locator("#switcher-input")
const rows = (page: Page) => page.locator(".switch-row")
const createRow = (page: Page) => page.locator(".switch-create")

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")
  await writeNote(page, "gamma.md", "gamma body")
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(3)
})

test("Ctrl+K opens the switcher focused, listing the notes (AC-1)", async ({ page }) => {
  await editor(page).click() // focus in the editor — the shortcut must still fire
  await page.keyboard.press("Control+k")

  await expect(backdrop(page)).toBeVisible()
  await expect(input(page)).toBeFocused()
  await expect(rows(page)).toHaveCount(3)
})

test("typing fuzzily filters, and Enter opens the highlighted note (AC-2, AC-3)", async ({
  page,
}) => {
  await page.locator("#sidebar-search").click()
  await input(page).fill("gam")

  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText("gamma")
  await input(page).press("Enter")

  await expect(backdrop(page)).toBeHidden()
  await expect(editor(page)).toHaveText("gamma body")
})

test("clicking a result opens it (AC-4)", async ({ page }) => {
  await page.locator("#sidebar-search").click()
  await input(page).fill("beta")
  await rows(page).first().click()

  await expect(backdrop(page)).toBeHidden()
  await expect(editor(page)).toHaveText("beta body")
})

test("Esc closes without changing the open note (AC-5)", async ({ page }) => {
  // alpha is the active note (first alphabetically) after open.
  await expect(editor(page)).toHaveText("alpha body")
  await page.locator("#sidebar-search").click()
  await input(page).fill("beta")
  await input(page).press("Escape")

  await expect(backdrop(page)).toBeHidden()
  await expect(editor(page)).toHaveText("alpha body") // unchanged
})

test("a no-match query creates and opens a new note (AC-6)", async ({ page }) => {
  await page.locator("#sidebar-search").click()
  await input(page).fill("Diablo builds")

  await expect(rows(page)).toHaveCount(0)
  await expect(createRow(page)).toContainText("Diablo builds")
  await input(page).press("Enter")

  await expect(backdrop(page)).toBeHidden()
  expect(await noteExists(page, "Diablo builds.md")).toBe(true)
  await editor(page).click()
  await page.keyboard.type("Whirlwind barb")
  await expect(editor(page)).toHaveText("Whirlwind barb")
})

test("an invalid create name shows an inline error and creates nothing (AC-7)", async ({
  page,
}) => {
  await page.locator("#sidebar-search").click()
  // A bare `..` segment is rejected by the name validator.
  await input(page).fill("..")
  await input(page).press("Enter")

  await expect(page.locator("#switcher-error")).toBeVisible()
  await expect(backdrop(page)).toBeVisible() // stays open
  expect(await noteExists(page, "...md")).toBe(false)
})

test("the sidebar has no inline new-note textbox (AC-8)", async ({ page }) => {
  await expect(page.locator("#new-note-input")).toHaveCount(0)
  await expect(page.locator("#sidebar-search")).toBeVisible()
})

test("the shortcut opens the switcher with Vim on (AC-9)", async ({ page }) => {
  await page.locator("#toggle-vim").click()
  await expect(page.locator("#toggle-vim")).toHaveAttribute("aria-pressed", "true")
  await editor(page).click() // Vim normal mode, focus in the editor
  await expect(page.locator(".cm-vimMode")).toBeVisible()

  await page.keyboard.press("Control+k")

  await expect(backdrop(page)).toBeVisible()
  await expect(input(page)).toBeFocused()
})
