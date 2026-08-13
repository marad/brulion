import { test, expect, type Page } from "@playwright/test"

// FEAT-0105/AC-8: this suite reaches dialogs through the enabled extension's
// iframe/RPC command path and uses OPFS for the vault. It never calls host
// adapters or imports application modules.
const FOLDER = "e2e-extension-dialogs-folder"
const NOTE = "dialog bytes must stay unchanged"

const manifest = JSON.stringify({
  schemaVersion: 1,
  apiVersion: 1,
  id: "dialog-tools",
  name: "Dialog tools",
  version: "0.1.0",
  entry: "main.js",
  permissions: ["commands", "dialogs"],
})

const source = String.raw`export default async function activate(api) {
  async function result(id, label) {
    await api.commands.register({ id, label }, async () => {})
  }
  await api.commands.register({ id: "alert", label: "Ask alert" }, async () => {
    await api.dialogs.alert([
      { type: "text", text: "plain\nline " },
      { type: "strong", text: "strong" },
      { type: "code", text: "<safe>" },
    ], { okLabel: "Got it" })
    await result("alert-result", "Alert acknowledged")
  })
  await api.commands.register({ id: "confirm-yes", label: "Ask confirm yes" }, async () => {
    const answer = await api.dialogs.confirm("Continue?", { confirmLabel: "Proceed", cancelLabel: "Stop" })
    await result("confirm-yes-result", "Confirm result: " + answer)
  })
  await api.commands.register({ id: "confirm-no", label: "Ask confirm no" }, async () => {
    const answer = await api.dialogs.confirm("Continue?", { confirmLabel: "Proceed", cancelLabel: "Stop" })
    await result("confirm-no-result", "Confirm result: " + answer)
  })
  await api.commands.register({ id: "prompt-single", label: "Ask single-line prompt" }, async () => {
    const answer = await api.dialogs.prompt("One line", {
      confirmLabel: "Save answer", cancelLabel: "Cancel answer", initial: "seed", placeholder: "type here",
    })
    await result("prompt-single-result", answer === null ? "Prompt cancelled" : "Prompt accepted: " + answer)
  })
  await api.commands.register({ id: "prompt-multi", label: "Ask multiline prompt" }, async () => {
    const answer = await api.dialogs.prompt("Many lines", {
      confirmLabel: "Use text", cancelLabel: "Discard text", multiline: true, placeholder: "multiple lines",
    })
    await result("prompt-multi-result", answer === null ? "Multiline cancelled" : "Multiline accepted: " + JSON.stringify(answer))
  })
  await api.commands.register({ id: "prompt-cancel", label: "Ask cancelled prompt" }, async () => {
    const answer = await api.dialogs.prompt("Cancel this", {
      confirmLabel: "Accept", cancelLabel: "Cancel", initial: "unchanged",
    })
    await result("prompt-cancel-result", answer === null ? "Cancel distinguished" : "Unexpected acceptance")
  })
  await api.commands.register({ id: "prompt-empty", label: "Ask empty prompt" }, async () => {
    const answer = await api.dialogs.prompt("Accept empty", {
      confirmLabel: "Accept empty", cancelLabel: "Cancel empty", initial: "seed",
    })
    await result("prompt-empty-result", answer === null ? "Empty prompt cancelled" : "Empty prompt accepted: " + JSON.stringify(answer))
  })
  await api.commands.register({ id: "ask-disposal", label: "Ask disposal" }, async () => {
    await api.dialogs.alert("This dialog is disposed", { okLabel: "Never" })
  })
  await api.commands.register({ id: "ask-timeout", label: "Ask timeout" }, async () => {
    try {
      await api.dialogs.alert("This dialog times out", { okLabel: "Never" })
    } catch (error) {
      await result("timeout-result", "Timeout result: " + error.code)
    }
  })
  await api.commands.register({ id: "after-timeout", label: "Ask after timeout" }, async () => {
    await api.dialogs.alert("This dialog opens after timeout", { okLabel: "Close" })
    await result("after-timeout-result", "Post-timeout dialog opened")
  })
}`

async function accelerateDialogDeadline(page: Page) {
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = ((handler, timeout, ...args) => {
      const delay = timeout === 119000 ? 3000 : timeout === 120000 ? 6000 : timeout
      return nativeSetTimeout(handler, delay, ...args)
    }) as typeof window.setTimeout
  })
}

