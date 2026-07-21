import { test, expect, type Page } from "@playwright/test"

// FEAT-0079 (M38 P1): cross-device permalinks — `?ws` resolves by a stable workspace
// NAME (the folder name by default), not the per-machine opaque id. Needs real
// IndexedDB + OPFS handles + real navigations, which happy-dom can't exercise. An OPFS
// folder stands in for a granted vault; its name is the effective workspace name.

const A = "ws-folder-a"
const B = "ws-folder-b"

/** Stub the picker to return the named folders in sequence (the last one repeats). */
async function stubPicker(page: Page, folders: string[]) {
  await page.addInitScript((names) => {
    let i = 0
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      const name = names[Math.min(i, names.length - 1)]
      i++
      return await root.getDirectoryHandle(name, { create: true })
    }
  }, folders)
}

async function writeNote(page: Page, folder: string, file: string, text: string) {
  await page.evaluate(
    async ([f, name, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle(name, { create: true })
      const w = await handle.createWritable()
      await w.write(content)
      await w.close()
    },
    [folder, file, text] as const,
  )
}

const ws = (page: Page) => new URL(page.url()).searchParams.get("ws")
const hash = (page: Page) => new URL(page.url()).hash
const noteRows = (page: Page) => page.locator(".note-row")

test("opening a folder stamps ?ws with the folder NAME, not an opaque id (AC-8)", async ({
  page,
}) => {
  await stubPicker(page, [A])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await expect(noteRows(page)).toHaveCount(1)
  // The portable effective name (the folder name), not a random 8-char id — this is
  // what makes the URL cross-device.
  expect(ws(page)).toBe(A)
})

test("a name-keyed ?ws permalink resolves to the vault and opens the note (AC-4)", async ({
  page,
}) => {
  // First, grant folder A once so it is in the vault set with its name cached.
  await stubPicker(page, [A])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(noteRows(page)).toHaveCount(1)

  // Now open a fresh permalink by NAME + note hash (as if copied from another device).
  await page.goto(`/brulion/?ws=${A}#/alpha`)

  await expect(page.locator("#welcome")).toBeHidden() // resolved by name, no pick needed
  await expect(page.locator(".cm-content")).toHaveText("alpha body") // the linked note opened
  expect(ws(page)).toBe(A)
})

test("an explicit unmatched ?ws shows welcome and does NOT open another granted vault (AC-7)", async ({
  page,
}) => {
  // Grant A (and make it most-recent), so a naive fallback would wrongly open it.
  await stubPicker(page, [A])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(noteRows(page)).toHaveCount(1)

  // A permalink for a workspace this device doesn't have.
  await page.goto("/brulion/?ws=ghost#/some-note")

  // It must NOT silently open A (that would consume the hash against the wrong folder
  // and rewrite the shared link). The welcome/pick flow runs with the URL intact.
  await expect(page.locator("#welcome")).toBeVisible()
  await expect(noteRows(page)).toHaveCount(0)
  expect(ws(page)).toBe("ghost") // preserved, so the note resolves once the folder is granted
  expect(hash(page)).toBe("#/some-note")
})

test("a fresh device with no matching folder falls back to welcome, never a wrong vault (AC-7)", async ({
  page,
  context,
}) => {
  // A second window/tab that has never granted B, opening a B permalink while only A
  // exists. It must land on welcome, not on A.
  await stubPicker(page, [A])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(noteRows(page)).toHaveCount(1)

  const page2 = await context.newPage()
  await page2.goto(`/brulion/?ws=${B}#/beta`)
  await expect(page2.locator("#welcome")).toBeVisible()
  await expect(page2.locator(".note-row")).toHaveCount(0)
  expect(ws(page2)).toBe(B)
  await page2.close()
})
