-- Tie an in-app summary row to the conversation it summarises.
--
-- The summarise route fires after every turn, so one conversation produced a
-- run of near-identical rows — roughly nine for a twenty-message chat. The
-- near-duplicate guard could only compare against recent rows for the user,
-- which is a heuristic: with two conversations interleaved the newest row
-- belonged to the other chat, so every summary looked novel.
--
-- With chat_id the route can find *this* chat's summary exactly, and replace
-- it rather than appending another.
--
-- ON DELETE SET NULL, not CASCADE, on purpose: memory outlives the
-- conversation it came from. Deleting a chat must not delete what was learned
-- from it — that is the product. The row simply stops being replaceable and
-- becomes ordinary history.
--
-- Nullable, because every existing row predates this and imported rows never
-- have a chat.
--
-- DEPLOY ORDER: apply before publishing the code that writes chat_id. The
-- reverse makes the summarise route error on an unknown column; the chat still
-- works, but new turns stop being remembered until the migration lands.

SET lock_timeout = '5s';

ALTER TABLE summaries
  ADD COLUMN IF NOT EXISTS chat_id UUID REFERENCES chats(id) ON DELETE SET NULL;

-- Serves the lookup the route does on every turn: this user's summary for this
-- chat. Partial, because only in-app summaries carry a chat_id and the
-- imported majority would otherwise bloat the index.
CREATE INDEX IF NOT EXISTS idx_summaries_user_chat
  ON summaries (user_id, chat_id, created_at DESC)
  WHERE chat_id IS NOT NULL;
