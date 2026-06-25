---
id: FEAT-0062
title: Weekly journal navigation
status: draft
depends_on: [FEAT-0047, FEAT-0048, FEAT-0057]
---

## Intent

A weekly journal lives at a predictable, date-derived path (e.g.
`Allegro/Journal/Week/2026-06-22.md`), but reaching *this week's* note still means
typing or hunting for that path every time. This phase adds one keyboard-first
action: **open this week's journal** — resolve a user-configured, date-templated path
against today and open it. Building on the action registry (M30) and settings (M16),
it turns a recurring navigation chore into a single command.

Scope is deliberately just navigation: it reuses the existing open-note path, so a
missing journal note is created by the *existing* create-on-miss prompt — no new file
creation, no week template, and (for now) no day-log append. Moat-neutral: the only
thing written is the user's own `journalPath` preference (in `.brulion.json`) and,
on an explicit confirm, the note the existing flow already creates.

## Behavior

**The setting.** `Settings` gains `journalPath: string` — a folder-relative note path
template with date placeholders, persisted in `.brulion.json` (so it travels with the
vault). Default is empty. Edited in the settings modal as a text field with a hint
listing the supported placeholders.

**Placeholders.** Expanded against the current date:
- `{year}` → 4-digit year (`2026`)
- `{month}` → 2-digit month (`06`)
- `{day}` → 2-digit day-of-month (`25`)
- `{mondayOfTheWeek}` → ISO date (`YYYY-MM-DD`) of the **Monday** of the current week
  (week starts Monday). For Thursday 2026-06-25 → `2026-06-22`.

So `Allegro/Journal/Week/{mondayOfTheWeek}` → `Allegro/Journal/Week/2026-06-22`.

**The action.** A registered action **"Open this week's journal"** (M30 registry, so
it appears in the command palette and is pinnable to the action bar). Running it:
expands `journalPath` against today, normalizes the result to a note path (the same
validator note creation uses, which appends `.md`), and opens it through the existing
open-note path — switching to it if it exists, else raising the existing
create-on-miss prompt. When `journalPath` is **empty** (unconfigured), the action
opens the settings modal instead (so the user can set it), rather than doing nothing.

## Constraints

- **Reuse the open-note path.** Opening/creating goes through the existing follow
  mechanism (FEAT-0025/0057's `openNotePath` + create-on-miss) — this phase only
  computes a path and hands it over; it adds no bespoke note-creation.
- **Reuse the settings engine.** `journalPath` rides the existing `Settings` model,
  `normalizeSettings`, and the modal's `onChange` patch flow (no new persistence).
- **Path expansion is pure.** Placeholder expansion is a pure function of (template,
  date) — unit-tested with fixed dates, no `Date.now()` dependency in the core.
- **Lean scope.** One setting, one action. No week template, no day-log, no general
  per-note-type template system.
- **Moat: only the preference is written by this phase.** Expanding and opening read
  only; the journal note itself is created solely by the existing, user-confirmed
  create-on-miss flow.

## Out of scope

- **The quick day-log** (appending an entry to today's section) — deferred; it needs a
  defined weekly-note structure, which is also deferred.
- **A week template** seeding per-day headings into a fresh journal note — deferred.
- **Configurable week-start / locale** — week starts Monday; placeholders are fixed.
- **A general per-note-type template system** — this is scoped to the one journal path.

## Acceptance criteria

**AC-1** — `journalPath` persists in the settings file.
Given a vault,
When `journalPath` is set to a template string,
Then it is saved in `.brulion.json` and restored on reload; `normalizeSettings`
coerces a non-string to the empty default.

**AC-2** — Placeholders expand against the current date.
Given a template `Allegro/Journal/Week/{mondayOfTheWeek}` and today is Thursday
2026-06-25,
When the path is expanded,
Then it is `Allegro/Journal/Week/2026-06-22`; and `{year}`/`{month}`/`{day}` expand to
`2026`/`06`/`25` (zero-padded month/day).

**AC-3** — `{mondayOfTheWeek}` is the Monday of the current week, across month/year
boundaries.
Given any weekday,
When `{mondayOfTheWeek}` is expanded,
Then it is the ISO date of that week's Monday (e.g. Sunday 2026-03-01 → 2026-02-23),
computed correctly across month and year boundaries.

**AC-4** — The action opens an existing journal note.
Given `journalPath` is configured and this week's journal note already exists,
When the user runs "Open this week's journal",
Then the editor switches to that note.

**AC-5** — The action routes a missing journal note through the existing create flow.
Given `journalPath` is configured and this week's note does not exist,
When the user runs the action,
Then the existing create-on-miss prompt is raised for the resolved path (no bespoke
creation).

**AC-6** — An empty `journalPath` opens settings.
Given `journalPath` is empty (unconfigured),
When the user runs the action,
Then the settings modal opens (so the path can be set) and no note navigation occurs.

**AC-7** — The action is a registry action (palette + pinnable).
Given a folder is open,
When the user opens the command palette,
Then "Open this week's journal" is listed (and is available to pin to the action
bar), like the other registered actions.

**AC-8** — No bytes beyond the preference and the confirmed note.
Given the user configures `journalPath` and runs the action,
When the path expands and opens,
Then the only writes are `.brulion.json` (the preference) and, if the user confirms
the create-on-miss prompt, the new note — nothing else.
