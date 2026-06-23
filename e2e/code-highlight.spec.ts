import { test, expect, type Page } from "@playwright/test"

// M15 P1 (FEAT-0049): fenced code blocks get syntax colors driven by the info
// string; unknown/blank info strings stay plain; the bytes are never rewritten.

const FOLDER = "e2e-code-highlight"

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

// Distinct CSS colors among the token <span>s inside the code box. A highlighted
// block yields several differently-colored spans; a plain one yields ≤1.
function distinctSpanColors(page: Page) {
  return page.evaluate(() => {
    const spans = document.querySelectorAll(".cm-code-block span")
    const colors = new Set<string>()
    for (const s of spans) colors.add(getComputedStyle(s).color)
    return colors.size
  })
}

const JS_BLOCK = '```js\nconst greeting = "hello";\nlet count = 42;\n```\n'
const UNKNOWN_BLOCK = "```nope\nconst z = 1;\n```\n"

test("a fenced js block shows multiple colored token spans (AC-2)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, "start.md", JS_BLOCK)
  await page.locator("#open-folder").click()
  await expect(page.locator(".cm-code-block").first()).toBeVisible()

  // The language parser loads lazily; once it resolves the tokens get >1 distinct
  // colors. Auto-retry past the dynamic import.
  await expect.poll(() => distinctSpanColors(page), { timeout: 7000 }).toBeGreaterThan(1)
})

test("prose escapes and HTML comments are not recolored (AC-4)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  // Prose only — backslash escapes and an HTML comment share highlight tags with
  // code (escape/comment), but must stay plain: no token marks outside code blocks.
  await seedNote(page, "start.md", "Use \\*literal\\* stars.\n\n<!-- a private note -->\n")
  await page.locator("#open-folder").click()
  await expect(page.locator(".cm-content")).toBeVisible()
  await page.waitForTimeout(1000)

  expect(await page.locator('.cm-content span[class*="tok-"]').count()).toBe(0)
})

test("an unknown info string stays plain (AC-3)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, "start.md", UNKNOWN_BLOCK)
  await page.locator("#open-folder").click()
  await expect(page.locator(".cm-code-block").first()).toBeVisible()

  // Give any (non-existent) parser the same chance to load, then assert no coloring.
  await page.waitForTimeout(1500)
  expect(await distinctSpanColors(page)).toBeLessThanOrEqual(1)
})

test("highlighting never rewrites the bytes (AC-5)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedNote(page, "start.md", JS_BLOCK)
  await page.locator("#open-folder").click()
  await expect(page.locator(".cm-code-block").first()).toBeVisible()
  await expect.poll(() => distinctSpanColors(page), { timeout: 7000 }).toBeGreaterThan(1)

  // The source on disk is byte-identical to what was seeded — highlighting is paint
  // only, and a save (Ctrl+S) round-trips the same bytes.
  await page.locator(".cm-content").click()
  await page.keyboard.press("Control+s")
  await expect.poll(() => readNote(page, "start.md")).toBe(JS_BLOCK)
})
