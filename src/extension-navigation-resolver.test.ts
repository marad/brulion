import { describe, expect, it } from "vitest"
import { resolveNavigationLink } from "./extension-navigation"

const notePaths = new Set([
  "Journal/today.md",
  "Journal/tomorrow.md",
  "Projects/Alpha.md",
  "Tasks/today.md",
])
const context = { activeNote: "Journal/today.md", notePaths }

describe("resolveNavigationLink", () => {
  it("resolves a relative markdown note and preserves its anchor", () => {
    expect(
      resolveNavigationLink("../Tasks/today.md#next", {
        kind: "markdown",
        from: "Journal/today.md",
      }, context),
    ).toEqual({ status: "resolved", path: "Tasks/today.md", anchor: "next" })
  })

  it("resolves a same-note markdown anchor from the explicit source or active note", () => {
    expect(
      resolveNavigationLink("#focus", { kind: "markdown", from: "Journal/today.md" }, context),
    ).toEqual({ status: "resolved", path: "Journal/today.md", anchor: "focus" })
    expect(resolveNavigationLink("#focus", { kind: "markdown" }, context)).toEqual({
      status: "resolved",
      path: "Journal/today.md",
      anchor: "focus",
    })
  })

  it("reports a valid absent markdown target without creating it", () => {
    expect(
      resolveNavigationLink("later.md", { kind: "markdown", from: "Journal/today.md" }, context),
    ).toEqual({ status: "missing", path: "Journal/later.md", anchor: null })
    expect(notePaths).not.toContain("Journal/later.md")
  })

  it("classifies external markdown destinations before requiring a source or listing", () => {
    expect(
      resolveNavigationLink("https://example.test/note#section", { kind: "markdown" }, {
        activeNote: null,
        notePaths: new Set(),
      }),
    ).toEqual({ status: "external", target: "https://example.test/note#section" })
    expect(resolveNavigationLink("//example.test/note", { kind: "markdown" }, context)).toEqual({
      status: "external",
      target: "//example.test/note",
    })
  })

  it("rejects unsafe, non-note, escaping, and source-less markdown destinations", () => {
    for (const target of ["../../outside.md", "/root.md", "folder\\note.md", "folder/<note>.md", "readme.txt"]) {
      expect(
        resolveNavigationLink(target, { kind: "markdown", from: "Journal/today.md" }, context),
      ).toEqual({ status: "invalid", target })
    }
    expect(
      resolveNavigationLink("child.md", { kind: "markdown" }, { activeNote: null, notePaths }),
    ).toEqual({ status: "invalid", target: "child.md" })
  })

  it("resolves wikilink basenames, paths, and anchors with existing matching rules", () => {
    expect(resolveNavigationLink("TODAY#focus", { kind: "wikilink" }, context)).toEqual({
      status: "resolved",
      path: "Journal/today.md",
      anchor: "focus",
    })
    expect(resolveNavigationLink("projects/alpha", { kind: "wikilink" }, context)).toEqual({
      status: "resolved",
      path: "Projects/Alpha.md",
      anchor: null,
    })
  })

  it("reports missing normalized wikilinks and rejects malformed targets", () => {
    expect(resolveNavigationLink("New note", { kind: "wikilink" }, context)).toEqual({
      status: "missing",
      path: "New note.md",
      anchor: null,
    })
    expect(resolveNavigationLink("folder/new-note.md#later", { kind: "wikilink" }, context)).toEqual({
      status: "missing",
      path: "folder/new-note.md",
      anchor: "later",
    })
    for (const target of ["", "../outside", "folder\\note", ".brulion/state", "folder/<note>"]) {
      expect(resolveNavigationLink(target, { kind: "wikilink" }, context)).toEqual({
        status: "invalid",
        target,
      })
    }
    expect(resolveNavigationLink("mailto:me@example.test", { kind: "wikilink" }, context)).toEqual({
      status: "external",
      target: "mailto:me@example.test",
    })
  })

  it("returns invalid for an unsupported syntax kind without touching the context", () => {
    const before = [...notePaths]
    expect(
      resolveNavigationLink("today", { kind: "other" as "markdown" }, context),
    ).toEqual({ status: "invalid", target: "today" })
    expect([...notePaths]).toEqual(before)
  })
})
