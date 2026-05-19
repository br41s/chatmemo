-- User Lessons: one living document per user, upserted (not append-only).
-- The AI reads this at session start and rewrites it after each conversation.

CREATE TABLE IF NOT EXISTS user_lessons (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content     text        NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT  user_lessons_user_id_key UNIQUE (user_id)
);

ALTER TABLE user_lessons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own lessons"
  ON user_lessons FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own lessons"
  ON user_lessons FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own lessons"
  ON user_lessons FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own lessons"
  ON user_lessons FOR DELETE USING (auth.uid() = user_id);
