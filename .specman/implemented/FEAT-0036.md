---
id: FEAT-0036
title: "Note URLs: hash route for the open note"
status: draft
depends_on: [FEAT-0023, FEAT-0011]
---

## Intent

Today an open note has no address. There is no way to bookmark "this note",
share a link to it, or use the browser's Back button to return to the note you
just came from — switching notes leaves no trail the browser can navigate. The
only "history" is the single persisted last-active note, which a reload restores
but Back/Forward cannot walk.

Give every open note its own URL. A hash route (`#/path/to/note`) that mirrors
the open note turns the browser's own Back/Forward (and the mouse back button)
into prev/next navigation over visit history — for free, with no custom history
stack — and makes the URL a self-bookmark of where the user was. This is also the
foundation M21 builds on: "most-recently-visited" recency reuses the visit
history the browser now records.

It must stay **moat-neutral**: the URL is the only thing that changes. No file is
read or written differently because of a route; the hash is pure navigation
state on top of the existing path-addressed storage (FEAT-0023).

## Behavior

**The URL shape.** The open note is mirrored into the location hash as
`#/` followed by the note's folder-relative path **without its `.md` extension**,
with each path segment individually percent-encoded and joined by `/`. So
`start.md` is `#/start`, `Allegro/Journal/Week 22.md` is
`#/Allegro/Journal/Week%2022`. The codec is a pure, total round-trip: a path the
app produced decodes back to exactly that path (same casing, same `.md`).

**Open note → URL.** Whenever the active note changes — a sidebar click, a
followed link, the quick switcher, a rename following the file, an external
delete switching off the open note — the hash is updated to mirror the new active
note. A genuine in-session navigation **pushes** a history entry, so Back returns
to the previously open note. Updating the hash to the value it already holds adds
no entry.

**URL → open note.** A `hashchange` — the browser Back/Forward buttons, the
mouse back/forward buttons, or an edited/pasted/typed URL — switches the editor
to the note named by the hash, reusing the existing note-switch path
(`switchTo`). A hash that names a note that does **not** exist in the open folder
is inert: the open note does not change (no create-on-miss; a bookmark to a
since-deleted note simply leaves you where you are). The app must not loop:
mirroring the active note into the hash must not be read back as a fresh
navigation.

**Load / bookmark.** On load, after the folder is granted (silently re-attached
or re-picked), the initial hash takes precedence over the persisted active note:
if the hash names an existing note, that note opens. With no hash, an empty/
malformed hash, or a hash naming a note absent from the folder, the normal flow
stands (the persisted last-active note, else the seed). The settled initial URL
leaves exactly **one** history entry for the resolved note — landing on a note
must not bury a phantom "previous" entry that Back would step onto. Before any
folder is granted, the hash is not acted on (the first-run screen shows); it is
honored once a folder is opened.

## Constraints

- **Hash routing, not History `pushState` paths.** Brulion is a static site on
  GitHub Pages with no server to rewrite deep paths; a real path URL would
  404 on reload. The hash is the only zero-config option and is consistent with
  the no-backend moat.
- **No custom history stack.** Back/Forward is the browser's own session history,
  driven entirely by pushing hash entries; the app holds no parallel stack.
- **One source of truth for path resolution.** The route is path-addressed,
  consistent with FEAT-0023 storage and the in-memory note list; a hash resolves
  to a note by exact path membership in that list. No second name validator.
- **Moat-neutral.** No file read/write changes because of routing. The hash is
  navigation state only.
- The path↔hash codec is pure (no DOM/History/FSA dependency) so it is unit-
  tested directly.

## Out of scope

- **In-app Back/Forward buttons.** In an installed PWA (M9) the browser's
  Back/Forward chrome may be hidden; in-app buttons are deferred to that work,
  not added here.
- **Recency / most-recently-visited ordering** (M21) — this phase only records
  the visit history (by pushing hash entries); consuming it for ranking is M21.
- **Create-on-miss from a URL.** A hash naming a missing note is inert; it does
  not offer to create the note.
- **Deep-linking to a position within a note** (a heading anchor, a line). The
  route addresses the note, not a location inside it.

## Acceptance criteria

**AC-1** — A root-level note encodes to a bare hash route.
Given the note path `start.md`,
When it is encoded to a hash route,
Then the result is `#/start` (no `.md` extension).

**AC-2** — A nested note encodes with percent-encoded segments.
Given the note path `Allegro/Journal/Week 22.md`,
When it is encoded to a hash route,
Then the result is `#/Allegro/Journal/Week%2022` (each segment percent-encoded,
`/` preserved as the separator, `.md` dropped).

**AC-3** — The codec round-trips a path back to itself.
Given any note path the app produced (e.g. `a/b c.md`),
When it is encoded to a hash and then decoded,
Then the decoded value equals the original path exactly (same casing, `.md`
restored).

**AC-4** — A malformed or empty hash decodes to no note.
Given a hash that is empty, is just `#`, is `#/`, or has an empty segment
(e.g. `#/a//b`),
When it is decoded,
Then the result is "no note" (null), not a bogus path.

**AC-5** — Opening a note mirrors it into the URL hash.
Given a folder is open with `a.md` active,
When the user switches to `b.md`,
Then the location hash becomes `#/b`.

**AC-6** — In-session navigation pushes history, so Back returns to the prior note.
Given the user opened `a.md` then switched to `b.md` (hash now `#/b`),
When the browser Back button is pressed,
Then the hash returns to `#/a` and the editor shows `a.md`.

**AC-7** — Forward re-opens the note Back left.
Given the user pressed Back from `b.md` to `a.md`,
When the browser Forward button is pressed,
Then the hash returns to `#/b` and the editor shows `b.md`.

**AC-8** — A hash naming a missing note is inert.
Given a folder is open with `a.md` active and no note `ghost.md`,
When the hash is changed to `#/ghost`,
Then the open note stays `a.md` (no switch, no note created).

**AC-9** — A bookmarked hash opens that note on load.
Given the URL hash is `#/projects/diablo` and the folder (containing
`projects/diablo.md`) is granted on load,
When the app finishes restoring the folder,
Then `projects/diablo.md` is the active note, regardless of which note was
persisted as last-active.

**AC-10** — The hash takes precedence over the persisted active note on load.
Given the persisted last-active note is `a.md` and the load URL hash is `#/b`
(with `b.md` present),
When the app restores the folder,
Then `b.md` opens, not `a.md`.

**AC-11** — No hash falls back to the normal active-note flow.
Given the load URL has no hash (or a hash naming a note absent from the folder),
When the app restores the folder,
Then the persisted last-active note opens (else the seed), exactly as before this
feature.

**AC-12** — Mirroring the active note does not re-trigger a navigation loop.
Given a note becomes active and its path is mirrored into the hash,
When the resulting hash state is observed,
Then it does not cause a second switch back to the same note (no feedback loop),
and no spurious extra history entry is created for landing on it on load.
