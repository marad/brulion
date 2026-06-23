import { Annotation } from "@codemirror/state"

/**
 * Marks a transaction that loads document content programmatically (a note load,
 * an external-refresh apply) rather than a user edit. Two consumers read it:
 * `editor.ts` skips the autosave `onChange` for these, and `frontmatter.ts` resets
 * its collapse state so every freshly-loaded note opens with frontmatter collapsed.
 * Lives in its own module so both can import it without an editor↔frontmatter cycle.
 */
export const ProgrammaticLoad = Annotation.define<boolean>()
