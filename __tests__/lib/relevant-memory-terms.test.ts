import { buildRelevantTerms } from "@/lib/server/get-relevant-memory"

describe("buildRelevantTerms", () => {
  it("returns empty when every word is short or a stopword (zero-cost exit, no DB call)", () => {
    expect(buildRelevantTerms("ok")).toEqual([])
    expect(buildRelevantTerms("do it now")).toEqual([])
    expect(buildRelevantTerms("2026")).toEqual([])
  })

  it("drops conversational filler that survives the shared stopword list", () => {
    expect(buildRelevantTerms("thanks!")).toEqual([])
    expect(buildRelevantTerms("hola buenas")).toEqual([])
    expect(buildRelevantTerms("hello good morning")).toEqual([])
  })

  it("keeps real topic words even when mixed with filler", () => {
    expect(
      buildRelevantTerms("thanks, what about my Phuket flight?")
    ).toContain("phuket")
  })

  it("extracts topic words from a natural recall question", () => {
    const terms = buildRelevantTerms(
      "what did I decide about my Qatar flight to Phuket?"
    )
    expect(terms).toContain("qatar")
    expect(terms).toContain("flight")
    expect(terms).toContain("phuket")
  })

  it("prioritises quoted phrases ahead of loose topic words", () => {
    const terms = buildRelevantTerms(
      'remind me about "Madrid to Phuket" hotels please'
    )
    expect(terms[0]).toBe("Madrid to Phuket")
  })

  it("caps the number of terms at four", () => {
    const terms = buildRelevantTerms(
      "phuket madrid qatar doha barcelona valencia sevilla"
    )
    expect(terms.length).toBeLessThanOrEqual(4)
  })
})
