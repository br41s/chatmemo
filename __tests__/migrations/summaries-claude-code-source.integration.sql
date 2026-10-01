-- Verifies 20261001000000_summaries_claude_code_source.sql down both of its
-- paths: the backfill of rows the previous trigger called 'claude' or 'other',
-- and the trigger on new rows. Mirrors the Claude Code cases in
-- `__tests__/lib/summary-metadata.test.ts`.
--
-- Run against a disposable PostgreSQL, never a real database:
--   psql "$CHATMEMO_RLS_TEST_DATABASE_URL" -v chatmemo_rls_test=1 \
--     -f __tests__/migrations/summaries-claude-code-source.integration.sql
--
-- It creates and drops its own schema, so it cannot touch application data.

\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable empty database.'
    \quit 1
\endif

BEGIN;

CREATE SCHEMA chatmemo_claude_code_source_test;
SET LOCAL search_path = chatmemo_claude_code_source_test, public;

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
  external_id  TEXT,
  fixture_key  TEXT,
  CONSTRAINT summaries_source_known
    CHECK (source IS NULL OR source IN ('claude', 'chatgpt', 'perplexity', 'other'))
);

CREATE TABLE fixtures (
  fixture_key TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  external_id TEXT
);

INSERT INTO fixtures (fixture_key, content, external_id) VALUES
  ('tagged-session',          E'[source:claude_code]\n### [2026-10-01] chatmemo\n\n- shipped', NULL),
  ('tagged-session-summary',  E'[source:claude_code:summary]\n### [2026-10-01] chatmemo', NULL),
  ('hook-bracketless',        E'### 2026-09-23 FinView Audit\n\n- **Project:** FinView', NULL),
  ('cloud-session',           E'### [2026-09-30] FlyWell UI Redesign\n- done', 'claude-code:abc'),
  ('other-writer-key',        E'### [2026-09-30] Something else\n- done', 'notes:abc'),
  ('tagged-claude',           E'[source:claude]\n### [2026-03-01] Qatar flight change\n- rebook', NULL),
  ('tagged-claude-bare-date', E'[source:claude]\n### 2026-03-01 Qatar flight change', NULL),
  ('tagged-chatgpt-bare-date', E'[source:chatgpt]\n### 2025-11-05 Tax questions', NULL),
  ('tag-beats-key',           E'[source:chatgpt]\n### [2025-11-05] Tax questions', 'claude-code:xyz'),
  ('bracketed-first',         E'### [2026-05-01] First\n\n### 2026-05-02 Second', NULL),
  ('untagged-bracketed',      E'### [2024-12-24] Christmas planning\n- gifts', NULL),
  ('claude-index',            E'[Claude Conversation Index — imported 2026-05-19]\n### 2026-05-01 A', NULL),
  ('plain',                   'User prefers concise answers.', NULL);

-- The trigger as it stood, and rows it classified — what the backfill meets.
\ir ../../supabase/migrations/20260924000000_summaries_metadata_trigger.sql
\ir ../../supabase/migrations/20260929000000_summaries_bracketless_dates.sql

INSERT INTO summaries (fixture_key, content, external_id)
SELECT 'backfill:' || fixture_key, content, external_id FROM fixtures;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM summaries WHERE source NOT IN ('claude', 'chatgpt', 'other')) THEN
    RAISE EXCEPTION 'Precondition: the previous trigger knows no claude_code';
  END IF;
  IF (SELECT source FROM summaries WHERE fixture_key = 'backfill:tagged-session') <> 'other' THEN
    RAISE EXCEPTION 'Precondition: the previous trigger should call the new tag other';
  END IF;
END
$$;

\ir ../../supabase/migrations/20261001000000_summaries_claude_code_source.sql

INSERT INTO summaries (fixture_key, content, external_id)
SELECT 'insert:' || fixture_key, content, external_id FROM fixtures;

CREATE TABLE expected (
  fixture_key TEXT PRIMARY KEY,
  source      TEXT,
  kind        TEXT
);

INSERT INTO expected VALUES
  ('tagged-session',           'claude_code', 'conversation'),
  ('tagged-session-summary',   'claude_code', 'summary'),
  ('hook-bracketless',         'claude_code', 'conversation'),
  ('cloud-session',            'claude_code', 'conversation'),
  ('other-writer-key',         'claude',      'conversation'),
  ('tagged-claude',            'claude',      'conversation'),
  ('tagged-claude-bare-date',  'claude',      'conversation'),
  ('tagged-chatgpt-bare-date', 'chatgpt',     'conversation'),
  ('tag-beats-key',            'chatgpt',     'conversation'),
  ('bracketed-first',          'claude',      'conversation'),
  ('untagged-bracketed',       'claude',      'conversation'),
  ('claude-index',             'claude',      'index'),
  ('plain',                    'other',       'conversation');

DO $$
DECLARE
  mismatch RECORD;
  failures INT := 0;
  rejected BOOLEAN := false;
BEGIN
  FOR mismatch IN
    SELECT s.fixture_key,
           e.source AS want_source, s.source AS got_source,
           e.kind   AS want_kind,   s.kind   AS got_kind
    FROM summaries s
    JOIN expected e ON e.fixture_key = split_part(s.fixture_key, ':', 2)
    WHERE s.source IS DISTINCT FROM e.source
       OR s.kind   IS DISTINCT FROM e.kind
  LOOP
    failures := failures + 1;
    RAISE WARNING 'FIXTURE % — source want=% got=% | kind want=% got=%',
      mismatch.fixture_key,
      mismatch.want_source, mismatch.got_source,
      mismatch.want_kind,   mismatch.got_kind;
  END LOOP;

  IF failures > 0 THEN
    RAISE EXCEPTION 'Source disagrees with the classifier on % row(s)', failures;
  END IF;

  IF (SELECT count(*) FROM summaries) <> 2 * (SELECT count(*) FROM expected) THEN
    RAISE EXCEPTION 'Fixture count drifted between the fixtures and expected tables';
  END IF;

  -- The backfill moves a source and nothing else.
  IF (SELECT title FROM summaries WHERE fixture_key = 'backfill:hook-bracketless') <> 'FinView Audit'
     OR (SELECT occurred_at FROM summaries WHERE fixture_key = 'backfill:hook-bracketless')
        <> TIMESTAMPTZ '2026-09-23 00:00:00Z' THEN
    RAISE EXCEPTION 'The backfill changed more than the source';
  END IF;

  -- A writer that names the source keeps it, in both directions.
  INSERT INTO summaries (fixture_key, content, source)
  VALUES ('explicit-claude', E'### 2026-09-23 Looks like a hook row', 'claude'),
         ('explicit-session', E'[source:claude]\n### [2026-09-29] biglobster', 'claude_code');
  IF (SELECT source FROM summaries WHERE fixture_key = 'explicit-claude') <> 'claude'
     OR (SELECT source FROM summaries WHERE fixture_key = 'explicit-session') <> 'claude_code' THEN
    RAISE EXCEPTION 'The trigger overrode a source the writer supplied';
  END IF;

  -- The set is still closed.
  BEGIN
    INSERT INTO summaries (content, source) VALUES ('x', 'copilot');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'summaries_source_known accepted an unknown source';
  END IF;

  RAISE NOTICE 'summaries claude_code source: % fixtures OK on backfill and insert',
    (SELECT count(*) FROM expected);
END
$$;

ROLLBACK;