async function stubPicker(page: Page) {
  await page.addInitScript((folder) => {
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, FOLDER)
}

async function writeFile(page: Page, path: string, content: string) {
  await page.evaluate(
    async ([folder, relativePath, text]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder, { create: true })
      const parts = relativePath.split("/")
      const file = parts.pop()
      if (!file) throw new Error("Missing file name")
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
      const handle = await dir.getFileHandle(file, { create: true })
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
    [FOLDER, path, content] as const,
  )
}

async function readFile(page: Page, path: string): Promise<string> {
  return page.evaluate(
    async ([folder, relativePath]) => {
      const root = await navigator.storage.getDirectory()
      let dir = await root.getDirectoryHandle(folder)
      const parts = relativePath.split("/")
      const file = parts.pop()
      if (!file) throw new Error("Missing file name")
      for (const part of parts) dir = await dir.getDirectoryHandle(part)
      return (await dir.getFileHandle(file)).getFile().then((item) => item.text())
    },
    [FOLDER, path] as const,
  )
}

async function setEnabledExtensions(page: Page, extensions: string[]) {
  const settings = JSON.parse(await readFile(page, ".brulion.json")) as Record<string, unknown>
  settings.extensions = extensions
  await writeFile(page, ".brulion.json", JSON.stringify(settings))
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
}

async function seedVault(page: Page) {
  await writeFile(page, "alpha.md", NOTE)
  await writeFile(page, ".brulion.json", JSON.stringify({
    font: [], textSize: 16, editorWidth: "narrow", vim: false, actionBar: [],
    journalPath: "", theme: "system", workspace: "", extensions: ["dialog-tools"],
  }))
  await writeFile(page, ".brulion/scripts/dialog-tools/manifest.json", manifest)
  await writeFile(page, ".brulion/scripts/dialog-tools/main.js", source)
}

const paletteRows = (page: Page) => page.locator(".palette-row")

async function invoke(page: Page, label: string) {
  await page.keyboard.press("Control+Shift+K")
  const matching = paletteRows(page).filter({ hasText: label })
  await expect.poll(async () => {
    await page.locator("#palette-input").fill(label)
    return matching.count()
  }).toBeGreaterThan(0)
  await matching.first().click()
}

async function expectResultAction(page: Page, label: string) {
  await invoke(page, label)
  // Result actions intentionally have no side effect; their presence proves
  // the sandbox received the exact outcome and registered it through RPC.
  await page.keyboard.press("Escape")
}

test.describe.configure({ timeout: 60_000 })

test("AC-8 runs formatted alert, confirm, and prompt flows in Chromium", async ({ page }) => {
  await accelerateDialogDeadline(page)
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedVault(page)
  await page.locator("#open-folder").click()
  const editor = page.locator(".cm-content")
  await expect(editor).toHaveText(NOTE)

  await invoke(page, "Ask alert")
  const message = page.locator("#dialog-message")
  await expect(message.locator("strong")).toHaveText("strong")
  await expect(message.locator("code")).toHaveText("<safe>")
  await expect(message.locator("br")).toHaveCount(1)
  await expect(message.locator("script, a")).toHaveCount(0)
  await expect(page.locator("#dialog-confirm")).toHaveText("Got it")
  await expect(page.locator("#dialog-cancel")).toBeHidden()
  await page.locator("#dialog-confirm").click()
  await expect(page.locator("#dialog-backdrop")).toBeHidden()
  await expectResultAction(page, "Alert acknowledged")

  await invoke(page, "Ask confirm yes")
  await expect(page.locator("#dialog-confirm")).toHaveText("Proceed")
  await expect(page.locator("#dialog-cancel")).toHaveText("Stop")
  await page.locator("#dialog-confirm").click()
  await expectResultAction(page, "Confirm result: true")

  await invoke(page, "Ask confirm no")
  await page.locator("#dialog-cancel").click()
  await expectResultAction(page, "Confirm result: false")

  await invoke(page, "Ask single-line prompt")
  const input = page.locator("#dialog-input")
  await expect(input).toBeVisible()
  await expect(input).toHaveValue("seed")
  await expect(input).toHaveAttribute("placeholder", "type here")
  await input.fill("exact UTF-16 text")
  await page.locator("#dialog-confirm").click()
  await expectResultAction(page, "Prompt accepted: exact UTF-16 text")

  await invoke(page, "Ask multiline prompt")
  const textarea = page.locator("#dialog-textarea")
  await expect(textarea).toBeVisible()
  await expect(textarea).toHaveAttribute("placeholder", "multiple lines")
  await textarea.fill("first line\nsecond line")
  await page.locator("#dialog-confirm").click()
  await expectResultAction(page, 'Multiline accepted: "first line\\nsecond line"')

  await invoke(page, "Ask empty prompt")
  await expect(page.locator("#dialog-input")).toHaveValue("seed")
  await page.locator("#dialog-input").fill("")
  await page.locator("#dialog-confirm").click()
  await expectResultAction(page, 'Empty prompt accepted: ""')

  await invoke(page, "Ask cancelled prompt")
  await expect(input).toHaveValue("unchanged")
  await page.locator("#dialog-cancel").click()
  await expectResultAction(page, "Cancel distinguished")

  await invoke(page, "Ask timeout")
  await expect(page.locator("#dialog-backdrop")).toBeVisible()
  await expect(page.locator("#dialog-backdrop")).toBeHidden({ timeout: 7_000 })
  await expectResultAction(page, "Timeout result: timeout")

  await invoke(page, "Ask after timeout")
  await expect(page.locator("#dialog-confirm")).toHaveText("Close")
  await page.locator("#dialog-confirm").click()
  await expectResultAction(page, "Post-timeout dialog opened")

  await invoke(page, "Ask disposal")
  await expect(page.locator("#dialog-backdrop")).toBeVisible()
  await setEnabledExtensions(page, [])
  await expect(page.locator("#dialog-backdrop")).toBeHidden()
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Ask disposal")
    return paletteRows(page).count()
  }).toBe(0)

  await setEnabledExtensions(page, ["dialog-tools"])
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Ask alert")
    return paletteRows(page).filter({ hasText: "Ask alert" }).count()
  }).toBe(1)
  await paletteRows(page).filter({ hasText: "Ask alert" }).first().click()
  await expect(page.locator("#dialog-confirm")).toHaveText("Got it")
  await page.locator("#dialog-confirm").click()

  await expect(editor).toHaveText(NOTE)
  expect(await readFile(page, "alpha.md")).toBe(NOTE)
})
