import { test, expect, type Page } from "@playwright/test"

// FEAT-0009, reduced in M17 P3 (FEAT-0053): the right-click menu is now the
// wikilink-form toggle only — formatting moved to the selection toolbar. So the menu
// opens only on a togglable wikilink; plain-text right-click leaves the native menu.

const FOLDER = "e2e-context-menu-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

// Seed a nested target note and a start note linking to it by full path, so the
// wikilink has a form toggle (its basename `target` is unique → "Use name only").
async function seed(page: Page) {
  await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    const sub = await dir.getDirectoryHandle("sub", { create: true })
    const t = await sub.getFileHandle("target.md", { create: true })
    let w = await t.createWritable()
    await w.write("target body")
    await w.close()
    const s = await dir.getFileHandle("start.md", { create: true })
    w = await s.createWritable()
    await w.write("see [[sub/target]] here\n")
    await w.close()
  }, FOLDER)
}

async function readStartMd(page: Page): Promise<string | null> {
  return await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    try {
      return await (await (await dir.getFileHandle("start.md")).getFile()).text()
    } catch {
      return null
    }
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")
const cmenu = (page: Page) => page.locator(".cm-context-menu")
const wikilink = (page: Page) => page.locator("[data-note]").first()

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seed(page)
  await page.locator("#open-folder").click()
  await expect(wikilink(page)).toBeVisible() // start.md (with the link) is open
})

test("right-clicking a togglable wikilink opens a one-item toggle menu (FEAT-0009 AC-1)", async ({
  page,
}) => {
  await wikilink(page).click({ button: "right" })
  await expect(cmenu(page)).toBeVisible()
  // Exactly one item — the form toggle — and no formatting items (FEAT-0053 AC-3/AC-5).
  await expect(cmenu(page).locator("button")).toHaveCount(1)
  await expect(cmenu(page).locator("button")).toHaveText("Use name only")

  await cmenu(page).locator("button").click()
  await page.keyboard.press("Control+s")
  await expect.poll(() => readStartMd(page)).toBe("see [[target]] here\n") // switched to name-only
})

test("right-clicking plain text opens no custom menu (FEAT-0053 AC-4)", async ({ page }) => {
  // Right-click in the prose, away from the link.
  await editor(page).click({ button: "right", position: { x: 4, y: 4 } })
  // No custom menu — the browser's native menu is left to appear.
  await expect(cmenu(page)).toHaveCount(0)
})

test("the toggle menu dismisses on Esc without changing the document (FEAT-0009 AC-4)", async ({
  page,
}) => {
  const before = await readStartMd(page)
  await wikilink(page).click({ button: "right" })
  await expect(cmenu(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(cmenu(page)).toHaveCount(0)
  expect(await readStartMd(page)).toBe(before)
})
