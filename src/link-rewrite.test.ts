import { describe, it, expect } from "vitest"
import { relativeLink, rewriteLinksForRename } from "./link-rewrite"
import { resolveNotePath } from "./note-name"

/** Build a path set the way the contract expects (ReadonlySet<string>). */
const vault = (...paths: string[]): ReadonlySet<string> => new Set(paths)

describe("relativeLink — round-trip invariant", () => {
  // The defining property: resolveNotePath(from, relativeLink(from, target)) === target.
  const cases: Array<{ name: string; from: string; target: string }> = [
    { name: "same folder, root", from: "n.md", target: "diablo.md" },
    { name: "same folder, nested", from: "sub/n.md", target: "sub/diablo.md" },
    { name: "target in a subfolder", from: "n.md", target: "sub/diablo.md" },
    { name: "target needs ../ (sibling folder)", from: "sub/n.md", target: "archive/diablo.md" },
    { name: "target needs ../ (up to root)", from: "sub/n.md", target: "diablo.md" },
    { name: "both nested, deep", from: "a/b/c/n.md", target: "a/b/x/diablo.md" },
    { name: "deep target from root", from: "n.md", target: "a/b/c/diablo.md" },
    { name: "deep source to deep sibling", from: "a/b/c/n.md", target: "x/y/z/diablo.md" },
  ]

  for (const { name, from, target } of cases) {
    it(`round-trips: ${name}`, () => {
      const link = relativeLink(from, target)
      expect(resolveNotePath(from, link)).toBe(target)
    })
  }

  it("yields a bare filename (no ./) for a same-folder target", () => {
    expect(relativeLink("n.md", "diablo.md")).toBe("diablo.md")
    expect(relativeLink("sub/n.md", "sub/diablo.md")).toBe("diablo.md")
  })

  it("uses ../ to reach a sibling folder", () => {
    expect(relativeLink("sub/n.md", "archive/diablo.md")).toBe("../archive/diablo.md")
  })
})

