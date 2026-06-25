import { describe, it, expect } from "vitest"
import { expandJournalPath } from "./journal"

// Local-time dates so the expansion's local getFullYear/getMonth/getDate are stable
// regardless of the test runner's timezone.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe("expandJournalPath (FEAT-0062)", () => {
  it("expands {mondayOfTheWeek} to the week's Monday (AC-2)", () => {
    // Thursday 2026-06-25 → Monday 2026-06-22.
    expect(expandJournalPath("Allegro/Journal/Week/{mondayOfTheWeek}", at(2026, 6, 25))).toBe(
      "Allegro/Journal/Week/2026-06-22",
    )
  })

  it("expands {year}/{month}/{day} from the given date, zero-padded (AC-2)", () => {
    expect(expandJournalPath("{year}/{month}/{day}", at(2026, 6, 25))).toBe("2026/06/25")
    expect(expandJournalPath("{year}-{month}-{day}", at(2026, 1, 5))).toBe("2026-01-05")
  })

  it("returns Monday itself when the date is already Monday (AC-3)", () => {
    expect(expandJournalPath("{mondayOfTheWeek}", at(2026, 6, 22))).toBe("2026-06-22")
  })

  it("rolls {mondayOfTheWeek} back across a month boundary (AC-3)", () => {
    // Sunday 2026-03-01 → that week's Monday is 2026-02-23.
    expect(expandJournalPath("{mondayOfTheWeek}", at(2026, 3, 1))).toBe("2026-02-23")
  })

  it("rolls {mondayOfTheWeek} back across a year boundary (AC-3)", () => {
    // Friday 2027-01-01 → that week's Monday is 2026-12-28.
    expect(expandJournalPath("{mondayOfTheWeek}", at(2027, 1, 1))).toBe("2026-12-28")
  })

  it("replaces every occurrence and leaves non-placeholder text alone", () => {
    expect(expandJournalPath("J/{year}/W{mondayOfTheWeek}-{year}", at(2026, 6, 25))).toBe(
      "J/2026/W2026-06-22-2026",
    )
  })

  it("an empty template yields an empty string", () => {
    expect(expandJournalPath("", at(2026, 6, 25))).toBe("")
  })
})
