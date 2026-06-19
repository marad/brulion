import { mountEditor } from "./editor"
import { pickFolder, listMarkdownFiles } from "./fs"

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const fileList = document.querySelector<HTMLUListElement>("#file-list")
if (!editorEl || !openButton || !fileList) {
  throw new Error("missing mount points in index.html")
}

mountEditor(editorEl)

openButton.addEventListener("click", async () => {
  const dir = await pickFolder()
  if (!dir) return // picker dismissed — leave everything as it was
  renderFileList(fileList, await listMarkdownFiles(dir))
})

function renderFileList(list: HTMLUListElement, names: string[]): void {
  list.replaceChildren(
    ...names.map((name) => {
      const item = document.createElement("li")
      item.textContent = name
      return item
    }),
  )
}
