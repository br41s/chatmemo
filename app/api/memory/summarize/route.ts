import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"
import OpenAI from "openai"

export const runtime: ServerRuntime = "nodejs"

const MAX_MESSAGES = 20
const MIN_USEFUL_MESSAGES = 4 // at least 2 full turns before summarising
const MIN_SUMMARY_WORDS = 10
const DUPLICATE_THRESHOLD = 0.75 // Jaccard similarity above this → skip insert
const OPENROUTER_TIMEOUT_MS = 15_000

/** Word-level Jaccard similarity between two strings (0–1). */
function jaccardSimilarity(a: string, b: string): number {
  const wordsOf = (s: string) => new Set(s.toLowerCase().match(/\w+/g) ?? [])
  const setA = wordsOf(a)
  const setB = wordsOf(b)
  if (setA.size === 0 && setB.size === 0) return 1
  let intersection = 0
  setA.forEach(w => {
    if (setB.has(w)) intersection++
  })
  return intersection / (setA.size + setB.size - intersection)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chatId } = body as { chatId?: string }

    if (!chatId || typeof chatId !== "string") {
      return NextResponse.json(
        { message: "chatId is required" },
        { status: 400 }
      )
    }

    // Auth — throws if session is missing
    const profile = await getServerProfile()
    const userId = profile.user_id

    // Server supabase client for DB queries (shares session via cookies)
    const supabase = createClient(cookies())

    // Security: verify the chat belongs to the authenticated user
    const { data: chat, error: chatError } = await supabase
      .from("chats")
      .select("id, user_id")
      .eq("id", chatId)
      .eq("user_id", userId)
      .maybeSingle()

    if (chatError || !chat) {
      return NextResponse.json({ message: "Chat not found" }, { status: 404 })
    }

    // Fetch the last N messages ordered by sequence_number
    const { data: rows, error: msgError } = await supabase
      .from("messages")
      .select("role, content")
      .eq("chat_id", chatId)
      .order("sequence_number", { ascending: false })
      .limit(MAX_MESSAGES)

    if (msgError || !rows || rows.length === 0) {
      return NextResponse.json(
        { success: true, inserted: false, reason: "no messages" },
        { status: 200 }
      )
    }

    if (rows.length < MIN_USEFUL_MESSAGES) {
      return NextResponse.json(
        { success: true, inserted: false, reason: "too few messages" },
        { status: 200 }
      )
    }

    // Restore chronological order
    const messages = [...rows].reverse()

    // Resolve OpenRouter API key (profile key takes precedence, env key as fallback)
    const openrouterKey =
      profile.openrouter_api_key || process.env.OPENROUTER_API_KEY || null
    checkApiKey(openrouterKey, "OpenRouter")

    // Build conversation text for the summarization prompt
    const conversationText = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n")

    if (!conversationText.trim()) {
      return NextResponse.json(
        { success: true, inserted: false, reason: "no content to summarise" },
        { status: 200 }
      )
    }

    const systemPrompt = `You are a memory assistant. Extract a concise, durable memory summary from the following conversation.

Focus on:
- User preferences, habits, and working style
- Active projects, goals, and ongoing context
- Important constraints, restrictions, or requirements stated by the user
- Personal facts that are stable and useful for future sessions

Avoid:
- Ephemeral or one-off requests
- Verbatim quotes from the conversation
- Trivial details or small talk
- Time-sensitive information unlikely to remain relevant

Output: plain text only, under 350 words.
If the conversation contains nothing worth remembering, output only the single word: SKIP`

    const openai = new OpenAI({
      apiKey: openrouterKey ?? "",
      baseURL: "https://openrouter.ai/api/v1",
      timeout: OPENROUTER_TIMEOUT_MS
    })

    const completion = await openai.chat.completions.create({
      model: "meta-llama/llama-3.3-70b-instruct:free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: conversationText }
      ],
      temperature: 0.3,
      max_tokens: 600,
      stream: false
    })

    const summaryText = (completion.choices[0]?.message?.content ?? "").trim()

    if (
      !summaryText ||
      summaryText === "SKIP" ||
      summaryText.split(/\s+/).length < MIN_SUMMARY_WORDS
    ) {
      return NextResponse.json(
        { success: true, inserted: false, reason: "summary not useful" },
        { status: 200 }
      )
    }

    // Near-duplicate guard: skip if the new summary is too similar to the last one
    const { data: lastRow } = await supabase
      .from("summaries")
      .select("content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (
      lastRow?.content &&
      jaccardSimilarity(summaryText, lastRow.content) >= DUPLICATE_THRESHOLD
    ) {
      return NextResponse.json(
        { success: true, inserted: false, reason: "duplicate" },
        { status: 200 }
      )
    }

    await insertSummary(supabase, userId, summaryText)

    return NextResponse.json({ success: true, inserted: true }, { status: 200 })
  } catch (error: any) {
    const message = error?.message || "Unexpected error"
    const status = error?.status || 500
    return NextResponse.json({ message }, { status })
  }
}
