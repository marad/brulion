import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-rendering-folder"

// A real OPFS directory handle, so saves exercise the genuine FSA write path
// and we can assert the on-disk bytes round-trip verbatim (the moat).
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
const renderedText = (page: Page) => editor(page).innerText()

async function type(page: Page, text: string) {
  await editor(page).click()
  await page.keyboard.type(text)
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  // A folder must be open for the editor to be reachable (the welcome screen,
  // FEAT-0031, covers it until then); these tests then edit the seeded start note.
  await page.locator("#open-folder").click()
})

test("hides heading markers and styles the heading (AC-1)", async ({ page }) => {
  await type(page, "# Title")

  expect(await renderedText(page)).not.toContain("#")
  await expect(editor(page)).toContainText("Title")

  const fontSize = await page
    .locator(".cm-heading")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const bodyFontSize = await editor(page).evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  )
  expect(fontSize).toBeGreaterThan(bodyFontSize)
})

test("a bare heading marker stays visible until a space completes it (AC-8)", async ({
  page,
}) => {
  await type(page, "##")
  // No space yet: the markers must be visible so the user sees what they type.
  expect(await renderedText(page)).toContain("##")
  await expect(page.locator(".cm-heading")).toHaveCount(0)

  // Adding the space completes the heading: markers vanish, styling applies.
  await page.keyboard.type(" Heading")
  expect(await renderedText(page)).not.toContain("#")
  await expect(page.locator(".cm-heading")).toContainText("Heading")
})

test("hides bold markers and renders bold (AC-2)", async ({ page }) => {
  await type(page, "say **hello** now")

  expect(await renderedText(page)).not.toContain("*")
  await expect(editor(page)).toContainText("say hello now")

  const weight = await page
    .locator(".cm-strong")
    .evaluate((el) => getComputedStyle(el).fontWeight)
  expect(Number(weight)).toBeGreaterThanOrEqual(700)
})

test("hides italic markers and renders italic (AC-3)", async ({ page }) => {
  await type(page, "say *hi* now")

  expect(await renderedText(page)).not.toContain("*")
  await expect(editor(page)).toContainText("say hi now")
  const style = await page
    .locator(".cm-em")
    .evaluate((el) => getComputedStyle(el).fontStyle)
  expect(style).toBe("italic")
})

test("hides inline-code backticks and renders monospace (AC-4)", async ({
  page,
}) => {
  await type(page, "run `code` here")

  expect(await renderedText(page)).not.toContain("`")
  await expect(editor(page)).toContainText("run code here")
  const family = await page
    .locator(".cm-inline-code")
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family.toLowerCase()).toContain("monospace")
})

test("markup stays hidden when the caret is on the line (AC-5)", async ({
  page,
}) => {
  await type(page, "a **bold** b")

  // Move the caret onto the line; markers must NOT reveal (no Obsidian flicker).
  await page.keyboard.press("Home")
  await page.keyboard.press("ArrowRight")
  expect(await renderedText(page)).not.toContain("*")
})

test("rendering does not alter the saved markdown (AC-6)", async ({ page }) => {
  await type(page, "# Title")
  await page.keyboard.press("Enter")
  await page.keyboard.type("a **bold** word")
  await page.keyboard.press("Control+s")

  await expect
    .poll(() => readStartMd(page))
    .toBe("# Title\na **bold** word")
})

test("the caret steps over hidden markers atomically (AC-7)", async ({
  page,
}) => {
  await type(page, "**bold**")
  // Home lands on the visible text (after the hidden `**`). Pressing Left must
  // jump the whole `**` run to the line start, never stopping between the two
  // `*` — so an inserted char lands BEFORE the run, not inside it.
  await page.keyboard.press("Home")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.type("X")
  await page.keyboard.press("Control+s")

  await expect.poll(() => readStartMd(page)).toBe("X**bold**")
})

// --- FEAT-0016: block constructs ---

test("collapses the fences and renders a code block (AC-1)", async ({ page }) => {
  await type(page, "```js")
  await page.keyboard.press("Enter")
  await page.keyboard.type("const x = 1")
  await page.keyboard.press("Enter")
  await page.keyboard.type("```")

  // Neither fence shows; the body reads as a monospace code block.
  expect(await renderedText(page)).not.toContain("```")
  await expect(editor(page)).toContainText("const x = 1")
  const family = await page
    .locator(".cm-code-block")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily)
  expect(family.toLowerCase()).toContain("monospace")
})

test("hides the blockquote marker and styles the quote (AC-2)", async ({ page }) => {
  await type(page, "> quoted line")

  expect(await renderedText(page)).not.toContain(">")
  await expect(editor(page)).toContainText("quoted line")
  await expect(page.locator(".cm-blockquote")).toHaveCount(1)
})

test("hides a `*` bullet and renders a disc glyph (AC-4)", async ({ page }) => {
  await type(page, "* a list item")

  // The literal `*` is gone; the disc lives in a widget that replaces the marker
  // run (FEAT-0019), so it IS in the rendered text — the `*` marker is not.
  await expect(editor(page)).toContainText("a list item")
  const disc = await page.locator(".cm-bullet-disc").first().textContent()
  expect(disc).toContain("•")
  // No literal asterisk marker leaks (the disc glyph is what shows instead).
  expect(await renderedText(page)).not.toContain("*")
})

test("a `-` bullet renders a distinct dash glyph (AC-4)", async ({ page }) => {
  await type(page, "- a dash item")

  await expect(editor(page)).toContainText("a dash item")
  const dash = await page.locator(".cm-bullet-dash").first().textContent()
  expect(dash).toContain("–")
  expect(dash).not.toContain("•") // distinct glyph from the `*` disc
})

test("block markup stays hidden when the caret is on the line (AC-5)", async ({
  page,
}) => {
  await type(page, "* a list item")
  await page.keyboard.press("Home") // caret onto the line; marker must not reveal
  expect(await renderedText(page)).not.toContain("*")
})

test("rendering does not alter a saved code block and quote (AC-6)", async ({
  page,
}) => {
  // The fences are collapsed in the view and the `>` is hidden, but the bytes
  // must survive verbatim. (The list marker's byte round-trip is covered by AC-7;
  // mixing a third block here only fights the editor's Enter-continues-markup
  // behavior, which is pre-existing and orthogonal to rendering.)
  await type(page, "```js")
  await page.keyboard.press("Enter")
  await page.keyboard.type("const x = 1")
  await page.keyboard.press("Enter")
  await page.keyboard.type("```")
  await page.keyboard.press("Enter")
  await page.keyboard.type("> quoted")
  await page.keyboard.press("Control+s")

  await expect
    .poll(() => readStartMd(page))
    .toBe("```js\nconst x = 1\n```\n> quoted")
})

test("the caret steps over a hidden list marker atomically (AC-7)", async ({
  page,
}) => {
  await type(page, "* item")
  // Home lands on the visible text (after the hidden `* `). Left must jump the
  // whole `* ` run to the line start, so an inserted char lands before it.
  await page.keyboard.press("Home")
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.type("X")
  await page.keyboard.press("Control+s")

  await expect.poll(() => readStartMd(page)).toBe("X* item")
})
