import { test, expect, type Page } from "@playwright/test"

// FEAT-0059 (M33 P1): the vault set + per-window identity (?ws). These need real
// IndexedDB, real OPFS handles, and real reloads/multiple pages — happy-dom can't
// exercise window identity. Two OPFS folders stand in for two granted vaults.

const A = "ws-folder-a"
const B = "ws-folder-b"

/** Stub the picker to return the named folders in sequence (the last one repeats),
 * so a test can drive successive "open folder" picks at different folders. */
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

async function mdCount(page: Page, folder: string): Promise<number> {
  return await page.evaluate(async (f) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(f, { create: true })
    let n = 0
    // @ts-expect-error async iterator over a directory handle
    for await (const [name] of dir.entries()) if (name.endsWith(".md")) n++
    return n
  }, folder)
}

const ws = (page: Page) => new URL(page.url()).searchParams.get("ws")
const noteRows = (page: Page) => page.locator(".note-row")
const switchFolder = async (page: Page) => {
  await page.locator("#open-settings").click()
  await page.locator(".settings-switch-folder").click()
}

test("opening a folder stamps the window's ?ws (AC-1)", async ({ page }) => {
  await stubPicker(page, [A])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()

  await expect(noteRows(page)).toHaveCount(1)
  expect(ws(page)).toMatch(/.+/) // a non-empty vault id is in the URL
})

test("a reload re-attaches to the same ?ws vault (AC-2)", async ({ page }) => {
  await stubPicker(page, [A])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(noteRows(page)).toHaveCount(1)
  const id = ws(page)

  await page.reload()

  await expect(page.locator("#welcome")).toBeHidden() // straight back to the workspace
  await expect(noteRows(page)).toHaveCount(1)
  expect(ws(page)).toBe(id) // same vault, no picker
})

test("re-picking the same folder keeps its ?ws id, no duplicate (AC-4)", async ({ page }) => {
  await stubPicker(page, [A, A]) // both picks resolve to folder A
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(noteRows(page)).toHaveCount(1)
  const id = ws(page)

  await switchFolder(page) // pick A again
  await expect(noteRows(page)).toHaveCount(1)

  expect(ws(page)).toBe(id) // same vault id reused (isSameEntry dedup)
})

test("two windows on different vaults stay independent across reload (AC-3)", async ({
  page,
  context,
}) => {
  // Window 1 → folder A.
  await stubPicker(page, [A])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(noteRows(page)).toHaveCount(1)
  const idA = ws(page)

  // Window 2 (a second page in the same context shares IndexedDB/OPFS). With no ?ws
  // it auto-attaches to the most-recent vault (A) — AC-6 — so it switches to B via
  // the settings folder-switch rather than the (absent) welcome button.
  const page2 = await context.newPage()
  await stubPicker(page2, [B])
  await page2.goto("/brulion/")
  await expect(page2.locator(".note-row")).toHaveCount(1) // auto-attached to A
  expect(ws(page2)).toBe(idA)

  await writeNote(page2, B, "beta.md", "beta body")
  await switchFolder(page2) // pick B
  await expect(page2.locator(".cm-content")).toHaveText("beta body")
  const idB = ws(page2)

  expect(idA).not.toBe(idB)

  // B is now the most-recent vault, but window 1 reloads to its OWN ?ws (A).
  await page.reload()
  await expect(noteRows(page)).toHaveCount(1)
  expect(ws(page)).toBe(idA)
  await expect(page.locator(".cm-content")).toHaveText("alpha body")

  await page2.reload()
  await expect(page2.locator(".note-row")).toHaveCount(1)
  expect(ws(page2)).toBe(idB)
  await page2.close()
})

test("recency is per-vault — one vault's history doesn't bleed into another (AC-10)", async ({
  page,
}) => {
  await stubPicker(page, [A, B, A]) // open A, switch to B, switch back to A
  await page.goto("/brulion/")
  await writeNote(page, A, "a-one.md", "a one")
  await writeNote(page, A, "a-two.md", "a two")
  await writeNote(page, B, "b-one.md", "b one")
  await page.locator("#open-folder").click()
  await expect(noteRows(page)).toHaveCount(2) // folder A

  // Visit both A notes so A has a recency history.
  await page.locator(".note-row", { hasText: "a-one" }).click()
  await page.locator(".note-row", { hasText: "a-two" }).click()

  await switchFolder(page) // → B
  await expect(noteRows(page)).toHaveCount(1) // only b-one
  await switchFolder(page) // → A again

  // A's quick switcher (empty query) lists A's notes by recency, not B's.
  await page.locator("#sidebar-search").click()
  const rows = page.locator(".switch-row")
  await expect(rows).toHaveCount(1) // the open A note is excluded; the other A note shows
  await expect(rows.first()).toContainText("a-")
  await expect(page.locator(".switch-row", { hasText: "b-one" })).toHaveCount(0)
})

test("opening and reloading writes no note files (AC-9)", async ({ page }) => {
  await stubPicker(page, [A])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  const before = await mdCount(page, A)
  await page.locator("#open-folder").click()
  await expect(noteRows(page)).toHaveCount(1)
  await page.reload()
  await expect(noteRows(page)).toHaveCount(1)

  expect(await mdCount(page, A)).toBe(before) // vault set + ?ws are not note writes
})
