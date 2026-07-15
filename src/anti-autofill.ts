/**
 * The anti-autofill attribute set (M35/FEAT-0074): `autocomplete="off"` alone
 * doesn't reliably stop password managers like Bitwarden, which override it
 * for fields that look like login prompts — the vendor-specific ignore
 * attributes plus a generic form-type hint are the standard mitigation.
 * Applied here as one call so a future dynamically-created text input can't
 * silently miss it the way this one first got noticed missing.
 */
export function applyAntiAutofillAttrs(input: HTMLInputElement): void {
  input.autocomplete = "off"
  input.setAttribute("data-lpignore", "true")
  input.setAttribute("data-1p-ignore", "")
  input.setAttribute("data-bwignore", "true")
  input.setAttribute("data-form-type", "other")
}
