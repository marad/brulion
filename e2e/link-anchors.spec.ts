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

async function mdCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle("e2e-link-anchors-folder", { create: true })
    let n = 0
    // @ts-expect-error async iterator over a directory handle
    for await (const [name] of dir.entries()) if (name.endsWith(".md")) n++
    return n
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
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "go").click()

  await expect(editor(page)).toContainText("section two body") // switched to other
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0) // scrolled down to the heading
})

test("a wikilink with an anchor switches and scrolls (AC-2)", async ({ page }) => {
  await openWith(page, {
    "home.md": "home top\n\n[[other#section-two]]\n",
    "other.md": `other top\n\n${PAD}## Section two\n\nsection two body\n`,
  })
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "other").click()

  await expect(editor(page)).toContainText("section two body")
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0)
})

test("a same-note anchor scrolls within the open note, no switch (AC-3)", async ({ page }) => {
  await openWith(page, {
    "solo.md": `[jump](#here)\n\n${PAD}## Here\n\nhere body\n`,
  })
  await page.locator(".note-row", { hasText: "solo" }).click()
  expect(await scrollTop(page)).toBe(0) // starts at the top

  await link(page, "jump").click()

  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0) // scrolled to "Here"
  await expect(editor(page)).toContainText("here body") // same note
})

test("a missing target heading opens the note without scrolling, no error (AC-5)", async ({
  page,
}) => {
  await openWith(page, {
    "home.md": "home top\n\n[go](other.md#no-such-heading)\n",
    "other.md": `other top\n\n${PAD}## Section two\n\nsection two body\n`,
  })
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "go").click()

  await expect(editor(page)).toContainText("other top") // switched to other…
  expect(await scrollTop(page)).toBe(0) // …but no scroll (heading not found)
})

test("an external link's #fragment is kept and opens a tab, no in-editor scroll (AC-6)", async ({
  page,
}) => {
  await openWith(page, {
    "home.md": "home top\n\n[ext](https://example.com/p#frag)\n",
  })
  await page.locator(".note-row", { hasText: "home" }).click()

  await link(page, "ext").click()

  const clicked = await page.evaluate(() => (window as unknown as { __clicked: string[] }).__clicked)
  expect(clicked).toContain("https://example.com/p#frag") // fragment intact
  await expect(editor(page)).toContainText("home top") // still on home
})

test("anchored navigation writes no note files (AC-8)", async ({ page }) => {
  await openWith(page, {
    "home.md": "home top\n\n[go](other.md#section-two) [[other#section-two]]\n",
    "other.md": `other top\n\n${PAD}## Section two\n\nsection two body\n`,
  })
  const before = await mdCount(page)
  await page.locator(".note-row", { hasText: "home" }).click()
  await link(page, "go").click()
  await expect(editor(page)).toContainText("section two body")

  expect(await mdCount(page)).toBe(before)
})
