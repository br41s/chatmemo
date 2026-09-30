import type { MemoryEntryReport } from "@/lib/memory-report"
import { IconBrain } from "@tabler/icons-react"
import { FC } from "react"
import { MemorySourceChip } from "./memory-source-chip"

interface MemoryRecallingProps {
  /** The matched conversations, by name. */
  items: MemoryEntryReport[]
  /** A transcript was recovered and is in the block, or is being looked for.
   *  Different claims: only the turn's own report can say one was found. */
  transcript?: "found" | "searching"
  /** How many history entries went in, when the full report is in hand. */
  historyEntries?: number
  /** The newest date the memory reaches, when the full report is in hand. */
  reach?: string
}

/**
 * What the model is being reminded of, shown while the answer is on its way.
 *
 * Two things can say so before the first token. The turn's own report, when
 * it is already in hand — the Ollama path fetches memory before it calls the
 * local model. And for a hosted model, whose report only arrives with the
 * answer, the preview the browser asks for alongside the chat request. Either
 * way this names the conversations and then gives way to the answer; the same
 * facts live on in the panel beneath it.
 */
export const MemoryRecalling: FC<MemoryRecallingProps> = ({
  items,
  transcript,
  historyEntries = 0,
  reach
}) => {
  const headline =
    transcript === "found"
      ? "Reading the recovered transcript"
      : transcript === "searching"
        ? "Looking for the conversation you asked for"
        : items.length > 0
          ? `Remembering ${items.length} ${items.length === 1 ? "conversation" : "conversations"}`
          : historyEntries > 0
            ? `Recalling ${historyEntries.toLocaleString()} memory entries`
            : "Recalling"

  return (
    <div
      role="status"
      className="duration-300 animate-in fade-in slide-in-from-bottom-1"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconBrain
          size={18}
          className="animate-recall text-brand motion-reduce:animate-none"
        />
        <span>{headline}</span>
        {reach && <span className="text-xs tabular-nums">· up to {reach}</span>}
      </div>
      {items.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {items.map((item, index) => (
            <li
              key={`${item.source}-${item.title}-${index}`}
              className="max-w-full animate-in fade-in slide-in-from-left-1 fill-mode-backwards"
              style={{ animationDelay: `${120 + index * 90}ms` }}
            >
              <MemorySourceChip
                source={item.source}
                title={item.date ? `${item.date} · ${item.title}` : item.title}
              >
                {item.title}
                {item.more ? ` +${item.more}` : ""}
              </MemorySourceChip>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
