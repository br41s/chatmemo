\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable database.'
    \quit 1
\endif

SELECT 'CREATE ROLE authenticated NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
\gexec

SELECT 'CREATE ROLE anon NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
\gexec

SELECT 'CREATE ROLE service_role NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
\gexec

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO authenticated;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

CREATE TABLE public.files (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    sharing text NOT NULL DEFAULT 'private',
    tokens integer NOT NULL DEFAULT 0
);

CREATE TABLE public.collections (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    sharing text NOT NULL DEFAULT 'private'
);

CREATE TABLE public.collection_files (
    collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
    file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    PRIMARY KEY (collection_id, file_id)
);

CREATE TABLE public.file_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    content text NOT NULL,
    tokens integer NOT NULL,
    active boolean NOT NULL DEFAULT true,
    openai_embedding extensions.vector(1536),
    local_embedding extensions.vector(384)
);

CREATE TABLE public.message_file_items (
    file_item_id uuid PRIMARY KEY REFERENCES public.file_items(id) ON DELETE CASCADE
);

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to own files"
    ON public.files
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow view access to non-private files"
    ON public.files
    FOR SELECT
    USING (sharing <> 'private');

CREATE POLICY "Allow full access to own collections"
    ON public.collections
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow view access to non-private collections"
    ON public.collections
    FOR SELECT
    USING (sharing <> 'private');

CREATE POLICY "Allow full access to own collection_files"
    ON public.collection_files
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow view access to collection files for non-private collections"
    ON public.collection_files
    FOR SELECT
    USING (
        collection_id IN (
            SELECT id FROM public.collections WHERE sharing <> 'private'
        )
    );

CREATE POLICY "Allow view access to files for non-private collections"
    ON public.files
    FOR SELECT
    USING (
        id IN (
            SELECT file_id
            FROM public.collection_files
            WHERE collection_id IN (
                SELECT id FROM public.collections WHERE sharing <> 'private'
            )
        )
    );

CREATE POLICY "Allow full access to own file items"
    ON public.file_items
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow view access to non-private file items"
    ON public.file_items
    FOR SELECT
    USING (file_id IN (
        SELECT id FROM public.files WHERE sharing <> 'private'
    ));

CREATE FUNCTION public.match_file_items_local(
    query_embedding extensions.vector(384),
    match_count integer DEFAULT NULL,
    file_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, file_id uuid, content text, tokens integer, similarity float)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    SELECT item.id, item.file_id, item.content, item.tokens, 1::float
    FROM public.file_items AS item
    WHERE item.file_id = ANY(file_ids)
      AND item.active
    ORDER BY item.id
    LIMIT match_count;
END
$$;

CREATE FUNCTION public.match_file_items_openai(
    query_embedding extensions.vector(1536),
    match_count integer DEFAULT NULL,
    file_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, file_id uuid, content text, tokens integer, similarity float)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY
    SELECT item.id, item.file_id, item.content, item.tokens, 1::float
    FROM public.file_items AS item
    WHERE item.file_id = ANY(file_ids)
      AND item.active
    ORDER BY item.id
    LIMIT match_count;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.file_items TO authenticated;
