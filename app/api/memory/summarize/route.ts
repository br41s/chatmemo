import { getServerProfile } from "@/lib/server/server-chat-helpers"
import {
  callSummarizer,
  callSummarizerWithMeta,
  createOpenRouterClient,
  resolveOpenRouterKey
} from "@/lib/server/openrouter"
import { createClient } from "@/lib/supabase/server"
import { insertSummary } from "@/db/summaries"
import { getLessonsRecord, replaceLessons } from "@/lib/db/lessons"
import {
  checkLessonsRewrite,
  lessonsRewriteMaxTokens,
  MAX_LESSONS_CHARS
} from "@/lib/lessons-rewrite"
import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { ServerRuntime } from "next"

export const runtime: ServerRuntime = "nodejs"

const MAX_MESSAGES = 20
const MIN_USEFUL_MESSAGES = 4
const DUPLICATE_THRESHOLD = 0.75 // Jaccard similarity above this → skip insert
// How far back to look for a near-duplicate. Enough to see past the other
// conversations a user may have in flight at the same time.
const DUPLICATE_LOOKBACK = 8

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

    // Near-duplicate guard.
    //
    // Compared against the most recent few rows rather than only the newest.
    // This route fires after every turn, so a conversation produces a run of
    // near-identical summaries; checking one row back caught that only while
    // the user had a single chat in flight. With two conversations interleaved,
    // the newest row belonged to the other chat and every summary looked novel.
    const { data: recentRows } = await supabase
      .from("summaries")
      .select("content")
      .eq("user_id", userId)
      .eq("kind", "conversation")
      .order("created_at", { ascending: false })
      .limit(DUPLICATE_LOOKBACK)

    const duplicateOf = (recentRows ?? []).find(
      row =>
        row.content &&
        jaccardSimilarity(summaryText, row.content) >= DUPLICATE_THRESHOLD
    )

    if (duplicateOf) {
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
      // Read the version stamp with the document: the rewrite below replaces
      // it wholesale, so the write has to prove nothing changed underneath.
      const { content: currentLessons, updatedAt } = await getLessonsRecord(
        supabase,
        userId
      )
      const emptyTemplate = `# User Lessons

## Preferences & Communication Style

## Active Projects & Work Context

## Personal Context

## Recurring Patterns & Constraints`

      if ((currentLessons?.length ?? 0) > MAX_LESSONS_CHARS) {
        // Too large to restate even at the ceiling allowance. Attempting the
        // rewrite would risk losing what it could not fit.
        console.warn(
          `[summarize] Lessons document is ${currentLessons?.length} chars; skipping rewrite (limit ${MAX_LESSONS_CHARS})`
        )
      } else {
        const lessonsInput =
          `CURRENT USER LESSONS DOCUMENT:\n${currentLessons ?? emptyTemplate}\n\n` +
          `TODAY'S CONVERSATION SUMMARY:\n${summaryText}`

        const { text: updatedLessons, truncated } =
          await callSummarizerWithMeta(
            openai,
            LESSONS_SYSTEM_PROMPT,
            lessonsInput,
            // Scales with the document. The previous fixed 800 guaranteed
            // truncation once the document outgrew it.
            lessonsRewriteMaxTokens(currentLessons)
          )

        if (updatedLessons) {
          const verdict = checkLessonsRewrite({
            previous: currentLessons,
            next: updatedLessons,
            truncated
          })

          if (verdict.ok) {
            const won = await replaceLessons(
              supabase,
              userId,
              updatedLessons,
              updatedAt
            )
            if (!won) {
              // Another summarise wrote first. Its document is the base now;
              // rewriting from the stale copy would discard its facts.
              console.warn(
                "[summarize] Lessons write lost a race; leaving the winner in place"
              )
            }
          } else if (verdict.reason !== "unchanged") {
            console.warn(
              `[summarize] Rejected lessons rewrite (${verdict.reason}${
                verdict.detail ? `: ${verdict.detail}` : ""
              })`
            )
          }
        }
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
