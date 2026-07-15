/// <reference types="vite/client" />
import { describe, it, expect } from "vitest"
import indexHtml from "../index.html?raw"

// FEAT-0074 — the switcher/palette/move-picker/dialog inputs are declared
// statically in index.html (unlike the note-identity rename input and the
// settings modal's journal field, covered in ui.test.ts/settings-modal.test.ts,
// which build their own DOM). Read through Vite's ?raw import, same pattern
// manifest.test.ts already uses for index.html assertions.

const STATIC_INPUT_IDS = ["switcher-input", "palette-input", "move-input", "dialog-input"]

describe("FEAT-0074 anti-autofill attributes on static text inputs", () => {
  for (const id of STATIC_INPUT_IDS) {
    it(`#${id} carries the anti-autofill attribute set (AC-1)`, () => {
      const match = indexHtml.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))
      expect(match, `no <input id="${id}"> found`).toBeTruthy()
      const tag = match![0]
      expect(tag).toContain('autocomplete="off"')
      expect(tag).toContain('data-lpignore="true"')
      expect(tag).toContain("data-1p-ignore")
      expect(tag).toContain('data-bwignore="true"')
      expect(tag).toContain('data-form-type="other"')
    })
  }
})
