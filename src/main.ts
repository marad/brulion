import { mountEditor } from "./editor"

const app = document.querySelector<HTMLDivElement>("#app")
if (!app) throw new Error("#app mount point not found")

mountEditor(app)
