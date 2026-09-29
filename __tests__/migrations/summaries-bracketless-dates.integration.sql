-- Verifies 20260929000000_summaries_bracketless_dates.sql down both of its
-- paths: the backfill of rows the previous trigger classified without a date,
-- and the trigger on new rows. Mirrors the bracketless cases in
-- `__tests__/lib/summary-metadata.test.ts`.
--
-- Run against a disposable PostgreSQL, never a real database:
--   psql "$CHATMEMO_RLS_TEST_DATABASE_URL" -v chatmemo_rls_test=1 \
--     -f __tests__/migrations/summaries-bracketless-dates.integration.sql
--
-- It creates and drops its own schema, so it cannot touch application data.

\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable empty database.'
    \quit 1
\endif

BEGIN;

CREATE SCHEMA chatmemo_bracketless_dates_test;
SET LOCAL search_path = chatmemo_bracketless_dates_test, public;

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
  ('hook-bracketless',      E'### 2026-09-23 FinView Audit\n\n- **Project:** FinView'),
  ('tagged-bracketless',    E'[source:chatgpt]\n### 2025-11-05 Tax questions'),
  ('timestamp-not-header',  E'### 2026-09-27T10:00 notes'),
  ('bracketed-unchanged',   E'[source:claude]\n### [2026-03-01] Qatar flight change\n- rebook'),
  ('plain-unchanged',       'User prefers concise answers.');

-- The trigger as it stood, and rows it classified — what the backfill meets.
\ir ../../supabase/migrations/20260924000000_summaries_metadata_trigger.sql

INSERT INTO summaries (fixture_key, content)
SELECT 'backfill:' || fixture_key, content FROM fixtures;

DO $$
BEGIN
  IF (SELECT occurred_at FROM summaries WHERE fixture_key = 'backfill:hook-bracketless') IS NOT NULL THEN
    RAISE EXCEPTION 'Precondition: the previous trigger should not date a bracketless header';
  END IF;
END
$$;

\ir ../../supabase/migrations/20260929000000_summaries_bracketless_dates.sql

INSERT INTO summaries (fixture_key, content)
SELECT 'insert:' || fixture_key, content FROM fixtures;

CREATE TABLE expected (
  fixture_key TEXT PRIMARY KEY,
  source      TEXT,
  kind        TEXT,
  title       TEXT,
  occurred_on DATE
);

INSERT INTO expected VALUES
  ('hook-bracketless',     'claude',  'conversation', 'FinView Audit',        DATE '2026-09-23'),
  ('tagged-bracketless',   'chatgpt', 'conversation', 'Tax questions',        DATE '2025-11-05'),
  ('timestamp-not-header', 'other',   'conversation', '2026-09-27T10:00 notes', NULL),
  ('bracketed-unchanged',  'claude',  'conversation', 'Qatar flight change',  DATE '2026-03-01'),
  ('plain-unchanged',      'other',   'conversation', 'User prefers concise answers.', NULL);

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

  IF (SELECT effective_at FROM summaries WHERE fixture_key = 'backfill:hook-bracketless')
     <> TIMESTAMPTZ '2026-09-23 00:00:00Z' THEN
    RAISE EXCEPTION 'effective_at did not follow the backfilled occurred_at';
  END IF;

  RAISE NOTICE 'summaries bracketless dates: % fixtures OK on backfill and insert',
    (SELECT count(*) FROM expected);
END
$$;

ROLLBACK;
