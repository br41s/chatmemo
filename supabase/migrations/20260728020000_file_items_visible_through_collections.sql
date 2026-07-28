BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.collection_file_link_is_owned(
    p_collection_id uuid,
    p_file_id uuid,
    p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.collections AS owned_collection
        JOIN public.files AS owned_file
          ON owned_file.id = p_file_id
         AND owned_file.user_id = p_user_id
        WHERE owned_collection.id = p_collection_id
          AND owned_collection.user_id = p_user_id
    )
$$;

REVOKE ALL ON FUNCTION private.collection_file_link_is_owned(uuid, uuid, uuid)
FROM PUBLIC;

GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.collection_file_link_is_owned(uuid, uuid, uuid)
TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Allow full access to own collection_files"
ON public.collection_files;

CREATE POLICY "Allow access to owned collection file links"
    ON public.collection_files
    TO authenticated
    USING (
        user_id = auth.uid()
        AND private.collection_file_link_is_owned(
            collection_id,
            file_id,
            user_id
        )
    )
    WITH CHECK (
        user_id = auth.uid()
        AND private.collection_file_link_is_owned(
            collection_id,
            file_id,
            user_id
        )
    );

DROP POLICY IF EXISTS "Allow view access to collection files for non-private collections"
ON public.collection_files;

CREATE POLICY "Allow view access to valid links for non-private collections"
    ON public.collection_files
    FOR SELECT
    USING (
        private.collection_file_link_is_owned(
            collection_id,
            file_id,
            user_id
        )
        AND EXISTS (
            SELECT 1
            FROM public.collections AS visible_collection
            WHERE visible_collection.id = collection_files.collection_id
              AND visible_collection.sharing <> 'private'
        )
    );

DROP POLICY IF EXISTS "Allow view access to files for non-private collections"
ON public.files;

CREATE POLICY "Allow view access to files through valid shared collections"
    ON public.files
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.collection_files AS visible_link
            WHERE visible_link.file_id = files.id
        )
    );

DROP POLICY IF EXISTS "Allow view access to non-private file items"
ON public.file_items;

CREATE POLICY "Allow view access to visible file items"
    ON public.file_items
    FOR SELECT
    USING (
        file_items.active
        AND EXISTS (
            SELECT 1
            FROM public.files AS visible_file
            WHERE visible_file.id = file_items.file_id
        )
    );

COMMIT;
