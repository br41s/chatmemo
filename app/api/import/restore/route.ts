/**
 * POST /api/import/restore
 *
 * Accepts a backup file payload and re-inserts rows that don't already
 * exist in the database (content-based deduplication).
 *
 * Body: { rows: { content: string; created_at: string }[] }
 *
 * Returns: { success: boolean; inserted: number; skipped: number }
 */

import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

const MAX_ROWS = 50_000 // safety cap

export async function POST(request: NextRequest) {
  try {
    const profile = await getServerProfile()
    const userId = profile.user_id
    const supabase = createClient(cookies())

    let body: { rows?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 }
      )
    }

    if (!Array.isArray(body.rows)) {
      return NextResponse.json(
        { success: false, message: "Body must have a `rows` array" },
        { status: 400 }
      )
    }

    const incoming = (body.rows as unknown[])
      .filter(
        r =>
          r !== null &&
          typeof r === "object" &&
          typeof (r as Record<string, unknown>).content === "string" &&
          (r as Record<string, unknown>).content !== ""
      )
      .slice(0, MAX_ROWS) as { content: string; created_at?: string }[]

    if (incoming.length === 0) {
      return NextResponse.json({ success: true, inserted: 0, skipped: 0 })
    }

    // Fetch all existing content for this user so we can dedup
    const { data: existing, error: fetchErr } = await supabase
      .from("summaries")
      .select("content")
      .eq("user_id", userId)

    if (fetchErr) {
      return NextResponse.json(
        { success: false, message: fetchErr.message },
        { status: 500 }
      )
    }

    const existingSet = new Set((existing ?? []).map(r => r.content))

    const toInsert = incoming.filter(r => !existingSet.has(r.content))
    const skipped = incoming.length - toInsert.length

    if (toInsert.length === 0) {
      return NextResponse.json({ success: true, inserted: 0, skipped })
    }

    // Insert in batches of 500 to avoid request size limits
    const BATCH = 500
    let inserted = 0

    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH).map(r => ({
        user_id: userId,
        content: r.content,
        // Preserve original timestamp if valid; fall back to now()
        ...(r.created_at && !isNaN(Date.parse(r.created_at))
          ? { created_at: r.created_at }
          : {})
      }))

      const { error: insertErr } = await supabase
        .from("summaries")
        .insert(batch)

      if (insertErr) {
        return NextResponse.json(
          {
            success: false,
            message: insertErr.message,
            inserted,
            skipped
          },
          { status: 500 }
        )
      }

      inserted += batch.length
    }

    return NextResponse.json({ success: true, inserted, skipped })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
