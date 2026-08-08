import "./styles.css"
import { javascript } from "@codemirror/lang-javascript"
import { syntaxTree } from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import { classHighlighter, highlightTree } from "@lezer/highlight"
import apiReference from "../extension-kit/API.md?raw"
import declarations from "../extension-kit/brulion-extension.d.ts?raw"

const content = document.getElementById("api-docs-content")
const declarationSource = document.getElementById("api-docs-declaration-source")

if (!content || !declarationSource) {
  throw new Error("Missing API documentation mount point")
}

function appendInline(parent: HTMLElement, text: string): void {
  const tokenPattern = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let cursor = 0
  for (const match of text.matchAll(tokenPattern)) {
    const start = match.index ?? 0
    if (start > cursor) parent.append(document.createTextNode(text.slice(cursor, start)))
    const token = match[0]
    if (token.startsWith("`")) {
      const code = document.createElement("code")
      code.textContent = token.slice(1, -1)
      parent.append(code)
    } else {
      const strong = document.createElement("strong")
      strong.textContent = token.slice(2, -2)
      parent.append(strong)
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

function renderMarkdown(source: string, target: HTMLElement): void {
  const lines = source.replaceAll("\r", "").split("\n")
  let paragraph: string[] = []
  let list: HTMLUListElement | null = null
  let code: { lines: string[]; language: CodeLanguage } | null = null

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
    const pre = document.createElement("pre")
    pre.append(highlightedCode(code.lines.join("\n"), code.language))
    target.append(pre)
    code = null
  }

  for (const line of lines) {
    const fence = /^```\s*([\w-]+)?\s*$/.exec(line.trim())
    if (fence) {
      flushParagraph()
      flushList()
      if (code) flushCode()
      else code = { lines: [], language: codeLanguage(fence[1] ?? "javascript") }
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
      const element = document.createElement(`h${Math.min(heading[1].length + 1, 6)}`)
      appendInline(element, heading[2])
      if (!target.firstElementChild && element.tagName === "H2") {
        element.id = "api-docs-content-title"
      }
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

renderMarkdown(apiReference, content)
const highlightedDeclarations = highlightedCode(declarations, "typescript")
highlightedDeclarations.id = "api-docs-declaration-source"
declarationSource.replaceWith(highlightedDeclarations)

document.getElementById("api-docs-close")?.addEventListener("click", () => window.close())
