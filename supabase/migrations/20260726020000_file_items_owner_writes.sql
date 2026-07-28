BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.file_items
    ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS file_items_active_file_id_idx
    ON public.file_items (file_id)
    WHERE active;

DROP POLICY IF EXISTS "Allow full access to own file items"
    ON public.file_items;

CREATE POLICY "Allow owners to view their file items"
    ON public.file_items
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Allow owners to insert items into their files"
    ON public.file_items
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.files
            WHERE files.id = file_items.file_id
              AND files.user_id = auth.uid()
        )
    );

CREATE POLICY "Allow owners to update items in their files"
    ON public.file_items
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.files
            WHERE files.id = file_items.file_id
              AND files.user_id = auth.uid()
        )
    )
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.files
            WHERE files.id = file_items.file_id
              AND files.user_id = auth.uid()
        )
    );

CREATE POLICY "Allow owners to delete items from their files"
    ON public.file_items
    FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.files
            WHERE files.id = file_items.file_id
              AND files.user_id = auth.uid()
        )
    );

CREATE OR REPLACE FUNCTION public.match_file_items_local(
    query_embedding extensions.vector(384),
    match_count integer DEFAULT NULL,
    file_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    file_id uuid,
    content text,
    tokens integer,
    similarity double precision
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    SELECT
        file_items.id,
        file_items.file_id,
        file_items.content,
        file_items.tokens,
        1 - (
            file_items.local_embedding
            OPERATOR(extensions.<=>)
            query_embedding
        ) AS similarity
    FROM public.file_items
    WHERE file_items.file_id = ANY(file_ids)
      AND file_items.active
    ORDER BY file_items.local_embedding OPERATOR(extensions.<=>) query_embedding
    LIMIT match_count;
END
$$;

CREATE OR REPLACE FUNCTION public.match_file_items_openai(
    query_embedding extensions.vector(1536),
    match_count integer DEFAULT NULL,
    file_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    file_id uuid,
    content text,
    tokens integer,
    similarity double precision
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    SELECT
        file_items.id,
        file_items.file_id,
        file_items.content,
        file_items.tokens,
        1 - (
            file_items.openai_embedding
            OPERATOR(extensions.<=>)
            query_embedding
        ) AS similarity
    FROM public.file_items
    WHERE file_items.file_id = ANY(file_ids)
      AND file_items.active
    ORDER BY file_items.openai_embedding OPERATOR(extensions.<=>) query_embedding
    LIMIT match_count;
END
$$;

CREATE OR REPLACE FUNCTION public.replace_file_items(
    p_file_id uuid,
    p_items jsonb,
    p_total_tokens integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    current_item jsonb;
    file_owner_id uuid;
    calculated_total_tokens bigint := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
    END IF;

    SELECT user_id
    INTO file_owner_id
    FROM public.files
    WHERE id = p_file_id
    FOR UPDATE;

    IF file_owner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'file unavailable' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0
       OR jsonb_array_length(p_items) > 2048
       OR p_total_tokens < 0 THEN
        RAISE EXCEPTION 'invalid file items' USING ERRCODE = '22023';
    END IF;

    FOR current_item IN SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(current_item) <> 'object'
           OR jsonb_typeof(current_item -> 'content') <> 'string'
           OR jsonb_typeof(current_item -> 'tokens') <> 'number'
           OR (current_item ->> 'tokens')::integer < 0 THEN
            RAISE EXCEPTION 'invalid file item' USING ERRCODE = '22023';
        END IF;

        calculated_total_tokens := calculated_total_tokens
            + (current_item ->> 'tokens')::integer;
    END LOOP;

    IF calculated_total_tokens <> p_total_tokens THEN
        RAISE EXCEPTION 'file token total does not match items'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.file_items
    SET active = false
    WHERE file_id = p_file_id
      AND active;

    DELETE FROM public.file_items AS old_item
    WHERE old_item.file_id = p_file_id
      AND NOT old_item.active
      AND NOT EXISTS (
          SELECT 1
          FROM public.message_file_items
          WHERE message_file_items.file_item_id = old_item.id
      );

    INSERT INTO public.file_items (
        file_id,
        user_id,
        content,
        tokens,
        active,
        openai_embedding,
        local_embedding
    )
    SELECT
        p_file_id,
        auth.uid(),
        item ->> 'content',
        (item ->> 'tokens')::integer,
        true,
        CASE
            WHEN item -> 'openai_embedding' IS NULL
              OR item -> 'openai_embedding' = 'null'::jsonb THEN NULL
            ELSE (item -> 'openai_embedding')::text::extensions.vector
        END,
        CASE
            WHEN item -> 'local_embedding' IS NULL
              OR item -> 'local_embedding' = 'null'::jsonb THEN NULL
            ELSE (item -> 'local_embedding')::text::extensions.vector
        END
    FROM jsonb_array_elements(p_items) AS item;

    UPDATE public.files
    SET tokens = p_total_tokens
    WHERE id = p_file_id
      AND user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'file unavailable' USING ERRCODE = '42501';
    END IF;
END
$$;

REVOKE ALL ON FUNCTION public.replace_file_items(uuid, jsonb, integer)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.replace_file_items(uuid, jsonb, integer)
    TO authenticated;

COMMIT;
