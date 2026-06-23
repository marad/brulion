import { test, expect, type Page } from "@playwright/test"

// M16 P1 (FEAT-0047): settings live in `.brulion.json` at the folder root and apply
// to the editor on open. Each test uses its own OPFS folder so state can't leak.

async function stubPicker(page: Page, folder: string) {
  await page.addInitScript((f) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(f, { create: true })
    }
  }, folder)
}

// Write a file into the folder from OUTSIDE the app — seeding `.brulion.json` (or a
// note) before the app opens the folder.
async function writeFile(page: Page, folder: string, name: string, content: string) {
  await page.evaluate(
    async ([f, file, body]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(body)
      await writable.close()
    },
    [folder, name, content] as const,
  )
}

// Read a file back out of the OPFS folder — to assert what the app persisted.
async function readFile(page: Page, folder: string, name: string): Promise<string> {
  return await page.evaluate(
    async ([f, file]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle(file)
      return await (await handle.getFile()).text()
    },
    [folder, name] as const,
  )
}

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

const contentFontSize = (page: Page) =>
  page.locator(".cm-content").evaluate((el) => getComputedStyle(el).fontSize)

test("settings from .brulion.json apply on open (AC-1)", async ({ page }) => {
  const folder = "e2e-settings-apply"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeFile(
    page,
    folder,
    ".brulion.json",
    JSON.stringify({ font: [], textSize: 22, editorWidth: "wider", vim: true }),
  )

  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible() // folder is open

  expect(await contentFontSize(page)).toBe("22px") // base size reflects the file
  expect(await cssVar(page, "--editor-measure")).toBe("90ch") // Wider preset
  await expect(page.locator("#toggle-vim")).toHaveAttribute("aria-pressed", "true")
})

test("an absent settings file falls back to defaults (AC-2)", async ({ page }) => {
  const folder = "e2e-settings-defaults"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  // No .brulion.json seeded.

  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()

  expect(await contentFontSize(page)).toBe("16px") // default base size
  expect(await cssVar(page, "--editor-measure")).toBe("68ch") // Narrow default
  await expect(page.locator("#toggle-vim")).toHaveAttribute("aria-pressed", "false")
  const fontFamily = await page
    .locator(".cm-content")
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(fontFamily.toLowerCase()).toContain("system-ui") // default stack, no override
})

test("Ctrl/Cmd+; toggles Vim and persists to .brulion.json (AC-6)", async ({ page }) => {
  const folder = "e2e-settings-vim-persist"
  await stubPicker(page, folder)
  await page.goto("/brulion/")

  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()
  await expect(page.locator("#toggle-vim")).toHaveAttribute("aria-pressed", "false")

  await page.keyboard.press("Control+Semicolon")
  await expect(page.locator("#toggle-vim")).toHaveAttribute("aria-pressed", "true")

  // The file Brulion wrote records vim:true (Playwright retries past the async write).
  await expect
    .poll(async () => JSON.parse(await readFile(page, folder, ".brulion.json")).vim)
    .toBe(true)
})

test(".brulion.json never appears in the note list (AC-7)", async ({ page }) => {
  const folder = "e2e-settings-not-listed"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeFile(page, folder, ".brulion.json", JSON.stringify({ textSize: 18 }))
  await writeFile(page, folder, "note.md", "a real note")

  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()

  // Only the real `.md` note shows; the settings file is invisible to the note layer.
  await expect(page.locator(".note-name")).toHaveText(["note"])
})
