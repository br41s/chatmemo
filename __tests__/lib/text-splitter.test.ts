/**
 * @jest-environment node
 *
 * Tests for the vendored RecursiveCharacterTextSplitter and the loader logic
 * in lib/retrieval/processing that replaced langchain. The splitter port was
 * verified byte-identical against langchain@0.0.213 output at migration time;
 * these tests pin the behavior so future edits can't drift silently.
 */
import { RecursiveCharacterTextSplitter } from "@/lib/retrieval/text-splitter"
import { processCSV } from "@/lib/retrieval/processing/csv"
import { processJSON } from "@/lib/retrieval/processing/json"

describe("RecursiveCharacterTextSplitter", () => {
  it("returns the whole text as one chunk when under chunkSize", () => {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 100,
      chunkOverlap: 10
    })
    expect(splitter.splitText("short text")).toEqual(["short text"])
  })

  it("splits on paragraph boundaries and respects chunkSize", () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `paragraph ${i} ` + "word ".repeat(30)
    )
    const text = paragraphs.map(p => p.trim()).join("\n\n")
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 50
    })
    const chunks = splitter.splitText(text)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500)
    }
    // No content lost: every paragraph appears in some chunk
    for (const p of paragraphs) {
      expect(chunks.some(c => c.includes(p.trim().slice(0, 40)))).toBe(true)
    }
  })

  it("overlaps consecutive chunks", () => {
    const text = Array.from({ length: 50 }, (_, i) => `sentence${i}`).join(" ")
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 120,
      chunkOverlap: 40
    })
    const chunks = splitter.splitText(text)
    expect(chunks.length).toBeGreaterThan(1)
    // The tail of chunk N should reappear at the start of chunk N+1
    const tailWord = chunks[0].split(" ").pop() as string
    expect(chunks[1]).toContain(tailWord)
  })

  it("hard-splits text with no separators at all", () => {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 100,
      chunkOverlap: 0
    })
    const chunks = splitter.splitText("x".repeat(950))
    expect(chunks.length).toBeGreaterThanOrEqual(9)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100)
    }
  })

  it("fromLanguage(markdown) prefers heading boundaries", () => {
    const md =
      "intro " +
      "a".repeat(200) +
      "\n## First\n" +
      "b".repeat(200) +
      "\n## Second\n" +
      "c".repeat(200)
    const splitter = RecursiveCharacterTextSplitter.fromLanguage("markdown", {
      chunkSize: 250,
      chunkOverlap: 0
    })
    const chunks = splitter.splitText(md)
    expect(chunks.some(c => c.startsWith("## First"))).toBe(true)
    expect(chunks.some(c => c.startsWith("## Second"))).toBe(true)
  })

  it("rejects overlap >= chunkSize", () => {
    expect(
      () =>
        new RecursiveCharacterTextSplitter({ chunkSize: 10, chunkOverlap: 10 })
    ).toThrow()
  })
})

describe("processJSON", () => {
  it("extracts nested string leaves like langchain's JSONLoader", async () => {
    const blob = new Blob([
      JSON.stringify({
        a: "alpha",
        nested: { b: "beta", deeper: ["gamma", 42, { c: "delta" }] },
        num: 7,
        flag: true
      })
    ])
    const chunks = await processJSON(blob)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe("alpha beta gamma delta")
    expect(chunks[0].tokens).toBeGreaterThan(0)
  })
})

describe("processCSV", () => {
  it("renders one key/value block per row like langchain's CSVLoader", async () => {
    const blob = new Blob(["name,city\nAda,London\nLinus,Helsinki"])
    const chunks = await processCSV(blob)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].content).toBe(
      "name: Ada\ncity: London\n\nname: Linus\ncity: Helsinki"
    )
  })
})
