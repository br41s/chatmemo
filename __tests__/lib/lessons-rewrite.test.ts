/**
 * Tests for lib/lessons-rewrite.ts — the checks standing between a bad
 * generation and permanent loss of the user's accumulated context.
 *
 * The lessons pass replaces the whole document with the model's output, and
 * user_lessons has no version history to recover from. So the interesting
 * cases here are all rejections: every one of them is a write that would have
 * destroyed facts.
 */
import {
  checkLessonsRewrite,
  lessonsRewriteMaxTokens,
  MAX_LESSONS_CHARS
} from "@/lib/lessons-rewrite"

const DOC = `# User Lessons

## Preferences & Communication Style
- Prefers concise answers
- Writes in Spanish and English

## Active Projects & Work Context
- ChatMemo, a self-hosted memory workspace
- Next.js and Supabase

## Personal Context
- Based in Spain

## Recurring Patterns & Constraints
- Ships on Fridays
- Will not use GitHub Actions on this account`

describe("checkLessonsRewrite — accepts a real edit", () => {
  it("accepts a document that grew", () => {
    const next = `${DOC}\n- Runs Postgres 16 locally for migration tests`
    expect(checkLessonsRewrite({ previous: DOC, next, truncated: false })).toEqual({
      ok: true
    })
  })

  it("accepts a modest consolidation", () => {
    // Real edits tighten wording; they do not delete a fifth of the document.
    const next = DOC.replace("- Writes in Spanish and English", "- Bilingual")
    expect(
      checkLessonsRewrite({ previous: DOC, next, truncated: false }).ok
    ).toBe(true)
  })

  it("accepts the very first document", () => {
    expect(
      checkLessonsRewrite({ previous: null, next: DOC, truncated: false }).ok
    ).toBe(true)
  })
})

describe("checkLessonsRewrite — rejects what would lose facts", () => {
  it("rejects a rewrite the model reported as truncated", () => {
    // The definitive signal: finish_reason was "length".
    const verdict = checkLessonsRewrite({
      previous: DOC,
      next: `${DOC}\n- One more fact`,
      truncated: true
    })
    expect(verdict).toMatchObject({ ok: false, reason: "truncated" })
  })

  it("rejects a rewrite missing a section, even when not flagged truncated", () => {
    // What truncation looks like when the provider reports no finish reason:
    // output stops mid-document and the trailing sections vanish.
    const cut = DOC.slice(0, DOC.indexOf("## Personal Context"))
    const verdict = checkLessonsRewrite({
      previous: DOC,
      next: cut,
      truncated: false
    })
    expect(verdict).toMatchObject({ ok: false, reason: "section-lost" })
    expect((verdict as { detail: string }).detail).toContain("Personal Context")
  })

  it("rejects a rewrite that shrank sharply while keeping its headings", () => {
    // Sections intact but the bullets gone — a summarised-away document.
    const gutted = DOC.replace(/^- .*$/gm, "").replace(/\n{3,}/g, "\n\n")
    const verdict = checkLessonsRewrite({
      previous: DOC,
      next: gutted,
      truncated: false
    })
    expect(verdict).toMatchObject({ ok: false, reason: "shrank" })
  })

  it("rejects an empty rewrite", () => {
    expect(
      checkLessonsRewrite({ previous: DOC, next: "   ", truncated: false })
    ).toMatchObject({ ok: false, reason: "empty" })
  })

  it("rejects an empty first document rather than storing nothing", () => {
    expect(
      checkLessonsRewrite({ previous: null, next: "", truncated: false })
    ).toMatchObject({ ok: false, reason: "empty" })
  })

  it("reports an unchanged document as its own outcome", () => {
    // Not a failure — the prompt tells the model to return the document as-is
    // when nothing is new — so the caller can stay quiet about it.
    expect(
      checkLessonsRewrite({ previous: DOC, next: DOC, truncated: false })
    ).toMatchObject({ ok: false, reason: "unchanged" })
  })

  it("checks truncation before anything else", () => {
    // A truncated rewrite that happens to keep every heading is still refused.
    expect(
      checkLessonsRewrite({ previous: DOC, next: DOC + " x", truncated: true })
    ).toMatchObject({ reason: "truncated" })
  })
})

describe("lessonsRewriteMaxTokens", () => {
  it("never drops below the old fixed allowance", () => {
    expect(lessonsRewriteMaxTokens(null)).toBeGreaterThanOrEqual(800)
    expect(lessonsRewriteMaxTokens("tiny")).toBeGreaterThanOrEqual(800)
  })

  it("scales past the old fixed 800 as the document grows", () => {
    // The bug: 800 was fixed, so once the document outgrew it every rewrite
    // was truncated and every write destroyed the tail.
    const big = "x".repeat(20_000)
    expect(lessonsRewriteMaxTokens(big)).toBeGreaterThan(800)
  })

  it("leaves room to restate the document plus additions", () => {
    const doc = "x".repeat(8_000) // ~2000 tokens to restate
    expect(lessonsRewriteMaxTokens(doc)).toBeGreaterThan(2_000)
  })

  it("is bounded, so a runaway document cannot request unlimited output", () => {
    expect(lessonsRewriteMaxTokens("x".repeat(5_000_000))).toBeLessThanOrEqual(
      8_000
    )
  })

  it("stops being viable at exactly the documented ceiling", () => {
    // Past MAX_LESSONS_CHARS the route skips the rewrite instead of risking a
    // lossy one, because even the ceiling allowance could not restate it.
    const atLimit = lessonsRewriteMaxTokens("x".repeat(MAX_LESSONS_CHARS))
    expect(atLimit).toBe(8_000)
  })
})
