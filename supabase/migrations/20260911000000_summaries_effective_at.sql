-- Order memory by when a conversation happened, not when the row was written.
--
-- `occurred_at` was added by 20260819000000_summaries_typed_metadata.sql and
-- has been written on every insert since — and read by nothing. Every memory
-- query orders by `created_at`, the row's insertion time, while the block it
-- assembles is labelled "newest entries first".
--
-- For rows written as the conversation happens those are the same thing. For a
-- bulk import they are not: a ChatGPT archive loaded today gives hundreds of
-- rows a `created_at` of today and an `occurred_at` from whenever those
-- conversations actually took place. Ordering by insertion time puts that
-- archive above everything the user said this week, and because the baseline
-- takes only the newest 150 rows and fits ~100 of them in its char budget, a
-- large import can push every recent conversation out of memory entirely. The
-- user then asks about yesterday and is told their history stops in August.
--
-- `effective_at` is the date to sort by: the conversation's own, falling back
-- to insertion time for rows with no parseable date (index rows, watermarks,
-- anything the header regex did not match). Generated and stored rather than
-- computed per query, because PostgREST cannot order on an expression and the
-- ordering needs an index to stay cheap.

ALTER TABLE summaries
  ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ
  GENERATED ALWAYS AS (COALESCE(occurred_at, created_at)) STORED;

-- INDEXES --
--
-- The same two access paths as the typed-metadata migration — user plus kind,
-- user plus source — now sorted by the column the reads actually order on.
-- The `created_at` pair stays: `readMemoryVersion` still asks for the newest
-- insertion to invalidate its cache, which is a question about writes and is
-- correctly answered by `created_at`.

CREATE INDEX IF NOT EXISTS idx_summaries_user_kind_effective
  ON summaries (user_id, kind, effective_at DESC);

CREATE INDEX IF NOT EXISTS idx_summaries_user_source_effective
  ON summaries (user_id, source, effective_at DESC);
