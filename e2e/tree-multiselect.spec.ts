import { test, expect, type Page } from "@playwright/test"

// M37/FEAT-0078: multi-select in the sidebar tree + batch delete/move. Real
// Chromium is needed for genuine Ctrl+click selection, the context menu, the
// confirm dialog, and real on-disk moves/deletes (via an OPFS-backed handle).
const FOLDER = "e2e-tree-multiselect-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeNote(page: Page, path: string, content: string) {
  await page.evaluate(
    async ([folder, rel, text]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      const segments = rel.split("/")
      for (const seg of segments.slice(0, -1)) dir = await dir.getDirectoryHandle(seg, { create: true })
      const handle = await dir.getFileHandle(segments[segments.length - 1], { create: true })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
    [FOLDER, path, content] as const,
  )
}

async function entriesOf(page: Page, subPath: string): Promise<string[]> {
  return page.evaluate(
    async ([folder, sub]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder)
      for (const seg of sub ? sub.split("/") : []) dir = await dir.getDirectoryHandle(seg)
      const names: string[] = []
      // @ts-expect-error async iterator on the directory handle
      for await (const [name] of dir.entries()) names.push(name)
      return names.sort()
    },
    [FOLDER, subPath] as const,
  )
}

const noteName = (page: Page, name: string) => page.locator(".note-name", { hasText: name })

test("Ctrl+click two notes, Delete + confirm removes both (FEAT-0078/AC-3, AC-7)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "a.md", "aa")
  await writeNote(page, "b.md", "bb")
  await writeNote(page, "c.md", "cc")
  await page.locator("#open-folder").click()
  await expect(noteName(page, "a")).toBeVisible()

  await noteName(page, "a").click({ modifiers: ["Control"] })
  await noteName(page, "b").click({ modifiers: ["Control"] })
  await expect(noteName(page, "a")).toHaveAttribute("aria-selected", "true")
  await expect(noteName(page, "b")).toHaveAttribute("aria-selected", "true")

  await page.keyboard.press("Delete")
  await page.locator("#dialog-confirm").click()

  await expect(noteName(page, "a")).toHaveCount(0)
  await expect(noteName(page, "b")).toHaveCount(0)
  await expect(noteName(page, "c")).toBeVisible()
  expect(await entriesOf(page, "")).toEqual(["c.md"])
})

test("select two notes, batch-move via the menu relocates both (FEAT-0078/AC-8)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "a.md", "aa")
  await writeNote(page, "b.md", "bb")
  await writeNote(page, "dest/keep.md", "keep") // materializes the "dest" folder
  await page.locator("#open-folder").click()
  await expect(noteName(page, "a")).toBeVisible()

  await noteName(page, "a").click({ modifiers: ["Control"] })
  await noteName(page, "b").click({ modifiers: ["Control"] })

  await noteName(page, "a").click({ button: "right" }) // context menu on a selected row
  await page
    .locator(".cm-context-menu button[role=menuitem]", { hasText: "Move 2 items" })
    .click()

  await page.locator(".move-row", { hasText: "dest" }).click() // pick the destination

  // Both notes now live under dest/ and are gone from the root.
  await expect.poll(() => entriesOf(page, "dest")).toEqual(["a.md", "b.md", "keep.md"])
  expect(await entriesOf(page, "")).toEqual(["dest"])
})

test("a batch move where one item conflicts still moves the rest (FEAT-0078/AC-9)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "a.md", "aa")
  await writeNote(page, "b.md", "bb")
  await writeNote(page, "dest/a.md", "already here") // a name clash for a.md only
  await page.locator("#open-folder").click()
  // "a" alone would match both a.md and dest/a.md — address the root notes by path.
  const rootA = page.locator('.note-name[data-path="a.md"]')
  const rootB = page.locator('.note-name[data-path="b.md"]')
  await expect(rootA).toBeVisible()

  await rootA.click({ modifiers: ["Control"] })
  await rootB.click({ modifiers: ["Control"] })
  await rootA.click({ button: "right" })
  await page
    .locator(".cm-context-menu button[role=menuitem]", { hasText: "Move 2 items" })
    .click()
  await page.locator(".move-row", { hasText: "dest" }).click()

  // b.md moved in; a.md was refused (won't clobber the existing dest/a.md) but did
  // not abort the batch — it stays at the root.
  await expect.poll(() => entriesOf(page, "dest")).toEqual(["a.md", "b.md"])
  await expect.poll(() => entriesOf(page, "")).toEqual(["a.md", "dest"])
})

