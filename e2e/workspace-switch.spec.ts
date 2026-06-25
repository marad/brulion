import { test, expect, type Page } from "@playwright/test"

// FEAT-0060 (M33 P2): the workspace switcher (palette action) + forget in settings.
// Needs real IndexedDB/OPFS, the live command palette, and real switching.

const A = "ws2-folder-a"
const B = "ws2-folder-b"

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
const paletteRows = (page: Page) => page.locator(".palette-row")
const switchFolder = async (page: Page) => {
  await page.locator("#open-settings").click()
  await page.locator(".settings-switch-folder").click()
}

// Open folder A, then folder B (so both are granted vaults; B ends up open).
async function openAthenB(page: Page) {
  await stubPicker(page, [A, B])
  await page.goto("/brulion/")
  await writeNote(page, A, "alpha.md", "alpha body")
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(1) // A
  const idA = ws(page)
  await writeNote(page, B, "beta.md", "beta body")
  await switchFolder(page) // → B
  await expect(page.locator(".cm-content")).toHaveText("beta body")
  return { idA, idB: ws(page) }
}

test("the Switch workspace… palette action switches the window (AC-1, AC-2)", async ({ page }) => {
  const { idA, idB } = await openAthenB(page)
  expect(idA).not.toBe(idB)

  await page.keyboard.press("Control+Shift+K") // command palette (registry)
  await page.locator("#palette-input").fill("switch workspace")
  await paletteRows(page).first().click() // run "Switch workspace…" → palette reopens with vaults

  // The chooser now lists the OTHER workspace (A); the open one (B) is excluded.
  await expect(paletteRows(page)).toHaveCount(1)
  await paletteRows(page).first().click() // switch to A

  await expect(page.locator(".cm-content")).toHaveText("alpha body")
  expect(ws(page)).toBe(idA) // ?ws updated to A
})

test("the settings Workspaces section forgets a non-open workspace (AC-4, AC-5, AC-6)", async ({
  page,
}) => {
  await openAthenB(page) // B is open; A and B both granted
  await page.locator("#open-settings").click()

  const rows = page.locator(".settings-workspace-row")
  await expect(rows).toHaveCount(2)
  // The open workspace (B) has no Forget control; the other (A) does.
  const openRow = page.locator(`.settings-workspace-row:has-text("${B}")`)
  await expect(openRow.locator(".settings-workspace-forget")).toHaveCount(0)
  const otherRow = page.locator(`.settings-workspace-row:has-text("${A}")`)
  await expect(otherRow.locator(".settings-workspace-forget")).toHaveCount(1)

  await otherRow.locator(".settings-workspace-forget").click()

  await expect(page.locator(".settings-workspace-row")).toHaveCount(1) // A forgotten
  await expect(page.locator(`.settings-workspace-row:has-text("${A}")`)).toHaveCount(0)
})

test("switching and forgetting write no note files (AC-7)", async ({ page }) => {
  const beforeA = await (async () => {
    await openAthenB(page)
    return mdCount(page, A)
  })()
  const beforeB = await mdCount(page, B)

  // Switch B → A via the palette.
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("switch workspace")
  await paletteRows(page).first().click()
  await paletteRows(page).first().click()
  await expect(page.locator(".cm-content")).toHaveText("alpha body")

  // Forget B (now non-open) via settings.
  await page.locator("#open-settings").click()
  await page.locator(`.settings-workspace-row:has-text("${B}") .settings-workspace-forget`).click()
  await expect(page.locator(".settings-workspace-row")).toHaveCount(1)

  expect(await mdCount(page, A)).toBe(beforeA)
  expect(await mdCount(page, B)).toBe(beforeB)
})
