import { test, expect, type Page } from "@playwright/test"

// M18 (FEAT-0065): the light/dark/system theme. Each test uses its own OPFS folder.
// Verifies that choosing a theme flips the live palette + persists, and that
// theming never touches note bytes (the file-fidelity moat).

async function stubPicker(page: Page, folder: string) {
  await page.addInitScript((f) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(f, { create: true })
    }
  }, folder)
}

async function seedNote(page: Page, folder: string, name: string, body: string) {
  await page.evaluate(
    async ({ f, n, b }) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const h = await dir.getFileHandle(n, { create: true })
      const w = await h.createWritable()
      await w.write(b)
      await w.close()
    },
    { f: folder, n: name, b: body },
  )
}

async function readFile(page: Page, folder: string, name: string): Promise<string> {
  return await page.evaluate(
    async ({ f, n }) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle(n)
      return await (await handle.getFile()).text()
    },
    { f: folder, n: name },
  )
}

async function readSettings(page: Page, folder: string): Promise<Record<string, unknown>> {
  return await page.evaluate(async (f) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(f, { create: true })
    const handle = await dir.getFileHandle(".brulion.json")
    return JSON.parse(await (await handle.getFile()).text())
  }, folder)
}

const rootBg = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

async function openFolder(page: Page, folder: string) {
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()
}

test("choosing Dark applies the dark palette live and persists (AC-2, AC-5)", async ({ page }) => {
  const folder = "e2e-theme-dark"
  await openFolder(page, folder)
  const lightBg = await rootBg(page)

  await page.locator("#open-settings").click()
  await page.locator('input[name="settings-theme"][value="dark"]').check()

  // AC-2: the root carries data-theme="dark" and the page background goes dark.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  const darkBg = await rootBg(page)
  expect(darkBg).not.toBe(lightBg)
  // A genuinely dark background: each RGB channel is low.
  const [r, g, b] = darkBg.match(/\d+/g)!.map(Number)
  expect(Math.max(r, g, b)).toBeLessThan(80)

  // AC-5: the choice persists to .brulion.json.
  await expect.poll(async () => (await readSettings(page, folder)).theme).toBe("dark")
})

test("Light forces the light palette and System clears the attribute (AC-3, AC-4)", async ({
  page,
}) => {
  await openFolder(page, "e2e-theme-light-system")
  await page.locator("#open-settings").click()

  await page.locator('input[name="settings-theme"][value="light"]').check()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")

  await page.locator('input[name="settings-theme"][value="system"]').check()
  // System mode sets no attribute — the prefers-color-scheme query decides.
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/)
})

test("switching theme writes no note bytes (AC-7)", async ({ page }) => {
  const folder = "e2e-theme-moat"
  const body = "# Title\n\nUntouched body with trailing spaces.   \n"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await seedNote(page, folder, "note.md", body)
  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()

  await page.locator("#open-settings").click()
  await page.locator('input[name="settings-theme"][value="dark"]').check()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")

  // The .md file is byte-for-byte what we seeded; only .brulion.json was written.
  expect(await readFile(page, folder, "note.md")).toBe(body)
})
