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
  // 3 notes seeded; alpha is the open note and is excluded (FEAT-0039), so 2 rows.
  await expect(rows(page)).toHaveCount(2)
})

test("with many notes the rows keep full height and the list scrolls (layout regression)", async ({
  page,
}) => {
  // Seed enough notes to overflow the switcher's max-height. Regression guard: the
  // rows used to shrink with the item count (flex-shrink) instead of the list
  // scrolling, leaving an unusable squished list.
  for (let i = 0; i < 30; i++) await writeNote(page, `bulk-note-${i}.md`, "x")
  await page.reload()
  await page.locator(".note-row").first().waitFor()

  await page.locator("#sidebar-search").click()
  const rowHeight = await rows(page)
    .first()
    .evaluate((el) => el.getBoundingClientRect().height)
  expect(rowHeight).toBeGreaterThan(24) // not squished
  const listScrolls = await page
    .locator("#switcher-list")
    .evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  expect(listScrolls).toBe(true) // overflow scrolls rather than shrinking rows
})

test("a wide note tree keeps the sidebar at its fixed width (layout regression)", async ({
  page,
}) => {
  // A long unbroken name used to balloon the sidebar (min-width: auto floors it at
  // the content's min-content) and squeeze the editor. It must stay pinned (~14rem)
  // and ellipsize instead.
  await writeNote(page, "an-extremely-long-note-name-that-would-otherwise-stretch-the-sidebar.md", "x")
  await page.reload()
  await page.locator(".note-row").first().waitFor()

  const width = await page.locator("#sidebar").evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBeLessThan(260) // 14rem (~224px) + border, not ballooned
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

test("an empty switcher lists recent notes first, excluding the open one (FEAT-0039)", async ({
  page,
}) => {
  // alpha is active on open. Visit beta then gamma via the sidebar, so the MRU
  // order becomes gamma, beta, alpha. gamma is now open → excluded from the list,
  // so the empty switcher shows the *previous* note (beta) first, then alpha.
  await page.locator(".note-row", { hasText: "beta" }).click()
  await expect(editor(page)).toHaveText("beta body")
  await page.locator(".note-row", { hasText: "gamma" }).click()
  await expect(editor(page)).toHaveText("gamma body")

  await page.locator("#sidebar-search").click()
  await expect(rows(page)).toHaveCount(2) // gamma (open) excluded
  await expect(rows(page).nth(0)).toContainText("beta") // previous note → Enter toggles back
  await expect(rows(page).nth(1)).toContainText("alpha")
})

test("the most-recently-visited order survives a reload (FEAT-0039)", async ({ page }) => {
  // Visit beta, then gamma; gamma is open. After reload gamma is restored as the
  // open note (excluded), so the most-recent *switchable* note, beta, is first.
  await page.locator(".note-row", { hasText: "beta" }).click()
  await expect(editor(page)).toHaveText("beta body")
  await page.locator(".note-row", { hasText: "gamma" }).click()
  await expect(editor(page)).toHaveText("gamma body")
  await page.reload()
  await expect(page.locator(".note-row")).toHaveCount(3)

  await page.locator("#sidebar-search").click()
  await expect(rows(page).first()).toContainText("beta") // most-recent switchable, after reload
})

test("the shortcut opens the switcher with Vim on (AC-9)", async ({ page }) => {
  await page.keyboard.press("Control+;") // enable Vim (header button removed in M16 P2)
  await expect(page.locator(".cm-vimMode")).toBeVisible()
  await editor(page).click() // Vim normal mode, focus in the editor

  await page.keyboard.press("Control+k")

  await expect(backdrop(page)).toBeVisible()
  await expect(input(page)).toBeFocused()
})