test("batch delete of a folder and a note inside it, child selected first (FEAT-0078/AC-7, order)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "keep.md", "keep")
  await writeNote(page, "sub/x.md", "xx")
  await page.locator("#open-folder").click()
  const subHeader = page.locator(".folder-header", { hasText: "sub" })
  await expect(subHeader).toBeVisible()

  await subHeader.click() // expand (no selection yet → plain click)
  await expect(noteName(page, "x")).toBeVisible()
  await noteName(page, "x").click({ modifiers: ["Control"] }) // select the child first…
  await subHeader.click({ modifiers: ["Control"] }) // …then its parent folder
  await page.keyboard.press("Delete")
  await page.locator("#dialog-confirm").click()

  // The folder (and its note) are gone; runBatch processes the parent first
  // despite the child being selected first, so nothing is stranded.
  await expect.poll(() => entriesOf(page, "")).toEqual(["keep.md"])
})

test("batch delete reports an externally-vanished item and removes the rest (FEAT-0078/AC-9)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "a.md", "aa")
  await writeNote(page, "b.md", "bb")
  await writeNote(page, "keep.md", "keep")
  await page.locator("#open-folder").click()
  const rootA = page.locator('.note-name[data-path="a.md"]')
  const rootB = page.locator('.note-name[data-path="b.md"]')
  await expect(rootA).toBeVisible()

  await rootA.click({ modifiers: ["Control"] })
  await rootB.click({ modifiers: ["Control"] })

  // Remove a.md out from under the app; wait for the poll to drop its row.
  await page.evaluate(async (folder) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(folder)
    await dir.removeEntry("a.md")
  }, FOLDER)
  await expect(rootA).toHaveCount(0)

  await rootB.focus()
  await page.keyboard.press("Delete")
  await page.locator("#dialog-confirm").click() // confirm the delete
  // The vanished a.md is reported (not silently swallowed); b.md is deleted.
  await expect(page.locator("#dialog-message")).toContainText("no longer exists")
  await page.locator("#dialog-confirm").click() // dismiss the alert
  await expect.poll(() => entriesOf(page, "")).toEqual(["keep.md"])
})

test("batch-moving a folder and a note inside it moves the folder as a unit (FEAT-0078/AC-8)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "sub/x.md", "xx")
  await writeNote(page, "dest/keep.md", "keep")
  await page.locator("#open-folder").click()
  const subHeader = page.locator(".folder-header", { hasText: "sub" })
  await expect(subHeader).toBeVisible()

  await subHeader.click() // expand (no selection yet)
  await page.locator('.note-name[data-path="sub/x.md"]').click({ modifiers: ["Control"] })
  await subHeader.click({ modifiers: ["Control"] }) // select folder + its child
  await subHeader.click({ button: "right" })
  await page
    .locator(".cm-context-menu button[role=menuitem]", { hasText: "Move 2 items" })
    .click()
  await page.locator(".move-row", { hasText: "dest" }).click()

  // The folder moved as a unit; the child was never extracted independently
  // (no stray dest/x.md), which the descendant-filter guards.
  await expect.poll(() => entriesOf(page, "dest")).toEqual(["keep.md", "sub"])
  await expect.poll(() => entriesOf(page, "dest/sub")).toEqual(["x.md"])
  await expect.poll(() => entriesOf(page, "")).toEqual(["dest"])
})

