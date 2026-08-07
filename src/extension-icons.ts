import { Braces, Puzzle, Sparkles, Terminal, type IconNode } from "lucide"

export const DEFAULT_EXTENSION_ICON_NAME = "puzzle" as const

const ICONS: Record<string, IconNode> = {
  braces: Braces,
  puzzle: Puzzle,
  sparkles: Sparkles,
  terminal: Terminal,
}

export function sanitizeExtensionIconName(value: unknown): string {
  return typeof value === "string" && value in ICONS ? value : DEFAULT_EXTENSION_ICON_NAME
}

export function resolveExtensionIcon(value: unknown): IconNode {
  return ICONS[sanitizeExtensionIconName(value)]
}
