import { test, expect, type Page } from "@playwright/test"

const FOLDER = "e2e-extension-navigation-folder"
const SECOND_FOLDER = "e2e-extension-navigation-second-folder"
const PICK_FOLDERS = [FOLDER, SECOND_FOLDER]
const EXTENSION_ID = "navigation-tools"

test.describe.configure({ timeout: 60_000 })

const manifest = JSON.stringify({
  schemaVersion: 1,
  apiVersion: 1,
  id: EXTENSION_ID,
  name: "Navigation tools",
  version: "0.1.0",
  entry: "main.js",
  permissions: ["commands", "editor:read", "navigation:read", "navigation:write", "notes:write"],
})

const source = `export default async function activate(api) {
  let releaseConflict
  const conflictGate = new Promise((resolve) => { releaseConflict = resolve })
  await api.commands.register({ id: "release-conflict", label: "Release conflict navigation" }, async () => {
    releaseConflict()
  })

  const active = await api.navigation.getActiveNote()
  await api.commands.register({
    id: "active",
    label: "Active "+(active ? active.path : "none"),
  }, async () => {})

  await api.commands.register({ id: "open-beta", label: "Open beta at done" }, async () => {
    const result = await api.navigation.openNote("beta", { anchor: "done" })
      const selection = await api.editor.getSelection()
    await api.commands.register({
      id: "opened-result",
      label: "Navigation "+result.status+" "+result.path+" "+(result.anchorStatus || "")+" cursor "+selection.head,
    }, async () => {})
  })

  await api.commands.register({ id: "open-missing-anchor", label: "Open beta at missing heading" }, async () => {
    const result = await api.navigation.openNote("beta", { anchor: "does-not-exist" })
    await api.commands.register({
      id: "missing-anchor-result",
      label: "Navigation "+result.status+" "+result.path+" "+(result.anchorStatus || ""),
    }, async () => {})
  })

  await api.commands.register({ id: "open-missing", label: "Open missing note" }, async () => {
    const result = await api.navigation.openNote("missing")
    await api.commands.register({
      id: "missing-result",
      label: "Navigation "+result.status+" "+result.path,
    }, async () => {})
  })

  await api.commands.register({ id: "resolve-beta", label: "Resolve beta link" }, async () => {
    const result = await api.navigation.resolveLink("beta.md#done", {
      kind: "markdown",
      from: "alpha.md",
    })
    await api.commands.register({
      id: "resolved-result",
      label: "Resolution "+result.status+" "+(result.path || result.target || "")+" "+(result.anchor || ""),
    }, async () => {})
  })

  await api.commands.register({ id: "create-then-open", label: "Create then open" }, async () => {
    const created = await api.notes.create("created")
    const result = await api.navigation.openNote("created")
    await api.commands.register({
      id: "created-result",
      label: "Navigation "+created.status+" then "+result.status+" "+result.path,
    }, async () => {})
  })

  await api.commands.register({ id: "conflicting-open", label: "Open beta after external edit" }, async () => {
    await api.commands.register({ id: "conflict-ready", label: "Conflict navigation ready" }, async () => {})
    await conflictGate
    const result = await api.navigation.openNote("beta")
    await api.commands.register({
      id: "conflict-result",
      label: "Navigation "+result.status+" "+result.path,
    }, async () => {})
  })

  await api.commands.register({ id: "resolve-cases", label: "Resolve navigation cases" }, async () => {
    const results = await Promise.all([
      api.navigation.resolveLink("BETA#done", { kind: "wikilink" }),
      api.navigation.resolveLink("not-there", { kind: "wikilink" }),
      api.navigation.resolveLink("https://example.test/note#part", { kind: "markdown" }),
      api.navigation.resolveLink("../../outside.md", { kind: "markdown", from: "alpha.md" }),
    ])
    const summary = results.map((result) => {
      if (result.status === "resolved" || result.status === "missing") {
        return (result.status === "resolved" ? "r" : "m")+" "+result.path+" "+(result.anchor || "")
      }
      return (result.status === "external" ? "e" : "i")+" "+(result.target || "")
    }).join("; ")
    await api.commands.register({ id: "resolved-cases-result", label: "Cases "+summary }, async () => {})
  })

  await api.commands.register({ id: "stale-navigation", label: "Start stale navigation" }, async () => {
    const pending = api.navigation.openNote("zeta")
    await api.commands.register({ id: "stale-in-flight", label: "Stale navigation in flight" }, async () => {})
    const result = await pending
    await api.commands.register({
      id: "stale-result",
      label: "Stale navigation "+result.status+" "+result.path,
    }, async () => {})
  })
}`

async function stubPicker(page: Page) {
  await page.addInitScript((folders) => {
    let pick = 0
    window.showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory()
      const folder = folders[Math.min(pick++, folders.length - 1)]
      return await root.getDirectoryHandle(folder, { create: true })
    }
  }, PICK_FOLDERS)
}

async function writeFile(page: Page, path: string, content: string, folder = FOLDER) {
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
    [folder, path, content] as const,
  )
}

async function readFile(page: Page, path: string, folder = FOLDER): Promise<string> {
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
    [folder, path] as const,
  )
}

const paletteRows = (page: Page) => page.locator(".palette-row")

async function runCommand(page: Page, query: string) {
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill(query)
  await expect(paletteRows(page).first()).toBeVisible()
  // Keyboard activation stays reliable even if the conflict modal appears between
  // opening the palette and dispatching the command (the pointer path is then
  // correctly blocked by the modal backdrop).
  await page.keyboard.press("Enter")
}

