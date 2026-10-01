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
//
// So does the `summaries_derive_metadata` trigger
// (20260924000000_summaries_metadata_trigger.sql), which fills the columns for
// any row inserted without them — the Claude Code session scripts POST content
// only. Change a rule here and change it there.

// `claude_code` is a Claude Code session — the laptop sync, the cloud hook or
// the old Stop hook. `claude` is Claude.ai: the bulk import and the
// bookmarklet. They were one value until 20261001000000.
export type SummarySource =
  | "claude"
  | "claude_code"
  | "chatgpt"
  | "perplexity"
  | "other"

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
// `### [2026-03-01] Title`, or `### 2026-03-01 Title` without the brackets —
// the form the Claude Code Stop hook's summariser wrote until 2026-09-29, when
// the hook began writing the header itself. The date is group 1 or 2.
const HEADER_RE =
  /^\s*###\s+(?:\[(\d{4}-\d{2}-\d{2})\]|(\d{4}-\d{2}-\d{2})\b)\s*(.*)$/m

const INDEX_MARKER = "Conversation Index"

const KNOWN_SOURCES: readonly string[] = [
  "claude",
  "claude_code",
  "chatgpt",
  "perplexity"
]

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
  const occurredAt = header ? header[1] ?? header[2] : null
  const headerTitle = header ? header[3].trim() : ""

  const title =
    headerTitle ||
    body
      .split("\n")
      .map(line => line.replace(/^#+\s*/, "").trim())
      .find(line => line.length > 0)
      ?.slice(0, 200) ||
    null

  // An untagged row carrying a `### [date]` header came from the Claude bulk
  // importer or the bookmarklet, both of which predate source tagging; one
  // without the brackets, from the Claude Code Stop hook. The import route's
  // summariser could drop them too; every such row checked when this rule
  // was written was a session, and the route now restores the brackets.
  const source = tag
    ? normaliseSource(tag[1])
    : header
      ? header[2]
        ? "claude_code"
        : "claude"
      : "other"

  return {
    source,
    kind: tag?.[2] ? "summary" : "conversation",
    title,
    occurredAt
  }
}

// The cloud hook's keys. Its rows are Claude Code sessions, and say so in a
// tag, so the content alone classifies them — in a backup as in the table.
const CLAUDE_CODE_KEY_PREFIX = "claude-code:"

/**
 * The summary as it is stored.
 *
 * The summariser is asked for `### [YYYY-MM-DD] Title` and sometimes drops
 * the brackets. A bare date header is how the old Claude Code Stop hook's
 * rows are recognised (classifySummaryContent), so a bookmarklet save must
 * not arrive looking like one: the brackets are put back here.
 */
export function storedSummary(
  summaryText: string,
  sessionKey: string | null
): string {
  const text = summaryText.replace(
    /^(\s*###\s+)(\d{4}-\d{2}-\d{2})\b/m,
    "$1[$2]"
  )
  return sessionKey?.startsWith(CLAUDE_CODE_KEY_PREFIX)
    ? `[source:claude_code]\n${text}`
    : text
}

/**
 * The source a restored row is stored with.
 *
 * A backup is one file per source, and the file names its source. Content
 * decides, with one exception: Claude Code sessions synced before they were
 * tagged read as `claude`, and were moved to `claude_code` by row id. Their
 * content still says `claude`, so the file they were exported in is the only
 * record of what they are. Nothing else is taken from the file — it is
 * user-supplied, and a row that says ChatGPT is not a session.
 */
export function restoredSource(
  derived: SummarySource,
  fileSource: unknown
): SummarySource {
  return derived === "claude" && fileSource === "claude_code"
    ? "claude_code"
    : derived
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

/**
 * The column memory reads order by: the conversation's own date, falling back
 * to the row's insertion time.
 *
 * A generated, stored column (20260911000000_summaries_effective_at.sql),
 * because PostgREST cannot order on an expression and the ordering needs an
 * index to stay cheap.
 *
 * Named once because `.order()` is not type-checked against the schema in this
 * version of supabase-js — a typo here would compile, deploy, and fail as a
 * runtime error inside memory retrieval, which degrades silently to no memory.
 */
export const MEMORY_ORDER_COLUMN = "effective_at"
