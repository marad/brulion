import { test, expect, type Page } from "@playwright/test"

// FEAT-0100: the heading hierarchy is a quiet decoration-only treatment over
// the same Markdown bytes in both themes and at every base text size.

const BODY = "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n\n**bold**\n"

async function stubPicker(page: Page, folder: string) {
  await page.addInitScript((f) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(f, { create: true })
    }
  }, folder)
}

async function writeNote(page: Page, folder: string) {
  await page.evaluate(
    async ([f, text]) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle(f, { create: true })
      const handle = await dir.getFileHandle("headings.md", { create: true })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
    [folder, BODY] as const,
  )
}

async function readNote(page: Page, folder: string): Promise<string> {
  return await page.evaluate(async (f) => {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(f, { create: true })
    const handle = await dir.getFileHandle("headings.md")
    return await (await handle.getFile()).text()
  }, folder)
}

async function openFixture(page: Page, folder: string) {
  await stubPicker(page, folder)
  await page.goto("/brulion/")
  await writeNote(page, folder)
  await page.locator("#open-folder").click()
  await expect(page.locator("#note-identity")).toBeVisible()
  await expect(page.locator(".cm-h6")).toBeVisible()
}

async function metrics(page: Page) {
  return await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".cm-content")!
    const bodyStyle = getComputedStyle(body)
    const levels = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((level) => {
        const element = document.querySelector<HTMLElement>(`.cm-h${level}`)!
        const style = getComputedStyle(element)
        return [
          level,
          {
            size: parseFloat(style.fontSize),
            weight: Number(style.fontWeight),
            opacity: style.opacity,
            indent: style.textIndent,
            color: style.color,
          },
        ]
      }),
    )
    return { bodySize: parseFloat(bodyStyle.fontSize), bodyColor: bodyStyle.color, levels }
  }) as {
    bodySize: number
    bodyColor: string
    levels: Record<number, { size: number; weight: number; opacity: string; indent: string; color: string }>
  }
}

test("headings use the compact hierarchy, scale with text size, and preserve Markdown bytes (AC-1, AC-2, AC-3, AC-4)", async ({
  page,
}) => {
  const folder = "e2e-heading-hierarchy"
  await openFixture(page, folder)
  const before = await readNote(page, folder)
  const initial = await metrics(page)

  expect(initial.levels[1].size / initial.bodySize).toBeCloseTo(1.35, 2)
  expect(initial.levels[2].size / initial.bodySize).toBeCloseTo(1.15, 2)
  for (const level of [3, 4, 5, 6]) {
    expect(initial.levels[level].size / initial.bodySize).toBeCloseTo(1, 2)
    expect(initial.levels[level].weight).toBeGreaterThanOrEqual(600)
  }
  expect(await page.locator(".cm-strong")).toHaveCount(1)
  expect(await page.locator(".cm-strong.cm-heading")).toHaveCount(0)

  await page.locator("#open-settings").click()
  await page.locator('input[name="settings-theme"][value="light"]').check()
  await page.keyboard.press("Escape")
  const light = await metrics(page)
  expect(light.levels[1].size / light.bodySize).toBeCloseTo(1.35, 2)
  expect(light.levels[2].size / light.bodySize).toBeCloseTo(1.15, 2)
  for (const level of [3, 4, 5, 6]) {
    expect(light.levels[level].size / light.bodySize).toBeCloseTo(1, 2)
  }
  for (const level of [1, 2, 3, 4, 5, 6]) {
    expect(light.levels[level].weight).toBeGreaterThanOrEqual(600)
    expect(light.levels[level].opacity).toBe("1")
    expect(light.levels[level].indent).toBe("0px")
    expect(light.levels[level].color).toBe(light.bodyColor)
  }

  await page.locator("#open-settings").click()
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Increase text size" }).click()
  }
  await page.locator('input[name="settings-theme"][value="dark"]').check()
  await page.keyboard.press("Escape")
  await expect
    .poll(() => page.locator(".cm-content").evaluate((el) => getComputedStyle(el).fontSize))
    .toBe("20px")

  const dark = await metrics(page)
  expect(dark.bodySize).toBeGreaterThan(initial.bodySize)
  expect(dark.levels[1].size).toBeGreaterThan(initial.levels[1].size)
  expect(dark.levels[1].size / dark.bodySize).toBeCloseTo(1.35, 2)
  expect(dark.levels[2].size / dark.bodySize).toBeCloseTo(1.15, 2)
  for (const level of [3, 4, 5, 6]) {
    expect(dark.levels[level].size / dark.bodySize).toBeCloseTo(1, 2)
    expect(dark.levels[level].weight).toBeGreaterThanOrEqual(600)
    expect(dark.levels[level].opacity).toBe("1")
    expect(dark.levels[level].indent).toBe("0px")
    expect(dark.levels[level].color).toBe(dark.bodyColor)
  }
  for (const level of [1, 2]) {
    expect(dark.levels[level].weight).toBeGreaterThanOrEqual(600)
    expect(dark.levels[level].opacity).toBe("1")
    expect(dark.levels[level].indent).toBe("0px")
    expect(dark.levels[level].color).toBe(dark.bodyColor)
  }
  expect(await readNote(page, folder)).toBe(before)
})
