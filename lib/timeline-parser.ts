/**
 * Parses raw summary rows into flat, dated TimelineEntry objects.
 *
 * Summaries can contain:
 *  - Multiple `### [YYYY-MM-DD] Title` sections (bulk imports, bookmarklet)
 *  - A single block with no date header (in-app summariser)
 *  - A date-index row `[Claude Conversation Index — imported …]` (skipped)
 *  - A TODO note `### [YYYY-MM-DD] TODO: …`
 */

export type TimelineSource =
  | "claude-ai" // bookmarklet
  | "claude-code" // VS Code Stop hook
  | "chatgpt" // ChatGPT bulk import
  | "import" // Claude bulk import
  | "todo" // manual note
  | "chat" // in-app live summariser
  | "unknown"

export interface TimelineEntry {
  /** Unique key: `${summaryId}-${sectionIndex}` or just summaryId */
  id: string
  summaryId: string
  /** Conversation date from `### [YYYY-MM-DD]` header, or import date */
  date: string
  title: string
  /** Bullet content under the header (may be empty for raw-text entries) */
  content: string
  source: TimelineSource
  /** When this summary row was inserted (ISO string) */
  importedAt: string
}

// ---------------------------------------------------------------------------
// Header regex: ### [2026-03-01] Some title
// ---------------------------------------------------------------------------
const HEADER_RE = /^###\s+\[(\d{4}-\d{2}-\d{2})\]\s+(.+)$/gm

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

function detectSource(title: string, content: string): TimelineSource {
  const t = title.toLowerCase()
  const c = content.toLowerCase()
  if (t.includes("[claude code]") || t.startsWith("[claude code]"))
    return "claude-code"
  if (t.startsWith("todo:") || t.includes("todo:")) return "todo"
  if (c.includes("chatgpt") || c.includes("openai")) return "chatgpt"
  if (
    c.includes("claude conversation index") ||
    content.startsWith("[Claude Conversation Index")
  )
    return "import"
  return "claude-ai"
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export interface SummaryRow {
  id: string
  content: string
  created_at: string
}

export function parseSummariesToEntries(
  summaries: SummaryRow[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = []

  for (const summary of summaries) {
    const text = (summary.content ?? "").trim()
    if (!text) continue

    // Skip pure date-index rows (no narrative content)
    if (text.startsWith("[Claude Conversation Index")) continue

    // Find all ### headers
    const headerMatches = [...text.matchAll(HEADER_RE)]

    if (headerMatches.length === 0) {
      // Unstructured summary (in-app summariser or raw conversation text)
      // Use the first non-empty line as a title hint
      const firstLine = text.split("\n").find(l => l.trim().length > 0) ?? ""
      const title =
        firstLine.replace(/^#+\s*/, "").slice(0, 120) || "Conversation"
      entries.push({
        id: summary.id,
        summaryId: summary.id,
        date: summary.created_at.slice(0, 10),
        title,
        content: text,
        source: detectSource(title, text),
        importedAt: summary.created_at
      })
      continue
    }

    // Split into sections by header
    for (let i = 0; i < headerMatches.length; i++) {
      const match = headerMatches[i]
      const date = match[1]
      const title = match[2].trim()
      const bodyStart = match.index! + match[0].length
      const bodyEnd =
        i + 1 < headerMatches.length ? headerMatches[i + 1].index! : text.length
      const content = text.slice(bodyStart, bodyEnd).trim()

      entries.push({
        id: `${summary.id}-${i}`,
        summaryId: summary.id,
        date,
        title,
        content,
        source: detectSource(title, content),
        importedAt: summary.created_at
      })
    }
  }

  // Sort newest conversation date first
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  return entries
}
