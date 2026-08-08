import { effectiveVaultName, pickStartupVault, type Vault } from "./vaults"
import { hasPermission, requestAccess } from "./session"

export type WorkbenchAttachFailureCode =
  | "missing_vault"
  | "permission_denied"
  | "permission_error"

export interface WorkbenchAttachFailure {
  ok: false
  code: WorkbenchAttachFailureCode
  message: string
}

export interface WorkbenchAttachment {
  ok: true
  vault: Vault
  root: FileSystemDirectoryHandle
}

export type WorkbenchAttachmentResult = WorkbenchAttachment | WorkbenchAttachFailure

export interface WorkbenchAttachmentDeps {
  resolveVault: (reference: string | null) => Promise<Vault | undefined>
  hasPermission: (handle: FileSystemDirectoryHandle) => Promise<boolean>
  requestPermission: (handle: FileSystemDirectoryHandle) => Promise<boolean>
}

const DEFAULT_DEPS: WorkbenchAttachmentDeps = {
  resolveVault: (reference) => pickStartupVault(reference),
  hasPermission,
  requestPermission: requestAccess,
}

export function createWorkbenchUrl(
  workspace: string,
  base = typeof location === "undefined" ? "https://brulion.invalid/" : location.href,
): string {
  const url = new URL("workbench.html", base)
  url.search = ""
  url.searchParams.set("ws", workspace)
  return url.href
}

export const WORKBENCH_REFRESH_INTERVAL_MS = 3_000

export type WorkbenchRefreshReason = "attach" | "manual" | "focus" | "poll"

export interface WorkbenchRefreshSchedulerOptions {
  refresh: (reason: WorkbenchRefreshReason) => Promise<void>
  intervalMs?: number
  setInterval?: (callback: () => void, milliseconds: number) => number
  clearInterval?: (handle: number) => void
}

export interface WorkbenchRefreshScheduler {
  request: (reason: WorkbenchRefreshReason) => Promise<void>
  start: () => void
  stop: () => void
}

/** Serialize refresh triggers so a slow filesystem scan cannot overlap a later one. */
export function createWorkbenchRefreshScheduler(
  options: WorkbenchRefreshSchedulerOptions,
): WorkbenchRefreshScheduler {
  const intervalMs = options.intervalMs ?? WORKBENCH_REFRESH_INTERVAL_MS
  const setInterval =
    options.setInterval ?? ((callback, milliseconds) => globalThis.setInterval(callback, milliseconds))
  const clearInterval = options.clearInterval ?? ((handle) => globalThis.clearInterval(handle))
  let timer: number | null = null
  let running: Promise<void> | null = null
  let queuedReason: WorkbenchRefreshReason | null = null

  const drain = async (): Promise<void> => {
    let firstError: unknown
    let hasError = false
    while (queuedReason !== null) {
      const reason = queuedReason
      queuedReason = null
      try {
        await options.refresh(reason)
      } catch (error) {
        firstError ??= error
        hasError = true
      }
    }
    if (hasError) throw firstError
  }

  const request = (reason: WorkbenchRefreshReason): Promise<void> => {
    queuedReason = reason
    if (!running) {
      running = drain().finally(() => {
        running = null
        if (queuedReason !== null) void request(queuedReason)
      })
    }
    return running
  }

  return {
    request,
    start: () => {
      if (timer !== null) return
      timer = setInterval(() => void request("poll"), intervalMs)
    },
    stop: () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}

export async function attachWorkbenchVault(
  reference: string | null,
  dependencies: Partial<WorkbenchAttachmentDeps> = {},
): Promise<WorkbenchAttachmentResult> {
  const deps = { ...DEFAULT_DEPS, ...dependencies }
  let vault: Vault | undefined
  try {
    vault = await deps.resolveVault(reference)
  } catch (error) {
    return {
      ok: false,
      code: "missing_vault",
      message: error instanceof Error ? error.message : "Unable to resolve the workspace.",
    }
  }
  if (!vault) {
    return {
      ok: false,
      code: "missing_vault",
      message: reference
        ? "This workspace is not available in this browser. Choose its folder to attach it."
        : "Choose a folder before opening the extension workbench.",
    }
  }
  try {
    if (!(await deps.hasPermission(vault.handle)) && !(await deps.requestPermission(vault.handle))) {
      return {
        ok: false,
        code: "permission_denied",
        message: "Brulion needs read/write permission for " + effectiveVaultName(vault) + ".",
      }
    }
  } catch (error) {
    return {
      ok: false,
      code: "permission_error",
      message: error instanceof Error ? error.message : "Unable to access this workspace.",
    }
  }
  return { ok: true, vault, root: vault.handle }
}
