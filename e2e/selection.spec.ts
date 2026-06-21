import { test, expect, type Page } from "@playwright/test"

// FEAT-0021 AC-10: the selection highlight must align with the selected glyphs,
// even on a line with hidden markup. This is the regression guard for the M6
// root-cause finding — the M2 selection offset was `scrollbar-gutter` (now
// removed), NOT the hidden-markup decorations. drawSelection paints the highlight;
// CodeMirror still keeps the DOM selection in sync (just visually hidden), so the
// native range rect is the ground-truth text position to compare against.
//
// The offset is read via expect.poll: drawSelection paints in a measure→render
// pass, so a fresh selection's highlight can lag a frame under parallel load.
// Polling settles that jitter; the bug we guard against (a ~15px left shift and a
// blown-out right edge) never settles, so a real regression still fails.

const FOLDER = "e2e-selection-folder"

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

const editor = (page: Page) => page.locator(".cm-content")

/** Max |Δ| between the drawSelection highlight and the real selected-text rect. */
async function maxOffset(page: Page): Promise<number | null> {
  return await page.evaluate(() => {
    const sel = window.getSelection()
    const real = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
    const bg = document.querySelector(".cm-selectionLayer .cm-selectionBackground")
    const draw = bg ? bg.getBoundingClientRect() : null
    if (!real || !draw) return null
    return Math.max(Math.abs(draw.left - real.left), Math.abs(draw.right - real.right))
  })
}

async function selectWholeLine(page: Page) {
  await page.keyboard.press("Home")
  await page.keyboard.press("Shift+End")
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await page.locator("#open-folder").click()
  await editor(page).click()
})

/** Re-issue the selection each poll so drawSelection re-measures against settled
 * layout (a heading's font grows after its decoration applies). ≤2px = aligned;
 * the old scrollbar-gutter bug was 15px+ and never settles. */
async function expectAligned(page: Page) {
  await expect
    .poll(async () => {
      await selectWholeLine(page)
      return maxOffset(page)
    })
    .toBeLessThanOrEqual(2)
}

test("selection aligns with text on a heading line (hidden '# ') (AC-10)", async ({
  page,
}) => {
  await page.keyboard.type("# Hello world")
  await expectAligned(page)
})

test("selection aligns with text containing a hidden bold span (AC-10)", async ({
  page,
}) => {
  await page.keyboard.type("a **b** c")
  await expectAligned(page)
})
