/** Pure manifest contract for local JavaScript extensions (FEAT-0082). */

export const SCRIPT_SCHEMA_VERSION = 1 as const
export const SCRIPT_API_VERSION = 1 as const

export const SCRIPT_PERMISSIONS = [
  "commands",
  "editor:read",
  "editor:write",
  "notes:read",
  "notes:write",
  "navigation:read",
  "navigation:write",
  "editor:selection",
  "notifications",
  "dialogs",
] as const

export type ScriptPermission = (typeof SCRIPT_PERMISSIONS)[number]

export interface ScriptManifest {
  schemaVersion: typeof SCRIPT_SCHEMA_VERSION
  apiVersion: typeof SCRIPT_API_VERSION
  id: string
  name: string
  version: string
  entry: string
  permissions: ScriptPermission[]
}

export type ManifestResult =
  | { ok: true; manifest: ScriptManifest }
  | { ok: false; error: string }

export type PathResult = { ok: true; value: string } | { ok: false; error: string }

const SCRIPT_ID = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const UNSAFE_SEGMENT = /[\\<>:"|?*]/
const MAX_ID_LENGTH = 64
const MAX_NAME_LENGTH = 160
const MAX_VERSION_LENGTH = 64
const MAX_ENTRY_LENGTH = 240

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) < 0x20) return true
  }
  return false
}

function safeSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !UNSAFE_SEGMENT.test(value) &&
    !hasControlCharacter(value)
  )
}

/** Validate a folder name used as the script's stable identity. */
export function validateScriptId(value: unknown): PathResult {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    return { ok: false, error: "Script id must be a bounded non-empty string." }
  }
  if (!SCRIPT_ID.test(value)) {
    return {
      ok: false,
      error: "Script id must start with a lowercase letter and contain only lowercase letters, numbers, dots, hyphens, or underscores.",
    }
  }
  return { ok: true, value }
}

/** Validate a folder-relative JavaScript entry path. */
export function validateScriptEntry(value: unknown): PathResult {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENTRY_LENGTH) {
    return { ok: false, error: "Script entry must be a bounded non-empty path." }
  }
  if (value.startsWith("/") || value.includes("\\")) {
    return { ok: false, error: "Script entry must be a relative POSIX path." }
  }
  const segments = value.split("/")
  if (segments.some((segment) => !safeSegment(segment))) {
    return { ok: false, error: "Script entry contains an unsafe or traversal path segment." }
  }
  if (!/\.js$/i.test(value)) {
    return { ok: false, error: "Script entry must point to a .js file." }
  }
  return { ok: true, value }
}

/** Validate any supported text file inside a script directory. */
export function validateScriptFilePath(value: unknown): PathResult {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENTRY_LENGTH) {
    return { ok: false, error: "Script file path must be a bounded non-empty path." }
  }
  if (value.startsWith("/") || value.includes("\\")) {
    return { ok: false, error: "Script file path must be a relative POSIX path." }
  }
  const segments = value.split("/")
  if (segments.some((segment) => !safeSegment(segment))) {
    return { ok: false, error: "Script file path contains an unsafe or traversal path segment." }
  }
  if (!/\.(?:js|json)$/i.test(value)) {
    return { ok: false, error: "Script file path must point to a .js or .json file." }
  }
  return { ok: true, value }
}

function validPermission(value: unknown): value is ScriptPermission {
  return (SCRIPT_PERMISSIONS as readonly unknown[]).includes(value)
}

/** Parse and validate a manifest value without filesystem or DOM side effects. */
export function parseScriptManifest(raw: unknown): ManifestResult {
  if (!isPlainRecord(raw)) return { ok: false, error: "Manifest must be a JSON object." }
  if (raw.schemaVersion !== SCRIPT_SCHEMA_VERSION) {
    return { ok: false, error: `Unsupported manifest schema version: ${String(raw.schemaVersion)}` }
  }
  if (raw.apiVersion !== SCRIPT_API_VERSION) {
    return { ok: false, error: `Unsupported extension API version: ${String(raw.apiVersion)}` }
  }

  const id = validateScriptId(raw.id)
  if (!id.ok) return id
  if (typeof raw.name !== "string" || raw.name.trim().length === 0 || raw.name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: "Manifest name must be a bounded non-empty string." }
  }
  if (typeof raw.version !== "string" || raw.version.length === 0 || raw.version.length > MAX_VERSION_LENGTH || !SEMVER.test(raw.version)) {
    return { ok: false, error: "Manifest version must be valid semantic versioning." }
  }
  const entry = validateScriptEntry(raw.entry)
  if (!entry.ok) return entry
  if (!Array.isArray(raw.permissions) || raw.permissions.length > SCRIPT_PERMISSIONS.length) {
    return { ok: false, error: "Manifest permissions must be an array of known capabilities." }
  }
  const permissions: ScriptPermission[] = []
  for (const permission of raw.permissions) {
    if (!validPermission(permission)) {
      return { ok: false, error: `Unknown script permission: ${String(permission)}` }
    }
    if (permissions.includes(permission)) {
      return { ok: false, error: `Duplicate script permission: ${permission}` }
    }
    permissions.push(permission)
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: SCRIPT_SCHEMA_VERSION,
      apiVersion: SCRIPT_API_VERSION,
      id: id.value,
      name: raw.name.trim(),
      version: raw.version,
      entry: entry.value,
      permissions,
    },
  }
}

/** Parse JSON manifest text and convert syntax errors into a structured result. */
export function parseScriptManifestText(text: string): ManifestResult {
  try {
    return parseScriptManifest(JSON.parse(text) as unknown)
  } catch {
    return { ok: false, error: "Manifest is not valid JSON." }
  }
}
