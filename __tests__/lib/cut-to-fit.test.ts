/**
 * @jest-environment node
 *
 * Tests for lib/server/cut-to-fit.ts — how a memory layer is filled.
 *
 * The rule under test: a layer whose first entry does not fit carries a cut
 * version of it rather than nothing. "Nothing" is what turned a found
 * conversation into "no matching conversation found" on a small window.
 */
import { cutToFit, fillLayer, MIN_CUT_CHARS } from "@/lib/server/cut-to-fit"

describe("cutToFit", () => {
  it("returns text that already fits", () => {
    expect(cutToFit("short", 10)).toBe("short")
  })

  it("cuts to the limit and marks the cut", () => {
    const cut = cutToFit("x".repeat(1_000), 300)!
    expect(cut.length).toBe(300)
    expect(cut.endsWith("…")).toBe(true)
  })

  it("counts a longer note inside the limit", () => {
    const note = "\n[…cut to fit]"
    const cut = cutToFit("x".repeat(1_000), 300, note)!
    expect(cut.length).toBeLessThanOrEqual(300)
    expect(cut.endsWith(note)).toBe(true)
  })

  it("gives up when what is left is too small to be useful", () => {
    expect(cutToFit("x".repeat(1_000), MIN_CUT_CHARS - 1)).toBeNull()
    expect(cutToFit("x".repeat(1_000), 0)).toBeNull()
  })

  it("does not cut through an emoji", () => {
    // The cut falls between the two halves of the last emoji kept.
    const text = "a".repeat(298) + "😀😀😀"
    const cut = cutToFit(text, 300)!
    expect(cut).toBe("a".repeat(298) + "…")
    expect(cut.length).toBeLessThanOrEqual(300)
  })
})

describe("fillLayer", () => {
  it("admits entries in order until the allowance is spent", () => {
    expect(fillLayer(["aaa", "bbb", "ccc"], 7)).toEqual(["aaa", "bbb"])
  })

  it("stops at the first entry that does not fit, as before", () => {
    // A later, smaller entry is not pulled forward: order is rank.
    const big = "b".repeat(500)
    expect(fillLayer(["aaa", big, "c"], 300)).toEqual(["aaa"])
  })

  it("cuts the first entry when not even it fits", () => {
    const [only, ...rest] = fillLayer(["x".repeat(1_000), "y"], 400)
    expect(only.length).toBe(400)
    expect(only.endsWith("…")).toBe(true)
    expect(rest).toEqual([])
  })

  it("stays empty when the allowance is too small to cut into", () => {
    expect(fillLayer(["x".repeat(1_000)], 50)).toEqual([])
    expect(fillLayer([], 1_000)).toEqual([])
  })
})
