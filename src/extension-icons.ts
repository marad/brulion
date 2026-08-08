import { icons, type IconNode } from "lucide"

export const DEFAULT_EXTENSION_ICON_NAME = "puzzle" as const

function lookupKey(value: string): string {
  return value.trim().replace(/[\s_-]+/g, "").toLowerCase()
}

// The public API intentionally accepts an unconstrained string. Resolution is
// still host-owned: only IconNodes from Lucide's bundled catalog can reach the
// DOM, and an unavailable name falls back to the default icon.
const ICONS_BY_NAME = new Map<string, IconNode>(
  Object.entries(icons).map(([name, icon]) => [lookupKey(name), icon]),
)

export function sanitizeExtensionIconName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_EXTENSION_ICON_NAME
  const name = value.trim()
  return name.length > 0 ? name : DEFAULT_EXTENSION_ICON_NAME
}

export function resolveExtensionIcon(value: unknown): IconNode {
  const name = sanitizeExtensionIconName(value)
  return ICONS_BY_NAME.get(lookupKey(name)) ?? ICONS_BY_NAME.get(lookupKey(DEFAULT_EXTENSION_ICON_NAME))!
}
