import { getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  callSummarizer,
  createOpenRouterClient,
  resolveOpenRouterKey
} from "@/lib/server/openrouter"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { getLessons, upsertLessons } from "@/lib/db/lessons"
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

const LESSONS_SYSTEM_PROMPT = `You are a personal AI assistant maintaining a persistent "User Lessons" document — a growing knowledge base about one specific user, updated after each conversation.

TASK:
Review the conversation summary below. If it reveals new, durable, non-redundant facts about the user, add them to the document. If existing entries are contradicted or outdated, update them.

RULES:
- Only add genuinely new information not already captured
- Be specific: project names, tech choices, personal context, preferences, recurring patterns, decisions
- One fact per bullet point — concise, no filler
- Do NOT add timestamps, dates, or "learned today" markers — the document captures timeless facts
- If nothing meaningful is new, return the document exactly as-is (no changes)
- Never remove sections, even if empty

DOCUMENT STRUCTURE (always maintain this):
# User Lessons

## Preferences & Communication Style
- (how the user likes to work, communicate, respond)

## Active Projects & Work Context
- (ongoing projects, tech stack, goals, role)

## Personal Context
- (background, interests, stable personal facts)

## Recurring Patterns & Constraints
- (things that come up repeatedly, hard requirements, known friction points)

Return ONLY the updated document. No preamble, no commentary, no markdown fences.`

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

    // ------------------------------------------------------------------
    // Lessons update pass — runs after the summary is saved.
    // Reads the current lessons doc + today's summary and rewrites the
    // doc if new meaningful facts were found. Non-fatal if it fails.
    // ------------------------------------------------------------------
    try {
      const currentLessons = await getLessons(supabase, userId)
      const emptyTemplate = `# User Lessons

## Preferences & Communication Style

## Active Projects & Work Context

## Personal Context

## Recurring Patterns & Constraints`

      const lessonsInput =
        `CURRENT USER LESSONS DOCUMENT:\n${currentLessons ?? emptyTemplate}\n\n` +
        `TODAY'S CONVERSATION SUMMARY:\n${summaryText}`

      const updatedLessons = await callSummarizer(
        openai,
        LESSONS_SYSTEM_PROMPT,
        lessonsInput,
        800
      )

      if (
        updatedLessons &&
        updatedLessons !== "SKIP" &&
        updatedLessons !== currentLessons
      ) {
        await upsertLessons(supabase, userId, updatedLessons)
      }
    } catch (lessonsErr) {
      // Non-fatal — log but don't fail the summarize response
      console.error(
        "[summarize] Lessons update failed:",
        lessonsErr instanceof Error ? lessonsErr.message : lessonsErr
      )
    }

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
