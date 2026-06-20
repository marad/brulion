import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-shortcuts-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function readStartMd(page: Page): Promise<string | null> {
  return await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder, { create: true })
    try {
      const handle = await dir.getFileHandle("start.md")
      return await (await handle.getFile()).text()
    } catch {
      return null
    }
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await editor(page).click()
})

test("Ctrl+B wraps a selection in bold (AC-1)", async ({ page }) => {
  await page.keyboard.type("hello world")
  for (let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowLeft") // select "world"
  await page.keyboard.press("Control+b")

  await expect.poll(() => readStartMd(page)).toBe("hello **world**")
})

test("Ctrl+B on a bold word removes the bold (AC-2)", async ({ page }) => {
  await page.keyboard.type("hello **world**")
  // The markers are hidden; double-click selects the visible word "world".
  await editor(page).getByText("world").dblclick()
  await page.keyboard.press("Control+b")

  await expect.poll(() => readStartMd(page)).toBe("hello world")
})

test("Ctrl+I italic and Ctrl+E inline code wrap a selection (AC-3)", async ({
  page,
}) => {
  // Double-click selects the visible word regardless of hidden/atomic markers.
  const selectBB = () => editor(page).getByText("bb").dblclick()

  await page.keyboard.type("aa bb")
  await selectBB()
  await page.keyboard.press("Control+i")
  await expect.poll(() => readStartMd(page)).toBe("aa *bb*")

  await selectBB()
  await page.keyboard.press("Control+i") // toggle back off
  await expect.poll(() => readStartMd(page)).toBe("aa bb")

  await selectBB()
  await page.keyboard.press("Control+e")
  await expect.poll(() => readStartMd(page)).toBe("aa `bb`")
})

test("an inline shortcut with no selection inserts empty markers (AC-4)", async ({
  page,
}) => {
  await page.keyboard.press("Control+b")
  await page.keyboard.type("typed")
  await expect.poll(() => readStartMd(page)).toBe("**typed**")
})

test("Ctrl+ArrowUp promotes the heading level toward H1 (AC-5)", async ({
  page,
}) => {
  await page.keyboard.type("note")

  await page.keyboard.press("Control+ArrowUp")
  await expect.poll(() => readStartMd(page)).toBe("### note")
  await page.keyboard.press("Control+ArrowUp")
  await expect.poll(() => readStartMd(page)).toBe("## note")
  await page.keyboard.press("Control+ArrowUp")
  await expect.poll(() => readStartMd(page)).toBe("# note")
  await page.keyboard.press("Control+ArrowUp") // stops at H1
  await expect.poll(() => readStartMd(page)).toBe("# note")
})

test("Ctrl+ArrowDown demotes and can remove the heading (AC-6)", async ({
  page,
}) => {
  await page.keyboard.type("# note")

  await page.keyboard.press("Control+ArrowDown")
  await expect.poll(() => readStartMd(page)).toBe("## note")
  await page.keyboard.press("Control+ArrowDown")
  await expect.poll(() => readStartMd(page)).toBe("### note")
  await page.keyboard.press("Control+ArrowDown")
  await expect.poll(() => readStartMd(page)).toBe("note") // heading removed
})

test("Ctrl+Shift+2 sets the line directly to H2 (AC-7)", async ({ page }) => {
  await page.keyboard.type("note")
  await page.keyboard.press("Control+Shift+Digit2")
  await expect.poll(() => readStartMd(page)).toBe("## note")
})

test("Ctrl+U inserts no underline markup (AC-9)", async ({ page }) => {
  await page.keyboard.type("plain text")
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft")
  await page.keyboard.press("Control+u")
  await page.keyboard.press("Control+s")

  // Underline is unsupported: Ctrl+U leaves the document exactly as typed.
  await expect.poll(() => readStartMd(page)).toBe("plain text")
})
