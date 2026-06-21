import { test, expect, type Page } from "@playwright/test"

// FEAT-0031 — the first-run welcome screen and the re-pick flow. showDirectoryPicker
// returns a real OPFS directory; which one is read from a page global so the same
// stub can open a second folder for the re-pick case.
const FOLDER_A = "e2e-welcome-a"
const FOLDER_B = "e2e-welcome-b"

async function stubPicker(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __pick: string }).__pick = "e2e-welcome-a"
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      const which = (window as unknown as { __pick: string }).__pick
      return await root.getDirectoryHandle(which, { create: true })
    }
  })
}

async function writeNote(page: Page, folder: string, file: string, content: string) {
  await page.evaluate(
    async ([folder, file, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    },
    [folder, file, content] as const,
  )
}

test("welcome → open folder → workspace, then re-pick (AC-1, AC-4, AC-5)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")

  // The loading overlay exists so the welcome never flashes before the folder
  // restore check resolves (M10 review fix); with no folder it gives way to welcome.
  await expect(page.locator("#loading")).toHaveCount(1)
  // AC-1: the welcome hero greets the user; no bare editor, sidebar hidden.
  await expect(page.locator("#welcome")).toBeVisible()
  await expect(page.locator("#sidebar")).toBeHidden()
  await expect(page.locator("#welcome #open-folder")).toBeVisible()

  // Open folder A from the welcome CTA.
  await writeNote(page, FOLDER_A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  // AC-4: the hero is gone and the workspace is shown; it stays gone.
  await expect(page.locator("#welcome")).toBeHidden()
  await expect(page.locator(".cm-editor")).toBeVisible()
  await expect(page.locator("#sidebar")).toBeVisible()
  await expect(page.locator(".note-name")).toHaveText(["alpha"])

  // AC-5: re-pick a different folder from the header; its notes show, hero stays gone.
  await writeNote(page, FOLDER_B, "beta.md", "beta body")
  await page.evaluate(() => {
    ;(window as unknown as { __pick: string }).__pick = "e2e-welcome-b"
  })
  await page.locator("#reopen-folder").click()

  await expect(page.locator(".note-name")).toHaveText(["beta"])
  await expect(page.locator("#welcome")).toBeHidden()
})
