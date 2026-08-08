import "./styles.css"
import { javascript } from "@codemirror/lang-javascript"
import { syntaxTree } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import { classHighlighter, highlightTree } from "@lezer/highlight"
import apiReference from "../extension-kit/API.md?raw"
import apiContractSource from "../extension-kit/api-contract.json?raw"
import declarations from "../extension-kit/brulion-extension.d.ts?raw"
import {
  contractMethods,
  parseExtensionApiContract,
  type ApiContractMethod,
  type ApiContractNamespace,
  type ExtensionApiContract,
} from "./extension-api-contract"

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing API documentation mount point: ${id}`)
  return element as T
}

const content = requiredElement<HTMLElement>("api-docs-content")
const declarationSource = requiredElement<HTMLElement>("api-docs-declaration-source")
const reference = requiredElement<HTMLElement>("api-docs-reference")
const methodsMount = requiredElement<HTMLElement>("api-docs-methods")
const typesMount = requiredElement<HTMLElement>("api-docs-type-list")
const toc = requiredElement<HTMLElement>("api-docs-toc")
const search = requiredElement<HTMLInputElement>("api-docs-search")
const searchStatus = requiredElement<HTMLElement>("api-docs-search-status")

function appendInline(parent: HTMLElement, text: string): void {
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*|\[([^\]]+)\]\(([^)]+)\))/g
  let cursor = 0
  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index ?? 0
    if (start > cursor) parent.append(document.createTextNode(text.slice(cursor, start)))
    const token = match[0]
    if (token.startsWith("`")) {
      const code = document.createElement("code")
      code.textContent = token.slice(1, -1)
      parent.append(code)
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong")
      strong.textContent = token.slice(2, -2)
      parent.append(strong)
    } else {
      const link = document.createElement("a")
      link.textContent = match[2] ?? token
      const href = match[3] ?? "#"
      link.href = href
      if (/^(?:https?:|mailto:)/i.test(href)) {
        link.target = "_blank"
        link.rel = "noreferrer"
      }
      parent.append(link)
    }
    cursor = start + token.length
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)))
}

type CodeLanguage = "javascript" | "typescript"

function highlightedCode(source: string, language: CodeLanguage): HTMLElement {
  const code = document.createElement("code")
  const state = EditorState.create({
    doc: source,
    extensions: [javascript({ typescript: language === "typescript" })],
  })
  const marks: { from: number; to: number; cls: string }[] = []
  highlightTree(syntaxTree(state), classHighlighter, (from, to, cls) => {
    if (from < to) marks.push({ from, to, cls })
  })
  let cursor = 0
  for (const mark of marks) {
    const from = Math.max(cursor, mark.from)
    if (from > cursor) code.append(document.createTextNode(source.slice(cursor, from)))
    if (mark.to <= from) continue
    const token = document.createElement("span")
    token.className = mark.cls
    token.textContent = source.slice(from, mark.to)
    code.append(token)
    cursor = mark.to
  }
  if (cursor < source.length) code.append(document.createTextNode(source.slice(cursor)))
  return code
}

function codeLanguage(label: string): CodeLanguage {
  return /^(ts|typescript|tsx)$/i.test(label) ? "typescript" : "javascript"
}

function copyFallback(text: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.append(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand("copy")
  } catch {
    copied = false
  }
  textarea.remove()
  return copied
}

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent ?? "Copy"
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text)
    else if (!copyFallback(text)) throw new Error("Clipboard unavailable")
    button.textContent = "Copied"
    button.dataset.copied = "true"
  } catch {
    button.textContent = "Copy failed"
    button.dataset.copied = "false"
  }
  window.setTimeout(() => {
    button.textContent = original
    delete button.dataset.copied
  }, 1400)
}

function copyButton(label: string, text: string): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "api-docs-copy-button"
  button.textContent = label
  button.addEventListener("click", () => void copyText(text, button))
  return button
}

function codePanel(source: string, label: string, language = codeLanguage(label)): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = "api-docs-code-panel"
  const toolbar = document.createElement("div")
  toolbar.className = "api-docs-code-toolbar"
  const languageLabel = document.createElement("span")
  languageLabel.className = "api-docs-code-language"
  languageLabel.textContent = label || "code"
  toolbar.append(languageLabel, copyButton("Copy", source))
  const pre = document.createElement("pre")
  pre.append(highlightedCode(source, language))
  wrapper.append(toolbar, pre)
  return wrapper
}

