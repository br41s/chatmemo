import { MemoryReport } from "@/lib/memory-report"
import {
  IconBrain,
  IconChevronDown,
  IconChevronRight
} from "@tabler/icons-react"
import { FC, useState } from "react"

interface MessageMemoryProps {
  report: MemoryReport
}

const formatChars = (chars: number): string =>
  chars >= 1_000 ? `${Math.round(chars / 1_000)}k chars` : `${chars} chars`

interface LayerRowProps {
  label: string
  detail: string
  hint: string
}

const LayerRow: FC<LayerRowProps> = ({ label, detail, hint }) => (
  <div className="flex items-baseline justify-between gap-4 py-1">
    <div className="min-w-0">
      <div className="text-xs font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
    <div className="shrink-0 text-xs tabular-nums text-muted-foreground">
      {detail}
    </div>
  </div>
)

/**
 * What this answer was told about the user, shown under the answer itself.
 *
 * The product is built on persistent memory, but the chat surface said nothing
 * about it: no sign that memory was injected, no way to tell an answer grounded
 * in a stored conversation from one the model invented. The injected
 * instructions spend a paragraph forbidding fabrication; this is the part that
 * lets a person check.
 */
export const MessageMemory: FC<MessageMemoryProps> = ({ report }) => {
  const [open, setOpen] = useState(false)

  // Retrieval that ran and matched nothing is worth surfacing on its own: the
  // model was told to say it could not find the conversation rather than guess.
  if (!report.injected && !report.fullConversationMissed) return null

  const entryCount =
    (report.history?.entries ?? 0) + (report.relevant?.entries ?? 0)

  const summary = report.fullConversation
    ? "Answered from a recovered transcript"
    : entryCount > 0
      ? `${entryCount} memory ${entryCount === 1 ? "entry" : "entries"} used`
      : report.lessons
        ? "Used your lessons"
        : "No memory matched"

  const usedShare =
    report.budgetChars > 0
      ? Math.min(
          100,
          Math.round((report.totalChars / report.budgetChars) * 100)
        )
      : 0

  return (
    <div className="mt-3 border-t pt-2">
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <IconBrain size={14} />
        <span>{summary}</span>
        {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
      </button>

      {open && (
        <div className="mt-2 space-y-0.5 rounded-md border p-3">
          {report.lessons && (
            <LayerRow
              label="Lessons"
              hint="Durable facts learned about you"
              detail={formatChars(report.lessons.chars)}
            />
          )}

          {report.history && (
            <LayerRow
              label="Conversation history"
              hint="Recent and imported summaries"
              detail={`${report.history.entries ?? 0} · ${formatChars(report.history.chars)}`}
            />
          )}

          {report.relevant && (
            <LayerRow
              label="Relevant matches"
              hint="Closest entries to this question"
              detail={`${report.relevant.entries ?? 0} · ${formatChars(report.relevant.chars)}`}
            />
          )}

          {report.fullConversation && (
            <LayerRow
              label="Recovered transcript"
              hint="Verbatim, from your stored history"
              detail={formatChars(report.fullConversation.chars)}
            />
          )}

          {report.fullConversationMissed && (
            <p className="py-1 text-xs text-muted-foreground">
              You asked to recover a conversation and none matched. The model
              was told to say so rather than reconstruct it.
            </p>
          )}

          <div className="mt-2 border-t pt-2 text-xs tabular-nums text-muted-foreground">
            {formatChars(report.totalChars)} of{" "}
            {formatChars(report.budgetChars)} allowance ({usedShare}%)
          </div>
        </div>
      )}
    </div>
  )
}
