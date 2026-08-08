import "./styles.css"
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

function renderMarkdown(source: string, target: HTMLElement): void {
  const lines = source.replaceAll("\r", "").split("\n")
  let paragraph: string[] = []
  let list: HTMLUListElement | null = null
  let code: string[] | null = null

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
    const codeElement = document.createElement("code")
    codeElement.textContent = code.join("\n")
    pre.append(codeElement)
    target.append(pre)
    code = null
  }

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      flushParagraph()
      flushList()
      if (code) flushCode()
      else code = []
      continue
    }
    if (code) {
      code.push(line)
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
declarationSource.textContent = declarations

document.getElementById("api-docs-close")?.addEventListener("click", () => window.close())
