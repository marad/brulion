/**
 * Weekly-journal path expansion (M31/FEAT-0062). A `journalPath` setting is a
 * folder-relative note-path template with date placeholders; this expands it against
 * a given date so the "open this week's journal" action can resolve today's note.
 * Pure (the date is passed in) — no `Date.now()` in the core, so it unit-tests with
 * fixed dates. The caller passes `new Date()` and normalizes the result to a `.md`
 * note path (`normalizeNoteName`).
 *
 * Placeholders (all from the given date; week starts **Monday**):
 * - `{year}` → 4-digit year (`2026`)
 * - `{month}` → 2-digit month (`06`)
 * - `{day}` → 2-digit day-of-month (`25`)
 * - `{mondayOfTheWeek}` → ISO date of that week's Monday (`2026-06-22`)
 */

const pad2 = (n: number): string => String(n).padStart(2, "0")

/** ISO `YYYY-MM-DD` from a date's local components. */
const isoDate = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

/** The Monday of `date`'s week (week starts Monday), as a new Date. Rolls back
 * across month/year boundaries via `setDate`. */
function mondayOf(date: Date): Date {
  const m = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const offset = (m.getDay() + 6) % 7 // 0 = Monday … 6 = Sunday
  m.setDate(m.getDate() - offset)
  return m
}

/** Expand a `journalPath` template against `date` (see module doc). An empty template
 * yields `""`. Pure; never throws. */
export function expandJournalPath(template: string, date: Date): string {
  return template
    .replaceAll("{year}", String(date.getFullYear()))
    .replaceAll("{month}", pad2(date.getMonth() + 1))
    .replaceAll("{day}", pad2(date.getDate()))
    .replaceAll("{mondayOfTheWeek}", isoDate(mondayOf(date)))
}