function renderMarkdown(source: string, target: HTMLElement): void {
  const lines = source.replaceAll("\r", "").split("\n")
  let paragraph: string[] = []
  let list: HTMLUListElement | null = null
  let code: { lines: string[]; label: string } | null = null

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const element = document.createElement("p")
    appendInline(element, paragraph.join(" "))
    target.append(element)
    paragraph = []
  }
  const flushList = () => {
    if (list) target.append(list)
    list = null
  }
  const flushCode = () => {
    if (!code) return
    target.append(codePanel(code.lines.join("\n"), code.label))
    code = null
  }

  for (const line of lines) {
    const fence = /^```\s*([\w-]+)?\s*$/.exec(line.trim())
    if (fence) {
      flushParagraph()
      flushList()
      if (code) flushCode()
      else code = { lines: [], label: fence[1] ?? "text" }
      continue
    }
    if (code) {
      code.lines.push(line)
      continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      flushParagraph()
      flushList()
      const level = Math.min(heading[1].length + 1, 6)
      const element = document.createElement(`h${level}`)
      appendInline(element, heading[2])
      if (!target.firstElementChild && level === 2) element.id = "api-docs-content-title"
      target.append(element)
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    if (bullet) {
      flushParagraph()
      list ??= document.createElement("ul")
      const item = document.createElement("li")
      appendInline(item, bullet[1])
      list.append(item)
      continue
    }
    if (line.trim() === "") {
      flushParagraph()
      flushList()
      continue
    }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  flushCode()
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function heading(parent: HTMLElement, level: 2 | 3 | 4, text: string, id: string): HTMLHeadingElement {
  const element = document.createElement(`h${level}`) as HTMLHeadingElement
  element.id = id
  element.textContent = text
  parent.append(element)
  return element
}

function inlineCode(text: string): HTMLElement {
  const element = document.createElement("code")
  element.textContent = text
  return element
}

function paragraph(parent: HTMLElement, text: string): HTMLParagraphElement {
  const element = document.createElement("p")
  appendInline(element, text)
  parent.append(element)
  return element
}

function bulletList(parent: HTMLElement, items: readonly string[]): void {
  const list = document.createElement("ul")
  for (const itemText of items) {
    const item = document.createElement("li")
    appendInline(item, itemText)
    list.append(item)
  }
  parent.append(list)
}

function table(parent: HTMLElement, headers: readonly string[], rows: readonly (readonly string[])[]): void {
  const table = document.createElement("table")
  table.className = "api-docs-table"
  const thead = document.createElement("thead")
  const headerRow = document.createElement("tr")
  for (const header of headers) {
    const cell = document.createElement("th")
    cell.scope = "col"
    cell.textContent = header
    headerRow.append(cell)
  }
  thead.append(headerRow)
  const body = document.createElement("tbody")
  for (const row of rows) {
    const tableRow = document.createElement("tr")
    for (const [index, value] of row.entries()) {
      const cell = document.createElement("td")
      if (index < 2) cell.append(inlineCode(value))
      else cell.textContent = value
      tableRow.append(cell)
    }
    body.append(tableRow)
  }
  table.append(thead, body)
  parent.append(table)
}

function renderMethod(namespace: ApiContractNamespace, method: ApiContractMethod, parent: HTMLElement): HTMLElement {
  const card = document.createElement("article")
  card.className = "api-method-card"
  card.id = `api-method-${slug(method.id)}`
  card.dataset.search = `${namespace.name} ${method.id} ${method.name} ${method.description} ${method.permission}`.toLowerCase()

  const header = document.createElement("header")
  header.className = "api-method-header"
  const title = document.createElement("h4")
  title.className = "api-method-title"
  title.id = `${card.id}-title`
  title.append(inlineCode(method.signature))
  const permission = document.createElement("span")
  permission.className = "api-docs-permission"
  permission.textContent = method.permission
  header.append(title, permission)
  card.append(header)

  paragraph(card, method.description)
  const meta = document.createElement("p")
  meta.className = "api-method-meta"
  meta.append(document.createTextNode("API "))
  meta.append(inlineCode(`v${method.since}`))
  meta.append(document.createTextNode(" · Returns "))
  meta.append(inlineCode(method.returns))
  card.append(meta)

  if (method.parameters.length > 0) {
    const parametersHeading = document.createElement("h5")
    parametersHeading.textContent = "Parameters"
    card.append(parametersHeading)
    table(
      card,
      ["Name", "Type", "Description"],
      method.parameters.map((parameter) => [parameter.name, parameter.type, parameter.description]),
    )
    for (const parameter of method.parameters) {
      if (!parameter.constraints || parameter.constraints.length === 0) continue
      const constraints = document.createElement("p")
      constraints.className = "api-method-constraints"
      constraints.append(inlineCode(parameter.name), document.createTextNode(": "))
      constraints.append(document.createTextNode(parameter.constraints.join("; ")))
      card.append(constraints)
    }
  }

  const behaviorHeading = document.createElement("h5")
  behaviorHeading.textContent = "Behavior"
  card.append(behaviorHeading)
  bulletList(card, method.behavior)

  const errorsHeading = document.createElement("h5")
  errorsHeading.textContent = "Rejects when"
  card.append(errorsHeading)
  bulletList(card, method.errors)

  const exampleHeading = document.createElement("h5")
  exampleHeading.textContent = "Example"
  card.append(exampleHeading, codePanel(method.example, "javascript"))
  card.setAttribute("aria-labelledby", title.id)
  parent.append(card)
  return card
}

function renderContract(contract: ExtensionApiContract): void {
  methodsMount.replaceChildren()
  for (const namespace of contract.namespaces) {
    const section = document.createElement("section")
    section.className = "api-namespace"
    section.id = `api-namespace-${slug(namespace.name)}`
    heading(section, 3, `brulion.${namespace.name}`, section.id + "-title")
    paragraph(section, namespace.summary)
    for (const method of namespace.methods) renderMethod(namespace, method, section)
    methodsMount.append(section)
  }

  typesMount.replaceChildren()
  for (const type of contract.types) {
    const section = document.createElement("section")
    section.className = "api-type-card"
    section.id = `api-type-${slug(type.name)}`
    heading(section, 3, type.name, section.id + "-title")
    paragraph(section, type.description)
    section.append(codePanel(type.declaration, "typescript", "typescript"))
    typesMount.append(section)
  }
}

function addHeadingIds(): void {
  const headings = Array.from(content.querySelectorAll<HTMLElement>("h2, h3, h4")).concat(
    Array.from(reference.querySelectorAll<HTMLElement>("h2, h3, h4")),
    Array.from(typesMount.querySelectorAll<HTMLElement>("h2, h3, h4")),
    Array.from(document.getElementById("api-docs-declarations")?.querySelectorAll<HTMLElement>("h2, h3, h4") ?? []),
  )
  const used = new Set<string>()
  toc.replaceChildren()
  for (const element of headings) {
    if (element.classList.contains("api-method-subheading")) continue
    let id = element.id || `api-${slug(element.textContent ?? "section")}`
    while (used.has(id)) id += "-section"
    element.id = id
    used.add(id)
    const link = document.createElement("a")
    link.href = `#${id}`
    link.className = `api-docs-toc-level-${element.tagName.slice(1)}`
    link.textContent = element.textContent ?? "Section"
    toc.append(link)
  }
}

