import {
  detectFullConversationIntent,
  rankByTermCoverage
} from "@/lib/server/get-full-conversation"

describe("rankByTermCoverage", () => {
  it("ranks the row covering the most distinct query terms first", () => {
    // Regression: the Qatar/Phuket–Madrid miss. Common words (cambiar, vuelo,
    // madrid) matched many unrelated rows and buried the real flight row, which
    // is only uniquely identified by the rare word 'phuket'.
    const rows = [
      { content: "Quiero cambiar mi cita del dentista", createdAt: "2026-06-01" },
      { content: "Notas sobre Madrid y su clima", createdAt: "2026-06-02" },
      {
        content:
          "Cambiar mi vuelo de Madrid a Phuket con Qatar Airways, escala en Doha",
        createdAt: "2026-03-23"
      }
    ]

    const ranked = rankByTermCoverage(rows, ["cambiar", "vuelo", "madrid", "phuket"])

    expect(ranked[0].content).toContain("Phuket")
  })

  it("breaks score ties by recency (newest first)", () => {
    const rows = [
      { content: "vuelo barato", createdAt: "2026-01-01" },
      { content: "vuelo caro", createdAt: "2026-05-01" }
    ]
    const ranked = rankByTermCoverage(rows, ["vuelo"])
    expect(ranked[0].createdAt).toBe("2026-05-01")
  })

  it("is case-insensitive when matching terms", () => {
    const rows = [{ content: "QATAR AIRWAYS QR0847", createdAt: "2026-03-23" }]
    const ranked = rankByTermCoverage(rows, ["qatar", "airways"])
    expect(ranked).toHaveLength(1)
  })
})

describe("detectFullConversationIntent", () => {
  it("fires on the real failing phrasing (recupera ... chat)", () => {
    expect(
      detectFullConversationIntent(
        "recupera el ultimo chat sobre cambiar mi vuelo de madrid a phuket"
      )
    ).toBe(true)
  })

  it("does not fire on unrelated questions", () => {
    expect(detectFullConversationIntent("what's the weather today?")).toBe(false)
  })
})
