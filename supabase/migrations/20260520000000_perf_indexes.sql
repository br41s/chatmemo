-- Performance indexes for common query patterns.
--
-- 1. Middleware home-workspace lookup: WHERE user_id = X AND is_home = true
CREATE INDEX IF NOT EXISTS idx_workspaces_user_home
  ON workspaces (user_id, is_home);

-- 2. Memory retrieval queries: WHERE user_id = X ORDER BY created_at DESC LIMIT N
--    Covers all three parallel queries in get-latest-summary.ts.
CREATE INDEX IF NOT EXISTS idx_summaries_user_created
  ON summaries (user_id, created_at DESC);
