--------------- SUMMARIES ---------------

-- TABLE --

CREATE TABLE IF NOT EXISTS summaries (
    -- ID
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- REQUIRED RELATIONSHIPS
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- METADATA
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- no updated_at: rows carry no revision history of their own
    -- (superseded: 20260518000000 added a DELETE policy, and the memory
    --  panel offers delete, clear-all and restore)

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

-- no UPDATE policy: a summary is replaced rather than edited in place.
-- A DELETE policy was added the next day (20260518000000_summaries_delete_policy)
-- so the memory panel can remove rows; this file predates it.
