/// <reference types="vite/client" />

import { describe, expect, it, vi } from "vitest"
import workbenchHtml from "../workbench.html?raw"
import {
  attachWorkbenchVault,
  createWorkbenchUrl,
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
  it("uses a full editor shell instead of a dashboard layout", () => {
    expect(workbenchHtml).toContain('class="workbench-titlebar"')
    expect(workbenchHtml).toContain('class="workbench-sidebar"')
    expect(workbenchHtml).toContain('class="workbench-tabbar"')
    expect(workbenchHtml).toContain('class="workbench-statusbar"')
    expect(workbenchHtml).not.toContain("workbench-eyebrow")
    expect(workbenchHtml).not.toContain("Reconnect this workspace")
  })

  it("builds a new-window URL carrying only the workspace reference", () => {
    expect(createWorkbenchUrl("my notes", "https://example.test/brulion/")).toBe(
      "https://example.test/brulion/workbench.html?ws=my+notes",
    )
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
