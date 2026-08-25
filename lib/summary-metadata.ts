// One classifier for what a summaries row *is*.
//
// Source, kind, title and conversation date used to live only as string
// prefixes inside `content`, and five consumers each re-derived them with their
// own predicate. They had already drifted: get-latest-summary excluded
// watermarks with `[chatmemo:%]%` while get-relevant-memory and
// get-full-conversation used `[chatmemo:%`. Both happen to match a watermark,
// but they are not the same predicate, and nothing kept them in step.
//
// The prefixes stay in `content` — the injected memory block quotes them and
// the backup format depends on them. What changes is that the metadata is also
// stored in typed columns, derived once, here.
//
// The migration's backfill mirrors these rules in SQL. `__tests__/lib/
// summary-metadata.test.ts` pins the fixtures both sides must agree on.

export type SummarySource = "claude" | "chatgpt" | "perplexity" | "other"

export type SummaryKind = "conversation" | "summary" | "index" | "watermark"

export interface SummaryMetadata {
  source: SummarySource
  kind: SummaryKind
  title: string | null
  /** The conversation's own date, when the row states one. Distinct from
   *  created_at, which is when the row was imported. */
  occurredAt: string | null
}

const WATERMARK_RE = /^\[chatmemo:watermark:source=(\w+)/
const SOURCE_TAG_RE = /^\[source:(\w+)(:summary)?\]/
const INDEX_RE = /^\[(Claude|ChatGPT|Perplexity) Conversation Index/
const HEADER_RE = /^\s*###\s+\[(\d{4}-\d{2}-\d{2})\]\s*(.*)$/m

const INDEX_MARKER = "Conversation Index"

const KNOWN_SOURCES: readonly string[] = ["claude", "chatgpt", "perplexity"]

function normaliseSource(raw: string | undefined): SummarySource {
  const lower = (raw ?? "").toLowerCase()
  return KNOWN_SOURCES.includes(lower) ? (lower as SummarySource) : "other"
}

/**
 * Classify a summaries row from its content.
 *
 * Pure and total: every string produces a metadata record, so a row can always
 * be tagged rather than left null and re-parsed later.
 */
export function classifySummaryContent(content: string): SummaryMetadata {
  const text = (content ?? "").trim()

  // Watermarks first — they carry their own source and nothing else.
  const watermark = text.match(WATERMARK_RE)
  if (watermark) {
    return {
      source: normaliseSource(watermark[1]),
      kind: "watermark",
      title: null,
      occurredAt: null
    }
  }

  const tag = text.match(SOURCE_TAG_RE)
  const body = tag ? text.slice(tag[0].length).trim() : text

  // Index rows are title-only date lists. They are recognised by the legacy
  // bracket form and by the marker appearing anywhere, which is what the
  // previous ILIKE '%Conversation Index%' filters matched.
  const legacyIndex = text.match(INDEX_RE)
  if (legacyIndex || text.includes(INDEX_MARKER)) {
    return {
      source: legacyIndex
        ? normaliseSource(legacyIndex[1])
        : normaliseSource(tag?.[1]),
      kind: "index",
      title: null,
      occurredAt: null
    }
  }

  const header = body.match(HEADER_RE)
  const occurredAt = header ? header[1] : null
  const headerTitle = header ? header[2].trim() : ""

  const title =
    headerTitle ||
    body
      .split("\n")
      .map(line => line.replace(/^#+\s*/, "").trim())
      .find(line => line.length > 0)
      ?.slice(0, 200) ||
    null

  // An untagged row carrying a `### [date]` header came from the Claude bulk
  // importer or the bookmarklet, both of which predate source tagging.
  const source = tag ? normaliseSource(tag[1]) : header ? "claude" : "other"

  return {
    source,
    kind: tag?.[2] ? "summary" : "conversation",
    title,
    occurredAt
  }
}

/** Row shape the typed columns are written as. */
export interface SummaryMetadataColumns {
  source: SummarySource
  kind: SummaryKind
  title: string | null
  occurred_at: string | null
}

/** Column values for a new row, derived from its content. */
export function summaryMetadataColumns(
  content: string
): SummaryMetadataColumns {
  const { source, kind, title, occurredAt } = classifySummaryContent(content)
  return {
    source,
    kind,
    title,
    // Stored as a timestamptz; a bare date is midnight UTC on that day.
    occurred_at: occurredAt ? `${occurredAt}T00:00:00Z` : null
  }
}
