-- Typed metadata for summaries rows.
--
-- Source, kind, title and conversation date were encoded only as string
-- prefixes inside `content`, and five consumers each re-derived them with
-- their own predicate — predicates that had already drifted apart. The
-- prefixes stay in `content` (the injected memory block quotes them, and the
-- backup format depends on them); these columns hold the same facts in a form
-- the planner can index and the application derives in exactly one place
-- (lib/summary-metadata.ts).
--
-- Nullable, with the backfill in this migration, so the table is consistent
-- the moment it completes.
--
-- DEPLOY ORDER: apply this migration BEFORE publishing the code that reads the
-- new columns. The reverse leaves the memory queries selecting a column that
-- does not exist; the chat routes catch memory failures and degrade to
-- no-memory, so chat keeps working, but memory silently disappears until the
-- migration lands.

SET lock_timeout = '5s';

-- COLUMNS --

ALTER TABLE summaries
  ADD COLUMN IF NOT EXISTS source      TEXT,
  ADD COLUMN IF NOT EXISTS kind        TEXT,
  ADD COLUMN IF NOT EXISTS title       TEXT,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

-- BACKFILL --
--
-- Mirrors classifySummaryContent() in lib/summary-metadata.ts. The order of
-- the CASE arms is the order of the checks there: watermark, then index, then
-- the [source:X] tag, then an untagged `### [date]` header meaning Claude.

UPDATE summaries
SET
  kind = CASE
    WHEN content ~ '^\[chatmemo:watermark:source=\w+'                 THEN 'watermark'
    WHEN content ~ '^\[(Claude|ChatGPT|Perplexity) Conversation Index' THEN 'index'
    WHEN position('Conversation Index' in content) > 0                 THEN 'index'
    WHEN content ~ '^\[source:\w+:summary\]'                           THEN 'summary'
    ELSE 'conversation'
  END,

  source = CASE
    WHEN content ~ '^\[chatmemo:watermark:source=claude'      THEN 'claude'
    WHEN content ~ '^\[chatmemo:watermark:source=chatgpt'     THEN 'chatgpt'
    WHEN content ~ '^\[chatmemo:watermark:source=perplexity'  THEN 'perplexity'
    WHEN content ~ '^\[chatmemo:watermark:'                   THEN 'other'
    WHEN content ~ '^\[Claude Conversation Index'             THEN 'claude'
    WHEN content ~ '^\[ChatGPT Conversation Index'            THEN 'chatgpt'
    WHEN content ~ '^\[Perplexity Conversation Index'         THEN 'perplexity'
    WHEN content ~ '^\[source:claude(:summary)?\]'            THEN 'claude'
    WHEN content ~ '^\[source:chatgpt(:summary)?\]'           THEN 'chatgpt'
    WHEN content ~ '^\[source:perplexity(:summary)?\]'        THEN 'perplexity'
    WHEN content ~ '^\[source:\w+(:summary)?\]'               THEN 'other'
    -- Untagged rows with a date header came from the Claude bulk importer or
    -- the bookmarklet, both of which predate source tagging.
    WHEN content ~ '(^|\n)\s*###\s+\[\d{4}-\d{2}-\d{2}\]'     THEN 'claude'
    ELSE 'other'
  END,

  occurred_at = NULL
WHERE kind IS NULL;

-- occurred_at: the date from the row's first `### [YYYY-MM-DD]` header, read
-- as midnight UTC. Watermark and index rows never carry one. Done as its own
-- pass because the value comes from a capture group.
UPDATE summaries
SET occurred_at = (derived.m[1] || 'T00:00:00Z')::timestamptz
FROM (
  SELECT id AS sid,
         regexp_match(content, '(?n)^\s*###\s+\[(\d{4}-\d{2}-\d{2})\]') AS m
  FROM summaries
) AS derived
WHERE summaries.id = derived.sid
  AND derived.m IS NOT NULL
  AND summaries.kind NOT IN ('watermark', 'index');

-- title: the header title when there is one, else the first non-empty line,
-- capped at 200 chars. NULL for watermark and index rows.
UPDATE summaries
SET title = NULLIF(
  left(
    trim(
      COALESCE(
        (regexp_match(
           regexp_replace(content, '^\[source:\w+(:summary)?\]\s*', ''),
           '(?n)^\s*###\s+\[\d{4}-\d{2}-\d{2}\]\s*(.*)$'
         ))[1],
        (regexp_match(
           regexp_replace(content, '^\[source:\w+(:summary)?\]\s*', ''),
           '(?n)^\s*#*\s*(\S.*)$'
         ))[1],
        ''
      )
    ),
    200
  ),
  ''
)
WHERE kind NOT IN ('watermark', 'index');

-- CONSTRAINTS --
--
-- NOT VALID so the check applies to new and updated rows without a full table
-- rewrite. The backfill above already satisfies it for existing rows.

ALTER TABLE summaries
  DROP CONSTRAINT IF EXISTS summaries_source_known;
ALTER TABLE summaries
  ADD CONSTRAINT summaries_source_known
  CHECK (source IS NULL OR source IN ('claude', 'chatgpt', 'perplexity', 'other'))
  NOT VALID;

ALTER TABLE summaries
  DROP CONSTRAINT IF EXISTS summaries_kind_known;
ALTER TABLE summaries
  ADD CONSTRAINT summaries_kind_known
  CHECK (kind IS NULL OR kind IN ('conversation', 'summary', 'index', 'watermark'))
  NOT VALID;

-- INDEXES --
--
-- The memory reads filter by user plus kind or source, newest first. These
-- replace the unindexable NOT LIKE / ILIKE '%…%' scans those filters used.

CREATE INDEX IF NOT EXISTS idx_summaries_user_kind_created
  ON summaries (user_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_summaries_user_source_created
  ON summaries (user_id, source, created_at DESC);

-- Redundant index cleanup (audit REF-06): the composite below covers
-- (user_id) as a leftmost prefix, and idx_summaries_user_created from
-- 20260520000000_perf_indexes.sql is an exact duplicate of
-- idx_summaries_user_id_created_at from the original table migration.
DROP INDEX IF EXISTS idx_summaries_user_id;
DROP INDEX IF EXISTS idx_summaries_user_created;
