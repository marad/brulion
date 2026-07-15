import { describe, it, expect, beforeEach } from "vitest"
import { mountDialog } from "./dialog"
import type { DialogElements } from "./dialog"

function elements(): DialogElements {
  const backdrop = document.createElement("div")
  const dialog = document.createElement("div")
  const message = document.createElement("p")
  const input = document.createElement("input")
  const cancelButton = document.createElement("button")
  const confirmButton = document.createElement("button")
  backdrop.hidden = true
  input.hidden = true
  document.body.append(backdrop, dialog, message, input, cancelButton, confirmButton)
  return { backdrop, dialog, message, input, cancelButton, confirmButton }
}

function key(target: HTMLElement, k: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }))
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("mountDialog confirm (FEAT-0073)", () => {
  it("shows the message, hides the input, resolves true on confirm", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const result = dialog.confirm("Delete it?")
    expect(els.backdrop.hidden).toBe(false)
    expect(els.message.textContent).toBe("Delete it?")
    expect(els.input.hidden).toBe(true)
    expect(els.cancelButton.hidden).toBe(false)

    els.confirmButton.click()
    expect(await result).toBe(true)
    expect(els.backdrop.hidden).toBe(true)
  })

  it("uses a custom confirm label when given", () => {
    const els = elements()
    const dialog = mountDialog(els)

    void dialog.confirm("Delete it?", "Delete")

    expect(els.confirmButton.textContent).toBe("Delete")
  })

  it("resolves false on cancel click", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const result = dialog.confirm("Delete it?")
    els.cancelButton.click()

    expect(await result).toBe(false)
  })

  it("resolves false on Escape", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const result = dialog.confirm("Delete it?")
    key(document.body, "Escape")

    expect(await result).toBe(false)
  })

  it("resolves false on a backdrop click", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const result = dialog.confirm("Delete it?")
    els.backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(await result).toBe(false)
  })
})

describe("mountDialog prompt (FEAT-0073)", () => {
  it("shows and focuses the input, pre-filled with the initial value", () => {
    const els = elements()
    const dialog = mountDialog(els)

    void dialog.prompt("Rename to:", "old-name")

    expect(els.input.hidden).toBe(false)
    expect(els.input.value).toBe("old-name")
    expect(document.activeElement).toBe(els.input)
  })

  it("resolves the input's value on confirm click", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const result = dialog.prompt("New folder name:")
    els.input.value = "ideas"
    els.confirmButton.click()

    expect(await result).toBe("ideas")
  })

  it("resolves the input's value on Enter", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const result = dialog.prompt("New folder name:")
    els.input.value = "ideas"
    key(els.input, "Enter")

    expect(await result).toBe("ideas")
  })

  it("resolves null on cancel", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const result = dialog.prompt("Rename to:", "old-name")
    els.cancelButton.click()

    expect(await result).toBe(null)
  })
})

describe("mountDialog alert (FEAT-0073)", () => {
  it("hides the input and the cancel button, dismissed by its one button", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const result = dialog.alert("Could not move it there.")
    expect(els.message.textContent).toBe("Could not move it there.")
    expect(els.input.hidden).toBe(true)
    expect(els.cancelButton.hidden).toBe(true)

    els.confirmButton.click()
    await result // resolves, doesn't hang
  })
})

describe("mountDialog focus restore and superseding (FEAT-0073)", () => {
  it("restores focus to whatever had it before opening", async () => {
    const els = elements()
    const dialog = mountDialog(els)
    const trigger = document.createElement("button")
    document.body.append(trigger)
    trigger.focus()

    const result = dialog.confirm("Delete it?")
    els.confirmButton.click()
    await result

    expect(document.activeElement).toBe(trigger)
  })

  it("a second open() resolves the first call's promise instead of leaving it dangling", async () => {
    const els = elements()
    const dialog = mountDialog(els)

    const first = dialog.confirm("First?")
    const second = dialog.confirm("Second?")
    els.confirmButton.click()

    expect(await first).toBe(false)
    expect(await second).toBe(true)
  })
})
