import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import {
  buildDateIndex,
  buildRawRows,
  formatConversationFull,
  parsePerplexityExport
} from "@/lib/importers/perplexity"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

const MAX_FILE_BYTES = 100 * 1024 * 1024 // 100 MB

/** Conversations with fewer chars than this are not stored as individual raw rows. */
const MIN_CHARS_FOR_RAW = 200

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

    const conversations = parsePerplexityExport(raw)
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
    // Step 1: Insert raw full-text rows for substantive conversations.
    // Each includes the Perplexity mode metadata line after the header.
    // 5 conversations per row keeps the table manageable.
    // ------------------------------------------------------------------
    const rawRows = buildRawRows(
      conversations.filter(
        c => formatConversationFull(c).length >= MIN_CHARS_FOR_RAW
      )
    )
    for (const row of rawRows) {
      try {
        await insertSummary(supabase, userId, row)
        inserted++
      } catch {
        // non-fatal — continue with remaining rows
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Compact date index for fast date-based recall.
    // Includes the mode tag for each conversation.
    // ------------------------------------------------------------------
    try {
      await insertSummary(supabase, userId, buildDateIndex(conversations))
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
