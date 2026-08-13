/// <reference types="vite/client" />

import templateManifest from "../extension-kit/template/manifest.json?raw"
import templateSource from "../extension-kit/template/main.js?raw"
import declarations from "../extension-kit/brulion-extension.d.ts?raw"
import apiContract from "../extension-kit/api-contract.json?raw"
import exampleManifest from "../extension-kit/examples/hello-world/manifest.json?raw"
import exampleSource from "../extension-kit/examples/hello-world/main.js?raw"
import journalExampleManifest from "../extension-kit/examples/open-journal/manifest.json?raw"
import journalExampleSource from "../extension-kit/examples/open-journal/main.js?raw"
import resolveExampleManifest from "../extension-kit/examples/resolve-and-open/manifest.json?raw"
import resolveExampleSource from "../extension-kit/examples/resolve-and-open/main.js?raw"
import selectionFeedbackManifest from "../extension-kit/examples/selection-feedback/manifest.json?raw"
import selectionFeedbackSource from "../extension-kit/examples/selection-feedback/main.js?raw"
import dialogLifecycleManifest from "../extension-kit/examples/dialog-lifecycle/manifest.json?raw"
import dialogLifecycleSource from "../extension-kit/examples/dialog-lifecycle/main.js?raw"
import apiReference from "../extension-kit/API.md?raw"
import agents from "../extension-kit/AGENTS.md?raw"
import skill from "../extension-kit/llm-skill.md?raw"
import prompt from "../extension-kit/authoring-prompt.md?raw"
import readme from "../extension-kit/README.md?raw"

export const AUTHORING_KIT_VERSION = "1.3.0"

export interface AuthoringKitFile {
  path: string
  content: string
}

const FILES: readonly AuthoringKitFile[] = [
  { path: "template/manifest.json", content: templateManifest },
  { path: "template/main.js", content: templateSource },
  { path: "brulion-extension.d.ts", content: declarations },
  { path: "api-contract.json", content: apiContract },
  { path: "examples/hello-world/manifest.json", content: exampleManifest },
  { path: "examples/hello-world/main.js", content: exampleSource },
  { path: "examples/open-journal/manifest.json", content: journalExampleManifest },
  { path: "examples/open-journal/main.js", content: journalExampleSource },
  { path: "examples/resolve-and-open/manifest.json", content: resolveExampleManifest },
  { path: "examples/resolve-and-open/main.js", content: resolveExampleSource },
  { path: "examples/selection-feedback/manifest.json", content: selectionFeedbackManifest },
  { path: "examples/selection-feedback/main.js", content: selectionFeedbackSource },
  { path: "examples/dialog-lifecycle/manifest.json", content: dialogLifecycleManifest },
  { path: "examples/dialog-lifecycle/main.js", content: dialogLifecycleSource },
  { path: "API.md", content: apiReference },
  { path: "AGENTS.md", content: agents },
  { path: "llm-skill.md", content: skill },
  { path: "authoring-prompt.md", content: prompt },
  { path: "README.md", content: readme },
]

export function listAuthoringKitFiles(): readonly AuthoringKitFile[] {
  return FILES.map((file) => ({ ...file }))
}

export function getAuthoringKitFile(path: string): AuthoringKitFile | undefined {
  const file = FILES.find((candidate) => candidate.path === path)
  return file ? { ...file } : undefined
}

export function serializeAuthoringKit(): string {
  return FILES.map(
    (file) => "===== " + file.path + " =====\n" + file.content.replace(/\n?$/, "\n"),
  ).join("\n")
}
