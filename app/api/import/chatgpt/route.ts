import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { buildRawRows, parseChatGPTExport } from "@/lib/importers/chatgpt"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

const MAX_FILE_BYTES = 100 * 1024 * 1024 // 100 MB

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

    const supabase = createClient(cookies())
    let inserted = 0

    // ------------------------------------------------------------------
    // Step 1: Insert raw dated rows for ALL conversations (no LLM).
    // Each row uses ### [YYYY-MM-DD] Title headers so the timeline parser
    // displays the real conversation date instead of the import date.
    // 5 conversations per row keeps the table manageable.
    // ------------------------------------------------------------------
    const rawRows = buildRawRows(conversations)
    for (const row of rawRows) {
      try {
        await insertSummary(supabase, userId, row)
        inserted++
      } catch {
        // non-fatal — continue with remaining rows
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Compact date index for fast date-based recall
    // ------------------------------------------------------------------
    const dateIndex = [
      `[ChatGPT Conversation Index — imported ${new Date().toISOString().slice(0, 10)}]`,
      ...conversations.map(c => {
        const date =
          c.updatedAt > 0
            ? new Date(c.updatedAt * 1000).toISOString().slice(0, 10)
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
      inserted
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
