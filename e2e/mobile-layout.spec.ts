import { test, expect, type Page } from "@playwright/test"

// M17 P1 (FEAT-0051): on a narrow viewport the sidebar becomes a slide-over drawer
// over a full-width editor, dismissable by a backdrop tap and on note-select; the
// resize handle is hidden. Desktop layout is unchanged.

const FOLDER = "e2e-mobile-layout"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function seedNotes(page: Page) {
  await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    for (const name of ["alpha.md", "beta.md"]) {
      const h = await dir.getFileHandle(name, { create: true })
      const w = await h.createWritable()
      await w.write(`body of ${name}`)
      await w.close()
    }
  }, FOLDER)
}

const sidebar = (page: Page) => page.locator("#sidebar")
const backdrop = (page: Page) => page.locator("#sidebar-backdrop")
const resizer = (page: Page) => page.locator("#sidebar-resizer")
const toggle = (page: Page) => page.locator("#toggle-sidebar")
const box = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())!

async function setup(page: Page) {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNotes(page) // OPFS needs the loaded page — seed after goto, before opening
  await page.locator("#open-folder").click()
  // Wait for the workspace (the gear is revealed with it) — not the note list, which
  // is hidden when the narrow drawer starts closed.
  await expect(page.locator("#open-settings")).toBeVisible()
}

const bgColor = (page: Page, sel: string) =>
  page.locator(sel).evaluate((el) => getComputedStyle(el).backgroundColor)

test.describe("narrow viewport (drawer)", () => {
  test.use({ viewport: { width: 375, height: 700 } })

  test("the drawer starts closed and overlays the editor when opened (AC-1)", async ({ page }) => {
    await setup(page)

    // Starts closed: editor full-width, no drawer, no backdrop.
    await expect(sidebar(page)).not.toBeVisible()
    await expect(backdrop(page)).not.toBeVisible()
    expect((await box(page, "#editor")).width).toBeGreaterThan(360) // ~viewport width

    // Open it: the drawer overlays the editor's left edge (doesn't take layout width).
    await toggle(page).click()
    const ed = await box(page, "#editor")
    const sb = await box(page, "#sidebar")
    expect(ed.x).toBeLessThan(2) // editor still starts at the left edge
    expect(ed.width).toBeGreaterThan(360) // still ~full width — drawer overlays
    expect(sb.x).toBeLessThan(2) // drawer over the same left edge
    expect(sb.width).toBeLessThan(330) // a drawer, not the whole screen
    await expect(backdrop(page)).toBeVisible()
  })

  test("the resize handle is hidden (AC-5)", async ({ page }) => {
    await setup(page)
    await expect(resizer(page)).not.toBeVisible()
  })

  test("the toggle opens and closes the drawer, with no pressed-state highlight (AC-2)", async ({
    page,
  }) => {
    await setup(page)

    const closedBg = await bgColor(page, "#toggle-sidebar")
    await toggle(page).click()
    await expect(sidebar(page)).toBeVisible() // opened
    await page.mouse.move(200, 450) // move off the toggle so :hover doesn't skew the bg
    expect(await bgColor(page, "#toggle-sidebar")).toBe(closedBg) // no pressed-state highlight
    await toggle(page).click()
    await expect(sidebar(page)).not.toBeVisible() // closed again
  })

  test("tapping the backdrop closes the drawer (AC-3)", async ({ page }) => {
    await setup(page)

    await toggle(page).click() // open the drawer
    await expect(backdrop(page)).toBeVisible()
    await backdrop(page).click({ position: { x: 350, y: 350 } }) // tap outside the drawer
    await expect(sidebar(page)).not.toBeVisible()
    await expect(backdrop(page)).not.toBeVisible()
  })

  test("selecting a note closes the drawer (AC-4)", async ({ page }) => {
    await setup(page)

    await toggle(page).click() // open the drawer to reach the note list
    await page.locator(".note-name", { hasText: "beta" }).click()
    await expect(page.locator("#note-identity")).toContainText("beta")
    await expect(sidebar(page)).not.toBeVisible() // drawer dismissed after navigating
  })

  test("the narrow drawer state isn't persisted — a reload starts closed (AC-7)", async ({
    page,
  }) => {
    await setup(page)

    await toggle(page).click()
    await expect(sidebar(page)).toBeVisible() // opened
    await page.reload()
    await expect(page.locator("#open-settings")).toBeVisible() // workspace restored
    await expect(sidebar(page)).not.toBeVisible() // narrow always starts closed
  })

  test("the toggle sits at the left edge, before the other controls (AC-8)", async ({ page }) => {
    await setup(page)
    const tog = await box(page, "#toggle-sidebar")
    const gear = await box(page, "#open-settings")
    expect(tog.x).toBeLessThan(gear.x) // ☰ is left of the gear
  })
})

test.describe("desktop viewport (unchanged)", () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test("the sidebar sits inline and there is no backdrop or close-on-select (AC-6)", async ({
    page,
  }) => {
    await setup(page)

    // Inline: the editor starts to the right of the sidebar (sidebar takes width).
    const sb = await box(page, "#sidebar")
    const ed = await box(page, "#editor")
    expect(ed.x).toBeGreaterThan(sb.width - 2)
    await expect(backdrop(page)).not.toBeVisible()
    await expect(resizer(page)).toBeVisible()

    // Selecting a note leaves the sidebar open on desktop.
    await page.locator(".note-name", { hasText: "beta" }).click()
    await expect(page.locator("#note-identity")).toContainText("beta")
    await expect(sidebar(page)).toBeVisible()
  })
})
