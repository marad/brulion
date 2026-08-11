import {
  resolveNavigationLink,
  type ExtensionNavigationCapabilities,
  type OpenNoteResult,
} from "./extension-navigation"
import type { ControllerOpenNoteResult } from "./note-controller"

export interface NavigationAdapterSource {
  /** Throws when the runner's vault is no longer the attached vault. */
  assertActive: () => void
  /** Current active path from the application view, or empty when none is open. */
  getActivePath: () => string
  /** Revalidate/open through the controller, bound to this exact folder. */
  openNote: (path: string, expectedFolder: FileSystemDirectoryHandle) => Promise<ControllerOpenNoteResult>
  /** Fresh filesystem note paths for one link-resolution call. */
  listNotePaths: () => Promise<readonly string[]>
  /** Existing heading scanner; returns whether the slug was found. */
  scrollToHeading: (anchor: string) => boolean
  /** Folder identity captured when this adapter is created. */
  expectedFolder: FileSystemDirectoryHandle
}

/** Build serialized, vault-bound extension navigation callbacks. */
export function createExtensionNavigationAdapter(
  source: NavigationAdapterSource,
): ExtensionNavigationCapabilities {
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return {
    getActiveNote: async () => {
      source.assertActive()
      const path = source.getActivePath()
      return path ? { path } : null
    },
    openNote: (path, options) =>
      serialize(async () => {
        source.assertActive()
        const outcome = await source.openNote(path, source.expectedFolder)
        source.assertActive()

        if (outcome.status === "missing") {
          return {
            status: "missing",
            path: outcome.path,
            anchor: options?.anchor ?? null,
          }
        }
        if (outcome.status === "conflict") return outcome
        if (source.getActivePath() !== outcome.path) {
          throw new Error("Active note changed during extension navigation")
        }

        const anchor = options?.anchor ?? null
        const anchorStatus = anchor
          ? source.scrollToHeading(anchor)
            ? "found"
            : "not-found"
          : "not-requested"
        return {
          status: outcome.status,
          path: outcome.path,
          anchor,
          anchorStatus,
        } satisfies OpenNoteResult
      }),
    resolveLink: async (target, options) => {
      source.assertActive()
      const activeNote = source.getActivePath() || null
      const preliminary = resolveNavigationLink(target, options, {
        activeNote,
        notePaths: new Set(),
      })
      if (preliminary.status === "external" || preliminary.status === "invalid") return preliminary

      const notePaths = await source.listNotePaths()
      source.assertActive()
      return resolveNavigationLink(target, options, {
        activeNote: source.getActivePath() || null,
        notePaths: new Set(notePaths),
      })
    },
  }
}
