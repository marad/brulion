import { test, expect, type Page } from "@playwright/test"

// M15 P2 (FEAT-0050): the expanded frontmatter region is highlighted as YAML using
// the same tok-* palette as code blocks; collapsed shows nothing; bytes untouched.

const FOLDER = "e2e-frontmatter-yaml"
const NOTE = '---\ntitle: "Hello World"\ncount: 42\n# a note comment\n---\n\nBody text.\n'

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function seedNote(page: Page, content: string) {
  await page.evaluate(
    async ([folder, body]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const handle = await dir.getFileHandle("start.md", { create: true })
      const w = await handle.createWritable()
      await w.write(body)
      await w.close()
    },
    [FOLDER, content] as const,
  )
}

async function readNote(page: Page): Promise<string> {
  return await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    return await (await (await dir.getFileHandle("start.md")).getFile()).text()
  }, FOLDER)
}

const tokSpans = (page: Page) => page.locator('.cm-content span[class*="tok-"]')
const chip = (page: Page) => page.locator(".cm-frontmatter-chip")
const toggle = (page: Page) => page.locator(".cm-frontmatter-toggle")

test("collapsed frontmatter shows the chip and no YAML colors (AC-2)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, NOTE)
  await page.locator("#open-folder").click()
  await expect(chip(page)).toBeVisible() // collapsed by default (FEAT-0042)
  await page.waitForTimeout(500)
  expect(await tokSpans(page).count()).toBe(0)
})

test("expanded frontmatter is highlighted as YAML (AC-1)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, NOTE)
  await page.locator("#open-folder").click()
  await expect(chip(page)).toBeVisible()

  await toggle(page).click() // expand
  // Keys and the comment get token colors from the shared palette.
  await expect.poll(() => tokSpans(page).count()).toBeGreaterThan(0)
})

test("highlighting the frontmatter never rewrites the bytes (AC-3)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, NOTE)
  await page.locator("#open-folder").click()
  await expect(chip(page)).toBeVisible()
  await toggle(page).click()
  await expect.poll(() => tokSpans(page).count()).toBeGreaterThan(0)

  await page.locator(".cm-content").click()
  await page.keyboard.press("Control+s")
  await expect.poll(() => readNote(page)).toBe(NOTE)
})
