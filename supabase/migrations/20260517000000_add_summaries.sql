--------------- SUMMARIES ---------------

-- TABLE --

CREATE TABLE IF NOT EXISTS summaries (
    -- ID
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- REQUIRED RELATIONSHIPS
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- METADATA
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- no updated_at: append-only, rows are never mutated

    -- REQUIRED
    content TEXT NOT NULL
);

-- INDEXES --

CREATE INDEX idx_summaries_user_id ON summaries (user_id);
CREATE INDEX idx_summaries_user_id_created_at ON summaries (user_id, created_at DESC);

-- RLS --

ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow select access to own summaries"
    ON summaries
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Allow insert access to own summaries"
    ON summaries
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- no UPDATE or DELETE policies: append-only table
