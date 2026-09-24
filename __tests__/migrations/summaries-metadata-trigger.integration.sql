-- Verifies 20260924000000_summaries_metadata_trigger.sql against the same
-- fixtures and expectations as summaries-typed-metadata.integration.sql, down
-- both of its paths: the backfill of rows already stored without metadata, and
-- the trigger on new rows written with content only.
--
-- Run against a disposable PostgreSQL, never a real database:
--   psql "$CHATMEMO_RLS_TEST_DATABASE_URL" -v chatmemo_rls_test=1 \
--     -f __tests__/migrations/summaries-metadata-trigger.integration.sql
--
-- It creates and drops its own schema, so it cannot touch application data.

\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable empty database.'
    \quit 1
\endif

BEGIN;

CREATE SCHEMA chatmemo_metadata_trigger_test;
SET LOCAL search_path = chatmemo_metadata_trigger_test, public;

-- The columns the trigger reads and writes, as they stand after 20260911.
CREATE TABLE summaries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  content      TEXT NOT NULL,
  source       TEXT,
  kind         TEXT,
  title        TEXT,
  occurred_at  TIMESTAMPTZ,
  effective_at TIMESTAMPTZ GENERATED ALWAYS AS (COALESCE(occurred_at, created_at)) STORED,
  fixture_key  TEXT
);

CREATE TABLE fixtures (fixture_key TEXT PRIMARY KEY, content TEXT NOT NULL);

INSERT INTO fixtures (fixture_key, content) VALUES
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
  ('tagged-unknown-source',   E'[source:gemini]\n### [2026-05-05] Something\nbody'),
  -- What the Claude Code SessionEnd hook actually stores: the summariser drops
  -- the brackets from the header it was asked for.
  ('session-hook-unbracketed', E'### 2026-09-23 FinView Audit\n\n- **Project:** FinView');

-- Rows already stored without metadata — what the migration's backfill meets.
INSERT INTO summaries (fixture_key, content)
SELECT 'backfill:' || fixture_key, content FROM fixtures;

\ir ../../supabase/migrations/20260924000000_summaries_metadata_trigger.sql

-- New rows written with content only — what the trigger meets from now on.
INSERT INTO summaries (fixture_key, content)
SELECT 'insert:' || fixture_key, content FROM fixtures;

-- ---------------------------------------------------------------------------
-- Expectations — identical to EXPECTED in the Jest suite, plus the hook row.
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
  ('tagged-unknown-source',     'other',      'conversation', 'Something',           DATE '2026-05-05'),
  ('session-hook-unbracketed',  'other',      'conversation', '2026-09-23 FinView Audit', NULL);

DO $$
DECLARE
  mismatch RECORD;
  failures INT := 0;
BEGIN
  FOR mismatch IN
    SELECT s.fixture_key,
           e.source AS want_source, s.source AS got_source,
           e.kind   AS want_kind,   s.kind   AS got_kind,
           e.title  AS want_title,  s.title  AS got_title,
           e.occurred_on AS want_date,
           (s.occurred_at AT TIME ZONE 'UTC')::date AS got_date
    FROM summaries s
    JOIN expected e ON e.fixture_key = split_part(s.fixture_key, ':', 2)
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
    RAISE EXCEPTION 'Trigger disagrees with the classifier on % row(s)', failures;
  END IF;

  IF (SELECT count(*) FROM summaries) <> 2 * (SELECT count(*) FROM expected) THEN
    RAISE EXCEPTION 'Fixture count drifted between the fixtures and expected tables';
  END IF;

  IF EXISTS (SELECT 1 FROM summaries WHERE kind IS NULL OR source IS NULL) THEN
    RAISE EXCEPTION 'Rows left unclassified';
  END IF;

  -- effective_at follows the derived date, so date-ordered reads see it.
  IF (SELECT effective_at FROM summaries WHERE fixture_key = 'backfill:tagged-claude-conv')
     <> TIMESTAMPTZ '2026-03-01 00:00:00Z' THEN
    RAISE EXCEPTION 'effective_at did not follow the backfilled occurred_at';
  END IF;

  RAISE NOTICE 'summaries metadata trigger: % fixtures OK on backfill and insert',
    (SELECT count(*) FROM expected);
END
$$;

-- A writer that derives its own metadata (insertSummary) keeps it: the
-- trigger only fires when kind is NULL.
DO $$
DECLARE
  got RECORD;
BEGIN
  INSERT INTO summaries (fixture_key, content, source, kind, title)
  VALUES ('explicit', E'### [2026-01-01] Derived by the app', 'perplexity', 'summary', 'App title')
  RETURNING source, kind, title, occurred_at INTO got;

  IF got.source <> 'perplexity' OR got.kind <> 'summary'
     OR got.title <> 'App title' OR got.occurred_at IS NOT NULL THEN
    RAISE EXCEPTION 'Trigger overwrote metadata the writer supplied: %', got;
  END IF;

  RAISE NOTICE 'summaries metadata trigger: writer-supplied metadata kept';
END
$$;

ROLLBACK;
