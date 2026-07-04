-- Trigram index for the relevance-search ILIKE queries.
--
-- get-relevant-memory.ts and get-full-conversation.ts both run
--   WHERE user_id = X AND content ILIKE '%term%'
-- on every chat turn / retrieval request. A plain btree cannot serve a
-- leading-wildcard ILIKE, so those queries sequential-scan all of the user's
-- summaries — fine at hundreds of rows, increasingly slow as bulk imports
-- grow into the thousands. A pg_trgm GIN index lets Postgres serve
-- ILIKE '%term%' directly.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_summaries_content_trgm
  ON summaries USING gin (content gin_trgm_ops);
