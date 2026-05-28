import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { getWatermark, insertSummary, setWatermark } from "@/db/summaries"
import {
  buildDateIndex,
  formatConversationFull,
  parsePerplexityExport
} from "@/lib/importers/perplexity"
import {
  callSummarizer,
  createOpenRouterClient,
  resolveOpenRouterKey
} from "@/lib/server/openrouter"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"
export const maxDuration = 60 // seconds — allow time for LLM summarisation batches

const SOURCE = "perplexity"
const MAX_FILE_BYTES = 100 * 1024 * 1024 // 100 MB

/** Conversations with fewer chars than this are not stored as individual raw rows. */
const MIN_CHARS_FOR_RAW = 200

/** Max conversations to LLM-summarise per import (3 per batch = ~5 batches). */
const MAX_TO_SUMMARIZE = 15
const CONVS_PER_BATCH = 3

const IMPORT_SYSTEM_PROMPT = `You are a memory assistant. You are given one or more past conversations a user had with an AI assistant (Perplexity).

Your job is to extract a detailed, durable memory summary that will help a future AI assistant understand this user deeply.

FORMAT: For each conversation, start with a header line exactly like this:
### [YYYY-MM-DD] Conversation Title
Then bullet the key facts from that conversation underneath.

Extract and preserve:
- Active and ongoing projects (names, tech stack, goals, current status)
- Preferences, habits, and working style
- Recurring patterns, constraints, or requirements
- Technical details: languages, frameworks, tools, architecture decisions
- Personal context: interests, goals, background facts
- Decisions made and their rationale
- Anything specific enough to be useful in a future session

Be specific and detailed. Preserve proper nouns, project names, technology choices, concrete facts, and exact dates. Do not generalize.

Avoid:
- Ephemeral one-off requests with no lasting relevance
- Step-by-step instructions that are obvious
- Time-sensitive information that will not remain relevant
- Filler and generic statements

Output: plain text only, as detailed as needed (up to 800 words).
If the conversations contain absolutely nothing worth remembering, output only the single word: SKIP`

export async function POST(request: NextRequest) {
  try {
    const profile = await getServerProfile()
    const userId = profile.user_id

    // --- Parse multipart form ---
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json(
        {
          success: false,
          reason: "Expected multipart/form-data with a 'file' field"
        },
        { status: 400 }
      )
    }

    const fileField = formData.get("file")
    if (!(fileField instanceof File)) {
      return NextResponse.json(
        { success: false, reason: "Missing 'file' field in form data" },
        { status: 400 }
      )
    }
    if (fileField.size === 0) {
      return NextResponse.json(
        { success: false, reason: "Uploaded file is empty" },
        { status: 400 }
      )
    }
    if (fileField.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          reason: `File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MB limit`
        },
        { status: 400 }
      )
    }

    let raw: unknown
    try {
      raw = JSON.parse(await fileField.text())
    } catch {
      return NextResponse.json(
        { success: false, reason: "File is not valid JSON" },
        { status: 400 }
      )
    }

    const allConversations = parsePerplexityExport(raw)
    if (allConversations.length === 0) {
      return NextResponse.json(
        {
          success: true,
          inserted: 0,
          reason: "No usable conversations found in file"
        },
        { status: 200 }
      )
    }

    const supabase = createClient(cookies())

    // ------------------------------------------------------------------
    // Incremental import: skip conversations already seen in a prior import.
    // The watermark holds the max updatedAt (unix ms) we've processed.
    // ------------------------------------------------------------------
    const watermarkTs = await getWatermark(supabase, userId, SOURCE)
    const conversations =
      watermarkTs > 0
        ? allConversations.filter(c => c.updatedAt > watermarkTs)
        : allConversations

    const skippedCount = allConversations.length - conversations.length

    if (conversations.length === 0) {
      return NextResponse.json({
        success: true,
        conversations_found: allConversations.length,
        skipped: skippedCount,
        inserted: 0,
        reason: "All conversations already imported (watermark up to date)"
      })
    }

    let inserted = 0

    // ------------------------------------------------------------------
    // Step 1: One raw row per conversation (for Timeline display).
    // Tagged with [source:perplexity] for selective deletion.
    // ------------------------------------------------------------------
    for (const conv of conversations) {
      const fullText = formatConversationFull(conv)
      if (fullText.length < MIN_CHARS_FOR_RAW) continue
      try {
        await insertSummary(supabase, userId, `[source:${SOURCE}]\n${fullText}`)
        inserted++
      } catch {
        // non-fatal — continue with remaining rows
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Compact date index for fast date-based recall.
    // Tagged with [source:perplexity] for selective deletion.
    // ------------------------------------------------------------------
    try {
      await insertSummary(
        supabase,
        userId,
        `[source:${SOURCE}]\n${buildDateIndex(conversations)}`
      )
    } catch {
      // non-fatal
    }

    // ------------------------------------------------------------------
    // Step 3: LLM summaries for the most recent N conversations.
    // Stored as [source:perplexity:summary] — picked up by the personal
    // memory query (compact, full content, not just 400-char excerpts).
    // Non-fatal: skipped if no OpenRouter key or LLM unavailable.
    // ------------------------------------------------------------------
    let summarized = 0
    try {
      const openrouterKey = resolveOpenRouterKey(profile)
      const openai = createOpenRouterClient(openrouterKey, 45_000)

      const toSummarize = conversations.slice(0, MAX_TO_SUMMARIZE)
      const perConvTexts = toSummarize.map(conv => formatConversationFull(conv))

      for (let i = 0; i < perConvTexts.length; i += CONVS_PER_BATCH) {
        const batchInput = perConvTexts
          .slice(i, i + CONVS_PER_BATCH)
          .join("\n\n---\n\n")
        try {
          const summaryText = await callSummarizer(
            openai,
            IMPORT_SYSTEM_PROMPT,
            batchInput,
            1200
          )
          if (!summaryText) continue
          await insertSummary(
            supabase,
            userId,
            `[source:${SOURCE}:summary]\n${summaryText}`
          )
          summarized++
        } catch {
          // non-fatal — continue with next batch
        }
      }
    } catch {
      // No OpenRouter key or LLM unavailable — raw rows still stored above
    }

    // ------------------------------------------------------------------
    // Step 4: Update watermark to the newest conversation we just stored.
    // ------------------------------------------------------------------
    const newestTs = Math.max(...conversations.map(c => c.updatedAt))
    try {
      await setWatermark(supabase, userId, SOURCE, newestTs)
    } catch {
      // non-fatal — worst case next import re-processes these conversations
    }

    return NextResponse.json({
      success: true,
      conversations_found: allConversations.length,
      skipped: skippedCount,
      inserted,
      summarized
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
