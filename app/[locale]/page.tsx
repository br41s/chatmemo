"use client"

import { ChatMemoSVG } from "@/components/icons/chatmemo-svg"
import { MemorySourceChip } from "@/components/memory/memory-source-chip"
import { IconArrowRight } from "@tabler/icons-react"
import Link from "next/link"

/**
 * The front door.
 *
 * It was the fork's: a mark and a button. Now it says what the product is —
 * a memory shared by every model you talk to, built from the conversations
 * you already had elsewhere — in the same colours the app uses for those
 * sources, and offers the help page to anyone not ready to sign in.
 */
export default function HomePage() {
  return (
    <div className="flex size-full flex-col items-center justify-center px-6">
      <div className="flex max-w-lg flex-col items-center text-center duration-500 animate-in fade-in slide-in-from-bottom-2">
        <ChatMemoSVG scale={0.32} />
        <h1 className="mt-3 text-4xl font-bold tracking-tight">ChatMemo</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          One memory across your AI conversations.
        </p>

        <p className="mt-6 text-sm leading-relaxed text-foreground/85">
          Bring in what you have already told ChatGPT, Claude and Perplexity.
          Every model you talk to here is reminded of it, and every answer shows
          you what it was told.
        </p>

        <ul
          aria-label="Memory sources"
          className="mt-4 flex flex-wrap justify-center gap-1.5"
        >
          {(
            [
              "claude-ai",
              "claude-code",
              "chatgpt",
              "perplexity",
              "chat"
            ] as const
          ).map((source, index) => (
            <li
              key={source}
              className="duration-300 animate-in fade-in zoom-in-95 fill-mode-backwards"
              style={{ animationDelay: `${200 + index * 70}ms` }}
            >
              <MemorySourceChip source={source} />
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            className="inline-flex items-center justify-center rounded-md bg-brand px-5 py-2.5 font-semibold text-brand-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            href="/login"
          >
            Start chatting
            <IconArrowRight className="ml-1" size={20} />
          </Link>
          <Link
            className="inline-flex items-center justify-center rounded-md border px-5 py-2.5 font-medium text-muted-foreground transition-colors hover:border-brand/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            href="/help"
          >
            How it works
          </Link>
        </div>
      </div>
    </div>
  )
}
