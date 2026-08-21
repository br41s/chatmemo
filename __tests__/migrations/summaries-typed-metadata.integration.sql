-- Verifies the backfill in 20260819000000_summaries_typed_metadata.sql against
-- the same fixtures __tests__/lib/summary-metadata.test.ts pins the TypeScript
-- classifier to. Two implementations of one rule set only stay honest if both
-- are checked against the same table of cases.
--
-- Run against a disposable PostgreSQL, never a real database:
--   psql "$CHATMEMO_RLS_TEST_DATABASE_URL" -v chatmemo_rls_test=1 \
--     -f __tests__/migrations/summaries-typed-metadata.integration.sql
--
-- It creates and drops its own schema, so it cannot touch application data.

\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable empty database.'
    \quit 1
\endif

BEGIN;

CREATE SCHEMA chatmemo_typed_metadata_test;
SET LOCAL search_path = chatmemo_typed_metadata_test, public;

-- Only the columns the migration reads and writes.
CREATE TABLE summaries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content    TEXT NOT NULL,
  fixture_key TEXT
);

INSERT INTO summaries (fixture_key, content) VALUES
  ('watermark-claude',        '[chatmemo:watermark:source=claude ts=1750000000000]'),
  ('watermark-chatgpt',       '[chatmemo:watermark:source=chatgpt ts=1750000000000]'),
  ('watermark-perplexity',    '[chatmemo:watermark:source=perplexity ts=1]'),
  ('watermark-unknown',       '[chatmemo:watermark:source=weird ts=1]'),
  ('index-claude',            E'[Claude Conversation Index — imported 2026-01-02]\n[2026-01-01] Trip'),
  ('index-chatgpt',           E'[ChatGPT Conversation Index — imported 2026-01-02]\n[2026-01-01] Trip'),
  ('index-perplexity',        '[Perplexity Conversation Index — imported 2026-01-02]'),
  ('index-marker-midtext',    E'[source:claude]\nConversation Index for my stuff\n[2026-01-01] Trip'),
  ('tagged-claude-conv',      E'[source:claude]\n### [2026-03-01] Qatar flight change\n- decided to rebook'),
  ('tagged-chatgpt-conv',     E'[source:chatgpt]\n### [2025-11-05] Tax questions\nUser: hi'),
  ('tagged-perplexity-conv',  E'[source:perplexity]\n### [2025-07-04] Phuket hotels\nUser: hi'),
  ('tagged-chatgpt-summary',  E'[source:chatgpt:summary]\n### [2025-11-05] Tax questions\n- summary bullet'),
  ('tagged-perplexity-summary', E'[source:perplexity:summary]\nSome compact summary text'),
  ('untagged-with-header',    E'### [2024-12-24] Christmas planning\n- bought gifts'),
  ('untagged-plain',          'User prefers concise answers and ships on Fridays.'),
  ('untagged-heading-line',   E'# My notes\nsome body text'),
  ('header-no-title',         E'### [2026-02-02]\nbody only'),
  ('blank',                   '   '),
  ('long-first-line',         repeat('A', 250) || ' end'),
  ('tagged-unknown-source',   E'[source:gemini]\n### [2026-05-05] Something\nbody');

-- ---------------------------------------------------------------------------
-- Apply the migration body. Kept in step with the migration file by hand; the
-- statements below must match it exactly.
-- ---------------------------------------------------------------------------

ALTER TABLE summaries
  ADD COLUMN IF NOT EXISTS source      TEXT,
  ADD COLUMN IF NOT EXISTS kind        TEXT,
  ADD COLUMN IF NOT EXISTS title       TEXT,
  ADD COLUMN IF NOT EXISTS occurred_at TIMESTAMPTZ;

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
    WHEN content ~ '(^|\n)\s*###\s+\[\d{4}-\d{2}-\d{2}\]'     THEN 'claude'
    ELSE 'other'
  END,
  occurred_at = NULL
WHERE kind IS NULL;

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

-- ---------------------------------------------------------------------------
-- Expectations — identical to EXPECTED in the Jest suite.
-- ---------------------------------------------------------------------------

CREATE TABLE expected (
  fixture_key TEXT PRIMARY KEY,
  source      TEXT,
  kind        TEXT,
  title       TEXT,
  occurred_on DATE
);

