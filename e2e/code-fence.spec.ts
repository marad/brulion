import { test, expect, type Page } from "@playwright/test"

// FEAT-0064 (M29): a fenced block's fence lines reveal for editing when the caret is
// inside the block, and re-hide when it leaves. Real CodeMirror decorations + caret.

const FOLDER = "e2e-code-fence-folder"

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

async function readNote(page: Page, file: string): Promise<string> {
  return await page.evaluate(
    async ([folder, name]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      return await (await (await dir.getFileHandle(name)).getFile()).text()
    },
    [FOLDER, file] as const,
  )
}

const editor = (page: Page) => page.locator(".cm-content")

async function openNote(page: Page, file: string, content: string) {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, file, content)
  await page.locator("#open-folder").click()
  await page.locator(".note-row", { hasText: file.replace(".md", "") }).click()
}

test("fences are hidden until the caret enters, then revealed; re-hidden on leave (AC-1, AC-2, AC-5)", async ({
  page,
}) => {
  await openNote(page, "t.md", "intro\n\n```js\nconst x = 1\n```\n\nmore\n")

  // Caret starts on the note's first line — outside the block: fences hidden.
  await expect(editor(page)).not.toContainText("```js")

  // Click into the block (on the code body) → reveal.
  await editor(page).getByText("const x = 1").click()
  await expect(editor(page)).toContainText("```js")
  await expect(editor(page)).toContainText("```") // closing fence too

  // Move the caret out → re-hidden.
  await editor(page).getByText("more").click()
  await expect(editor(page)).not.toContainText("```js")
})

test("the info string is editable in place (AC-3)", async ({ page }) => {
  await openNote(page, "t.md", "```js\ncode\n```\n\nafter\n")

  await editor(page).getByText("code").click() // reveal
  await expect(editor(page)).toContainText("```js")
  // Put the caret at the end of the ```js line and type to make it ```jsx.
  await editor(page).getByText("```js").click()
  await page.keyboard.press("End")
  await page.keyboard.type("x")

  await expect(editor(page)).toContainText("```jsx")
  await editor(page).getByText("after").click() // leave — re-renders without crashing
  await expect(editor(page)).not.toContainText("```jsx")
})

test("a Mermaid block reveals its ```mermaid fence with its source (AC-6)", async ({ page }) => {
  await openNote(page, "t.md", "intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nmore\n")
  // Outside: the diagram (or its error box) renders, fence hidden.
  await expect(editor(page)).not.toContainText("```mermaid")

  await page.locator(".cm-mermaid").click() // click the rendered block → caret inside, reveal
  await expect(editor(page)).toContainText("```mermaid")
})

test("revealing and hiding the fences does not change the bytes (AC-7)", async ({ page }) => {
  const content = "intro\n\n```js\nconst x = 1\n```\n\nmore\n"
  await openNote(page, "t.md", content)
  await editor(page).getByText("const x = 1").click() // reveal
  await expect(editor(page)).toContainText("```js")
  await editor(page).getByText("more").click() // hide

  expect(await readNote(page, "t.md")).toBe(content)
})
