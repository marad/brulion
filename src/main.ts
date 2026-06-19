import { mountEditor } from "./editor"
import { wireOpenFolder, restoreFolder } from "./ui"

const editorEl = document.querySelector<HTMLDivElement>("#editor")
const openButton = document.querySelector<HTMLButtonElement>("#open-folder")
const resumeButton = document.querySelector<HTMLButtonElement>("#resume-access")
const fileList = document.querySelector<HTMLUListElement>("#file-list")
if (!editorEl || !openButton || !resumeButton || !fileList) {
  throw new Error("missing mount points in index.html")
}

mountEditor(editorEl)
wireOpenFolder(openButton, fileList, resumeButton)
void restoreFolder(fileList, resumeButton)
