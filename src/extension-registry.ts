import type { Action } from "./actions"
import { ExtensionRunner } from "./extension-runner"
import type { ExtensionEditorCapabilities, ExtensionNoteCapabilities } from "./extension-host"
import type { ExtensionNavigationCapabilities } from "./extension-navigation"
import {
  listScripts,
  readScript,
  type ScriptDiscovery,
} from "./script-storage"

export interface ExtensionRegistryOptions {
  onActionsChanged?: () => void
  onError?: (error: unknown, scriptId?: string) => void
}

/**
 * Vault-scoped lifecycle for all validated local extensions. Invalid folders and
 * failed scripts are isolated: one bad extension never prevents notes opening or
 * another extension from contributing actions.
 */
export class ExtensionRegistry {
  private readonly onActionsChanged?: () => void
  private readonly onError?: (error: unknown, scriptId?: string) => void
  private runners: ExtensionRunner[] = []
  private readonly inFlight = new Set<ExtensionRunner>()
  private discovery: ScriptDiscovery[] = []
  private generation = 0

  constructor(options: ExtensionRegistryOptions = {}) {
    this.onActionsChanged = options.onActionsChanged
    this.onError = options.onError
  }

  async load(
    root: FileSystemDirectoryHandle,
    capabilities: {
      editor: ExtensionEditorCapabilities
      notes: ExtensionNoteCapabilities
      navigation?: ExtensionNavigationCapabilities
      interaction?: import("./extension-host").ExtensionInteractionCapabilities
    },
    enabledIds: readonly string[] = [],
  ): Promise<ScriptDiscovery[]> {
    const generation = ++this.generation
    this.disposeRunners()
    let discovery: ScriptDiscovery[]
    try {
      discovery = await listScripts(root)
    } catch (error) {
      if (generation !== this.generation) return []
      this.reportError(error)
      this.discovery = []
      this.notifyActionsChanged()
      return []
    }
    if (generation !== this.generation) return discovery
    this.discovery = discovery
    const candidates = new Set<ExtensionRunner>()
    const valid = discovery.filter(
      (item): item is ScriptDiscovery & { manifest: NonNullable<ScriptDiscovery["manifest"]> } =>
        item.manifest !== null && enabledIds.includes(item.id),
    )
    const started = await Promise.allSettled(
      valid.map(async (item) => {
        const record = await readScript(root, item.id)
        const runner = new ExtensionRunner({
          manifest: record.manifest,
          source: record.source,
          editor: capabilities.editor,
          notes: capabilities.notes,
          navigation: capabilities.navigation,
          interaction: capabilities.interaction,
          onActionsChanged: () => this.notifyActionsChanged(),
          onError: (error) => this.reportError(error, item.id),
        })
        candidates.add(runner)
        this.inFlight.add(runner)
        await runner.start()
        return runner
      }),
    )
    if (generation !== this.generation) {
      for (const runner of candidates) {
        runner.dispose()
        this.inFlight.delete(runner)
      }
      return discovery
    }
    this.runners = started.flatMap((result, index) => {
      if (result.status === "fulfilled") return [result.value]
      this.reportError(result.reason, valid[index]?.id)
      return []
    })
    for (const runner of candidates) this.inFlight.delete(runner)
    this.notifyActionsChanged()
    return discovery
  }

  getActions(): Action[] {
    return this.runners.flatMap((runner) => runner.getActions())
  }

  getDiscovery(): ScriptDiscovery[] {
    return this.discovery.map((item) => ({ ...item }))
  }

  dispose(): void {
    this.generation++
    this.disposeRunners()
    this.discovery = []
    this.notifyActionsChanged()
  }

  private disposeRunners(): void {
    for (const runner of this.runners) runner.dispose()
    for (const runner of this.inFlight) runner.dispose()
    this.runners = []
    this.inFlight.clear()
  }

  private notifyActionsChanged(): void {
    try {
      this.onActionsChanged?.()
    } catch (error) {
      this.reportError(error)
    }
  }

  private reportError(error: unknown, scriptId?: string): void {
    try {
      this.onError?.(error, scriptId)
    } catch {
      // A diagnostic observer cannot break extension isolation or vault opening.
    }
  }
}
