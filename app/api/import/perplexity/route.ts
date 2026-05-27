import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { getWatermark, insertSummary, setWatermark } from "@/db/summaries"
import {
  buildDateIndex,
  formatConversationFull,
  parsePerplexityExport
} from "@/lib/importers/perplexity"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

const SOURCE = "perplexity"
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
    // Step 1: One row per conversation via formatConversationFull.
    // This embeds "Source: Perplexity / MODE" so rows are identifiable
    // for selective deletion even without the [source:X] tag.
    // Tagged with [source:perplexity] prefix for the clear-source API.
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
    // Step 3: Update watermark to the newest conversation we just stored.
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
      inserted
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
