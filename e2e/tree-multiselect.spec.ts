import { test, expect, type Page } from "@playwright/test"

// M37/FEAT-0078: multi-select in the sidebar tree + batch delete/move. Real
// Chromium is needed for genuine Ctrl+click selection, the context menu, the
// confirm dialog, and real on-disk moves/deletes (via an OPFS-backed handle).
const FOLDER = "e2e-tree-multiselect-folder"

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

async function entriesOf(page: Page, subPath: string): Promise<string[]> {
  return page.evaluate(
    async ([folder, sub]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder)
      for (const seg of sub ? sub.split("/") : []) dir = await dir.getDirectoryHandle(seg)
      const names: string[] = []
      // @ts-expect-error async iterator on the directory handle
      for await (const [name] of dir.entries()) names.push(name)
      return names.sort()
    },
    [FOLDER, subPath] as const,
  )
}

const noteName = (page: Page, name: string) => page.locator(".note-name", { hasText: name })

test("Ctrl+click two notes, Delete + confirm removes both (FEAT-0078/AC-3, AC-7)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "a.md", "aa")
  await writeNote(page, "b.md", "bb")
  await writeNote(page, "c.md", "cc")
  await page.locator("#open-folder").click()
  await expect(noteName(page, "a")).toBeVisible()

  await noteName(page, "a").click({ modifiers: ["Control"] })
  await noteName(page, "b").click({ modifiers: ["Control"] })
  await expect(noteName(page, "a")).toHaveAttribute("aria-selected", "true")
  await expect(noteName(page, "b")).toHaveAttribute("aria-selected", "true")

  await page.keyboard.press("Delete")
  await page.locator("#dialog-confirm").click()

  await expect(noteName(page, "a")).toHaveCount(0)
  await expect(noteName(page, "b")).toHaveCount(0)
  await expect(noteName(page, "c")).toBeVisible()
  expect(await entriesOf(page, "")).toEqual(["c.md"])
})

test("select two notes, batch-move via the menu relocates both (FEAT-0078/AC-8)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "a.md", "aa")
  await writeNote(page, "b.md", "bb")
  await writeNote(page, "dest/keep.md", "keep") // materializes the "dest" folder
  await page.locator("#open-folder").click()
  await expect(noteName(page, "a")).toBeVisible()

  await noteName(page, "a").click({ modifiers: ["Control"] })
  await noteName(page, "b").click({ modifiers: ["Control"] })

  await noteName(page, "a").click({ button: "right" }) // context menu on a selected row
  await page
    .locator(".cm-context-menu button[role=menuitem]", { hasText: "Move 2 items" })
    .click()

  await page.locator(".move-row", { hasText: "dest" }).click() // pick the destination

  // Both notes now live under dest/ and are gone from the root.
  await expect.poll(() => entriesOf(page, "dest")).toEqual(["a.md", "b.md", "keep.md"])
  expect(await entriesOf(page, "")).toEqual(["dest"])
})
