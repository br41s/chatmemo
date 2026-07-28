BEGIN;

-- Fail quickly instead of waiting indefinitely for the brief ACCESS EXCLUSIVE
-- locks required by the policy and constraint changes. The migration is safe
-- to retry because a timeout rolls back this transaction.
SET LOCAL lock_timeout = '5s';

-- RLS policies are permissive by default and combine with OR. The original
-- policy must be replaced, not supplemented, or it would keep exposing the
-- complete row, including custom_headers.
DROP POLICY IF EXISTS "Allow view access to non-private tools"
ON public.tools;

CREATE POLICY "Allow authenticated view of shared tools without headers"
    ON public.tools
    FOR SELECT
    TO authenticated
    USING (
        sharing <> 'private'
        AND (
            custom_headers IN (
                '{}'::jsonb,
                '""'::jsonb,
                'null'::jsonb
            )
            OR (
                jsonb_typeof(custom_headers) = 'string'
                AND custom_headers #>> '{}' ~ E'^[ \t\n\r]*[{][ \t\n\r]*[}][ \t\n\r]*$'
            )
        )
    );

-- NOT VALID avoids rewriting or rejecting historical rows during deployment,
-- while still enforcing the rule for every new or subsequently updated row.
ALTER TABLE public.tools
ADD CONSTRAINT tools_shared_without_custom_headers
CHECK (
    sharing = 'private'
    OR custom_headers IN (
        '{}'::jsonb,
        '""'::jsonb,
        'null'::jsonb
    )
    OR (
        jsonb_typeof(custom_headers) = 'string'
        AND custom_headers #>> '{}' ~ E'^[ \t\n\r]*[{][ \t\n\r]*[}][ \t\n\r]*$'
    )
)
NOT VALID;

COMMIT;
