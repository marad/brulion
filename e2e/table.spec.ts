import { test, expect, type Page } from "@playwright/test"

// FEAT-0063 (M26) + inline table cell editing: pipe tables render as aligned,
// directly editable <table>s with multiline <br> cells and full Vim support;
// raw source stays reachable via Ctrl/Cmd+Click or the source button;
// untouched bytes remain verbatim.

const FOLDER = "e2e-table-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeNote(page: Page, file: string, content: string) {
  await page.evaluate(
    async ([folder, name, text]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const h = await dir.getFileHandle(name, { create: true })
      const w = await h.createWritable()
      await w.write(text)
      await w.close()
    },
    [FOLDER, file, content] as const,
  )
}

async function readNote(page: Page, file: string): Promise<string | null> {
  return await page.evaluate(
    async ([folder, name]) => {
      try {
        const root = await navigator.storage.getDirectory()
        const dir = await root.getDirectoryHandle(folder, { create: true })
        const h = await dir.getFileHandle(name)
        return await (await h.getFile()).text()
      } catch {
        return null
      }
    },
    [FOLDER, file] as const,
  )
}

const editor = (page: Page) => page.locator("#editor > .cm-editor > .cm-scroller > .cm-content")
const table = (page: Page) => page.locator(".cm-table")
const cell = (page: Page, row: number, col: number) =>
  table(page).locator(`.cm-table-cell[data-row="${row}"][data-col="${col}"]`)

async function openNote(page: Page, file: string, content: string) {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, file, content)
  await page.locator("#open-folder").click()
  await page.locator(".note-row", { hasText: file.replace(".md", "") }).click()
}

test("a header + separator + body renders as a table (AC-1)", async ({ page }) => {
  await openNote(page, "t.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n")

  await expect(table(page)).toHaveCount(1)
  await expect(table(page).locator("th")).toHaveText(["a", "b"])
  await expect(table(page).locator("tbody td")).toHaveText(["1", "2"])
})

test("column alignment follows the separator (AC-2)", async ({ page }) => {
  await openNote(page, "t.md", "| h1 | h2 | h3 |\n| :--- | :--: | ---: |\n| 1 | 2 | 3 |\n\nafter\n")

  const heads = table(page).locator("th")
  await expect(heads.nth(0)).toHaveCSS("text-align", "left")
  await expect(heads.nth(1)).toHaveCSS("text-align", "center")
  await expect(heads.nth(2)).toHaveCSS("text-align", "right")
})

test("a pipe table inside a fenced code block is not rendered as a table (AC-4)", async ({
  page,
}) => {
  await openNote(page, "t.md", "```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```\n\nafter\n")

  await expect(table(page)).toHaveCount(0) // it's code, not a table
  await expect(editor(page)).toContainText("| a | b |") // raw pipes shown (as code)
})

test("clicking a cell edits directly in the table without revealing raw markdown and preserves untouched bytes", async ({
  page,
}) => {
  const initial =
    "| Name   | Count |\n| :----- | ----: |\n| Foo    | 42    |\n| Bar    | 7     |\n\nafter\n"
  await openNote(page, "t.md", initial)
  await expect(table(page)).toHaveCount(1)

  const target = cell(page, 0, 1)
  await target.click()
  // Table stays rendered as a table — no jump to raw pipes.
  await expect(table(page)).toHaveCount(1)
  await expect(target.locator(".cm-content")).toBeFocused()

  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("99")
  // Save explicitly to flush to disk immediately.
  await page.keyboard.press("ControlOrMeta+s")

  await expect(table(page)).toHaveCount(1)
  await expect(target).toHaveText("99")
  await expect
    .poll(() => readNote(page, "t.md"))
    .toBe(
      "| Name   | Count |\n| :----- | ----: |\n| Foo    | 99    |\n| Bar    | 7     |\n\nafter\n",
    )
})

test("Enter inserts a multiline <br> break inside a cell without an extra border around the cell", async ({
  page,
}) => {
  await openNote(page, "t.md", "| a | b |\n| --- | --- |\n| line 1 | 2 |\n\nafter\n")
  await expect(table(page)).toHaveCount(1)

  const target = cell(page, 0, 0)
  await target.click()
  const innerEditor = target.locator(".cm-editor")
  await expect(innerEditor).toHaveCSS("box-shadow", "none")
  await expect(innerEditor).toHaveCSS("outline-style", "none")

  await page.keyboard.press("End")
  await page.keyboard.press("Enter")
  await page.keyboard.type("line 2")
  await page.keyboard.press("ControlOrMeta+s")

  await expect(table(page)).toHaveCount(1)
  await expect(target.locator(".cm-line")).toHaveText(["line 1", "line 2"])
  await expect
    .poll(() => readNote(page, "t.md"))
    .toBe("| a | b |\n| --- | --- |\n| line 1<br>line 2 | 2 |\n\nafter\n")

  // Exiting the cell preserves both lines in display mode.
  await page.keyboard.press("Escape")
  await expect(target).toHaveText("line 1\nline 2")
})