async function seedVault(page: Page, folder = FOLDER, activeContent = "# Alpha\n\nalpha body") {
  await writeFile(page, "alpha.md", activeContent, folder)
  await writeFile(page, "beta.md", "# Beta\n\n## Done\n\nbeta body", folder)
  await writeFile(
    page,
    ".brulion.json",
    JSON.stringify({
      font: [],
      textSize: 16,
      editorWidth: "narrow",
      vim: false,
      actionBar: [],
      journalPath: "",
      theme: "system",
      workspace: "",
      extensions: [EXTENSION_ID],
    }),
    folder,
  )
  await writeFile(page, `.brulion/scripts/${EXTENSION_ID}/manifest.json`, manifest, folder)
  await writeFile(page, `.brulion/scripts/${EXTENSION_ID}/main.js`, source, folder)
}

test.beforeEach(async ({ page }) => {
  await stubPicker(page)
  await page.goto("/brulion/")
  await seedVault(page)
  await page.locator("#open-folder").click()
  await expect(page.locator(".note-row")).toHaveCount(2)
  await expect(page.locator(".cm-content")).toContainText("Alpha")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Active alpha.md")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
})

test("reads the active note, opens a heading, and returns a missing result without creating", async ({ page }) => {
  await runCommand(page, "Open beta at done")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Navigation opened beta.md found cursor 8")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-content")).toContainText("Done")

  await runCommand(page, "Open missing note")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Navigation missing missing.md")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-content")).toContainText("Done")
  await expect.poll(async () => {
    try {
      await readFile(page, "missing.md")
      return true
    } catch {
      return false
    }
  }).toBe(false)
})

test("resolves a markdown link from a fresh filesystem listing without navigating", async ({ page }) => {
  await runCommand(page, "Resolve beta link")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Resolution resolved beta.md done")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-content")).toContainText("Alpha")
})

test("reports a missing heading without changing target bytes", async ({ page }) => {
  const before = await readFile(page, "beta.md")
  await runCommand(page, "Open beta at missing heading")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Navigation opened beta.md not-found")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.locator(".cm-content")).toContainText("Beta")
  await expect.poll(() => readFile(page, "beta.md")).toBe(before)
})

test("resolves wikilink, missing, external, and invalid cases without navigating or writing", async ({ page }) => {
  const before = await readFile(page, "alpha.md")
  await runCommand(page, "Resolve navigation cases")
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("Cases")
  const resultRow = paletteRows(page).filter({ hasText: "r beta.md done" })
  await expect(resultRow).toBeVisible()
  await expect(resultRow).toContainText("m not-there.md")
  await expect(resultRow).toContainText("e https://example.test/note#part")
  await expect(resultRow).toContainText("i ../../outside.md")
  await page.keyboard.press("Escape")
  await expect(page.locator("#editor .cm-content")).toContainText("Alpha")
  await expect.poll(() => readFile(page, "alpha.md")).toBe(before)
})

test("returns conflict and preserves external bytes when a dirty note changed on disk", async ({ page }) => {
  const editor = page.locator("#editor .cm-content")
  await runCommand(page, "Open beta after external edit")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Conflict navigation ready")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await editor.click()
  await page.keyboard.press("Control+A")
  await page.keyboard.type("local unsaved draft")
  await writeFile(page, "alpha.md", "external bytes")
  await runCommand(page, "Release conflict navigation")
  await expect(page.locator("#conflict")).toBeVisible()
  await page.locator("#conflict-disk").click()
  await expect(page.locator("#conflict")).toBeHidden()
  await page.keyboard.press("Control+Shift+K")
  await page.locator("#palette-input").fill("Navigation conflict alpha.md")
  await expect(paletteRows(page).first()).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(editor).toHaveText("external bytes")
  await expect.poll(() => readFile(page, "alpha.md")).toBe("external bytes")
})

test("does not let a stale runner open a note in the newly attached vault", async ({ page }) => {
  await seedVault(page, SECOND_FOLDER, "# Second vault\n\nsecond body")
  await writeFile(page, "zeta.md", "# Zeta\n\nzeta body", SECOND_FOLDER)

  await runCommand(page, "Start stale navigation")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Stale navigation in flight")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await page.locator("#open-settings").click()
  await expect(page.locator("#settings-backdrop")).toBeVisible()
  await page.locator(".settings-switch-folder").click()
  await expect(page.locator("#settings-backdrop")).toBeHidden()
  await expect(page.locator(".cm-content")).toContainText("Second vault")
  await page.waitForTimeout(500)
  await expect(page.locator(".cm-content")).toContainText("Second vault")
  await expect(page.locator(".cm-content")).not.toContainText("Zeta")
  await expect.poll(() => readFile(page, "zeta.md", SECOND_FOLDER)).toBe("# Zeta\n\nzeta body")
})

test("opens an explicitly extension-created note without waiting for the sidebar snapshot", async ({ page }) => {
  await runCommand(page, "Create then open")
  await expect.poll(async () => {
    await page.keyboard.press("Control+Shift+K")
    await page.locator("#palette-input").fill("Navigation created then opened created.md")
    return paletteRows(page).count()
  }).toBe(1)
  await page.keyboard.press("Escape")
  await expect(page.locator("#editor .cm-content")).toHaveText("")
  await expect(page.locator('.note-row[data-path="created.md"]')).toHaveClass(/active/)
  await expect(page).toHaveURL(/#\/created$/)
  await expect.poll(async () => {
    try {
      return await readFile(page, "created.md")
    } catch {
      return null
    }
  }).toBe("")
})
