-- Claude Code sessions get a source of their own: 'claude_code'.
--
-- Until now a Claude Code session and a Claude.ai conversation were both
-- 'claude'. The chat, the timeline chart and the memory counts could only say
-- "Claude" for either, and clearing the Claude import deleted the coding
-- sessions along with it.
--
-- A row is a Claude Code session when it says so — `[source:claude_code]`,
-- which the session scripts and the import route now write — or when only
-- that writer could have produced it:
--   * an external_id of `claude-code:<session id>`, the cloud hook's key;
--   * no tag and a date header without brackets (`### 2026-09-23 Title`),
--     the form the Stop hook's summariser wrote until 2026-09-29.
-- Sessions the laptop sync stored as `[source:claude]` cannot be told from a
-- Claude.ai import by their content; `scripts/backfill-claude-code-source.mjs`
-- moves those by the row ids the sync recorded.
--
-- lib/summary-metadata.ts changes in step; `__tests__/lib/summary-metadata.test.ts`
-- and `__tests__/migrations/summaries-claude-code-source.integration.sql` pin both.

SET lock_timeout = '5s';

ALTER TABLE summaries
  DROP CONSTRAINT IF EXISTS summaries_source_known;
ALTER TABLE summaries
  ADD CONSTRAINT summaries_source_known
  CHECK (source IS NULL OR source IN ('claude', 'claude_code', 'chatgpt', 'perplexity', 'other'))
  NOT VALID;

-- As 20260929000000_summaries_bracketless_dates.sql, with the three
-- 'claude_code' cases. The tag is tested before `[source:\w+]`, which would
-- make it 'other'; `[source:claude]` ends at its bracket, so it never matched.
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
    WHEN NEW.content ~ '^\[chatmemo:watermark:source=claude_code' THEN 'claude_code'
    WHEN NEW.content ~ '^\[chatmemo:watermark:source=claude'      THEN 'claude'
    WHEN NEW.content ~ '^\[chatmemo:watermark:source=chatgpt'     THEN 'chatgpt'
    WHEN NEW.content ~ '^\[chatmemo:watermark:source=perplexity'  THEN 'perplexity'
    WHEN NEW.content ~ '^\[chatmemo:watermark:'                   THEN 'other'
    WHEN NEW.content ~ '^\[Claude Conversation Index'             THEN 'claude'
    WHEN NEW.content ~ '^\[ChatGPT Conversation Index'            THEN 'chatgpt'
    WHEN NEW.content ~ '^\[Perplexity Conversation Index'         THEN 'perplexity'
    WHEN NEW.content ~ '^\[source:claude_code(:summary)?\]'       THEN 'claude_code'
    WHEN NEW.content ~ '^\[source:claude(:summary)?\]'            THEN 'claude'
    WHEN NEW.content ~ '^\[source:chatgpt(:summary)?\]'           THEN 'chatgpt'
    WHEN NEW.content ~ '^\[source:perplexity(:summary)?\]'        THEN 'perplexity'
    WHEN NEW.content ~ '^\[source:\w+(:summary)?\]'               THEN 'other'
    WHEN NEW.external_id LIKE 'claude-code:%'                     THEN 'claude_code'
    WHEN header[2] IS NOT NULL                                    THEN 'claude_code'
    WHEN header IS NOT NULL                                       THEN 'claude'
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
-- The rows already stored that the rules above would now call a Claude Code
-- session. Source is set directly: the trigger only runs when kind is NULL,
-- and nothing else about these rows changes. Index rows and watermarks are
-- left alone — no Claude Code writer produces them.
UPDATE summaries
SET source = 'claude_code'
WHERE kind IN ('conversation', 'summary')
  AND source IN ('claude', 'other')
  AND (
    content ~ '^\[source:claude_code(:summary)?\]'
    OR (
      content !~ '^\[source:\w+(:summary)?\]'
      AND (
        external_id LIKE 'claude-code:%'
        OR (regexp_match(
              content,
              '(?n)^\s*###\s+(?:\[(\d{4}-\d{2}-\d{2})\]|(\d{4}-\d{2}-\d{2})\M)'
            ))[2] IS NOT NULL
      )
    )
  );