test("a refused folder move does not extract a co-selected child (FEAT-0078 selectionRoots)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "sub/x.md", "xx")
  await writeNote(page, "sub/inner/keep.md", "keep")
  await page.locator("#open-folder").click()
  const subHeader = page.locator(".folder-header", { hasText: "sub" })
  await expect(subHeader).toBeVisible()

  // sub may already be expanded (it's an ancestor of the auto-opened note); only
  // click to expand if it's collapsed, so we never accidentally collapse it.
  if ((await subHeader.getAttribute("aria-expanded")) === "false") await subHeader.click()
  const childX = page.locator('.note-name[data-path="sub/x.md"]')
  await expect(childX).toBeVisible()
  await childX.click({ modifiers: ["Control"] })
  await subHeader.click({ modifiers: ["Control"] }) // select folder sub + its child
  await subHeader.click({ button: "right" })
  await page
    .locator(".cm-context-menu button[role=menuitem]", { hasText: "Move 2 items" })
    .click()
  // Try to move sub into its own subfolder — moveFolder refuses (self-nest). The
  // co-selected child must NOT then be moved on its own into sub/inner.
  await page.locator(".move-row", { hasText: "sub/inner" }).click()

  await expect.poll(() => entriesOf(page, "sub")).toEqual(["inner", "x.md"]) // sub unchanged
  await expect.poll(() => entriesOf(page, "sub/inner")).toEqual(["keep.md"]) // no extracted x.md
})

test("a batch move keeps the note you had open (FEAT-0078)", async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "x.md", "x body")
  await writeNote(page, "a.md", "aa")
  await writeNote(page, "b.md", "bb")
  await writeNote(page, "dest/keep.md", "keep")
  await page.locator("#open-folder").click()
  await expect(noteName(page, "x")).toBeVisible()

  await noteName(page, "x").click() // open x (not part of the selection)
  await expect(page.locator("#editor .cm-content")).toContainText("x body")

  await noteName(page, "a").click({ modifiers: ["Control"] })
  await noteName(page, "b").click({ modifiers: ["Control"] })
  await noteName(page, "a").click({ button: "right" })
  await page
    .locator(".cm-context-menu button[role=menuitem]", { hasText: "Move 2 items" })
    .click()
  await page.locator(".move-row", { hasText: "dest" }).click()

  await expect.poll(() => entriesOf(page, "dest")).toEqual(["a.md", "b.md", "keep.md"])
  // The editor was not yanked to the last moved note — x is still open.
  await expect(page.locator("#editor .cm-content")).toContainText("x body")
})

test("a failed move of the open note never opens a foreign same-named note (FEAT-0078)", async ({
  page,
}) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await writeNote(page, "a.md", "my a")
  await writeNote(page, "b.md", "bb")
  await writeNote(page, "dest/a.md", "foreign a") // a.md can't move here (name clash)
  await page.locator("#open-folder").click()
  const rootA = page.locator('.note-name[data-path="a.md"]')
  const rootB = page.locator('.note-name[data-path="b.md"]')
  await expect(rootA).toBeVisible()

  await rootA.click() // open the root a.md
  await expect(page.locator("#editor .cm-content")).toContainText("my a")

  await rootA.click({ modifiers: ["Control"] })
  await rootB.click({ modifiers: ["Control"] })
  await rootA.click({ button: "right" })
  await page
    .locator(".cm-context-menu button[role=menuitem]", { hasText: "Move 2 items" })
    .click()
  await page.locator(".move-row", { hasText: "dest" }).click()

  // a.md's move was refused, so it stays open showing its own content — the
  // restore must never switch to the pre-existing dest/a.md ("foreign a").
  await expect.poll(() => entriesOf(page, "")).toEqual(["a.md", "dest"])
  await expect(page.locator("#editor .cm-content")).toContainText("my a")
  await expect(page.locator("#editor .cm-content")).not.toContainText("foreign a")
})
