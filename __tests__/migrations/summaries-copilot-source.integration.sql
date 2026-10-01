-- Verifies 20261002000000_summaries_copilot_source.sql down both of its
-- paths: the backfill of rows the previous trigger called 'claude', and the
-- trigger on new rows. Mirrors the Copilot cases in
-- `__tests__/lib/summary-metadata.test.ts`.
--
-- Run against a disposable PostgreSQL, never a real database:
--   psql "$CHATMEMO_RLS_TEST_DATABASE_URL" -v chatmemo_rls_test=1 \
--     -f __tests__/migrations/summaries-copilot-source.integration.sql
--
-- It creates and drops its own schema, so it cannot touch application data.

\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable empty database.'
    \quit 1
\endif

BEGIN;

CREATE SCHEMA chatmemo_copilot_source_test;
SET LOCAL search_path = chatmemo_copilot_source_test, public;

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
  fixture_key  TEXT
);

CREATE TABLE fixtures (
  fixture_key TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  external_id TEXT
);

INSERT INTO fixtures (fixture_key, content, external_id) VALUES
  ('tagged-copilot',          E'[source:copilot]\n### [2026-10-01] VSCODE [Copilot]\n\n- shipped', NULL),
  ('untagged-copilot',        E'### [2026-09-12] OptionsAI [Copilot]\n\n- fix', NULL),
  ('untagged-copilot-bare',   E'### 2026-09-12 OptionsAI [Copilot]\n\n- fix', NULL),
  ('copilot-in-title-middle', E'### [2026-05-22] [Copilot] importer and watcher\n- built', NULL),
  ('copilot-in-body',         E'### [2026-05-22] Session importer\n- handles [Copilot]', NULL),
  ('second-header-copilot',   E'### [2026-05-01] First\n\n### [2026-05-02] Second [Copilot]', NULL),
  ('tag-beats-title',         E'[source:chatgpt]\n### [2025-11-05] Notes on [Copilot]', NULL),
  ('tagged-session',          E'[source:claude_code]\n### [2026-10-01] chatmemo\n\n- shipped', NULL),
  ('hook-bracketless',        E'### 2026-09-23 FinView Audit\n\n- **Project:** FinView', NULL),
  ('cloud-session',           E'### [2026-09-30] FlyWell UI Redesign\n- done', 'claude-code:abc'),
  ('untagged-bracketed',      E'### [2024-12-24] Christmas planning\n- gifts', NULL),
  ('plain',                   'User prefers concise answers.', NULL);

-- The trigger as it stood, and rows it classified — what the backfill meets.
\ir ../../supabase/migrations/20260924000000_summaries_metadata_trigger.sql
\ir ../../supabase/migrations/20261001000000_summaries_claude_code_source.sql

INSERT INTO summaries (fixture_key, content, external_id)
SELECT 'backfill:' || fixture_key, content, external_id FROM fixtures;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM summaries WHERE source = 'copilot') THEN
    RAISE EXCEPTION 'Precondition: the previous trigger knows no copilot';
  END IF;
END
$$;

\ir ../../supabase/migrations/20261002000000_summaries_copilot_source.sql

INSERT INTO summaries (fixture_key, content, external_id)
SELECT 'insert:' || fixture_key, content, external_id FROM fixtures;

CREATE TABLE expected (
  fixture_key TEXT PRIMARY KEY,
  source      TEXT,
  kind        TEXT
);

INSERT INTO expected VALUES
  ('tagged-copilot',          'copilot',     'conversation'),
  ('untagged-copilot',        'copilot',     'conversation'),
  ('untagged-copilot-bare',   'copilot',     'conversation'),
  ('copilot-in-title-middle', 'claude',      'conversation'),
  ('copilot-in-body',         'claude',      'conversation'),
  ('second-header-copilot',   'claude',      'conversation'),
  ('tag-beats-title',         'chatgpt',     'conversation'),
  ('tagged-session',          'claude_code', 'conversation'),
  ('hook-bracketless',        'claude_code', 'conversation'),
  ('cloud-session',           'claude_code', 'conversation'),
  ('untagged-bracketed',      'claude',      'conversation'),
  ('plain',                   'other',       'conversation');

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
  IF (SELECT title FROM summaries WHERE fixture_key = 'backfill:untagged-copilot') <> 'OptionsAI [Copilot]' THEN
    RAISE EXCEPTION 'The backfill changed more than the source';
  END IF;

  -- The set is still closed.
  BEGIN
    INSERT INTO summaries (content, source) VALUES ('x', 'cursor');
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'summaries_source_known accepted an unknown source';
  END IF;

  RAISE NOTICE 'summaries copilot source: % fixtures OK on backfill and insert',
    (SELECT count(*) FROM expected);
END
$$;

ROLLBACK;
