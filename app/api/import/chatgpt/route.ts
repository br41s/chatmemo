import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { buildSummaryChunks, parseChatGPTExport } from "@/lib/importers/chatgpt"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"
import OpenAI from "openai"

export const runtime: ServerRuntime = "nodejs"

/** Max size of the uploaded JSON file (bytes). */
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

const OPENROUTER_TIMEOUT_MS = 20_000
const MIN_SUMMARY_WORDS = 10

const IMPORT_SYSTEM_PROMPT = `You are a memory assistant. You are given a set of past conversations a user had with ChatGPT.

Your job is to extract a concise, durable memory summary that will help a new AI assistant understand this user.

Focus on:
- User preferences, habits, and working style
- Active projects, goals, and ongoing context
- Important constraints, requirements, or recurring patterns
- Technical stack, languages, or tools the user works with
- Personal facts that are stable and useful for future sessions

Avoid:
- Ephemeral or one-off requests
- Verbatim quotes
- Trivial details or small talk
- Time-sensitive information unlikely to remain relevant

Output: plain text only, under 400 words.
If the conversations contain nothing worth remembering, output only the single word: SKIP`

export async function POST(request: NextRequest) {
  try {
    // Auth — throws if session is missing
    const profile = await getServerProfile()
    const userId = profile.user_id

    // Resolve OpenRouter key (profile key > env fallback)
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
    const conversations = parseChatGPTExport(raw)

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

    // --- Build text chunks for summarization ---
    const chunks = buildSummaryChunks(conversations)

    // --- Summarize each chunk with OpenRouter ---
    const openai = new OpenAI({
      apiKey: openrouterKey ?? "",
      baseURL: "https://openrouter.ai/api/v1",
      timeout: OPENROUTER_TIMEOUT_MS
    })

    const supabase = createClient(cookies())
    let inserted = 0
    const skipped: string[] = []

    for (const chunk of chunks) {
      try {
        const completion = await openai.chat.completions.create({
          model: "google/gemini-2.0-flash-exp:free",
          messages: [
            { role: "system", content: IMPORT_SYSTEM_PROMPT },
            { role: "user", content: chunk }
          ],
          temperature: 0.3,
          max_tokens: 700,
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
          skipped.push("chunk not useful")
          continue
        }

        await insertSummary(supabase, userId, summaryText)
        inserted++
      } catch (err) {
        // Log and continue — don't fail the whole import for one bad chunk
        const msg = err instanceof Error ? err.message : "unknown"
        skipped.push(`chunk error: ${msg}`)
      }
    }

    return NextResponse.json({
      success: true,
      conversations_found: conversations.length,
      chunks_processed: chunks.length,
      inserted,
      skipped: skipped.length > 0 ? skipped : undefined
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
