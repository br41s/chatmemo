/**
 * POST /api/import/conversation
 *
 * Accepts a single conversation (from the bookmarklet or any client) and
 * stores it as a memory summary. Requires the user to be logged into
 * ChatMemo — the bookmarklet must be clicked while ChatMemo is open in
 * another tab so the Supabase session cookie is present.
 *
 * CORS is open for https://claude.ai so the bookmarklet can POST cross-origin
 * with credentials.
 */

import { getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"
import OpenAI from "openai"

export const runtime: ServerRuntime = "nodejs"

// ---------------------------------------------------------------------------
// CORS — allow claude.ai to POST with cookies
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = ["https://claude.ai", "http://localhost:3000"]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true"
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin")
  return new NextResponse(null, { status: 200, headers: corsHeaders(origin) })
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPENROUTER_TIMEOUT_MS = 30_000
const MIN_SUMMARY_WORDS = 10
const MIN_CHARS = 200

const SYSTEM_PROMPT = `You are a memory assistant. You are given a conversation a user had with an AI assistant.

Your job is to extract a detailed, durable memory summary that will help a future AI assistant understand this user deeply.

Start with a header line exactly like this:
### [YYYY-MM-DD] Conversation Title
Then bullet the key facts underneath.

Extract and preserve:
- Active and ongoing projects (names, tech stack, goals, current status)
- Preferences, habits, and working style
- Technical details: languages, frameworks, tools, architecture decisions
- Personal context: interests, goals, background facts
- Decisions made and their rationale
- Anything specific enough to be useful in a future session

Be specific. Preserve proper nouns, project names, technology choices, concrete facts, and exact dates. Do not generalize.

Output: plain text only, up to 600 words.
If the conversation contains nothing worth remembering, output only the single word: SKIP`

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  const headers = corsHeaders(origin)

  try {
    const profile = await getServerProfile()
    const userId = profile.user_id

    const openrouterKey =
      profile.openrouter_api_key || process.env.OPENROUTER_API_KEY || null

    if (!openrouterKey) {
      return NextResponse.json(
        { success: false, reason: "OpenRouter API key not configured" },
        { status: 400, headers }
      )
    }

    // --- Parse body ---
    let body: {
      title?: string
      date?: string
      messages?: { role: string; text: string }[]
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, reason: "Invalid JSON body" },
        { status: 400, headers }
      )
    }

    const { title = "Untitled conversation", date, messages = [] } = body

    const validMessages = messages.filter(
      m =>
        (m.role === "user" || m.role === "assistant") &&
        typeof m.text === "string" &&
        m.text.trim().length > 0
    )

    if (validMessages.length === 0) {
      return NextResponse.json(
        { success: false, reason: "No valid messages provided" },
        { status: 400, headers }
      )
    }

    const fullText = validMessages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text.trim()}`)
      .join("\n\n")

    if (fullText.length < MIN_CHARS) {
      return NextResponse.json(
        {
          success: true,
          inserted: 0,
          reason: "Conversation too short to summarize"
        },
        { status: 200, headers }
      )
    }

    const convDate = date ?? new Date().toISOString().slice(0, 10)
    const convHeader = `## ${title} (${convDate})`
    const inputText = `${convHeader}\n\n${fullText}`

    // --- Summarize ---
    const openai = new OpenAI({
      apiKey: openrouterKey,
      baseURL: "https://openrouter.ai/api/v1",
      timeout: OPENROUTER_TIMEOUT_MS
    })

    const completion = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash-exp:free",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: inputText }
      ],
      temperature: 0.3,
      max_tokens: 900,
      stream: false
    })

    const summaryText = (completion.choices[0]?.message?.content ?? "").trim()

    if (
      !summaryText ||
      summaryText === "SKIP" ||
      summaryText.split(/\s+/).length < MIN_SUMMARY_WORDS
    ) {
      return NextResponse.json(
        { success: true, inserted: 0, reason: "Nothing worth remembering" },
        { status: 200, headers }
      )
    }

    const supabase = createClient(cookies())
    await insertSummary(supabase, userId, summaryText)

    return NextResponse.json(
      { success: true, inserted: 1 },
      { status: 200, headers }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    return NextResponse.json(
      { success: false, message },
      { status: 500, headers }
    )
  }
}
