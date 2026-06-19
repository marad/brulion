import { pickFolder, listMarkdownFiles } from "./fs"

/** Render `names` as the contents of `list`, replacing whatever was there. */
export function renderFileList(list: HTMLUListElement, names: string[]): void {
  list.replaceChildren(
    ...names.map((name) => {
      const item = document.createElement("li")
      item.textContent = name
      return item
    }),
  )
}

/**
 * Pick a folder and render its markdown files into `list`. A dismissed picker
 * leaves `list` untouched. Any failure is logged, never thrown — this runs from
 * a fire-and-forget click handler, so an unhandled rejection would otherwise
 * surface only as a console warning with no context.
 */
export async function openFolder(list: HTMLUListElement): Promise<void> {
  try {
    const dir = await pickFolder()
    if (!dir) return // dismissed — leave everything as it was
    renderFileList(list, await listMarkdownFiles(dir))
  } catch (err) {
    console.error("Failed to open folder:", err)
  }
}

/** Wire `button`'s click (the required user gesture) to {@link openFolder}. */
export function wireOpenFolder(
  button: HTMLButtonElement,
  list: HTMLUListElement,
): void {
  button.addEventListener("click", () => {
    void openFolder(list)
  })
}
