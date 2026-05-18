--------------- SUMMARIES — DELETE POLICY ---------------

-- Allow users to delete their own summaries from the Memory History UI.

CREATE POLICY "Allow delete access to own summaries"
    ON summaries
    FOR DELETE
    USING (user_id = auth.uid());
