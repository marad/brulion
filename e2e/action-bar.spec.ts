import { test, expect, type Page } from "@playwright/test"

// FEAT-0058 (M30 P2): the customizable header action bar — pin/unpin + reorder
// actions in settings; they render as header buttons that persist in .brulion.json.
// Needs real key/click handling, the real settings round-trip, and the live registry.

const FOLDER = "e2e-actionbar-folder"

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

// Count only note files (.md) — the action-bar preference lives in .brulion.json,
// which must not count as a note write (the moat: AC-8).
async function noteCount(page: Page): Promise<number> {
  return await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    let n = 0
    // @ts-expect-error async iterator over a directory handle
    for await (const [name] of dir.entries()) if (name.endsWith(".md")) n++
    return n
  }, FOLDER)
}

const barButtons = (page: Page) => page.locator("#action-bar .action-bar-button")
const openSettings = (page: Page) => page.locator("#open-settings").click()
const pinBox = (page: Page, id: string) =>
  page.locator(`[data-action-id="${id}"] input[type="checkbox"]`)
const moveDown = (page: Page, id: string) =>
  page.locator(`[data-action-id="${id}"] [aria-label="Move down"]`)
const closeSettings = (page: Page) => page.locator(".settings-close").click()

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(1)
})

test("by default the action bar is empty (AC-7)", async ({ page }) => {
  await expect(barButtons(page)).toHaveCount(0)
})

test("pinning an action adds a header button that runs it (AC-2, AC-4)", async ({ page }) => {
  await openSettings(page)
  await pinBox(page, "goto").check()

  // The bar updates live (behind the modal) — assert the DOM, then close and click.
  await expect(barButtons(page)).toHaveCount(1)
  await expect(barButtons(page)).toContainText("Go to note")
  await closeSettings(page)

  await barButtons(page).click()
  await expect(page.locator("#switcher-backdrop")).toBeVisible()
})

test("unpinning removes the button (AC-4)", async ({ page }) => {
  await openSettings(page)
  await pinBox(page, "goto").check()
  await expect(barButtons(page)).toHaveCount(1)
  await pinBox(page, "goto").uncheck()
  await expect(barButtons(page)).toHaveCount(0)
})

test("reordering pinned actions reorders the bar (AC-5)", async ({ page }) => {
  await openSettings(page)
  await pinBox(page, "goto").check()
  await pinBox(page, "toggle-vim").check()
  await expect(barButtons(page)).toHaveCount(2)
  // Pinned order is goto, toggle-vim; move goto down so vim leads.
  await moveDown(page, "goto").click()

  await expect(barButtons(page).nth(0)).toContainText("Toggle Vim mode")
  await expect(barButtons(page).nth(1)).toContainText("Go to note")
})

test("the pinned bar persists across a reload (AC-6)", async ({ page }) => {
  await openSettings(page)
  await pinBox(page, "switch-folder").check()
  await expect(barButtons(page)).toHaveCount(1)
  await closeSettings(page)

  await page.reload()
  await expect(page.locator(".note-row")).toHaveCount(1) // folder auto-restored
  await expect(barButtons(page)).toHaveCount(1)
  await expect(barButtons(page)).toContainText("Switch folder")
})

test("pinning, unpinning and reordering write no note files (AC-8)", async ({ page }) => {
  const before = await noteCount(page)
  await openSettings(page)
  await pinBox(page, "goto").check()
  await pinBox(page, "toggle-vim").check()
  await moveDown(page, "goto").click()
  await pinBox(page, "toggle-vim").uncheck()

  expect(await noteCount(page)).toBe(before) // only .brulion.json changed, no note
})