GRANT SELECT ON public.message_file_items TO authenticated;
GRANT SELECT ON public.files, public.collections, public.collection_files, public.file_items TO anon;
GRANT EXECUTE ON FUNCTION public.match_file_items_local(extensions.vector, integer, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_file_items_openai(extensions.vector, integer, uuid[]) TO authenticated;

INSERT INTO public.files (id, user_id, sharing)
VALUES
    ('40000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'private'),
    ('40000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'public'),
    ('40000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'private'),
    ('40000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'private'),
    ('40000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'private');

INSERT INTO public.collections (id, user_id, sharing)
VALUES
    ('60000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'public'),
    ('60000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'private'),
    ('60000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'public');

INSERT INTO public.collection_files (collection_id, file_id, user_id)
VALUES
    ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111'),
    ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111'),
    ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.file_items (id, file_id, user_id, content, tokens, active)
VALUES
    ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'private other chunk', 3, true),
    ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'shared chunk', 2, true),
    ('50000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'own chunk', 2, true),
    ('50000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'collection-shared chunk', 2, true),
    ('50000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'private collection chunk', 2, true),
    ('50000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'inactive shared chunk', 2, false);

INSERT INTO public.message_file_items (file_item_id)
VALUES ('50000000-0000-0000-0000-000000000003');

\ir ../../supabase/migrations/20260726020000_file_items_owner_writes.sql
\ir ../../supabase/migrations/20260728020000_file_items_visible_through_collections.sql

SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

DO $$
DECLARE
    visible_file_ids uuid[];
    visible_item_ids uuid[];
    invalid_link_count integer;
    local_private_count integer;
    openai_private_count integer;
BEGIN
    SELECT array_agg(id ORDER BY id) INTO visible_file_ids FROM public.files;
    IF visible_file_ids IS DISTINCT FROM ARRAY[
        '40000000-0000-0000-0000-000000000002'::uuid,
        '40000000-0000-0000-0000-000000000003'::uuid,
        '40000000-0000-0000-0000-000000000004'::uuid
    ] THEN
        RAISE EXCEPTION 'unexpected visible files: %', visible_file_ids;
    END IF;

    SELECT array_agg(id ORDER BY id) INTO visible_item_ids FROM public.file_items;
    IF visible_item_ids IS DISTINCT FROM ARRAY[
        '50000000-0000-0000-0000-000000000002'::uuid,
        '50000000-0000-0000-0000-000000000003'::uuid,
        '50000000-0000-0000-0000-000000000004'::uuid
    ] THEN
        RAISE EXCEPTION 'unexpected visible file items: %', visible_item_ids;
    END IF;

    SELECT count(*) INTO invalid_link_count
    FROM public.collection_files
    WHERE collection_id = '60000000-0000-0000-0000-000000000003';

    IF invalid_link_count <> 0 THEN
        RAISE EXCEPTION 'historical cross-owner collection link remained visible';
    END IF;

    BEGIN
        INSERT INTO public.collection_files (collection_id, file_id, user_id)
        VALUES (
            '60000000-0000-0000-0000-000000000003',
            '40000000-0000-0000-0000-000000000005',
            auth.uid()
        );
        RAISE EXCEPTION 'cross-owner collection link was inserted';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    SELECT count(*) INTO local_private_count
    FROM public.match_file_items_local(
        array_fill(0::real, ARRAY[384])::extensions.vector,
        10,
        ARRAY['40000000-0000-0000-0000-000000000001'::uuid]
    );
    SELECT count(*) INTO openai_private_count
    FROM public.match_file_items_openai(
        array_fill(0::real, ARRAY[1536])::extensions.vector,
        10,
        ARRAY['40000000-0000-0000-0000-000000000001'::uuid]
    );

    IF local_private_count <> 0 OR openai_private_count <> 0 THEN
        RAISE EXCEPTION 'an RPC exposed private chunks: local %, openai %',
            local_private_count, openai_private_count;
    END IF;

    BEGIN
        INSERT INTO public.file_items (id, file_id, user_id, content, tokens)
        VALUES (
        '50000000-0000-0000-0000-000000000006',
            '40000000-0000-0000-0000-000000000002',
            auth.uid(),
            'injected shared chunk',
            3
        );
        RAISE EXCEPTION 'a non-owner inserted into a shared file';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        PERFORM public.replace_file_items(
            '40000000-0000-0000-0000-000000000002'::uuid,
            '[{"content":"injected replacement","tokens":2,"openai_embedding":null,"local_embedding":null}]'::jsonb,
            2
        );
        RAISE EXCEPTION 'a non-owner replaced items in a shared file';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;
END
$$;

INSERT INTO public.file_items (id, file_id, user_id, content, tokens)
VALUES (
    '50000000-0000-0000-0000-000000000007',
    '40000000-0000-0000-0000-000000000003',
    auth.uid(),
    'second own chunk',
    3
);

SELECT public.replace_file_items(
    '40000000-0000-0000-0000-000000000003'::uuid,
    '[{"content":"first replacement","tokens":4,"openai_embedding":null,"local_embedding":null}]'::jsonb,
    4
);

SELECT public.replace_file_items(
    '40000000-0000-0000-0000-000000000003'::uuid,
    '[{"content":"final replacement","tokens":6,"openai_embedding":null,"local_embedding":null}]'::jsonb,
    6
);

DO $$
BEGIN
    BEGIN
        PERFORM public.replace_file_items(
            '40000000-0000-0000-0000-000000000003'::uuid,
            '[{"content":"invalid replacement","tokens":7,"openai_embedding":null,"local_embedding":null}]'::jsonb,
            99
        );
        RAISE EXCEPTION 'replace_file_items accepted an inconsistent token total';
    EXCEPTION
        WHEN invalid_parameter_value THEN NULL;
    END;
END
$$;

DO $$
DECLARE
    own_item_count integer;
    active_item_count integer;
    cited_historical_count integer;
    own_file_tokens integer;
BEGIN
    SELECT count(*) INTO own_item_count
    FROM public.file_items
    WHERE file_id = '40000000-0000-0000-0000-000000000003'::uuid
      AND content = 'final replacement'
      AND tokens = 6
      AND active;

    SELECT count(*) INTO active_item_count
    FROM public.file_items
    WHERE file_id = '40000000-0000-0000-0000-000000000003'::uuid
      AND active;

    SELECT count(*) INTO cited_historical_count
    FROM public.file_items AS item
    JOIN public.message_file_items AS message_item
      ON message_item.file_item_id = item.id
    WHERE item.id = '50000000-0000-0000-0000-000000000003'::uuid
      AND NOT item.active
      AND item.content = 'own chunk';

    SELECT tokens INTO own_file_tokens
    FROM public.files
    WHERE id = '40000000-0000-0000-0000-000000000003'::uuid;

    IF own_item_count <> 1
       OR active_item_count <> 1
       OR cited_historical_count <> 1
       OR own_file_tokens <> 6 THEN
        RAISE EXCEPTION 'replace_file_items state invalid: final %, active %, cited %, tokens %',
            own_item_count, active_item_count, cited_historical_count, own_file_tokens;
    END IF;
END
$$;

RESET ROLE;
SET ROLE anon;
RESET request.jwt.claim.sub;

DO $$
DECLARE
    visible_count integer;
BEGIN
    SELECT count(*) INTO visible_count FROM public.file_items;
    IF visible_count <> 2 THEN
        RAISE EXCEPTION 'anonymous role saw % file items', visible_count;
    END IF;
END
$$;

RESET ROLE;

SELECT 'file items RLS integration passed' AS result;
