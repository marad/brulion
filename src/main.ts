import { mountEditor } from "./editor"
import { wireOpenFolder } from "./ui"

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const fileList = document.querySelector<HTMLUListElement>("#file-list")
if (!editorEl || !openButton || !fileList) {
  throw new Error("missing mount points in index.html")
}

mountEditor(editorEl)
wireOpenFolder(openButton, fileList)