test("keyboard navigation moves between cells, Tab on last cell adds a row, and Escape exits cleanly", async ({
  page,
}) => {
  await openNote(page, "t.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n")
  await expect(table(page)).toHaveCount(1)

  await cell(page, -1, 0).click()
  await page.keyboard.press("Tab")
  await expect(cell(page, -1, 1).locator(".cm-content")).toBeFocused()

  await page.keyboard.press("ArrowDown")
  await expect(cell(page, 0, 1).locator(".cm-content")).toBeFocused()

  await page.keyboard.press("Shift+Tab")
  await expect(cell(page, 0, 0).locator(".cm-content")).toBeFocused()

  await page.keyboard.press("Tab")
  await expect(cell(page, 0, 1).locator(".cm-content")).toBeFocused()

  // Tab on the very last cell inserts a new body row and focuses its first cell.
  await page.keyboard.press("Tab")
  await expect(cell(page, 1, 0).locator(".cm-content")).toBeFocused()
  await page.keyboard.type("3")
  await page.keyboard.press("Tab")
  await expect(cell(page, 1, 1).locator(".cm-content")).toBeFocused()
  await page.keyboard.type("4")
  await page.keyboard.press("ControlOrMeta+s")

  await expect
    .poll(() => readNote(page, "t.md"))
    .toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nafter\n")

  // Escape exits the cell without exploding the table into raw markdown.
  await page.keyboard.press("Escape")
  await expect(table(page)).toHaveCount(1)
  await expect(cell(page, 1, 1)).not.toHaveClass(/cm-table-cell-editing/)
})

test("Vim keybindings and cursors work properly inside table cells (Normal filled block + Insert visible caret)", async ({
  page,
}) => {
  await openNote(page, "t.md", "| a | b |\n| --- | --- |\n| hello | world |\n| foo | bar |\n\nafter\n")
  await expect(table(page)).toHaveCount(1)

  // Turn on Vim mode via Ctrl+;
  await page.keyboard.press("Control+;")
  await expect(page.locator("#editor > .cm-editor .cm-vimMode")).toBeVisible()

  // Clicking a cell opens it in Vim Normal mode with a solid filled block cursor (not hollow).
  const first = cell(page, 0, 0)
  await first.click()
  await expect(first.locator(".cm-vimMode")).toBeVisible()
  const fatCursor = first.locator(".cm-fat-cursor")
  await expect(fatCursor).toBeVisible()
  await expect(fatCursor).toHaveCSS("background-color", "rgb(255, 150, 150)")
  await expect(fatCursor).toHaveCSS("outline-style", "none")

  // Entering Insert mode shows the normal vertical caret (not hidden by outer .cm-vimMode).
  await page.keyboard.press("0")
  await page.keyboard.press("c")
  await page.keyboard.press("w")
  const insertCursorLayer = first.locator(".cm-cursorLayer:not(.cm-vimCursorLayer)")
  await expect(insertCursorLayer).toHaveCSS("display", "block")
  const insertCursor = first.locator(".cm-cursor-primary")
  await expect(insertCursor).toBeVisible()

  await page.keyboard.type("hi")
  // Plain Enter in Vim Insert mode adds a newline (<br>) inside the cell.
  await page.keyboard.press("Enter")
  await page.keyboard.type("second")
  await page.keyboard.press("Escape")
  await expect(first).toHaveClass(/cm-table-cell-editing/)

  // `j` on the bottom line of the cell moves down to row 1, col 0 in Normal mode.
  await page.keyboard.press("j")
  const below = cell(page, 1, 0)
  await expect(below).toHaveClass(/cm-table-cell-editing/)
  await page.keyboard.press("0")
  await page.keyboard.press("x") // deletes 'f' from "foo" -> "oo"

  await page.keyboard.press("ControlOrMeta+s")
  await expect
    .poll(() => readNote(page, "t.md"))
    .toBe("| a | b |\n| --- | --- |\n| hi<br>second | world |\n| oo | bar |\n\nafter\n")

  // Escape in clean Normal mode exits the table cleanly.
  await page.keyboard.press("Escape")
  await expect(table(page)).toHaveCount(1)
  await expect(below).not.toHaveClass(/cm-table-cell-editing/)
})

test("typing a literal pipe escapes it and Undo reverts inline cell edits", async ({ page }) => {
  await openNote(page, "t.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n")
  await expect(table(page)).toHaveCount(1)

  const target = cell(page, 0, 0)
  await target.click()
  await page.keyboard.press("ControlOrMeta+a")
  await page.keyboard.type("x | y")
  await page.keyboard.press("ControlOrMeta+s")

  await expect(table(page)).toHaveCount(1)
  await expect(target).toHaveText("x | y")
  await expect
    .poll(() => readNote(page, "t.md"))
    .toBe("| a | b |\n| --- | --- |\n| x \\| y | 2 |\n\nafter\n")

  await page.keyboard.press("ControlOrMeta+z")
  await page.keyboard.press("ControlOrMeta+s")
  await expect(target).toHaveText("1")
  await expect
    .poll(() => readNote(page, "t.md"))
    .toBe("| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n")
})

test("Ctrl/Cmd+Click and the source button reveal raw markdown at the targeted cell (AC-5)", async ({
  page,
}) => {
  await openNote(page, "t.md", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n")
  await expect(table(page)).toHaveCount(1)

  await cell(page, 0, 1).click({ modifiers: ["ControlOrMeta"] })

  await expect(table(page)).toHaveCount(0)
  await expect(editor(page)).toContainText("| --- | --- |")

  // Moving selection back out re-renders the table, and the </> button also reveals raw source.
  await editor(page).locator(".cm-line", { hasText: "after" }).click()
  await expect(table(page)).toHaveCount(1)

  await table(page).hover()
  await page.locator(".cm-table-source-btn").click()
  await expect(table(page)).toHaveCount(0)
  await expect(editor(page)).toContainText("| --- | --- |")
})

test("rendering and focusing without editing does not change the document bytes (AC-8)", async ({
  page,
}) => {
  const content = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n"
  await openNote(page, "t.md", content)
  await expect(table(page)).toHaveCount(1)
  await cell(page, 0, 0).click()
  await page.keyboard.press("Escape")
  await cell(page, 0, 0).click({ modifiers: ["ControlOrMeta"] })
  await expect(table(page)).toHaveCount(0)

  expect(await readNote(page, "t.md")).toBe(content) // byte-for-byte unchanged
})
