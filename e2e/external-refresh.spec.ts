import { test, expect, type Page } from "@playwright/test"

// Each test uses its own OPFS folder so state can't leak between them.
async function stubPicker(page: Page, folder: string) {
  await page.addInitScript((f) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(f, { create: true })
    }
  }, folder)
}

// Write a note from OUTSIDE the app's UI — simulating another tool touching the
// folder while Brulion is open.
async function writeNote(page: Page, folder: string, name: string, text: string) {
  await page.evaluate(
    async ([f, file, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    },
    [folder, name, text] as const,
  )
}

async function deleteNote(page: Page, folder: string, name: string) {
  await page.evaluate(
    async ([f, file]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      await dir.removeEntry(file)
    },
    [folder, name] as const,
  )
}

async function readNote(page: Page, folder: string, name: string): Promise<string> {
  return await page.evaluate(
    async ([f, file]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      return await (await (await dir.getFileHandle(file)).getFile()).text()
    },
    [folder, name] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")
const scroller = (page: Page) => page.locator(".cm-scroller")
const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })

test("a note added externally appears in the list (AC-1)", async ({ page }) => {
  const folder = "e2e-refresh-add"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "log.md", "log body")

  await page.locator("#open-folder").click()
  await expect(page.locator(".note-name")).toHaveText(["log"])

  await writeNote(page, folder, "new.md", "new body") // another tool adds a note
  // The poll loop catches it up (Playwright retries past the poll interval).
  await expect(page.locator(".note-name")).toHaveText(["log", "new"])
  await expect(editor(page)).toHaveText("log body") // open note untouched
})

test("a non-open note removed externally drops from the list (AC-2)", async ({ page }) => {
  const folder = "e2e-refresh-remove"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "keep.md", "keep body")
  await writeNote(page, folder, "trash.md", "trash body")

  await page.locator("#open-folder").click()
  await expect(page.locator(".note-name")).toHaveText(["keep", "trash"])
  await expect(row(page, "keep")).toHaveClass(/active/)

  await deleteNote(page, folder, "trash.md") // another tool removes the non-open note
  await expect(page.locator(".note-name")).toHaveText(["keep"])
  await expect(editor(page)).toHaveText("keep body")
})

test("the open note's external edit is reflected in the editor (AC-3)", async ({ page }) => {
  const folder = "e2e-refresh-edit"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "log.md", "first version")

  await page.locator("#open-folder").click()
  await expect(editor(page)).toHaveText("first version")

  await writeNote(page, folder, "log.md", "second version") // edited by another tool
  await expect(editor(page)).toHaveText("second version")
})

test("the open note deleted externally switches to another (AC-5)", async ({ page }) => {
  const folder = "e2e-refresh-delete-active"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "a.md", "a body")
  await writeNote(page, folder, "b.md", "b body")

  await page.locator("#open-folder").click()
  await expect(row(page, "a")).toHaveClass(/active/)
  await expect(editor(page)).toHaveText("a body")

  await deleteNote(page, folder, "a.md") // the open note is removed externally
  await expect(page.locator(".note-name")).toHaveText(["b"])
  await expect(editor(page)).toHaveText("b body")
  await expect(row(page, "b")).toHaveClass(/active/)
})

test("an external edit preserves the scroll position, not jumping to the top (FEAT-0067 AC-1, AC-5)", async ({
  page,
}) => {
  const folder = "e2e-refresh-scroll"
  // A note tall enough to scroll well past one viewport.
  const lines = Array.from({ length: 300 }, (_, i) => `line ${String(i + 1).padStart(3, "0")}`)
  lines[299] = "LAST LINE original"
  const body = lines.join("\n") + "\n"

  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "long.md", body)
  await page.locator("#open-folder").click()
  await expect(editor(page)).toContainText("line 001") // top is rendered on open

  // Scroll to the bottom and confirm the tail is in view.
  await scroller(page).evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  const before = await scroller(page).evaluate((el) => el.scrollTop)
  expect(before).toBeGreaterThan(500)
  await expect(editor(page)).toContainText("LAST LINE original")

  // Another tool edits the open note; the poller catches the buffer up.
  const edited = body.replace("LAST LINE original", "LAST LINE EDITED")
  await writeNote(page, folder, "long.md", edited)
  await expect(editor(page)).toContainText("LAST LINE EDITED")

  // The view did NOT reset to the top — the reader stays where they were.
  const after = await scroller(page).evaluate((el) => el.scrollTop)
  expect(after).toBeGreaterThan(before * 0.8)
  // The reload echoed nothing back: the file is exactly the external content (the moat).
  expect(await readNote(page, folder, "long.md")).toBe(edited)
})
