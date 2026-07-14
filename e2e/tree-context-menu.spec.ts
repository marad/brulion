import { test, expect, type Page } from "@playwright/test"

// M35/FEAT-0071: every row action (create/move/delete/rename) lives behind a
// right-click (or, on touch, long-press) context menu — no inline buttons.
const FOLDER = "e2e-tree-context-menu-folder"

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

const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })
const folderHeader = (page: Page, name: string) => page.locator(".folder-header", { hasText: name })
const menu = (page: Page) => page.locator(".cm-context-menu")
const menuItems = (page: Page) => page.locator(".cm-context-menu button[role=menuitem]")

test("right-clicking a note row opens exactly Move…/Delete (AC-1)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await row(page, "alpha").click({ button: "right" })

  await expect(menu(page)).toBeVisible()
  await expect(menuItems(page)).toHaveText(["Rename…", "Move…", "Delete"])
})

test("right-clicking a folder row opens exactly New subfolder…/New note…/Rename…/Move…/Delete (AC-2)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "projects/a.md", "a body")
  await page.locator("#open-folder").click()

  await folderHeader(page, "projects").click({ button: "right" })

  await expect(menu(page)).toBeVisible()
  await expect(menuItems(page)).toHaveText(["New subfolder…", "New note…", "Rename…", "Move…", "Delete"])
})

test("Esc dismisses the menu without acting (AC-4)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await row(page, "alpha").click({ button: "right" })
  await expect(menu(page)).toBeVisible()
  await page.keyboard.press("Escape")

  await expect(menu(page)).toBeHidden()
  await expect(row(page, "alpha")).toBeVisible() // untouched
})

test("clicking outside the menu dismisses it without acting (AC-4)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await row(page, "alpha").click({ button: "right" })
  await expect(menu(page)).toBeVisible()
  await page.locator("#sidebar-search").click()

  await expect(menu(page)).toBeHidden()
  await expect(row(page, "alpha")).toBeVisible()
})

test.describe("touch (long-press)", () => {
  test.use({ hasTouch: true })

  test("a long-press on a note row opens its context menu (AC-5)", async ({ page }) => {
    await stubPicker(page)
    await page.goto("/brulion/")
    await writeNote(page, "alpha.md", "alpha body")
    await page.locator("#open-folder").click()

    const box = (await row(page, "alpha").boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    // happy-dom's own trick (a plain Event with `touches` attached) works
    // identically in a real browser — wireLongPress only ever reads `.touches`.
    await page.evaluate(
      ([elX, elY]) => {
        const el = document.elementFromPoint(elX, elY) as HTMLElement
        const event = new Event("touchstart", { bubbles: true, cancelable: true })
        Object.defineProperty(event, "touches", { value: [{ clientX: elX, clientY: elY }] })
        el.dispatchEvent(event)
      },
      [x, y] as const,
    )
    // Real threshold matches wireLongPress's default (500ms).
    await page.waitForTimeout(600)

    await expect(menu(page)).toBeVisible()
    await expect(menuItems(page)).toHaveText(["Rename…", "Move…", "Delete"])
  })
})
