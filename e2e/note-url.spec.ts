import { test, expect, type Page } from "@playwright/test"

// FEAT-0036: the open note mirrors into a `#/path` hash route, so the browser's
// own Back/Forward walks visit history and a `#/…` URL is a bookmark. Exercised
// against a real OPFS-backed folder handle and the real History API.
const FOLDER = "e2e-note-url-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeNote(page: Page, name: string, text: string) {
  await page.evaluate(
    async ([folder, file, content]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(folder, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
    },
    [FOLDER, name, text] as const,
  )
}

const display = (page: Page) => page.locator("#note-identity .note-identity-display")
const renameInput = (page: Page) => page.locator("#note-identity .note-identity-edit")
const row = (page: Page, name: string) => page.locator(".note-row", { hasText: name })
const hash = (page: Page) => page.evaluate(() => location.hash)
const banner = (page: Page) => page.locator(".missing-note-banner")
const bannerCreate = (page: Page) => page.locator(".missing-note-create")
const bannerDismiss = (page: Page) => page.locator(".missing-note-dismiss")

// Two root-level notes; `alpha` sorts first, so it is the active note on a fresh
// open (no persisted active, no start.md).
async function openWithTwoNotes(page: Page) {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "alpha.md", "alpha body")
  await writeNote(page, "beta.md", "beta body")
  await page.locator("#open-folder").click()
  await expect(display(page)).toContainText("alpha")
}

test("opening a note mirrors it into the URL hash (AC-5)", async ({ page }) => {
  await openWithTwoNotes(page)
  await expect.poll(() => hash(page)).toBe("#/alpha")

  await row(page, "beta").click()
  await expect(display(page)).toContainText("beta")
  await expect.poll(() => hash(page)).toBe("#/beta")
})

test("Back returns to the prior note, Forward re-opens it (AC-6, AC-7)", async ({ page }) => {
  await openWithTwoNotes(page)
  await row(page, "beta").click()
  await expect.poll(() => hash(page)).toBe("#/beta")

  await page.goBack()
  await expect(display(page)).toContainText("alpha")
  await expect.poll(() => hash(page)).toBe("#/alpha")

  await page.goForward()
  await expect(display(page)).toContainText("beta")
  await expect.poll(() => hash(page)).toBe("#/beta")
})

test("a missing-note hash raises a banner and does not switch or create (AC-8, AC-13)", async ({
  page,
}) => {
  await openWithTwoNotes(page)
  await page.evaluate(() => {
    location.hash = "#/ghost"
  })
  // The open note does not change, no note is created, but the banner names ghost.
  await expect(banner(page)).toBeVisible()
  await expect(banner(page)).toContainText("ghost")
  await expect(display(page)).toContainText("alpha")
  await expect(row(page, "ghost")).toHaveCount(0)
  await expect.poll(() => hash(page)).toBe("#/ghost") // hash names the create target
})

test("the banner's Create button makes the note and opens it (AC-14)", async ({ page }) => {
  await openWithTwoNotes(page)
  await page.evaluate(() => {
    location.hash = "#/ghost"
  })
  await expect(banner(page)).toBeVisible()

  await bannerCreate(page).click()
  await expect(display(page)).toContainText("ghost")
  await expect(banner(page)).toBeHidden()
  await expect(row(page, "ghost")).toHaveClass(/active/)
  await expect.poll(() => hash(page)).toBe("#/ghost") // now names a real note
})

test("dismissing the banner re-syncs the URL to the open note (AC-15)", async ({ page }) => {
  await openWithTwoNotes(page)
  await page.evaluate(() => {
    location.hash = "#/ghost"
  })
  await expect(banner(page)).toBeVisible()

  await bannerDismiss(page).click()
  await expect(banner(page)).toBeHidden()
  await expect(display(page)).toContainText("alpha") // still on alpha, nothing created
  await expect(row(page, "ghost")).toHaveCount(0)
  await expect.poll(() => hash(page)).toBe("#/alpha") // URL no longer names an absent note
})

test("a malformed hash raises no banner and does not switch (AC-16)", async ({ page }) => {
  await openWithTwoNotes(page)
  await page.evaluate(() => {
    location.hash = "#/a//b"
  })
  await expect(display(page)).toContainText("alpha")
  await expect(banner(page)).toBeHidden()
})

test("a bookmarked missing hash on load opens the fallback and banners (AC-13 on load)", async ({
  page,
}) => {
  await openWithTwoNotes(page) // persists alpha as active; folder now has alpha + beta
  await page.goto("/brulion/#/ghost")
  // Fallback note opens (the persisted alpha), the banner names ghost, and the bar
  // keeps the bookmark hash (the create target).
  await expect(display(page)).toContainText("alpha")
  await expect(banner(page)).toBeVisible()
  await expect(banner(page)).toContainText("ghost")
  await expect.poll(() => hash(page)).toBe("#/ghost")
})

test("a bookmarked hash opens that note on load, beating the persisted active (AC-9, AC-10)", async ({
  page,
}) => {
  // First session: open the folder and switch to alpha so it is persisted active.
  await openWithTwoNotes(page)
  await row(page, "alpha").click()
  await expect(display(page)).toContainText("alpha")

  // Reload with a bookmark to beta. The folder silently re-attaches (OPFS handle
  // in idb), then the hash beats the persisted alpha.
  await page.goto("/brulion/#/beta")
  await expect(display(page)).toContainText("beta")
  await expect.poll(() => hash(page)).toBe("#/beta")
})

test("renaming the open note replaces the dead URL entry, so Back stays consistent (AC-12)", async ({
  page,
}) => {
  await openWithTwoNotes(page)
  await row(page, "beta").click() // push #/beta over #/alpha
  await expect.poll(() => hash(page)).toBe("#/beta")

  // Rename beta → gamma from the header. The old #/beta entry now names a vanished
  // note, so the mirror must REPLACE it (not push) — else Back lands on a dead note.
  await display(page).click()
  await renameInput(page).fill("gamma")
  await renameInput(page).press("Enter")
  await expect(display(page)).toContainText("gamma")
  await expect.poll(() => hash(page)).toBe("#/gamma")

  // Back goes to alpha (the genuine prior note), URL and open note agreeing — not
  // a phantom #/beta with gamma still open.
  await page.goBack()
  await expect(display(page)).toContainText("alpha")
  await expect.poll(() => hash(page)).toBe("#/alpha")
})

test("no hash falls back to the persisted/seed note (AC-11)", async ({ page }) => {
  await openWithTwoNotes(page)
  // No hash given on this fresh open: the first-sorted note (alpha) opens, exactly
  // as before this feature, and the URL settles to mirror it.
  await expect(display(page)).toContainText("alpha")
  await expect.poll(() => hash(page)).toBe("#/alpha")
})
