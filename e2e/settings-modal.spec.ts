import { test, expect, type Page } from "@playwright/test"

// M16 P2 (FEAT-0048): the settings modal, its entry points (gear + Ctrl/Cmd+,), and
// the font picker. Each test uses its own OPFS folder.

async function stubPicker(page: Page, folder: string) {
  await page.addInitScript((f) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(f, { create: true })
    }
  }, folder)
}

async function readSettings(page: Page, folder: string): Promise<Record<string, unknown>> {
  return await page.evaluate(async (f) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(f, { create: true })
    const handle = await dir.getFileHandle(".brulion.json")
    return JSON.parse(await (await handle.getFile()).text())
  }, folder)
}

const cssVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name)

const contentFontSize = (page: Page) =>
  page.locator(".cm-content").evaluate((el) => getComputedStyle(el).fontSize)

async function openFolder(page: Page, folder: string) {
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()
}

const backdrop = (page: Page) => page.locator("#settings-backdrop")

test("the gear icon opens the modal (AC-1)", async ({ page }) => {
  await openFolder(page, "e2e-sm-gear")
  await page.locator("#open-settings").click()
  await expect(backdrop(page)).toBeVisible()
  await expect(page.locator(".settings-font")).toBeVisible()
  await expect(page.locator('input[name="settings-width"]')).toHaveCount(3)
  await expect(page.locator(".settings-vim")).toBeVisible()
})

test("Ctrl/Cmd+, opens the modal (AC-2)", async ({ page }) => {
  await openFolder(page, "e2e-sm-chord")
  await page.keyboard.press("Control+Comma")
  await expect(backdrop(page)).toBeVisible()
})

test("changing text size applies live and persists (AC-3)", async ({ page }) => {
  const folder = "e2e-sm-size"
  await openFolder(page, folder)
  await page.locator("#open-settings").click()
  expect(await contentFontSize(page)).toBe("16px") // default

  await page.locator('button[aria-label="Increase text size"]').click()
  expect(await contentFontSize(page)).toBe("17px") // applied live
  await expect.poll(async () => (await readSettings(page, folder)).textSize).toBe(17)
})

test("changing the editor width applies live and persists (AC-4)", async ({ page }) => {
  const folder = "e2e-sm-width"
  await openFolder(page, folder)
  await page.locator("#open-settings").click()

  await page.locator('input[name="settings-width"][value="full"]').check()
  expect(await cssVar(page, "--editor-measure")).toBe("none") // Full
  await expect.poll(async () => (await readSettings(page, folder)).editorWidth).toBe("full")
})

test("the Vim toggle applies live, persists, and stays in sync (AC-5)", async ({ page }) => {
  const folder = "e2e-sm-vim"
  await openFolder(page, folder)
  await page.locator("#open-settings").click()

  await page.locator(".settings-vim").check()
  // Vim engages on the editor regardless of focus (the modal overlays the editor,
  // so we don't click into it — we just assert the Vim layer mounted).
  await expect(page.locator(".cm-vimMode")).toBeVisible()
  await expect.poll(async () => (await readSettings(page, folder)).vim).toBe(true)

  // Toggling via the chord while the modal is open reflects in the checkbox (sync).
  await page.keyboard.press("Control+Semicolon")
  await expect(page.locator(".settings-vim")).not.toBeChecked()
})

test("the header Vim button is gone; the gear is present (AC-6)", async ({ page }) => {
  await openFolder(page, "e2e-sm-noheadervim")
  await expect(page.locator("#toggle-vim")).toHaveCount(0)
  await expect(page.locator("#open-settings")).toBeVisible()
})

test("the font control lists options and choosing one applies + persists (AC-7, AC-8)", async ({
  page,
}) => {
  const folder = "e2e-sm-font"
  // Stub queryLocalFonts to a known set so the test is deterministic regardless of
  // the CI machine's installed fonts (exercises the local-enumeration path of AC-7).
  await page.addInitScript(() => {
    ;(window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts =
      async () => [{ family: "Test Mono" }, { family: "Test Sans" }]
  })
  await openFolder(page, folder)
  await page.locator("#open-settings").click()

  const select = page.locator(".settings-font")
  // At least the default option plus the resolved families (local or preset).
  expect(await select.locator("option").count()).toBeGreaterThan(1)

  // Pick the first real family (index 1, after the "Default" option) — robust
  // whether the list came from queryLocalFonts or the preset fallback.
  const family = await select.locator("option").nth(1).getAttribute("value")
  await select.selectOption({ index: 1 })
  const stack = await cssVar(page, "--font-stack")
  expect(stack).toContain(family!) // the chosen family
  expect(stack).toContain("sans-serif") // the generic floor
  await expect.poll(async () => (await readSettings(page, folder)).font).toEqual([family])

  // Back to default clears the override.
  await select.selectOption({ index: 0 })
  await expect.poll(async () => (await readSettings(page, folder)).font).toEqual([])
})

test("the Folder section names the open folder; the gear is an SVG (FEAT-0054 AC-1, AC-5, AC-6)", async ({
  page,
}) => {
  await openFolder(page, "e2e-sm-folder")

  // AC-6: the entry point renders an inline SVG gear, not the ⚙ glyph.
  await expect(page.locator("#open-settings svg")).toBeVisible()
  await expect(page.locator("#open-settings")).not.toContainText("⚙")
  // AC-5: the header keeps no folder button.
  await expect(page.locator("#reopen-folder")).toHaveCount(0)

  await page.locator("#open-settings").click()
  // AC-1: the Folder section names the open folder and offers a switch button.
  await expect(page.locator(".settings-folder-name")).toHaveText("e2e-sm-folder")
  await expect(page.locator(".settings-switch-folder")).toBeVisible()
})

test("Switch folder… opens another folder and dismisses the modal (FEAT-0054 AC-2, AC-3)", async ({
  page,
}) => {
  // A picker that returns whichever folder __pick names, so one stub can open two.
  await page.addInitScript(() => {
    ;(window as unknown as { __pick: string }).__pick = "e2e-sm-switch-a"
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      const which = (window as unknown as { __pick: string }).__pick
      return await root.getDirectoryHandle(which, { create: true })
    }
  })
  await page.goto("/brulion/")
  // Seed the second folder with a distinctive note.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle("e2e-sm-switch-b", { create: true })
    const h = await dir.getFileHandle("zeta.md", { create: true })
    const w = await h.createWritable()
    await w.write("zeta body")
    await w.close()
  })
  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()

  await page.locator("#open-settings").click()
  await expect(backdrop(page)).toBeVisible()
  // Point the stub at folder B, then switch from inside the modal.
  await page.evaluate(() => {
    ;(window as unknown as { __pick: string }).__pick = "e2e-sm-switch-b"
  })
  await page.locator(".settings-switch-folder").click()

  // AC-3: the modal is dismissed; AC-2: folder B's note is now listed.
  await expect(backdrop(page)).toBeHidden()
  await expect(page.locator(".note-name")).toHaveText(["zeta"])
})

test("the modal closes on Esc and on a backdrop click (AC-9)", async ({ page }) => {
  await openFolder(page, "e2e-sm-close")

  await page.locator("#open-settings").click()
  await expect(backdrop(page)).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(backdrop(page)).toBeHidden()

  await page.locator("#open-settings").click()
  await expect(backdrop(page)).toBeVisible()
  await backdrop(page).click({ position: { x: 5, y: 5 } }) // click the backdrop, not the dialog
  await expect(backdrop(page)).toBeHidden()
})
