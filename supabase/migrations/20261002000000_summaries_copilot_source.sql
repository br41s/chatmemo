-- GitHub Copilot sessions get a source of their own: 'copilot'.
--
-- The laptop sync stores Copilot sessions next to Claude Code ones, as
-- `### [date] project [Copilot]` with no tag, so the trigger called them
-- 'claude': they counted as Claude.ai conversations and "Clear Claude"
-- deleted them.
--
-- A row is a Copilot session when it says so — `[source:copilot]`, which the
-- sync now writes — or when it has no tag and its first header's title ends
-- in `[Copilot]`, which only that sync writes. Unlike the Claude Code rows,
-- these are all recognisable from their content, so the backfill is complete
-- and no script is needed.
--
-- lib/summary-metadata.ts changes in step; `__tests__/lib/summary-metadata.test.ts`
-- and `__tests__/migrations/summaries-copilot-source.integration.sql` pin both.

SET lock_timeout = '5s';

ALTER TABLE summaries
  DROP CONSTRAINT IF EXISTS summaries_source_known;
ALTER TABLE summaries
  ADD CONSTRAINT summaries_source_known
  CHECK (source IS NULL OR source IN ('claude', 'claude_code', 'copilot', 'chatgpt', 'perplexity', 'other'))
  NOT VALID;

-- As 20261001000000_summaries_claude_code_source.sql, with the two 'copilot'
-- cases. The title rule comes before the session-key and bare-date rules: a
-- row marked as Copilot's is Copilot's whatever else it looks like.
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
  -- The first header's title, for the Copilot sync's marker.
  header_title TEXT := (regexp_match(
    NEW.content,
    '(?n)^\s*###\s+(?:\[\d{4}-\d{2}-\d{2}\]|\d{4}-\d{2}-\d{2}\M)\s*(.*)$'
  ))[1];
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
    WHEN NEW.content ~ '^\[source:copilot(:summary)?\]'           THEN 'copilot'
    WHEN NEW.content ~ '^\[source:chatgpt(:summary)?\]'           THEN 'chatgpt'
    WHEN NEW.content ~ '^\[source:perplexity(:summary)?\]'        THEN 'perplexity'
    WHEN NEW.content ~ '^\[source:\w+(:summary)?\]'               THEN 'other'
    WHEN header_title ~ '\[Copilot\]\s*$'                         THEN 'copilot'
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
-- Source is set directly: the trigger only runs when kind is NULL, and
-- nothing else about these rows changes.
UPDATE summaries
SET source = 'copilot'
WHERE kind IN ('conversation', 'summary')
  AND source IN ('claude', 'claude_code', 'other')
  AND (
    content ~ '^\[source:copilot(:summary)?\]'
    OR (
      content !~ '^\[source:\w+(:summary)?\]'
      AND (regexp_match(
            content,
            '(?n)^\s*###\s+(?:\[\d{4}-\d{2}-\d{2}\]|\d{4}-\d{2}-\d{2}\M)\s*(.*)$'
          ))[1] ~ '\[Copilot\]\s*$'
    )
  );
