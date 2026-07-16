import { test, expect, type Page } from "@playwright/test"

// M36/FEAT-0075: the sidebar tree is keyboard-navigable — arrow keys move
// focus between visible rows and expand/collapse folders, with a roving tab
// stop. Real focus, real tab order, and real reload persistence need Chromium,
// not happy-dom.
const FOLDER = "e2e-tree-keyboard-nav-folder"

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

const noteName = (page: Page, name: string) => page.locator(".note-name", { hasText: name })
const folderHeader = (page: Page, name: string) => page.locator(".folder-header", { hasText: name })

test("Down/Up move focus; Right/Left expand, descend, ascend, collapse (AC-1, AC-4, AC-5)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "projects/keep.md", "keep body")
  await page.locator("#open-folder").click()

  await noteName(page, "alpha").focus()
  await expect(noteName(page, "alpha")).toBeFocused()

  await page.keyboard.press("ArrowDown") // → the projects folder header
  await expect(folderHeader(page, "projects")).toBeFocused()
  await expect(folderHeader(page, "projects")).toHaveAttribute("aria-expanded", "false")

  await page.keyboard.press("ArrowRight") // expand
  await expect(folderHeader(page, "projects")).toHaveAttribute("aria-expanded", "true")

  await page.keyboard.press("ArrowRight") // descend into first child
  await expect(noteName(page, "keep")).toBeFocused()

  await page.keyboard.press("ArrowLeft") // back up to the parent
  await expect(folderHeader(page, "projects")).toBeFocused()

  await page.keyboard.press("ArrowLeft") // collapse
  await expect(folderHeader(page, "projects")).toHaveAttribute("aria-expanded", "false")

  await page.keyboard.press("ArrowUp") // → back to alpha
  await expect(noteName(page, "alpha")).toBeFocused()
})

test("Enter opens the focused note (AC-7)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")
  await page.locator("#open-folder").click()

  await noteName(page, "beta").focus()
  await page.keyboard.press("Enter")

  await expect(page.locator("#editor .cm-content")).toContainText("beta body")
})

test("the tree is a single roving tab stop (AC-8)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")
  await writeNote(page, "projects/keep.md", "keep body")
  await page.locator("#open-folder").click()
  await expect(noteName(page, "alpha")).toBeVisible()

  const tabStops = page.locator(
    ".folder-header[tabindex='0'], .note-name[tabindex='0']",
  )
  await expect(tabStops).toHaveCount(1)
})

test("a folder expanded by keyboard stays expanded after reload (AC-9)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "other.md", "other body")
  await writeNote(page, "projects/keep.md", "keep body")
  await page.locator("#open-folder").click()

  // Make a note OUTSIDE projects the active one, so projects is expanded only
  // by the keyboard action below — never because it's an ancestor of the active
  // note (which always auto-expands, FEAT-0043).
  await noteName(page, "other").click()
  await folderHeader(page, "projects").focus()
  await page.keyboard.press("ArrowRight") // expand via keyboard
  await expect(folderHeader(page, "projects")).toHaveAttribute("aria-expanded", "true")

  await page.reload() // auto-reattaches the remembered vault

  await expect(folderHeader(page, "projects")).toHaveAttribute("aria-expanded", "true")
})
