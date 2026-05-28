/**
 * POST /api/import/conversation
 *
 * Accepts a single conversation (from the bookmarklet or any client) and
 * stores it as a memory summary.
 *
 * Two auth modes:
 *  1. Bearer token  — bookmarklet sends `Authorization: Bearer <CHATMEMO_IMPORT_TOKEN>`
 *     The server resolves userId from CHATMEMO_IMPORT_USER_ID env var (written by
 *     setup:sync). Works cross-origin even when SameSite cookies can't travel.
 *  2. Session cookie — any same-origin client that has a Supabase session cookie.
 *
 * CORS is open for https://claude.ai so the bookmarklet can POST cross-origin.
 */

import { getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  callSummarizer,
  createOpenRouterClient,
  MIN_SUMMARY_WORDS
} from "@/lib/server/openrouter"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { insertSummary } from "@/db/summaries"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"
import { timingSafeEqual } from "crypto"

export const runtime: ServerRuntime = "nodejs"

// ---------------------------------------------------------------------------
// CORS — allow claude.ai to POST without cookies
// ---------------------------------------------------------------------------

// localhost is included in dev only — remove it from production to avoid
// cross-origin abuse from local servers on the same machine as the user.
const ALLOWED_ORIGINS = [
  "https://claude.ai",
  ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000"] : [])
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Try Bearer token auth first (bookmarklet path).
 * Falls back to session cookie auth (same-origin path).
 * Returns userId or throws.
 */
async function resolveUserId(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get("authorization") ?? ""

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim()
    const importToken = process.env.CHATMEMO_IMPORT_TOKEN
    const importUserId = process.env.CHATMEMO_IMPORT_USER_ID

    if (!importToken || !importUserId) {
      throw new Error(
        "Bearer token auth not configured — run npm run setup:sync"
      )
    }

    // Constant-time comparison to prevent timing attacks
    const tokenBuf = Buffer.from(token)
    const importBuf = Buffer.from(importToken)
    const tokensMatch =
      tokenBuf.length === importBuf.length &&
      timingSafeEqual(tokenBuf, importBuf)
    if (!tokensMatch) {
      throw new Error("Invalid import token")
    }

    return importUserId
  }

  // Fall back to cookie-based session auth
  const profile = await getServerProfile()
  return profile.user_id
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  const headers = corsHeaders(origin)

  try {
    const userId = await resolveUserId(request)

    const openrouterKey = process.env.OPENROUTER_API_KEY
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
    const inputText = `## ${title} (${convDate})\n\n${fullText}`

    // --- Summarize ---
    const openai = createOpenRouterClient(openrouterKey)
    const summaryText = await callSummarizer(
      openai,
      SYSTEM_PROMPT,
      inputText,
      900
    )

    if (!summaryText) {
      return NextResponse.json(
        { success: true, inserted: 0, reason: "Nothing worth remembering" },
        { status: 200, headers }
      )
    }

    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await insertSummary(supabase, userId, summaryText)

    return NextResponse.json(
      { success: true, inserted: 1 },
      { status: 200, headers }
    )
  } catch (error) {
    const raw = error instanceof Error ? error.message : "Unexpected error"
    const isRateLimit =
      raw.includes("429") || raw.toLowerCase().includes("rate limit")
    const message = isRateLimit
      ? "OpenRouter rate limit — wait a moment and try again"
      : raw
    return NextResponse.json(
      { success: false, message },
      { status: isRateLimit ? 429 : 500, headers }
    )
  }
}
