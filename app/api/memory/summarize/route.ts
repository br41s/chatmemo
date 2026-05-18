import { getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  callSummarizer,
  createOpenRouterClient,
  resolveOpenRouterKey
} from "@/lib/server/openrouter"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

const MAX_MESSAGES = 20
const MIN_USEFUL_MESSAGES = 4
const DUPLICATE_THRESHOLD = 0.75 // Jaccard similarity above this → skip insert

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

const SYSTEM_PROMPT = `You are a memory assistant. Extract a concise, durable memory summary from the following conversation.

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

    const profile = await getServerProfile()
    const userId = profile.user_id
    const openrouterKey = resolveOpenRouterKey(profile)

    const supabase = createClient(cookies())

    // Verify the chat belongs to the authenticated user
    const { data: chat, error: chatError } = await supabase
      .from("chats")
      .select("id, user_id")
      .eq("id", chatId)
      .eq("user_id", userId)
      .maybeSingle()

    if (chatError || !chat) {
      return NextResponse.json({ message: "Chat not found" }, { status: 404 })
    }

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

    const conversationText = [...rows]
      .reverse()
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n")

    if (!conversationText.trim()) {
      return NextResponse.json(
        { success: true, inserted: false, reason: "no content to summarise" },
        { status: 200 }
      )
    }

    const openai = createOpenRouterClient(openrouterKey, 15_000)
    const summaryText = await callSummarizer(
      openai,
      SYSTEM_PROMPT,
      conversationText,
      600
    )

    if (!summaryText) {
      return NextResponse.json(
        { success: true, inserted: false, reason: "summary not useful" },
        { status: 200 }
      )
    }

    // Near-duplicate guard
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unexpected error"
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? (error as { status: number }).status
        : 500
    return NextResponse.json({ message }, { status })
  }
}
