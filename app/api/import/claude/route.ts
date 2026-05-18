import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import {
  buildPerConvTexts,
  formatConversationFull,
  parseClaudeExport
} from "@/lib/importers/claude"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"
import OpenAI from "openai"

export const runtime: ServerRuntime = "nodejs"

/** Max size of the uploaded JSON file (bytes). */
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

const OPENROUTER_TIMEOUT_MS = 30_000
const MIN_SUMMARY_WORDS = 10

/** Conversations with fewer chars than this are not stored as raw full text. */
const MIN_CHARS_FOR_RAW = 300

/** How many per-conv text blocks to batch per LLM summarization call. */
const CONVS_PER_BATCH = 3

const IMPORT_SYSTEM_PROMPT = `You are a memory assistant. You are given one or more past conversations a user had with Claude (Anthropic's AI).

Your job is to extract a detailed, durable memory summary that will help a future AI assistant understand this user deeply.

Extract and preserve:
- Active and ongoing projects (names, tech stack, goals, current status)
- Preferences, habits, and working style
- Recurring patterns, constraints, or requirements
- Technical details: languages, frameworks, tools, architecture decisions
- Personal context: interests, goals, background facts
- Decisions made and their rationale
- Anything specific enough to be useful in a future session

Be specific and detailed. Preserve proper nouns, project names, technology choices, and concrete facts. Do not generalize.

Avoid:
- Ephemeral one-off requests with no lasting relevance
- Step-by-step instructions that are obvious
- Time-sensitive information that will not remain relevant
- Filler and generic statements

Output: plain text only, as detailed as needed (up to 800 words).
If the conversations contain absolutely nothing worth remembering, output only the single word: SKIP`

export async function POST(request: NextRequest) {
  try {
    // Auth — throws if session is missing
    const profile = await getServerProfile()
    const userId = profile.user_id

    // Resolve OpenRouter key
    const openrouterKey =
      profile.openrouter_api_key || process.env.OPENROUTER_API_KEY || null
    checkApiKey(openrouterKey, "OpenRouter")

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

    // --- Parse JSON ---
    let raw: unknown
    try {
      const text = await fileField.text()
      raw = JSON.parse(text)
    } catch {
      return NextResponse.json(
        { success: false, reason: "File is not valid JSON" },
        { status: 400 }
      )
    }

    // --- Extract conversations ---
    const conversations = parseClaudeExport(raw)

    if (conversations.length === 0) {
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
    let inserted = 0
    let rawInserted = 0
    const skipped: string[] = []

    // -----------------------------------------------------------------------
    // Step 1: Insert full conversation text for substantive conversations.
    //   These are stored verbatim so no information is lost and the user can
    //   browse/restore them from Memory History.
    // -----------------------------------------------------------------------
    for (const conv of conversations) {
      const fullText = formatConversationFull(conv)
      if (fullText.length < MIN_CHARS_FOR_RAW) continue
      try {
        await insertSummary(supabase, userId, fullText)
        rawInserted++
      } catch {
        // Non-fatal — continue with LLM summaries
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Generate rich LLM summaries, batched CONVS_PER_BATCH at a time.
    //   Each batch produces one detailed memory entry focusing on patterns and
    //   durable context across the grouped conversations.
    // -----------------------------------------------------------------------
    const perConvTexts = buildPerConvTexts(conversations)
    const openai = new OpenAI({
      apiKey: openrouterKey ?? "",
      baseURL: "https://openrouter.ai/api/v1",
      timeout: OPENROUTER_TIMEOUT_MS
    })

    for (let i = 0; i < perConvTexts.length; i += CONVS_PER_BATCH) {
      const batchTexts = perConvTexts.slice(i, i + CONVS_PER_BATCH)
      const batchInput = batchTexts.join("\n\n---\n\n")

      try {
        const completion = await openai.chat.completions.create({
          model: "openai/gpt-4o-mini",
          messages: [
            { role: "system", content: IMPORT_SYSTEM_PROMPT },
            { role: "user", content: batchInput }
          ],
          temperature: 0.3,
          max_tokens: 1200,
          stream: false
        })

        const summaryText = (
          completion.choices[0]?.message?.content ?? ""
        ).trim()

        if (
          !summaryText ||
          summaryText === "SKIP" ||
          summaryText.split(/\s+/).length < MIN_SUMMARY_WORDS
        ) {
          skipped.push(
            `batch ${Math.floor(i / CONVS_PER_BATCH) + 1} not useful`
          )
          continue
        }

        await insertSummary(supabase, userId, summaryText)
        inserted++
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown"
        skipped.push(`batch error: ${msg}`)
      }
    }

    return NextResponse.json({
      success: true,
      conversations_found: conversations.length,
      raw_inserted: rawInserted,
      summaries_inserted: inserted,
      inserted: rawInserted + inserted,
      skipped: skipped.length > 0 ? skipped : undefined
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