INSERT INTO expected VALUES
  ('watermark-claude',          'claude',     'watermark',    NULL, NULL),
  ('watermark-chatgpt',         'chatgpt',    'watermark',    NULL, NULL),
  ('watermark-perplexity',      'perplexity', 'watermark',    NULL, NULL),
  ('watermark-unknown',         'other',      'watermark',    NULL, NULL),
  ('index-claude',              'claude',     'index',        NULL, NULL),
  ('index-chatgpt',             'chatgpt',    'index',        NULL, NULL),
  ('index-perplexity',          'perplexity', 'index',        NULL, NULL),
  ('index-marker-midtext',      'claude',     'index',        NULL, NULL),
  ('tagged-claude-conv',        'claude',     'conversation', 'Qatar flight change', DATE '2026-03-01'),
  ('tagged-chatgpt-conv',       'chatgpt',    'conversation', 'Tax questions',       DATE '2025-11-05'),
  ('tagged-perplexity-conv',    'perplexity', 'conversation', 'Phuket hotels',       DATE '2025-07-04'),
  ('tagged-chatgpt-summary',    'chatgpt',    'summary',      'Tax questions',       DATE '2025-11-05'),
  ('tagged-perplexity-summary', 'perplexity', 'summary',      'Some compact summary text', NULL),
  ('untagged-with-header',      'claude',     'conversation', 'Christmas planning',  DATE '2024-12-24'),
  ('untagged-plain',            'other',      'conversation', 'User prefers concise answers and ships on Fridays.', NULL),
  ('untagged-heading-line',     'other',      'conversation', 'My notes',            NULL),
  ('header-no-title',           'claude',     'conversation', 'body only',           DATE '2026-02-02'),
  ('blank',                     'other',      'conversation', NULL,                  NULL),
  ('long-first-line',           'other',      'conversation', repeat('A', 200),      NULL),
  ('tagged-unknown-source',     'other',      'conversation', 'Something',           DATE '2026-05-05');

DO $$
DECLARE
  mismatch RECORD;
  failures INT := 0;
BEGIN
  FOR mismatch IN
    SELECT e.fixture_key,
           e.source AS want_source, s.source AS got_source,
           e.kind   AS want_kind,   s.kind   AS got_kind,
           e.title  AS want_title,  s.title  AS got_title,
           e.occurred_on AS want_date,
           (s.occurred_at AT TIME ZONE 'UTC')::date AS got_date
    FROM expected e
    JOIN summaries s USING (fixture_key)
    WHERE s.source IS DISTINCT FROM e.source
       OR s.kind   IS DISTINCT FROM e.kind
       OR s.title  IS DISTINCT FROM e.title
       OR (s.occurred_at AT TIME ZONE 'UTC')::date IS DISTINCT FROM e.occurred_on
  LOOP
    failures := failures + 1;
    RAISE WARNING
      'FIXTURE % — source want=% got=% | kind want=% got=% | title want=% got=% | date want=% got=%',
      mismatch.fixture_key,
      mismatch.want_source, mismatch.got_source,
      mismatch.want_kind,   mismatch.got_kind,
      mismatch.want_title,  mismatch.got_title,
      mismatch.want_date,   mismatch.got_date;
  END LOOP;

  IF failures > 0 THEN
    RAISE EXCEPTION 'Backfill disagrees with the classifier on % fixture(s)', failures;
  END IF;

  IF (SELECT count(*) FROM summaries) <> (SELECT count(*) FROM expected) THEN
    RAISE EXCEPTION 'Fixture count drifted between the SQL and Jest tables';
  END IF;

  IF EXISTS (SELECT 1 FROM summaries WHERE kind IS NULL OR source IS NULL) THEN
    RAISE EXCEPTION 'Backfill left rows unclassified';
  END IF;

  RAISE NOTICE 'summaries typed metadata backfill: % fixtures OK',
    (SELECT count(*) FROM expected);
END
$$;

-- The CHECK constraints must accept the backfilled values and reject others.
ALTER TABLE summaries
  ADD CONSTRAINT summaries_source_known
  CHECK (source IS NULL OR source IN ('claude', 'chatgpt', 'perplexity', 'other'));

ALTER TABLE summaries
  ADD CONSTRAINT summaries_kind_known
  CHECK (kind IS NULL OR kind IN ('conversation', 'summary', 'index', 'watermark'));

DO $$
BEGIN
  BEGIN
    INSERT INTO summaries (content, source, kind) VALUES ('x', 'gemini', 'conversation');
    RAISE EXCEPTION 'CHECK did not reject an unknown source';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO summaries (content, source, kind) VALUES ('x', 'claude', 'nonsense');
    RAISE EXCEPTION 'CHECK did not reject an unknown kind';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'summaries typed metadata constraints: OK';
END
$$;

ROLLBACK;
