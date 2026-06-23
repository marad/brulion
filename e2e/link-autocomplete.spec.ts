import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-link-autocomplete-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function readNote(page: Page, name: string): Promise<string | null> {
  return await page.evaluate(
    async ({ folder, file }) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      try {
        const handle = await dir.getFileHandle(file)
        return await (await handle.getFile()).text()
      } catch {
        return null
      }
    },
    { folder: FOLDER, file: name },
  )
}

const editor = (page: Page) => page.locator(".cm-content")
const menu = (page: Page) => page.locator(".cm-tooltip-autocomplete")
const options = (page: Page) => page.locator(".cm-tooltip-autocomplete li")
const link = (page: Page, text: string) => page.locator(".cm-link", { hasText: text })

async function createNote(page: Page, name: string) {
  await page.locator("#sidebar-search").click()
  await page.locator("#switcher-input").fill(name)
  await page.locator("#switcher-input").press("Enter")
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
})

test("typing `[[` opens a list of existing notes (AC-1)", async ({ page }) => {
  await createNote(page, "alpha")
  await createNote(page, "beta")
  await createNote(page, "home")

  await editor(page).click()
  await page.keyboard.type("[[")
  await expect(menu(page)).toBeVisible()
  // existing notes are offered (alpha, beta, home, and the seed start)
  await expect(options(page)).toContainText(["alpha", "beta", "home"])
})

test("filtering narrows the list as you type (AC-2)", async ({ page }) => {
  await createNote(page, "alpha")
  await createNote(page, "beta")
  await createNote(page, "home")

  await editor(page).click()
  await page.keyboard.type("[[al")
  await expect(menu(page)).toBeVisible()
  await expect(options(page).filter({ hasText: "alpha" })).toBeVisible()
  await expect(options(page).filter({ hasText: "beta" })).toHaveCount(0)
})

test("accepting a suggestion inserts `[[path]]` resolving to the note (AC-3)", async ({
  page,
}) => {
  await createNote(page, "alpha")
  await createNote(page, "home")

  await editor(page).click()
  await page.keyboard.type("see [[al")
  await expect(menu(page)).toBeVisible()
  // click the entry (deterministic accept, like the slash suite)
  await options(page).filter({ hasText: "alpha" }).click()
  await expect(menu(page)).toBeHidden()

  // the buffer now holds a closed wikilink that renders as a non-broken link
  await expect(link(page, "alpha")).toBeVisible()
  await expect(link(page, "alpha")).not.toHaveClass(/cm-link-broken/)

  // and the bytes on disk are the well-formed `[[alpha]]`
  await page.keyboard.press("Control+s")
  await expect.poll(() => readNote(page, "home.md")).toBe("see [[alpha]]")
})

test("a nested note inserts its full path (AC-6)", async ({ page }) => {
  await createNote(page, "projects/diablo")
  await createNote(page, "home")

  await editor(page).click()
  await page.keyboard.type("[[dia")
  await expect(menu(page)).toBeVisible()
  await options(page).filter({ hasText: "projects/diablo" }).click()
  await expect(menu(page)).toBeHidden()

  await page.keyboard.press("Control+s")
  await expect.poll(() => readNote(page, "home.md")).toBe("[[projects/diablo]]")
})
