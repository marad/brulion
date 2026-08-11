import { test, expect, type Browser, type Page } from "@playwright/test"

// FEAT-0101: the API page remains an optional JavaScript enhancement over
// ordinary static Markdown, JSON, and declaration files that agents can fetch.

const PREVIEW = "http://localhost:4173/brulion"

async function noScriptPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  return { page, close: () => context.close() }
}

test("the static API hand-off works with JavaScript disabled", async ({ browser }) => {
  const { page, close } = await noScriptPage(browser)
  try {
    await page.goto(`${PREVIEW}/api.html`)

    await expect(page.getByText("For agents")).toBeVisible()
    await expect(page.getByRole("link", { name: "api.md" })).toBeVisible()
    await expect(page.getByRole("link", { name: "api-contract.json" })).toBeVisible()
    await expect(page.getByRole("link", { name: "brulion-extension.d.ts" })).toBeVisible()
    await expect(page.locator("#api-docs-content")).toBeEmpty() // enhancement did not run
  } finally {
    await close()
  }
})

test("the deployed static artifacts contain the current Authoring Kit contract", async ({ request }) => {
  const [guide, contract, declarations] = await Promise.all([
    request.get(`${PREVIEW}/api.md`),
    request.get(`${PREVIEW}/api-contract.json`),
    request.get(`${PREVIEW}/brulion-extension.d.ts`),
  ])

  expect(guide.ok()).toBe(true)
  expect(contract.ok()).toBe(true)
  expect(declarations.ok()).toBe(true)
  expect(declarations.headers()["content-type"]).toMatch(/^text\/plain(?:;|$)/)
  expect(await guide.text()).toContain("## Start here")
  expect((await contract.json()).apiVersion).toBe(1)
  expect(await declarations.text()).toContain("interface BrulionApi")
})
