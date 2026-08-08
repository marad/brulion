/// <reference types="vite/client" />

import { describe, expect, it, vi } from "vitest"
import workbenchHtml from "../workbench.html?raw"
import apiDocsHtml from "../api.html?raw"
import {
  attachWorkbenchVault,
  createWorkbenchRefreshScheduler,
  createWorkbenchUrl,
  WORKBENCH_REFRESH_INTERVAL_MS,
  type WorkbenchAttachmentDeps,
} from "./workbench"
import type { Vault } from "./vaults"

function vault(name: string, id = name): Vault {
  return { id, name, handle: {} as FileSystemDirectoryHandle }
}

function deps(overrides: Partial<WorkbenchAttachmentDeps> = {}): WorkbenchAttachmentDeps {
  return {
    resolveVault: vi.fn(async () => vault("notes")),
    hasPermission: vi.fn(async () => true),
    requestPermission: vi.fn(async () => true),
    ...overrides,
  }
}

describe("separate extension workbench contract", () => {
  it("uses an honest single-editor explorer and modal creation flows", () => {
    expect(workbenchHtml).toContain('class="workbench-titlebar"')
    expect(workbenchHtml).toContain('id="workbench-api-docs"')
    expect(workbenchHtml).toContain('class="workbench-sidebar"')
    expect(workbenchHtml).toContain('id="workbench-script-select"')
    expect(workbenchHtml).not.toContain('id="workbench-tabs"')
    expect(workbenchHtml).not.toContain('id="workbench-new-tab"')
    expect(workbenchHtml).not.toContain('class="workbench-tabbar"')
    expect(workbenchHtml).toContain('id="workbench-delete-script"')
    expect(workbenchHtml).toContain('id="workbench-delete-file-shortcut"')
    expect(workbenchHtml).toContain('id="workbench-create-dialog"')
    expect(workbenchHtml).toContain('id="workbench-create-error"')
    expect(workbenchHtml).toContain('class="workbench-statusbar"')
    expect(workbenchHtml).not.toContain("workbench-script-list")
    expect(workbenchHtml).not.toContain("workbench-create-form")
    expect(workbenchHtml).not.toContain("Extension options")
    expect(workbenchHtml).not.toContain("▾")
  })

  it("ships a standalone API documentation page", () => {
    expect(apiDocsHtml).toContain('id="api-docs-content"')
    expect(apiDocsHtml).toContain('src="/src/api-docs-main.ts"')
    expect(apiDocsHtml).toContain("Brulion extension API")
  })

  it("builds a new-window URL carrying only the workspace reference", () => {
    expect(createWorkbenchUrl("my notes", "https://example.test/brulion/")).toBe(
      "https://example.test/brulion/workbench.html?ws=my+notes",
    )
  })

  it("serializes refresh requests and drains a trigger that arrives during a scan", async () => {
    const calls: string[] = []
    const releases: Array<() => void> = []
    const refresh = vi.fn(async (reason: string) => {
      calls.push(reason)
      await new Promise<void>((resolve) => releases.push(resolve))
    })
    const scheduler = createWorkbenchRefreshScheduler({
      refresh,
      intervalMs: WORKBENCH_REFRESH_INTERVAL_MS,
      setInterval: () => 1,
      clearInterval: () => {},
    })

    const first = scheduler.request("attach")
    const queued = scheduler.request("focus")
    expect(calls).toEqual(["attach"])
    releases.shift()!()
    await Promise.resolve()
    await Promise.resolve()
    expect(calls).toEqual(["attach", "focus"])
    releases.shift()!()
    await expect(Promise.all([first, queued])).resolves.toEqual([undefined, undefined])
  })

  it("starts one bounded polling timer and stops it", async () => {
    const timerCallback = vi.fn()
    const setInterval = vi.fn((_callback: () => void, milliseconds: number) => {
      timerCallback.mockImplementation(_callback)
      expect(milliseconds).toBe(WORKBENCH_REFRESH_INTERVAL_MS)
      return 7
    })
    const clearInterval = vi.fn()
    const refresh = vi.fn(async () => {})
    const scheduler = createWorkbenchRefreshScheduler({ refresh, setInterval, clearInterval })

    scheduler.start()
    scheduler.start()
    expect(setInterval).toHaveBeenCalledOnce()
    timerCallback()
    await Promise.resolve()
    expect(refresh).toHaveBeenCalledWith("poll")
    scheduler.stop()
    expect(clearInterval).toHaveBeenCalledWith(7)
  })

  it("attaches the requested persisted vault independently", async () => {
    const requested = vault("notes", "vault-1")
    const resolveVault = vi.fn(async () => requested)
    const result = await attachWorkbenchVault("notes", deps({ resolveVault }))

    expect(result).toEqual({ ok: true, vault: requested, root: requested.handle })
    expect(resolveVault).toHaveBeenCalledWith("notes")
  })

  it("does not fall back to another vault when the explicit reference is missing", async () => {
    const result = await attachWorkbenchVault(
      "missing",
      deps({ resolveVault: vi.fn(async () => undefined) }),
    )

    expect(result).toMatchObject({ ok: false, code: "missing_vault" })
  })

  it("reports denied permission and asks only for the requested handle", async () => {
    const requestPermission = vi.fn(async () => false)
    const result = await attachWorkbenchVault(
      "notes",
      deps({ hasPermission: vi.fn(async () => false), requestPermission }),
    )

    expect(result).toMatchObject({ ok: false, code: "permission_denied" })
    expect(requestPermission).toHaveBeenCalledOnce()
  })
})
