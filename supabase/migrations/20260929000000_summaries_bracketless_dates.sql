-- Read the date from `### 2026-09-27 Title` headers as well as `### [2026-09-27]`.
--
-- Until 2026-09-29 the Claude Code Stop hook asked its summariser to open with
-- `### [YYYY-MM-DD] Session Title`, and the summariser mostly dropped the
-- brackets. Every classifier looked for the bracketed form only, so those rows
-- — the bulk of the Claude Code sessions — were stored with no occurred_at, a
-- source of 'other' instead of 'claude', and a title that began with the date.
-- The memory panel's date range skipped them too, and reported history ending
-- on the last bracketed row while a week of sessions sat in the same section.
--
-- The hook now writes the header itself. This teaches the trigger the other
-- form and re-derives the rows already stored with it. lib/summary-metadata.ts
-- changes in step; `__tests__/lib/summary-metadata.test.ts` and
-- `__tests__/migrations/summaries-metadata-trigger.integration.sql` pin both.

SET lock_timeout = '5s';

-- As 20260924000000_summaries_metadata_trigger.sql, with the header accepted
-- as `[date]` or a bare date. `\M` ends the bare date at a word boundary, so
-- `2026-09-27T10:00` is not read as a header date.
CREATE OR REPLACE FUNCTION summaries_derive_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  body TEXT := regexp_replace(NEW.content, '^\[source:\w+(:summary)?\]\s*', '');
  header TEXT[] := regexp_match(
    NEW.content,
    '(?n)^\s*###\s+(?:\[(\d{4}-\d{2}-\d{2})\]|(\d{4}-\d{2}-\d{2})\M)'
  );
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
    WHEN header IS NOT NULL                                      THEN 'claude'
    ELSE 'other'
  END);

  IF NEW.kind IN ('watermark', 'index') THEN
    RETURN NEW;
  END IF;

  NEW.occurred_at := COALESCE(
    NEW.occurred_at,
    (COALESCE(header[1], header[2]) || 'T00:00:00Z')::timestamptz
  );

  NEW.title := COALESCE(NEW.title, NULLIF(
    left(
      trim(
        COALESCE(
          (regexp_match(
            body,
            '(?n)^\s*###\s+(?:\[\d{4}-\d{2}-\d{2}\]|\d{4}-\d{2}-\d{2}\M)\s*(.*)$'
          ))[1],
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

-- BACKFILL --
--
-- Rows with a bracketless header and no date. Clearing kind sends each back
-- through the trigger (it fires on UPDATE when kind is NULL); clearing source
-- and title lets it derive them again, since it only fills what is empty.
UPDATE summaries
SET kind = NULL, source = NULL, title = NULL
WHERE occurred_at IS NULL
  AND kind IN ('conversation', 'summary')
  AND content ~ '(?n)^\s*###\s+\d{4}-\d{2}-\d{2}\M';
