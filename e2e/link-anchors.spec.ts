import { test, expect, type Page } from "@playwright/test"

// FEAT-0061 (M32): section anchors in links — `[t](note#sec)` / `[[note#sec]]` /
// `[t](#sec)` resolve the note and scroll to the heading. Real scrolling + the real
// follow path need a browser, so these are e2e.

const FOLDER = "e2e-link-anchors-folder"
// Enough padding lines to push a heading well below the viewport, so a scroll to it
// is observable as scrollTop > 0.
const PAD = "padding line\n".repeat(40)

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
    // Record + neutralize programmatic anchor clicks (external links) so the test
    // needn't open a real tab.
    ;(window as unknown as { __clicked: string[] }).__clicked = []
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      ;(window as unknown as { __clicked: string[] }).__clicked.push(this.href)
    }
  }, FOLDER)
}

async function writeNote(page: Page, file: string, content: string) {
  await page.evaluate(
    async ([f, text]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f.includes("/") ? f.split("/")[0] : "e2e-link-anchors-folder", {
        create: true,
      })
      const handle = await dir.getFileHandle(f, { create: true })
      const w = await handle.createWritable()
      await w.write(text)
      await w.close()
    },
    [file, content] as const,
  )
}

async function mdSnapshot(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle("e2e-link-anchors-folder", { create: true })
    const files: Record<string, string> = {}
    // @ts-expect-error async iterator over a directory handle
    for await (const [name, handle] of dir.entries()) {
      if (name.endsWith(".md")) files[name] = await (handle as FileSystemFileHandle).getFile().then((file) => file.text())
    }
    return files
  })
}

const editor = (page: Page) => page.locator(".cm-content")
const link = (page: Page, text: string) => page.locator(".cm-link", { hasText: text })
const scrollTop = (page: Page) => page.locator(".cm-scroller").evaluate((el) => el.scrollTop)

async function openWith(page: Page, files: Record<string, string>) {
  await stubPicker(page)
  await page.goto("/brulion/")
  for (const [name, content] of Object.entries(files)) await writeNote(page, name, content)
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(Object.keys(files).length)
}

test("a markdown link with an anchor switches to the note and scrolls to the heading (AC-1)", async ({
  page,
}) => {
  await openWith(page, {
    "home.md": "home top\n\n[go](other.md#section-two)\n",
    "other.md": `other top\n\n${PAD}## Section two\n\nsection two body\n`,
  })
  const before = await mdSnapshot(page)
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "go").click()

  await expect(editor(page)).toContainText("section two body") // switched to other
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0) // scrolled down to the heading
  expect(await mdSnapshot(page)).toEqual(before)
})

test("a wikilink with an anchor switches and scrolls (FEAT-0061 regression)", async ({ page }) => {
  await openWith(page, {
    "home.md": "home top\n\n[[other#section-two]]\n",
    "other.md": `other top\n\n${PAD}## Section two\n\nsection two body\n`,
  })
  const before = await mdSnapshot(page)
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "other").click()

  await expect(editor(page)).toContainText("section two body")
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0)
  expect(await mdSnapshot(page)).toEqual(before)
})

test("a same-note anchor scrolls within the open note, no switch (AC-2)", async ({ page }) => {
  await openWith(page, {
    "other.md": "other note\n",
    "solo.md": `[jump](#here)\n\n${PAD}## Here\n\nhere body\n`,
  })
  await page.locator(".note-row", { hasText: "solo" }).click()
  expect(await scrollTop(page)).toBe(0) // starts at the top

  const before = await mdSnapshot(page)
  await link(page, "jump").click()

  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0) // scrolled to "Here"
  await expect(editor(page)).toContainText("here body") // same note
  await expect(page.locator(".note-row.active .note-name")).toHaveText("solo")
  expect(await mdSnapshot(page)).toEqual(before)
})

test("a missing target heading opens the note without scrolling, no error (AC-3)", async ({
  page,
}) => {
  await openWith(page, {
    "home.md": "home top\n\n[go](other.md#no-such-heading)\n",
    "other.md": `other top\n\n${PAD}## Section two\n\nsection two body\n`,
  })
  const before = await mdSnapshot(page)
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "go").click()

  await expect(editor(page)).toContainText("other top") // switched to other…
  expect(await scrollTop(page)).toBe(0) // …but no scroll (heading not found)
  await expect(page.locator("#dialog-backdrop")).toBeHidden()
  await expect(page.locator("#conflict-backdrop")).toBeHidden()
  await expect(page.locator(".missing-note-banner")).toBeHidden()
  expect(await mdSnapshot(page)).toEqual(before)
})

test("an external link's #fragment is kept and opens a tab, no in-editor scroll (AC-4)", async ({
  page,
}) => {
  await openWith(page, {
    "home.md": "home top\n\n[ext](https://example.com/p#frag)\n",
  })
  const before = await mdSnapshot(page)
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "ext").click()

  const clicked = await page.evaluate(() => (window as unknown as { __clicked: string[] }).__clicked)
  expect(clicked).toContain("https://example.com/p#frag") // fragment intact
  await expect(editor(page)).toContainText("home top") // still on home
  expect(await scrollTop(page)).toBe(0) // external navigation does not scroll the editor
  expect(await mdSnapshot(page)).toEqual(before)
})

test("anchored navigation writes no note files (AC-5)", async ({ page }) => {
  await openWith(page, {
    "home.md": "home top\n\n[go](other.md#section-two) [[other#section-two]]\n",
    "other.md": `other top\n\n${PAD}## Section two\n\nsection two body\n`,
  })
  const before = await mdSnapshot(page)
  await page.locator(".note-row", { hasText: "home" }).click()
  await link(page, "go").click()
  await expect(editor(page)).toContainText("section two body")

  expect(await mdSnapshot(page)).toEqual(before)
})

test("same-note anchors participate in browser Back/Forward and restore the scroll position (AC-6)", async ({
  page,
}) => {
  await openWith(page, {
    "solo.md": `[jump](#here)\n\n${PAD}## Here\n\nhere body\n`,
  })
  await page.locator(".note-row", { hasText: "solo" }).click()
  expect(await scrollTop(page)).toBe(0)

  await link(page, "jump").click()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/solo#here")
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0)

  await page.goBack()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/solo")
  await expect.poll(() => scrollTop(page)).toBe(0)

  await page.goForward()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/solo#here")
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0)
})

test("cross-note anchors keep the note and section together in history (AC-6)", async ({ page }) => {
  await openWith(page, {
    "home.md": "home top\n\n[go](other.md#section-two)\n",
    "other.md": `other top\n\n${PAD}## Section two\n\nsection two body\n`,
  })
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "go").click()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/other#section-two")
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0)

  await page.goBack()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/home")
  await expect(editor(page)).toContainText("home top")
  await expect.poll(() => scrollTop(page)).toBe(0)

  await page.goForward()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/other#section-two")
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0)
})

test("rapid Back/Forward route changes cannot let a stale note switch win (AC-6)", async ({ page }) => {
  await openWith(page, {
    "home.md": "home top\n",
    "other.md": `${"slow content\\n".repeat(20000)}other body\\n`,
  })
  await page.locator(".note-row", { hasText: "home" }).click()

  await page.evaluate(() => {
    location.hash = "#/other"
    location.hash = "#/home"
  })

  await expect.poll(() => page.evaluate(() => location.hash)).toBe("#/home")
  await expect.poll(() => page.locator(".note-row.active .note-name").textContent()).toBe("home")
  await expect(editor(page)).toContainText("home top")
})
