import { test, expect } from "@playwright/test"

// The editor mounts on load (no folder needed), so typography is checkable
// straight after navigation.

test("uses a proportional system font, not monospace (AC-1)", async ({ page }) => {
  await page.goto("/brulion/")

  const fontFamily = await page
    .locator(".cm-content")
    .evaluate((el) => getComputedStyle(el).fontFamily)

  expect(fontFamily.toLowerCase()).toContain("system-ui")
  expect(fontFamily.toLowerCase()).not.toContain("monospace")
})

test("caps the text column to a readable measure and centers it (AC-2)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto("/brulion/")
  // Exercise the measure against real content: a long line must wrap within the
  // column, not stretch it (an empty editor would not catch a missing wrap).
  await page.locator(".cm-content").click()
  await page.keyboard.type("This is a deliberately long single line of prose. ".repeat(8))

  const box = await page.locator(".cm-content").boundingBox()
  const viewport = page.viewportSize()!
  expect(box).not.toBeNull()

  expect(box!.width).toBeLessThan(viewport.width * 0.75) // capped well under full width
  const leftGap = box!.x
  const rightGap = viewport.width - (box!.x + box!.width)
  expect(leftGap).toBeGreaterThan(40) // not flush to the edge
  expect(Math.abs(leftGap - rightGap)).toBeLessThan(4) // centered
})

test("body text is comfortably sized and spaced (AC-3)", async ({ page }) => {
  await page.goto("/brulion/")

  const { fontSize, lineHeight } = await page
    .locator(".cm-content")
    .evaluate((el) => {
      const style = getComputedStyle(el)
      return { fontSize: style.fontSize, lineHeight: style.lineHeight }
    })

  const sizePx = parseFloat(fontSize)
  const lineRaw = parseFloat(lineHeight)
  const ratio = lineHeight.endsWith("px") ? lineRaw / sizePx : lineRaw

  expect(sizePx).toBeGreaterThanOrEqual(16)
  expect(ratio).toBeGreaterThanOrEqual(1.5)
})
