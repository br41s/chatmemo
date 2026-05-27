/**
 * Parses raw summary rows into flat, dated TimelineEntry objects.
 *
 * Summaries can contain:
 *  - A `[source:X]` prefix line (new tagged imports)
 *  - Multiple `### [YYYY-MM-DD] Title` sections (bulk imports, bookmarklet)
 *  - A single block with no date header (in-app summariser)
 *  - Date-index rows `[X Conversation Index — imported …]` (skipped)
 *  - Watermark rows `[chatmemo:watermark:…]` (skipped)
 *  - A TODO note `### [YYYY-MM-DD] TODO: …`
 */

export type TimelineSource =
  | "claude-ai" // bookmarklet
  | "claude-code" // VS Code Stop hook
  | "chatgpt" // ChatGPT bulk import
  | "perplexity" // Perplexity bulk import
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

// [source:X] prefix written by all tagged importers
const SOURCE_TAG_RE = /^\[source:(\w+)\]\n/

// Row types to skip entirely (no narrative content)
const SKIP_PREFIXES = [
  "[Claude Conversation Index",
  "[ChatGPT Conversation Index",
  "[Perplexity Conversation Index",
  "[chatmemo:watermark:"
]

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

function tagToSource(tag: string): TimelineSource | null {
  switch (tag) {
    case "perplexity":
      return "perplexity"
    case "chatgpt":
      return "chatgpt"
    case "claude":
      return "import"
    default:
      return null
  }
}

function detectSource(title: string, content: string): TimelineSource {
  const t = title.toLowerCase()
  const c = content.toLowerCase()
  if (t.includes("[claude code]") || t.startsWith("[claude code]"))
    return "claude-code"
  if (t.startsWith("todo:") || t.includes("todo:")) return "todo"
  if (c.includes("source: perplexity")) return "perplexity"
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
    const raw = (summary.content ?? "").trim()
    if (!raw) continue

    // Skip rows that should never appear in the timeline
    if (SKIP_PREFIXES.some(p => raw.startsWith(p))) continue

    // Extract [source:X] tag if present, then work on the clean text
    const tagMatch = raw.match(SOURCE_TAG_RE)
    const taggedSource: TimelineSource | null = tagMatch
      ? tagToSource(tagMatch[1])
      : null
    const text = tagMatch ? raw.slice(tagMatch[0].length).trim() : raw

    if (!text) continue

    // Find all ### headers
    const headerMatches = [...text.matchAll(HEADER_RE)]

    if (headerMatches.length === 0) {
      // Unstructured summary (in-app summariser or raw conversation text)
      const firstLine = text.split("\n").find(l => l.trim().length > 0) ?? ""
      const title =
        firstLine.replace(/^#+\s*/, "").slice(0, 120) || "Conversation"
      const source = taggedSource ?? detectSource(title, text)
      entries.push({
        id: summary.id,
        summaryId: summary.id,
        date: summary.created_at.slice(0, 10),
        title,
        content: text,
        source,
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

      const source = taggedSource ?? detectSource(title, content)

      entries.push({
        id: `${summary.id}-${i}`,
        summaryId: summary.id,
        date,
        title,
        content,
        source,
        importedAt: summary.created_at
      })
    }
  }

  // Sort newest conversation date first
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))

  return entries
}
