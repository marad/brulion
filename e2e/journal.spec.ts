import { test, expect, type Page } from "@playwright/test"

// FEAT-0062 (M31): the "Open this week's journal" action — expand a configured
// journalPath template against today and open it. Real settings round-trip + the
// real open/create path need a browser.

const FOLDER = "e2e-journal-folder"

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

async function noteExists(page: Page, file: string): Promise<boolean> {
  return await page.evaluate(
    async ([folder, name]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      try {
        await dir.getFileHandle(name)
        return true
      } catch {
        return false
      }
    },
    [FOLDER, file] as const,
  )
}

// This week's Monday, ISO — the same computation the app does, evaluated at test time
// so the expected filename tracks the real current date.
function mondayIso(): string {
  const d = new Date()
  const off = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - off)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const editor = (page: Page) => page.locator(".cm-content")

async function setJournalPath(page: Page, value: string) {
  await page.locator("#open-settings").click()
  await page.locator(".settings-journal").fill(value) // fill fires input → persists
  await page.locator(".settings-close").click()
}

async function runJournalAction(page: Page) {
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("this week")
  await page.locator(".palette-row").first().click()
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "start.md", "start body")
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(1)
})

test("the action is listed in the palette (AC-7)", async ({ page }) => {
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("this week")
  await expect(page.locator(".palette-row").first()).toContainText("Open this week's journal")
})

test("opens an existing journal note for this week (AC-2, AC-4)", async ({ page }) => {
  const file = `${mondayIso()}.md`
  await writeNote(page, file, "this week's journal")
  await page.reload()
  await expect(page.locator(".note-row")).toHaveCount(2)
  await setJournalPath(page, "{mondayOfTheWeek}")

  await runJournalAction(page)

  await expect(editor(page)).toHaveText("this week's journal")
})

test("a missing journal note routes through the create-on-miss prompt (AC-5)", async ({ page }) => {
  await setJournalPath(page, "{mondayOfTheWeek}")
  page.on("dialog", (d) => d.accept()) // accept the "doesn't exist — create it?" confirm

  await runJournalAction(page)

  expect(await noteExists(page, `${mondayIso()}.md`)).toBe(true) // created via the existing flow
})

test("an empty journalPath opens settings instead of navigating (AC-6)", async ({ page }) => {
  // journalPath is unset by default.
  await runJournalAction(page)

  await expect(page.locator("#settings-backdrop")).toBeVisible()
  await expect(editor(page)).toHaveText("start body") // no navigation happened
})
