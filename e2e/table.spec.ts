import { test, expect, type Page } from "@playwright/test"

// FEAT-0063 (M26): pipe tables render as aligned <table>s; raw source revealed on
// selection; bytes untouched. Real CodeMirror decorations + reveal need a browser.

const FOLDER = "e2e-table-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeNote(page: Page, file: string, content: string) {
  await page.evaluate(
    async ([folder, name, text]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const h = await dir.getFileHandle(name, { create: true })
      const w = await h.createWritable()
      await w.write(text)
      await w.close()
    },
    [FOLDER, file, content] as const,
  )
}

async function readNote(page: Page, file: string): Promise<string> {
  return await page.evaluate(
    async ([folder, name]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const h = await dir.getFileHandle(name)
      return await (await h.getFile()).text()
    },
    [FOLDER, file] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")
const table = (page: Page) => page.locator(".cm-table")

async function openNote(page: Page, file: string, content: string) {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, file, content)
  await page.locator("#open-folder").click()
  await page.locator(".note-row", { hasText: file.replace(".md", "") }).click()
}

test("a header + separator + body renders as a table (AC-1)", async ({ page }) => {
  await openNote(page, "t.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n")

  await expect(table(page)).toHaveCount(1)
  await expect(table(page).locator("th")).toHaveText(["a", "b"])
  await expect(table(page).locator("tbody td")).toHaveText(["1", "2"])
})

test("column alignment follows the separator (AC-2)", async ({ page }) => {
  await openNote(page, "t.md", "| h1 | h2 | h3 |\n| :--- | :--: | ---: |\n| 1 | 2 | 3 |\n\nafter\n")

  const heads = table(page).locator("th")
  await expect(heads.nth(0)).toHaveCSS("text-align", "left")
  await expect(heads.nth(1)).toHaveCSS("text-align", "center")
  await expect(heads.nth(2)).toHaveCSS("text-align", "right")
})

test("a pipe table inside a fenced code block is not rendered as a table (AC-4)", async ({
  page,
}) => {
  await openNote(page, "t.md", "```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n\nafter\n")

  await expect(table(page)).toHaveCount(0) // it's code, not a table
  await expect(editor(page)).toContainText("| a | b |") // raw pipes shown (as code)
})

test("selecting inside the table reveals the raw source (AC-5)", async ({ page }) => {
  await openNote(page, "t.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n")
  await expect(table(page)).toHaveCount(1)

  await table(page).click() // places the caret inside the block → reveals

  await expect(table(page)).toHaveCount(0) // re-rendered as raw
  await expect(editor(page)).toContainText("| --- | --- |")
})

test("rendering does not change the document bytes (AC-8)", async ({ page }) => {
  const content = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n"
  await openNote(page, "t.md", content)
  await expect(table(page)).toHaveCount(1)
  await table(page).click() // reveal
  await expect(table(page)).toHaveCount(0)

  expect(await readNote(page, "t.md")).toBe(content) // byte-for-byte unchanged
})