describe("rewriteLinksForRename — markdown links", () => {
  it("AC-1: rewrites a same-folder markdown link, leaving the rest untouched", () => {
    const text = "before [d](diablo.md) after"
    const out = rewriteLinksForRename({
      text,
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    expect(out).toBe("before [d](diablo-2.md) after")
  })

  it("AC-2: rebases a markdown link across a folder move and re-resolves (round-trip)", () => {
    const text = "see [d](diablo.md)"
    const out = rewriteLinksForRename({
      text,
      notePath: "sub/n.md",
      oldPath: "sub/diablo.md",
      newPath: "archive/diablo.md",
      pathsBefore: vault("sub/n.md", "sub/diablo.md"),
      pathsAfter: vault("sub/n.md", "archive/diablo.md"),
    })
    expect(out).toBe("see [d](../archive/diablo.md)")
    // round-trip: the rewritten destination re-resolves to newPath from sub/n.md.
    expect(resolveNotePath("sub/n.md", "../archive/diablo.md")).toBe("archive/diablo.md")
  })

  it("AC-3: wraps a destination containing a space in <…> and re-resolves to newPath", () => {
    const text = "go [d](diablo.md)"
    const out = rewriteLinksForRename({
      text,
      notePath: "sub/n.md",
      oldPath: "sub/diablo.md",
      newPath: "x/new note.md",
      pathsBefore: vault("sub/n.md", "sub/diablo.md"),
      pathsAfter: vault("sub/n.md", "x/new note.md"),
    })
    expect(out).toBe("go [d](<../x/new note.md>)")
    expect(resolveNotePath("sub/n.md", "<../x/new note.md>")).toBe("x/new note.md")
  })
})

describe("rewriteLinksForRename — wikilinks", () => {
  it("AC-4: a bare wikilink stays bare when the basename is renamed (unique after)", () => {
    const out = rewriteLinksForRename({
      text: "link [[diablo]] here",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    expect(out).toBe("link [[diablo-2]] here")
  })

  it("AC-5: a bare wikilink is left untouched by a pure folder move (returns null)", () => {
    const out = rewriteLinksForRename({
      text: "link [[diablo]] here",
      notePath: "n.md",
      oldPath: "proj/diablo.md",
      newPath: "archive/diablo.md",
      pathsBefore: vault("n.md", "proj/diablo.md"),
      pathsAfter: vault("n.md", "archive/diablo.md"),
    })
    expect(out).toBeNull()
  })

  it("AC-6: a bare wikilink is promoted to a full path when the move makes it ambiguous", () => {
    // [[note]] resolves (first sorted) to a/note.md; b/note.md also present.
    const out = rewriteLinksForRename({
      text: "see [[note]]",
      notePath: "n.md",
      oldPath: "a/note.md",
      newPath: "c/note.md",
      pathsBefore: vault("n.md", "a/note.md", "b/note.md"),
      pathsAfter: vault("n.md", "c/note.md", "b/note.md"),
    })
    expect(out).toBe("see [[c/note]]")
  })

  it("AC-7: a slashed wikilink is rewritten to the new full path, alias preserved", () => {
    const out = rewriteLinksForRename({
      text: "see [[sub/diablo|Diablo]]",
      notePath: "n.md",
      oldPath: "sub/diablo.md",
      newPath: "archive/diablo.md",
      pathsBefore: vault("n.md", "sub/diablo.md"),
      pathsAfter: vault("n.md", "archive/diablo.md"),
    })
    expect(out).toBe("see [[archive/diablo|Diablo]]")
  })
})

describe("rewriteLinksForRename — exclusions and no-ops", () => {
  it("AC-8: unrelated, external, and image links are never rewritten (returns null)", () => {
    const text =
      "a [other](other.md) b [ext](https://x.test) c ![img](diablo.md)"
    const out = rewriteLinksForRename({
      text,
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md", "other.md"),
      pathsAfter: vault("n.md", "diablo-2.md", "other.md"),
    })
    expect(out).toBeNull()
  })

  it("returns null for a note with no links at all", () => {
    const out = rewriteLinksForRename({
      text: "just some prose, nothing linked",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    expect(out).toBeNull()
  })

  it("returns null when every link points at a different note", () => {
    const out = rewriteLinksForRename({
      text: "[a](other.md) and [[somewhere/else]]",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md", "other.md", "somewhere/else.md"),
      pathsAfter: vault("n.md", "diablo-2.md", "other.md", "somewhere/else.md"),
    })
    expect(out).toBeNull()
  })

  it("leaves an image link to the renamed note untouched (returns null when it's the only link)", () => {
    const out = rewriteLinksForRename({
      text: "![pic](diablo.md)",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    expect(out).toBeNull()
  })
})

describe("rewriteLinksForRename — multiple matches in one note", () => {
  it("rewrites both a markdown link and a wikilink to the renamed note in one call", () => {
    const out = rewriteLinksForRename({
      text: "md [d](diablo.md) and wiki [[diablo]]",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    expect(out).toBe("md [d](diablo-2.md) and wiki [[diablo-2]]")
  })

  it("rewrites every markdown link to the renamed note", () => {
    const out = rewriteLinksForRename({
      text: "[one](diablo.md) [two](diablo.md) [three](diablo.md)",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    expect(out).toBe("[one](diablo-2.md) [two](diablo-2.md) [three](diablo-2.md)")
  })

  it("rewrites the renamed note's links but leaves a sibling link to another note", () => {
    const out = rewriteLinksForRename({
      text: "[d](diablo.md) and [o](other.md)",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md", "other.md"),
      pathsAfter: vault("n.md", "diablo-2.md", "other.md"),
    })
    expect(out).toBe("[d](diablo-2.md) and [o](other.md)")
  })
})

describe("rewriteLinksForRename — wikilink whitespace, aliases, case", () => {
  it("rewrites a bare wikilink that carries an alias, preserving the alias", () => {
    const out = rewriteLinksForRename({
      text: "see [[diablo|D]]",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    expect(out).toBe("see [[diablo-2|D]]")
  })

  it("resolves a bare wikilink with surrounding whitespace", () => {
    // resolveWikilink trims the target, so [[ diablo ]] still points at diablo.md.
    const out = rewriteLinksForRename({
      text: "see [[ diablo ]]",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    // Whatever the whitespace handling, the target must now point at diablo-2,
    // not the now-vanished diablo, and the link must not be left dangling.
    expect(out).not.toBeNull()
    expect(out).toContain("diablo-2")
    expect(out).not.toMatch(/\[\[\s*diablo\s*\]\]/)
  })

  it("resolves a bare wikilink case-insensitively ([[Diablo]] → diablo.md)", () => {
    const out = rewriteLinksForRename({
      text: "see [[Diablo]]",
      notePath: "n.md",
      oldPath: "diablo.md",
      newPath: "diablo-2.md",
      pathsBefore: vault("n.md", "diablo.md"),
      pathsAfter: vault("n.md", "diablo-2.md"),
    })
    // The link resolved to diablo.md and must be retargeted to the new note.
    expect(out).not.toBeNull()
    expect(out).toContain("diablo-2")
  })
})
