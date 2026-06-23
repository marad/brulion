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

// Seed a note from OUTSIDE the app, so opening the folder loads it through the
// real note-load path (the programmatic load that resets frontmatter to collapsed).
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

async function readNote(page: Page, folder: string, name: string): Promise<string> {
  return await page.evaluate(
    async ([f, file]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle(file)
      return await (await handle.getFile()).text()
    },
    [folder, name] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")
const renderedText = (page: Page) => editor(page).innerText()
const toggle = (page: Page) => page.locator(".cm-frontmatter-toggle")

const FRONTMATTER = "---\ntitle: Hello\ntags: [a, b]\n---\n"
const BODY = "the note body\n"
const NOTE = FRONTMATTER + BODY

test("a leading frontmatter block opens collapsed as a metadata chip (AC-4)", async ({
  page,
}) => {
  const folder = "e2e-fm-collapsed"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "note.md", NOTE)

  await page.locator("#open-folder").click()

  // The chip is shown, the raw frontmatter is hidden, the body follows.
  await expect(toggle(page)).toBeVisible()
  await expect(toggle(page)).toContainText("metadata")
  const shown = await renderedText(page)
  expect(shown).not.toContain("title: Hello")
  expect(shown).not.toContain("tags: [a, b]")
  expect(shown).toContain("the note body")
})

test("clicking the chip expands the raw frontmatter, clicking again collapses it (AC-5, AC-6)", async ({
  page,
}) => {
  const folder = "e2e-fm-toggle"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "note.md", NOTE)
  await page.locator("#open-folder").click()

  // Expand.
  await toggle(page).click()
  const expanded = await renderedText(page)
  expect(expanded).toContain("title: Hello")
  expect(expanded).toContain("tags: [a, b]")
  expect(expanded).toContain("---")

  // Collapse again.
  await toggle(page).click()
  await expect(toggle(page)).toContainText("metadata")
  expect(await renderedText(page)).not.toContain("title: Hello")
})

test("saving round-trips the frontmatter bytes verbatim (AC-7)", async ({ page }) => {
  const folder = "e2e-fm-fidelity"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "note.md", NOTE)
  await page.locator("#open-folder").click()
  await expect(toggle(page)).toBeVisible()

  // Expand and collapse — purely visual, the bytes must not move.
  await toggle(page).click()
  await toggle(page).click()

  // Append to the body and save; the frontmatter block must be untouched.
  await editor(page).click()
  await page.keyboard.press("Control+End")
  await page.keyboard.type("more")
  await page.keyboard.press("Control+s")

  await expect
    .poll(() => readNote(page, folder, "note.md"))
    .toBe(FRONTMATTER + "the note body\nmore")
})

test("the collapsed chip is atomic — the caret never splits the hidden block (AC-8)", async ({
  page,
}) => {
  const folder = "e2e-fm-atomic"
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder, "note.md", NOTE)
  await page.locator("#open-folder").click()
  await expect(toggle(page)).toBeVisible()

  // From the body, walk the caret up across the chip and type. Because the chip
  // is atomic, the caret cannot land inside the hidden `---…---`, so the insert
  // lands at the body or before the block — never splitting the delimiters.
  await editor(page).click()
  await page.keyboard.press("Control+Home")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.type("Z")
  await page.keyboard.press("Control+s")

  // The frontmatter block survives as one contiguous, verbatim run.
  await expect.poll(() => readNote(page, folder, "note.md")).toContain(FRONTMATTER)
})
