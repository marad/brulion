export interface ApiContractRuntime {
  language: string
  module: string
  activation: readonly string[]
  sandbox: readonly string[]
  limits: Readonly<Record<string, number>>
  unsupported: readonly string[]
}

export interface ApiContractField {
  name: string
  type: string
  required: boolean
  description: string
  constraints?: readonly string[]
}

export interface ApiContractManifest {
  file: string
  fields: readonly ApiContractField[]
  example: string
}

export interface ApiContractPermission {
  id: string
  grants: readonly string[]
  description: string
  risk: string
}

export interface ApiContractType {
  name: string
  declaration: string
  description: string
}

export interface ApiContractParameter {
  name: string
  type: string
  required: boolean
  description: string
  constraints?: readonly string[]
}

export interface ApiContractMethod {
  id: string
  name: string
  signature: string
  permission: string
  description: string
  parameters: readonly ApiContractParameter[]
  returns: string
  errors: readonly string[]
  behavior: readonly string[]
  example: string
  since: number
}

export interface ApiContractNamespace {
  name: string
  summary: string
  methods: readonly ApiContractMethod[]
}

export interface ExtensionApiContract {
  kind: string
  apiVersion: number
  kitVersion: string
  title: string
  summary: string
  runtime: ApiContractRuntime
  manifest: ApiContractManifest
  permissions: readonly ApiContractPermission[]
  types: readonly ApiContractType[]
  namespaces: readonly ApiContractNamespace[]
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as UnknownRecord
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`)
  return value
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`)
  }
  return value
}

function asStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value.map((item, index) => asString(item, `${label}[${index}]`))
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`)
}

function parseRuntime(value: unknown): ApiContractRuntime {
  const raw = asRecord(value, "runtime")
  const rawLimits = asRecord(raw.limits, "runtime.limits")
  const limits: Record<string, number> = {}
  for (const [key, item] of Object.entries(rawLimits)) limits[key] = asNumber(item, `runtime.limits.${key}`)
  return {
    language: asString(raw.language, "runtime.language"),
    module: asString(raw.module, "runtime.module"),
    activation: asStringArray(raw.activation, "runtime.activation"),
    sandbox: asStringArray(raw.sandbox, "runtime.sandbox"),
    limits,
    unsupported: asStringArray(raw.unsupported, "runtime.unsupported"),
  }
}

function parseField(value: unknown, index: number): ApiContractField {
  const raw = asRecord(value, `manifest.fields[${index}]`)
  return {
    name: asString(raw.name, `manifest.fields[${index}].name`),
    type: asString(raw.type, `manifest.fields[${index}].type`),
    required: asBoolean(raw.required, `manifest.fields[${index}].required`),
    description: asString(raw.description, `manifest.fields[${index}].description`),
    ...(raw.constraints === undefined
      ? {}
      : { constraints: asStringArray(raw.constraints, `manifest.fields[${index}].constraints`) }),
  }
}

function parseManifest(value: unknown): ApiContractManifest {
  const raw = asRecord(value, "manifest")
  if (!Array.isArray(raw.fields)) throw new Error("manifest.fields must be an array")
  const fields = raw.fields.map(parseField)
  unique(fields.map((field) => field.name), "manifest field names")
  return {
    file: asString(raw.file, "manifest.file"),
    fields,
    example: asString(raw.example, "manifest.example"),
  }
}

function parsePermission(value: unknown, index: number): ApiContractPermission {
  const raw = asRecord(value, `permissions[${index}]`)
  return {
    id: asString(raw.id, `permissions[${index}].id`),
    grants: asStringArray(raw.grants, `permissions[${index}].grants`),
    description: asString(raw.description, `permissions[${index}].description`),
    risk: asString(raw.risk, `permissions[${index}].risk`),
  }
}

function parseType(value: unknown, index: number): ApiContractType {
  const raw = asRecord(value, `types[${index}]`)
  return {
    name: asString(raw.name, `types[${index}].name`),
    declaration: asString(raw.declaration, `types[${index}].declaration`),
    description: asString(raw.description, `types[${index}].description`),
  }
}

function parseParameter(value: unknown, label: string): ApiContractParameter {
  const raw = asRecord(value, label)
  return {
    name: asString(raw.name, `${label}.name`),
    type: asString(raw.type, `${label}.type`),
    required: asBoolean(raw.required, `${label}.required`),
    description: asString(raw.description, `${label}.description`),
    ...(raw.constraints === undefined
      ? {}
      : { constraints: asStringArray(raw.constraints, `${label}.constraints`) }),
  }
}

function parseMethod(value: unknown, namespace: string, index: number): ApiContractMethod {
  const label = `namespaces.${namespace}.methods[${index}]`
  const raw = asRecord(value, label)
  if (!Array.isArray(raw.parameters)) throw new Error(`${label}.parameters must be an array`)
  const parameters = raw.parameters.map((item, parameterIndex) =>
    parseParameter(item, `${label}.parameters[${parameterIndex}]`),
  )
  unique(parameters.map((parameter) => parameter.name), `${label}.parameter names`)
  const since = asNumber(raw.since, `${label}.since`)
  if (!Number.isInteger(since) || since < 1) throw new Error(`${label}.since must be a positive integer`)
  const id = asString(raw.id, `${label}.id`)
  const name = asString(raw.name, `${label}.name`)
  if (id !== `${namespace}.${name}`) throw new Error(`${label}.id must match its namespace and name`)
  return {
    id,
    name,
    signature: asString(raw.signature, `${label}.signature`),
    permission: asString(raw.permission, `${label}.permission`),
    description: asString(raw.description, `${label}.description`),
    parameters,
    returns: asString(raw.returns, `${label}.returns`),
    errors: asStringArray(raw.errors, `${label}.errors`),
    behavior: asStringArray(raw.behavior, `${label}.behavior`),
    example: asString(raw.example, `${label}.example`),
    since,
  }
}

function parseNamespace(value: unknown, index: number): ApiContractNamespace {
  const raw = asRecord(value, `namespaces[${index}]`)
  const name = asString(raw.name, `namespaces[${index}].name`)
  if (!Array.isArray(raw.methods)) throw new Error(`namespaces.${name}.methods must be an array`)
  const methods = raw.methods.map((item, methodIndex) => parseMethod(item, name, methodIndex))
  unique(methods.map((method) => method.id), `namespaces.${name}.method ids`)
  return {
    name,
    summary: asString(raw.summary, `namespaces.${name}.summary`),
    methods,
  }
}

/** Parse and validate the checked-in, machine-readable public API contract. */
export function parseExtensionApiContract(source: string): ExtensionApiContract {
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    throw new Error("Extension API contract is not valid JSON")
  }
  const raw = asRecord(value, "Extension API contract")
  if (!Array.isArray(raw.permissions)) throw new Error("permissions must be an array")
  if (!Array.isArray(raw.types)) throw new Error("types must be an array")
  if (!Array.isArray(raw.namespaces)) throw new Error("namespaces must be an array")
  const permissions = raw.permissions.map(parsePermission)
  const types = raw.types.map(parseType)
  const namespaces = raw.namespaces.map(parseNamespace)
  unique(permissions.map((permission) => permission.id), "permission ids")
  unique(types.map((type) => type.name), "type names")
  unique(namespaces.map((namespace) => namespace.name), "namespace names")
  const methods = namespaces.flatMap((namespace) => namespace.methods)
  unique(methods.map((method) => method.id), "method ids")
  const permissionIds = new Set(permissions.map((permission) => permission.id))
  for (const method of methods) {
    if (!permissionIds.has(method.permission)) {
      throw new Error(`Unknown permission for ${method.id}: ${method.permission}`)
    }
  }
  const kind = asString(raw.kind, "kind")
  if (kind !== "brulion.extension-api") throw new Error(`Unsupported contract kind: ${kind}`)
  const apiVersion = asNumber(raw.apiVersion, "apiVersion")
  if (!Number.isInteger(apiVersion) || apiVersion < 1) throw new Error("apiVersion must be a positive integer")
  return {
    kind,
    apiVersion,
    kitVersion: asString(raw.kitVersion, "kitVersion"),
    title: asString(raw.title, "title"),
    summary: asString(raw.summary, "summary"),
    runtime: parseRuntime(raw.runtime),
    manifest: parseManifest(raw.manifest),
    permissions,
    types,
    namespaces,
  }
}

export function contractMethods(contract: ExtensionApiContract): readonly ApiContractMethod[] {
  return contract.namespaces.flatMap((namespace) => namespace.methods)
}
