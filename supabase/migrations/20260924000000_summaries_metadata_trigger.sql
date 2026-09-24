-- Derive summaries metadata in the database, for every writer.
--
-- 20260819000000_summaries_typed_metadata.sql backfilled source, kind, title
-- and occurred_at once, and left new rows to the application: insertSummary()
-- derives them in lib/summary-metadata.ts. Not every writer goes through it.
-- The Claude Code SessionEnd hook and the session importers (scripts/*.mjs)
-- POST { user_id, content } straight to PostgREST, and insertSummary's own
-- schema-lag fallback drops the columns on purpose. Every memory read filters
-- on `kind IN ('conversation', 'summary')`, so those rows were stored but never
-- read — every Claude Code session since 2026-08-25 was invisible to memory.
--
-- A trigger closes that for any writer, present or future. It fires only when
-- kind is NULL, so rows written by insertSummary keep the values it derived.

SET lock_timeout = '5s';

-- Mirrors classifySummaryContent() in lib/summary-metadata.ts, arm for arm, as
-- the 20260819 backfill does: watermark, then index, then the [source:X] tag,
-- then an untagged `### [date]` header meaning Claude.
CREATE OR REPLACE FUNCTION summaries_derive_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  body TEXT := regexp_replace(NEW.content, '^\[source:\w+(:summary)?\]\s*', '');
BEGIN
  NEW.kind := CASE
    WHEN NEW.content ~ '^\[chatmemo:watermark:source=\w+'                 THEN 'watermark'
    WHEN NEW.content ~ '^\[(Claude|ChatGPT|Perplexity) Conversation Index' THEN 'index'
    WHEN position('Conversation Index' in NEW.content) > 0                 THEN 'index'
    WHEN NEW.content ~ '^\[source:\w+:summary\]'                           THEN 'summary'
    ELSE 'conversation'
  END;

  NEW.source := COALESCE(NEW.source, CASE
    WHEN NEW.content ~ '^\[chatmemo:watermark:source=claude'     THEN 'claude'
    WHEN NEW.content ~ '^\[chatmemo:watermark:source=chatgpt'    THEN 'chatgpt'
    WHEN NEW.content ~ '^\[chatmemo:watermark:source=perplexity' THEN 'perplexity'
    WHEN NEW.content ~ '^\[chatmemo:watermark:'                  THEN 'other'
    WHEN NEW.content ~ '^\[Claude Conversation Index'            THEN 'claude'
    WHEN NEW.content ~ '^\[ChatGPT Conversation Index'           THEN 'chatgpt'
    WHEN NEW.content ~ '^\[Perplexity Conversation Index'        THEN 'perplexity'
    WHEN NEW.content ~ '^\[source:claude(:summary)?\]'           THEN 'claude'
    WHEN NEW.content ~ '^\[source:chatgpt(:summary)?\]'          THEN 'chatgpt'
    WHEN NEW.content ~ '^\[source:perplexity(:summary)?\]'       THEN 'perplexity'
    WHEN NEW.content ~ '^\[source:\w+(:summary)?\]'              THEN 'other'
    WHEN NEW.content ~ '(^|\n)\s*###\s+\[\d{4}-\d{2}-\d{2}\]'    THEN 'claude'
    ELSE 'other'
  END);

  IF NEW.kind IN ('watermark', 'index') THEN
    RETURN NEW;
  END IF;

  NEW.occurred_at := COALESCE(
    NEW.occurred_at,
    ((regexp_match(NEW.content, '(?n)^\s*###\s+\[(\d{4}-\d{2}-\d{2})\]'))[1]
      || 'T00:00:00Z')::timestamptz
  );

  NEW.title := COALESCE(NEW.title, NULLIF(
    left(
      trim(
        COALESCE(
          (regexp_match(body, '(?n)^\s*###\s+\[\d{4}-\d{2}-\d{2}\]\s*(.*)$'))[1],
          (regexp_match(body, '(?n)^\s*#*\s*(\S.*)$'))[1],
          ''
        )
      ),
      200
    ),
    ''
  ));

  RETURN NEW;
END;
$$;

-- INSERT for new rows; UPDATE so the backfill below can run the same
-- derivation instead of restating it.
DROP TRIGGER IF EXISTS summaries_derive_metadata ON summaries;
CREATE TRIGGER summaries_derive_metadata
  BEFORE INSERT OR UPDATE ON summaries
  FOR EACH ROW
  WHEN (NEW.kind IS NULL)
  EXECUTE FUNCTION summaries_derive_metadata();

-- BACKFILL --
--
-- The rows the writers above left without metadata. Touching them sends each
-- through the trigger; effective_at, a generated column, follows occurred_at.
UPDATE summaries SET content = content WHERE kind IS NULL;
