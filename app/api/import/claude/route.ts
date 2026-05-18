import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  callSummarizer,
  createOpenRouterClient,
  resolveOpenRouterKey
} from "@/lib/server/openrouter"
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

export const runtime: ServerRuntime = "nodejs"

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

/** Conversations with fewer chars than this are not stored as raw full text. */
const MIN_CHARS_FOR_RAW = 300

/** How many per-conv text blocks to batch per LLM summarization call. */
const CONVS_PER_BATCH = 3

const IMPORT_SYSTEM_PROMPT = `You are a memory assistant. You are given one or more past conversations a user had with Claude (Anthropic's AI).

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
    const openrouterKey = resolveOpenRouterKey(profile)

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
    const openai = createOpenRouterClient(openrouterKey, 30_000)
    let inserted = 0
    let rawInserted = 0
    const skipped: string[] = []

    // Step 1: Insert full conversation text for substantive conversations
    for (const conv of conversations) {
      const fullText = formatConversationFull(conv)
      if (fullText.length < MIN_CHARS_FOR_RAW) continue
      try {
        await insertSummary(supabase, userId, fullText)
        rawInserted++
      } catch {
        // non-fatal
      }
    }

    // Step 2: LLM summaries batched CONVS_PER_BATCH at a time
    const perConvTexts = buildPerConvTexts(conversations)
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
        if (!summaryText) {
          skipped.push(
            `batch ${Math.floor(i / CONVS_PER_BATCH) + 1} not useful`
          )
          continue
        }
        await insertSummary(supabase, userId, summaryText)
        inserted++
      } catch (err) {
        skipped.push(
          `batch error: ${err instanceof Error ? err.message : "unknown"}`
        )
      }
    }

    // Step 3: Compact date index as final row for fast date-based recall
    const dateIndex = [
      `[Claude Conversation Index — imported ${new Date().toISOString().slice(0, 10)}]`,
      ...conversations.map(c => {
        const date = c.updatedAt
          ? new Date(c.updatedAt).toISOString().slice(0, 10)
          : "unknown"
        return `[${date}] ${c.title}`
      })
    ].join("\n")

    try {
      await insertSummary(supabase, userId, dateIndex)
    } catch {
      // non-fatal
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
