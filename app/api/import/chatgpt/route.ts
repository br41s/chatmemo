import { getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  callSummarizer,
  createOpenRouterClient,
  resolveOpenRouterKey
} from "@/lib/server/openrouter"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { buildSummaryChunks, parseChatGPTExport } from "@/lib/importers/chatgpt"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

const MAX_FILE_BYTES = 100 * 1024 * 1024 // 100 MB

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

    const chunks = buildSummaryChunks(conversations)
    const openai = createOpenRouterClient(openrouterKey, 20_000)
    const supabase = createClient(cookies())
    let inserted = 0
    const skipped: string[] = []

    for (const chunk of chunks) {
      try {
        const summaryText = await callSummarizer(
          openai,
          IMPORT_SYSTEM_PROMPT,
          chunk,
          700
        )
        if (!summaryText) {
          skipped.push("chunk not useful")
          continue
        }
        await insertSummary(supabase, userId, summaryText)
        inserted++
      } catch (err) {
        skipped.push(
          `chunk error: ${err instanceof Error ? err.message : "unknown"}`
        )
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
