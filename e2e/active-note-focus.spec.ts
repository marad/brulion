import { test, expect, type Page } from "@playwright/test"

// FEAT-0099: active-note focus is a vault preference, follows genuine navigation,
// and never changes the Markdown files or the independent sidebar-collapse choice.

async function stubPicker(page: Page, folder: string) {
  await page.addInitScript((f) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(f, { create: true })
    }
  }, folder)
}

async function writeFile(page: Page, folder: string, name: string, content: string) {
  await page.evaluate(
    async ([f, file, body]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(f, { create: true })
      const segments = file.split("/")
      const leaf = segments.pop()!
      for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true })
      const handle = await dir.getFileHandle(leaf, { create: true })
      const writable = await handle.createWritable()
      await writable.write(body)
      await writable.close()
    },
    [folder, name, content] as const,
  )
}

async function snapshotNotes(page: Page, folder: string): Promise<Record<string, string>> {
  return await page.evaluate(async (f) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(f, { create: true })
    const files: Record<string, string> = {}
    // @ts-expect-error async iterator over a directory handle
    for await (const [name, handle] of dir.entries()) {
      if (name.endsWith(".md")) files[name] = await (handle as FileSystemFileHandle).getFile().then((file) => file.text())
    }
    return files
  }, folder)
}

async function openFixture(page: Page, folder: string, selectA = true) {
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeFile(page, folder, "a.md", "A\n\n[go](b.md)\n")
  await writeFile(page, folder, "b.md", "B\n")
  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()
  if (selectA) await page.locator(".note-name", { hasText: "a" }).click()
}

test("opening a vault does not focus its initial active row (AC-4)", async ({ page }) => {
  const folder = "e2e-active-note-focus-initial"
  await openFixture(page, folder, false)

  await expect(page.locator(".note-row.active .note-name")).toHaveText("a")
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.path)).not.toBe("a.md")
})

async function followToB(page: Page) {
  await page.locator(".cm-content").click()
  await page.locator(".cm-link", { hasText: "go" }).click()
  await expect(page.locator(".note-row.active .note-name")).toHaveText("b")
}

test("enabled active-note focus follows link navigation and preserves Markdown bytes (AC-1, AC-3, AC-5)", async ({
  page,
}) => {
  const folder = "e2e-active-note-focus-enabled"
  await openFixture(page, folder)
  const before = await snapshotNotes(page, folder)

  await followToB(page)

  await expect
    .poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.path))
    .toBe("b.md")
  expect(await snapshotNotes(page, folder)).toEqual(before)
})

test("the Settings checkbox disables focus without disabling active-row state (AC-2, AC-4)", async ({
  page,
}) => {
  const folder = "e2e-active-note-focus-disabled"
  await openFixture(page, folder)
  const before = await snapshotNotes(page, folder)
  await page.locator("#open-settings").click()
  const focus = page.locator(".settings-focus-active")
  await expect(focus).toBeChecked()
  await focus.uncheck()
  await expect
    .poll(async () => JSON.parse(await page.evaluate(async (f) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle(".brulion.json")
      return await (await handle.getFile()).text()
    }, folder)).focusActiveNote)
    .toBe(false)
  await page.locator(".settings-close").click()

  await followToB(page)

  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.path)).not.toBe("b.md")
  await expect(page.locator(".note-row.active .note-name")).toHaveText("b")
  expect(await snapshotNotes(page, folder)).toEqual(before)
})

test("collapsed sidebar stays collapsed and does not receive focus during navigation (AC-4)", async ({
  page,
}) => {
  const folder = "e2e-active-note-focus-collapsed"
  await openFixture(page, folder)
  const before = await snapshotNotes(page, folder)
  await page.locator("#toggle-sidebar").click()
  await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/)

  await followToB(page)

  await expect(page.locator(".workspace")).toHaveClass(/sidebar-collapsed/)
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.path)).not.toBe("b.md")
  expect(await snapshotNotes(page, folder)).toEqual(before)
})

test("active-note focus reveals, persists, and centers nested note rows (AC-6)", async ({ page }) => {
  const folder = "e2e-active-note-focus-nested"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeFile(page, folder, "home.md", "Home\\n")
  for (let i = 0; i < 40; i++) await writeFile(page, folder, `root-${String(i).padStart(2, "0")}.md`, `Root ${i}\\n`)
  await writeFile(page, folder, "zz-nested/deep/target.md", "Target\\n")
  for (let i = 0; i < 40; i++) await writeFile(page, folder, `zzz-after-${String(i).padStart(2, "0")}.md`, `After ${i}\\n`)
  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()

  await page.evaluate(() => {
    location.hash = "#/zz-nested/deep/target"
  })
  const target = page.locator('.note-name[data-path="zz-nested/deep/target.md"]')
  await expect(target).toBeVisible()
  await expect(page.locator('.folder-header[data-path="zz-nested"]')).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator('.folder-header[data-path="zz-nested/deep"]')).toHaveAttribute("aria-expanded", "true")
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.path)).toBe(
    "zz-nested/deep/target.md",
  )

  const centered = await page.locator("#note-list").evaluate((list, row) => {
    const listRect = list.getBoundingClientRect()
    const rowRect = (row as HTMLElement).getBoundingClientRect()
    return Math.abs(rowRect.top + rowRect.height / 2 - (listRect.top + listRect.height / 2))
  }, await target.elementHandle())
  expect(centered).toBeLessThan(60)

  await page.reload()
  await expect(page.locator("#note-identity")).toBeVisible()
  await expect(page.locator('.note-name[data-path="zz-nested/deep/target.md"]')).toBeVisible()
  await expect(page.locator('.folder-header[data-path="zz-nested"]')).toHaveAttribute("aria-expanded", "true")
  await expect(page.locator('.folder-header[data-path="zz-nested/deep"]')).toHaveAttribute("aria-expanded", "true")
})
