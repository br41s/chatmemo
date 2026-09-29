-- Let a writer outside the app replace its own earlier row.
--
-- Claude Code sessions that run in the cloud never touch the laptop, so the
-- laptop sync cannot see them. They now post from inside the cloud container
-- to /api/import/conversation, once when a session reaches three messages and
-- again as it grows. Each post must replace the session's previous summary,
-- as replaceChatSummary does for in-app chats through chat_id.
--
-- chat_id cannot carry this: it references chats(id), and a cloud session is
-- not a chat. external_id is the writer's own key for what the row
-- summarises — "claude-code:<session id>" — and nothing else reads it.
--
-- Deploy note: the code tolerates the column's absence (insertSummary drops
-- unknown columns and the prune is skipped), so rows are never lost if this
-- lands after the code — they just are not replaced until it does.

SET lock_timeout = '5s';

ALTER TABLE summaries
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_summaries_user_external
  ON summaries (user_id, external_id)
  WHERE external_id IS NOT NULL;
