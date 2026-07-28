BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.is_username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        auth.uid() IS NOT NULL
        AND p_username ~ '^[A-Za-z0-9_]{3,25}$'
        AND NOT EXISTS (
            SELECT 1
            FROM public.profiles
            WHERE profiles.username = p_username
              AND profiles.user_id <> auth.uid()
        );
$$;

CREATE OR REPLACE FUNCTION public.get_username_by_user_id(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT profiles.username
    FROM public.profiles
    WHERE auth.uid() IS NOT NULL
      AND profiles.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.is_username_available(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_username_by_user_id(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_username_available(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_username_by_user_id(uuid) TO authenticated;

COMMIT;
