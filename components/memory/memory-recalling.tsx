import type { MemoryReport } from "@/lib/memory-report"
import { IconBrain } from "@tabler/icons-react"
import { FC } from "react"
import { MemorySourceChip } from "./memory-source-chip"

interface MemoryRecallingProps {
  report: MemoryReport
}

/**
 * What the model is being reminded of, shown while the answer is on its way.
 *
 * The report reaches the browser in the response headers, ahead of the first
 * token, so the pause before an answer can show the memory that is going
 * into it: the matched conversations by name and source, and how far back
 * the history reaches. Once text arrives this gives way to the answer, and
 * the same facts live on in the panel beneath it.
 */
export const MemoryRecalling: FC<MemoryRecallingProps> = ({ report }) => {
  const items = report.relevant?.items ?? []
  const historyEntries = report.history?.entries ?? 0
  const reach = report.history?.span?.newest ?? report.relevant?.span?.newest

  const headline = report.fullConversation
    ? "Reading the recovered transcript"
    : items.length > 0
      ? `Remembering ${items.length} ${items.length === 1 ? "conversation" : "conversations"}`
      : historyEntries > 0
        ? `Recalling ${historyEntries.toLocaleString()} memory entries`
        : "Recalling"

  return (
    <div
      role="status"
      aria-live="polite"
      className="duration-300 animate-in fade-in slide-in-from-bottom-1"
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconBrain size={18} className="animate-recall text-brand" />
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
              </MemorySourceChip>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