function filterMethods(query: string): void {
  const normalized = query.trim().toLowerCase()
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".api-method-card"))
  let visible = 0
  for (const card of cards) {
    const matches = normalized === "" || (card.dataset.search ?? "").includes(normalized)
    card.hidden = !matches
    if (matches) visible++
  }
  for (const namespace of Array.from(document.querySelectorAll<HTMLElement>(".api-namespace"))) {
    namespace.hidden = !Array.from(namespace.querySelectorAll<HTMLElement>(".api-method-card")).some((card) => !card.hidden)
  }
  searchStatus.textContent = normalized === "" ? `${cards.length} methods` : `${visible} matching method${visible === 1 ? "" : "s"}`
}

function bindCopyTargets(): void {
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-copy-target]"))) {
    const targetId = button.dataset.copyTarget
    const target = targetId ? document.getElementById(targetId) : null
    if (!target) continue
    button.addEventListener("click", () => void copyText(target.textContent ?? "", button))
  }
}

function downloadContract(contract: string): void {
  const link = document.createElement("a")
  link.href = URL.createObjectURL(new Blob([contract], { type: "application/json" }))
  link.download = "api-contract.json"
  link.click()
  URL.revokeObjectURL(link.href)
}

const contract = parseExtensionApiContract(apiContractSource)
renderMarkdown(apiReference, content)
renderContract(contract)
const highlightedDeclarations = highlightedCode(declarations, "typescript")
highlightedDeclarations.id = "api-docs-declaration-source"
declarationSource.replaceWith(highlightedDeclarations)
addHeadingIds()
bindCopyTargets()
filterMethods("")
search.addEventListener("input", () => filterMethods(search.value))
document.getElementById("api-docs-contract")?.addEventListener("click", () => downloadContract(apiContractSource))
document.getElementById("api-docs-close")?.addEventListener("click", () => window.close())

// Keep this reference in the entry graph so adding a public method without a
// contract card is caught by the contract test rather than only at runtime.
void contractMethods(contract)
