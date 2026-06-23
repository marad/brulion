import { test, expect, type Page } from "@playwright/test"

// FEAT-0035: rename the open note from the header identity, exercising the real
// File System Access move path (FEAT-0034) against an OPFS-backed folder handle.
const FOLDER = "e2e-note-rename-folder"

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

// Make the native FileSystemFileHandle.move reject, the way Android Chrome
// refuses it ("state changed since it was read from disk"), to force moveNote's
// copy-then-delete fallback over the real OPFS file system.
async function breakNativeMove(page: Page) {
  await page.addInitScript(() => {
    const proto = (
      globalThis as unknown as { FileSystemFileHandle?: { prototype: Record<string, unknown> } }
    ).FileSystemFileHandle?.prototype
    if (proto) {
      proto.move = () => Promise.reject(new DOMException("state had changed", "InvalidStateError"))
    }
  })
}

const display = (page: Page) => page.locator("#note-identity .note-identity-display")
const input = (page: Page) => page.locator("#note-identity .note-identity-edit")
const errorMsg = (page: Page) => page.locator("#note-identity .note-identity-error")
const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })

test("renames the open note from the header; the file moves and the UI follows (AC-6)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await expect(display(page)).toContainText("alpha")

  await display(page).click()
  await expect(input(page)).toHaveValue("alpha")
  await input(page).fill("renamed")
  await input(page).press("Enter")

  // The file moved on disk (native move), and the header + sidebar name the new note.
  await expect.poll(() => noteExists(page, "renamed.md")).toBe(true)
  expect(await noteExists(page, "alpha.md")).toBe(false)
  await expect(display(page)).toContainText("renamed")
  await expect(row(page, "renamed")).toHaveClass(/active/)
})

test("renames via the copy+delete fallback when native move is refused (AC-12)", async ({
  page,
}) => {
  await stubPicker(page)
  await breakNativeMove(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await display(page).click()
  await input(page).fill("renamed")
  await input(page).press("Enter")

  // The native move rejected, but the fallback moved the file all the same.
  await expect.poll(() => noteExists(page, "renamed.md")).toBe(true)
  expect(await noteExists(page, "alpha.md")).toBe(false)
  await expect(display(page)).toContainText("renamed")
})

test("a rename onto an existing name is refused and keeps the editor open (AC-7)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")
  await page.locator("#open-folder").click()

  // alpha is the active note (first sorted, no start.md); rename it onto beta.
  await expect(display(page)).toContainText("alpha")
  await display(page).click()
  await input(page).fill("beta")
  await input(page).press("Enter")

  await expect(errorMsg(page)).toContainText(/exist/i)
  await expect(input(page)).toBeVisible() // still editing
  await expect(input(page)).toHaveValue("beta") // typed text preserved
  // Neither file was touched.
  expect(await noteExists(page, "alpha.md")).toBe(true)
  expect(await noteExists(page, "beta.md")).toBe(true)
})

test("Escape cancels the rename without moving the file (AC-8)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await display(page).click()
  await input(page).fill("changed")
  await input(page).press("Escape")

  await expect(display(page)).toBeVisible()
  await expect(display(page)).toContainText("alpha")
  expect(await noteExists(page, "alpha.md")).toBe(true)
  expect(await noteExists(page, "changed.md")).toBe(false)
})
