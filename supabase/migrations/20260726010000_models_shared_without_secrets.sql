BEGIN;

SET LOCAL lock_timeout = '5s';

-- Permissive RLS policies combine with OR, so the original shared-row policy
-- must be replaced or it would continue exposing api_key with the rest of the
-- model row.
DROP POLICY IF EXISTS "Allow view access to non-private models"
ON public.models;

CREATE POLICY "Allow authenticated view of shared models without keys"
    ON public.models
    FOR SELECT
    TO authenticated
    USING (
        sharing <> 'private'
        AND api_key = ''
    );

-- Preserve historical rows while preventing every new or subsequently
-- updated shared model from carrying a stored credential.
ALTER TABLE public.models
ADD CONSTRAINT models_shared_without_api_key
CHECK (
    sharing = 'private'
    OR api_key = ''
)
NOT VALID;

COMMIT;
