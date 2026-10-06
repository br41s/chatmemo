import { HttpError } from "@/lib/server/http-error"
/**
 * POST /api/import/conversation
 *
 * Accepts a single conversation (from the bookmarklet or any client) and
 * stores it as a memory summary.
 *
 * `sessionKey` (optional) names what the conversation is, for a writer that
 * posts the same one again as it grows — the Claude Code cloud-session hook
 * sends "claude-code:<session id>". A post with a key replaces the row the
 * previous post with that key stored, instead of adding another.
 *
 * `replaceRowId` (optional) names a row the old laptop sync wrote itself,
 * before posts carried keys; it is retired once the new row is in, so the
 * session does not keep both.
 *
 * Two auth modes:
 *  1. Bearer token  — `Authorization: Bearer <token>`, one of the tokens in
 *     lib/server/import-token.ts (the laptop scripts and bookmarklets hold
 *     one, the cloud hook another that may only post Claude Code sessions).
 *     Either resolves to CHATMEMO_IMPORT_USER_ID, written by setup:sync.
 *     Works cross-origin, where SameSite cookies cannot travel.
 *  2. Session cookie — any same-origin client that has a Supabase session cookie.
 *
 * CORS is open for https://claude.ai and gemini.google.com so the bookmarklets
 * can POST cross-origin — with the token, never with cookies.
 */

import { getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  callSummarizer,
  createOpenRouterClient,
  MIN_SUMMARY_WORDS
} from "@/lib/server/openrouter"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { insertSummary, replaceSessionSummary } from "@/db/summaries"
import { storedSummary } from "@/lib/summary-metadata"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"
import {
  grantAllows,
  grantAllowsRetire,
  ImportTokenGrant,
  resolveImportToken
} from "@/lib/server/import-token"
import {
  LimitedJsonError,
  readLimitedJson
} from "@/lib/server/read-limited-json"

export const runtime: ServerRuntime = "nodejs"
// A cloud session's transcript is far longer than a bookmarklet page, and the
// default limit ends the function mid-summary.
export const maxDuration = 60

// ---------------------------------------------------------------------------
// CORS — allow claude.ai to POST without cookies
// ---------------------------------------------------------------------------

// localhost is included in dev only — remove it from production to avoid
// cross-origin abuse from local servers on the same machine as the user.
const ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://gemini.google.com",
  ...(process.env.NODE_ENV === "development" ? ["http://localhost:3000"] : [])
]

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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
// A cloud session's post is capped at 80k chars by the hook; a bookmarklet
// page can be longer. What the summariser is given is bounded here too, so a
// stray or hostile post cannot hold the function for the whole minute.
const MAX_BODY_BYTES = 1_000_000
const MAX_INPUT_CHARS = 200_000
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A key is the writer's own identifier, stored and matched verbatim; nothing
// here parses it. Bounded and plain so it cannot smuggle a filter into the
// query that prunes by it.
const SESSION_KEY_RE = /^[\w:.-]{1,200}$/

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
 * Try Bearer token auth first (the scripts' and bookmarklets' path).
 * Falls back to session cookie auth (same-origin path).
 * Returns the grant or throws.
 */
async function resolveGrant(request: NextRequest): Promise<ImportTokenGrant> {
  const grant = resolveImportToken(request.headers.get("authorization"))
  if (grant === "unconfigured") {
    throw new HttpError(
      "Bearer token auth not configured — run npm run setup:sync",
      500
    )
  }
  if (grant === "invalid") {
    // 401, not the 500 a bare Error became: a caller with a stale token
    // should be told so, not told the server broke.
    throw new HttpError("Invalid import token", 401)
  }
  if (grant) return grant

  // Fall back to cookie-based session auth
  const profile = await getServerProfile()
  return { userId: profile.user_id, keyPrefix: null }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  const headers = corsHeaders(origin)

  try {
    const grant = await resolveGrant(request)
    const userId = grant.userId

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
      sessionKey?: unknown
      replaceRowId?: unknown
    }
    try {
      body = (await readLimitedJson(request, {
        maxBytes: MAX_BODY_BYTES,
        timeoutMs: 15_000
      })) as typeof body
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new LimitedJsonError("Request body must be a JSON object", 400)
      }
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          reason:
            error instanceof LimitedJsonError
              ? error.message
              : "Invalid JSON body"
        },
        {
          status: error instanceof LimitedJsonError ? error.status : 400,
          headers
        }
      )
    }

    const { title = "Untitled conversation", date } = body
    const messages = Array.isArray(body.messages) ? body.messages : []

    const sessionKey =
      body.sessionKey === undefined ? null : String(body.sessionKey)
    if (sessionKey !== null && !SESSION_KEY_RE.test(sessionKey)) {
      return NextResponse.json(
        { success: false, reason: "Invalid sessionKey" },
        { status: 400, headers }
      )
    }
    if (!grantAllows(grant, sessionKey)) {
      return NextResponse.json(
        { success: false, reason: "This token may only post sessions" },
        { status: 403, headers }
      )
    }

    const replaceRowId =
      body.replaceRowId === undefined ? null : String(body.replaceRowId)
    if (replaceRowId !== null && !UUID_RE.test(replaceRowId)) {
      return NextResponse.json(
        { success: false, reason: "Invalid replaceRowId" },
        { status: 400, headers }
      )
    }
    if (replaceRowId !== null && !grantAllowsRetire(grant)) {
      return NextResponse.json(
        { success: false, reason: "This token may not retire rows" },
        { status: 403, headers }
      )
    }

    const validMessages = messages.filter(
      m =>
        m &&
        typeof m === "object" &&
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

    const joined = validMessages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text.trim()}`)
      .join("\n\n")
    // The most recent part, like the cloud hook keeps.
    const fullText =
      joined.length > MAX_INPUT_CHARS ? joined.slice(-MAX_INPUT_CHARS) : joined

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
    const openai = createOpenRouterClient(openrouterKey, 50_000)
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
    const content = storedSummary(summaryText, sessionKey)
    if (sessionKey) {
      await replaceSessionSummary(supabase, userId, sessionKey, content)
    } else {
      await insertSummary(supabase, userId, content)
    }
    if (replaceRowId) {
      // The caller's own row only, and only one the old laptop sync wrote: a
      // session row that carries no key. Lessons, watermarks and keyed rows
      // are out of reach however the id was learned.
      const { error } = await supabase
        .from("summaries")
        .delete()
        .eq("user_id", userId)
        .eq("id", replaceRowId)
        .is("external_id", null)
        .in("source", ["claude", "claude_code", "copilot"])
      if (error) {
        console.warn(
          `[import/conversation] could not retire row ${replaceRowId}: ${error.message}`
        )
      }
    }

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
      {
        status: isRateLimit
          ? 429
          : error instanceof HttpError
            ? error.status
            : 500,
        headers
      }
    )
  }
}
