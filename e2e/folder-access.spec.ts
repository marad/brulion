import { test, expect } from "@playwright/test"

// The native folder picker can't be scripted, so we stub showDirectoryPicker to
// return a real OPFS directory handle seeded with files. listMarkdownFiles then
// runs against a genuine FileSystemDirectoryHandle in real Chromium.
async function stubPickerWithSeededFolder(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      try {
        await root.removeEntry("e2e-folder", { recursive: true })
      } catch {
        // first run — nothing to clean
      }
      const dir = await root.getDirectoryHandle("e2e-folder", { create: true })
      for (const name of ["zebra.md", "notes.txt", "Alpha.MD", "beta.md"]) {
        await dir.getFileHandle(name, { create: true })
      }
      return dir
    }
  })
}

test("lists only the markdown files from a picked folder, sorted (AC-2)", async ({
  page,
}) => {
  await stubPickerWithSeededFolder(page)
  await page.goto("/brulion/")

  await page.locator("#open-folder").click()

  await expect(page.locator("#file-list li")).toHaveText([
    "Alpha.MD",
    "beta.md",
    "zebra.md",
  ])
})
