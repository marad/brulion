import { test, expect, type Page } from "@playwright/test"

// M28 P1 (FEAT-0056): a closed ```mermaid fenced block renders as a diagram; the
// engine is lazy-loaded; selecting inside reveals the raw source; an invalid diagram
// shows an in-place error; the bytes are never rewritten.

const FOLDER = "e2e-mermaid"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function seedNote(page: Page, name: string, content: string) {
  await page.evaluate(
    async ([folder, file, body]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const w = await handle.createWritable()
      await w.write(body)
      await w.close()
    },
    [FOLDER, name, content] as const,
  )
}

async function readNote(page: Page, name: string): Promise<string> {
  return await page.evaluate(
    async ([folder, file]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      return await (await (await dir.getFileHandle(file)).getFile()).text()
    },
    [FOLDER, name] as const,
  )
}

const FLOWCHART = "intro prose\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nafter prose\n"
const INVALID = "```mermaid\nnot a real diagram !!!\n```\n"
const PLAIN = "# Just prose\n\nNo diagrams here.\n"

// A request that pulls in the Mermaid LIBRARY (the lazy dynamic import). Excludes our
// own statically-imported source modules (`/src/mermaid-*.ts`, served by name in dev)
// so the signal is the engine actually loading, not the wrapper code.
const isMermaidChunk = (url: string) => /mermaid|flowdiagram/i.test(url) && !url.includes("/src/")

test("a valid ```mermaid block renders an SVG diagram (AC-1)", async ({ page }) => {
  // Catch any uncaught error during render — notably a CodeMirror decoration conflict
  // between this block-replace field and markdown-render's block field over the same
  // range (the two-field coexistence is only observable in a live editor).
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(String(e)))

  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, "start.md", FLOWCHART)
  await page.locator("#open-folder").click()
  // The engine loads lazily; once it resolves the diagram appears as an SVG.
  await expect(page.locator(".cm-mermaid svg")).toBeVisible({ timeout: 10000 })
  expect(errors).toEqual([])
})

test("rendering never rewrites the bytes (AC-2)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, "start.md", FLOWCHART)
  await page.locator("#open-folder").click()
  await expect(page.locator(".cm-mermaid svg")).toBeVisible({ timeout: 10000 })

  // Source on disk is byte-identical, and a save round-trips the same bytes.
  await page.locator(".cm-content").click()
  await page.keyboard.press("Control+s")
  await expect.poll(() => readNote(page, "start.md")).toBe(FLOWCHART)
})

test("selecting inside the block reveals the raw source, leaving re-renders (AC-3)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, "start.md", FLOWCHART)
  await page.locator("#open-folder").click()
  await expect(page.locator(".cm-mermaid svg")).toBeVisible({ timeout: 10000 })

  // Click the diagram → caret enters the block → raw fenced source is revealed.
  await page.locator(".cm-mermaid").click()
  await expect(page.locator(".cm-mermaid")).toHaveCount(0)
  await expect(page.locator(".cm-content")).toContainText("flowchart TD")

  // Move the caret out (click the trailing prose) → the diagram renders again.
  await page.getByText("after prose").click()
  await expect(page.locator(".cm-mermaid svg")).toBeVisible({ timeout: 10000 })
})

test("an invalid diagram shows an in-place error, editor keeps working (AC-5)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, "start.md", INVALID)
  await page.locator("#open-folder").click()
  await expect(page.locator(".cm-mermaid-error")).toBeVisible({ timeout: 10000 })
  // The editor is still interactive (the error didn't break the view).
  await page.locator(".cm-content").click()
  await expect(page.locator(".cm-content")).toBeVisible()
})

test("the Mermaid engine is loaded lazily (AC-6)", async ({ page }) => {
  const requested: string[] = []
  page.on("request", (r) => requested.push(r.url()))

  await stubPicker(page)
  await page.goto("/brulion/")
  // Seed both notes before opening, so the switcher sees the diagram note (a note
  // written after open wouldn't be in the list yet → create-on-miss opens it empty).
  await seedNote(page, "start.md", PLAIN)
  await seedNote(page, "diagram.md", FLOWCHART)
  await page.locator("#open-folder").click()

  // The default note ("start") has no Mermaid block → the engine must not load.
  await expect(page.locator(".cm-content")).toContainText("Just prose")
  await page.waitForTimeout(1500)
  expect(requested.some(isMermaidChunk)).toBe(false)

  // Switching to the diagram note fetches the engine chunk on demand.
  await page.locator("#sidebar-search").click()
  await page.locator("#switcher-input").fill("diagram")
  await page.locator("#switcher-input").press("Enter")
  await expect(page.locator(".cm-mermaid svg")).toBeVisible({ timeout: 10000 })
  expect(requested.some(isMermaidChunk)).toBe(true)
})
