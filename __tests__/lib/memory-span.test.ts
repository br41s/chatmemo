import { buildMemoryReport } from "../../lib/memory-report"

// The panel's counts could not answer the question people actually ask of it —
// "does what the model was given include yesterday?" — and a block that had
// quietly stopped months ago looked identical to a healthy one. That is not
// hypothetical: a bulk import ordered above every recent conversation produced
// exactly that, and neither the panel nor the model's own answer could show it.

const entry = (date: string, body = "Something happened.") =>
  `### [${date}] A conversation\n${body}`

const history = (...entries: string[]) =>
  `[CONVERSATION HISTORY — newest entries first]\n${entries.join(
    "\n\n---\n\n"
  )}\n[/CONVERSATION HISTORY]`

const report = (summary: string | null, relevant: string | null = null) =>
  buildMemoryReport({
    summary,
    relevant,
    fullConversation: null,
    fullConversationMissed: false,
    totalChars: (summary?.length ?? 0) + (relevant?.length ?? 0),
    budgetChars: 100_000
  })

describe("history date span", () => {
  it("reports the oldest and newest dates the block covers", () => {
    const { history: layer } = report(
      history(entry("2026-08-19"), entry("2024-03-11"), entry("2026-01-02"))
    )

    expect(layer!.span).toEqual({ oldest: "2024-03-11", newest: "2026-08-19" })
  })

  it("collapses a single date rather than repeating it", () => {
    const { history: layer } = report(history(entry("2026-09-05")))

    expect(layer!.span).toEqual({ oldest: "2026-09-05", newest: "2026-09-05" })
  })

  it("makes a block that stops in the past visible", () => {
    // The reported symptom: 100 entries, none of them recent.
    const entries = Array.from({ length: 100 }, (_, i) =>
      entry(`2024-0${(i % 9) + 1}-01`)
    )
    const { history: layer } = report(history(...entries, entry("2026-08-19")))

    expect(layer!.entries).toBe(101)
    expect(layer!.span!.newest).toBe("2026-08-19")
  })

  it("reports no span rather than a misleading one for undated content", () => {
    // Index rows and watermarks carry no `### [date]` header.
    const { history: layer } = report(
      history("A note with no date header at all.")
    )

    expect(layer!.entries).toBe(1)
    expect(layer!.span).toBeUndefined()
  })

  it("ignores a date that is not an entry header", () => {
    const { history: layer } = report(
      history(entry("2026-09-05", "We agreed on 2020-01-01 as the cutoff."))
    )

    expect(layer!.span).toEqual({ oldest: "2026-09-05", newest: "2026-09-05" })
  })

  it("spans the relevance layer too", () => {
    const { relevant } = report(
      null,
      [entry("2026-02-02"), entry("2026-07-07")].join("\n\n---\n\n")
    )

    expect(relevant!.span).toEqual({
      oldest: "2026-02-02",
      newest: "2026-07-07"
    })
  })

  it("leaves the lessons layer without a span", () => {
    // Lessons are durable facts, not dated conversations.
    const { lessons } = report(
      "[LESSONS — Accumulated knowledge about you from past sessions]\nYou prefer TypeScript.\n[/LESSONS]"
    )

    expect(lessons).toEqual({ chars: expect.any(Number) })
  })
})
