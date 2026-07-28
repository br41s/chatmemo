\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable empty database.'
    \quit 1
\endif

SELECT 'CREATE ROLE authenticated NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
\gexec

SELECT 'CREATE ROLE anon NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
\gexec

CREATE SCHEMA auth;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

CREATE TABLE public.tools (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    sharing text NOT NULL DEFAULT 'private',
    custom_headers jsonb NOT NULL DEFAULT '{}'
);

ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to own tools"
    ON public.tools
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow view access to non-private tools"
    ON public.tools
    FOR SELECT
    USING (sharing <> 'private');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tools TO authenticated;
GRANT SELECT ON public.tools TO anon;

INSERT INTO public.tools (id, user_id, sharing, custom_headers)
VALUES
    (
        '00000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'private',
        '{"Authorization":"private-secret"}'
    ),
    (
        '00000000-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111',
        'public',
        '{}'
    ),
    (
        '00000000-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111',
        'public',
        to_jsonb(''::text)
    ),
    (
        '00000000-0000-0000-0000-000000000004',
        '11111111-1111-1111-1111-111111111111',
        'public',
        to_jsonb(E' \t{ \n }\r'::text)
    ),
    (
        '00000000-0000-0000-0000-000000000005',
        '11111111-1111-1111-1111-111111111111',
        'public',
        '{"Authorization":"historical-secret"}'
    ),
    (
        '00000000-0000-0000-0000-000000000006',
        '11111111-1111-1111-1111-111111111111',
        'public',
        to_jsonb('{"Authorization":"string-secret"}'::text)
    ),
    (
        '00000000-0000-0000-0000-000000000007',
        '11111111-1111-1111-1111-111111111111',
        'public',
        'null'
    ),
    (
        '00000000-0000-0000-0000-000000000008',
        '11111111-1111-1111-1111-111111111111',
        'public',
        '[]'
    ),
    (
        '00000000-0000-0000-0000-000000000009',
        '11111111-1111-1111-1111-111111111111',
        'public',
        to_jsonb(E'{\v}'::text)
    );

\ir ../../supabase/migrations/20260726000000_tools_shared_without_secrets.sql

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tools'
          AND policyname = 'Allow view access to non-private tools'
    ) THEN
        RAISE EXCEPTION 'the original permissive policy still exists';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tools'
          AND policyname = 'Allow full access to own tools'
    ) THEN
        RAISE EXCEPTION 'the owner policy was removed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tools'
          AND policyname = 'Allow authenticated view of shared tools without headers'
          AND roles = ARRAY['authenticated'::name]
    ) THEN
        RAISE EXCEPTION 'the authenticated shared-tool policy is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.tools'::regclass
          AND conname = 'tools_shared_without_custom_headers'
          AND NOT convalidated
    ) THEN
        RAISE EXCEPTION 'the historical-row constraint is missing or validated';
    END IF;
END
$$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

DO $$
DECLARE
    visible_ids uuid[];
BEGIN
    SELECT array_agg(id ORDER BY id)
    INTO visible_ids
    FROM public.tools;

    IF visible_ids IS DISTINCT FROM ARRAY[
        '00000000-0000-0000-0000-000000000002'::uuid,
        '00000000-0000-0000-0000-000000000003'::uuid,
        '00000000-0000-0000-0000-000000000004'::uuid,
        '00000000-0000-0000-0000-000000000007'::uuid
    ] THEN
        RAISE EXCEPTION 'non-owner saw unexpected tools: %', visible_ids;
    END IF;
END
$$;

RESET ROLE;
SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
    visible_count integer;
BEGIN
    SELECT count(*)
    INTO visible_count
    FROM public.tools;

    IF visible_count <> 9 THEN
        RAISE EXCEPTION 'owner lost access to tools: % visible', visible_count;
    END IF;

    BEGIN
        INSERT INTO public.tools (id, user_id, sharing, custom_headers)
        VALUES (
            '00000000-0000-0000-0000-000000000010',
            auth.uid(),
            'public',
            '{"Authorization":"new-secret"}'
        );
        RAISE EXCEPTION 'shared tool with headers was inserted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE public.tools
        SET sharing = sharing
        WHERE id = '00000000-0000-0000-0000-000000000005';
        RAISE EXCEPTION 'historical shared tool with headers was updated';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    UPDATE public.tools
    SET sharing = 'private'
    WHERE id = '00000000-0000-0000-0000-000000000005';

    INSERT INTO public.tools (id, user_id, sharing, custom_headers)
    VALUES (
        '00000000-0000-0000-0000-000000000011',
        auth.uid(),
        'public',
        to_jsonb(E'\n{  }\t'::text)
    );
END
$$;

RESET ROLE;
SET ROLE anon;
RESET request.jwt.claim.sub;

DO $$
DECLARE
    visible_count integer;
BEGIN
    SELECT count(*)
    INTO visible_count
    FROM public.tools;

    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'anonymous role can read % tools', visible_count;
    END IF;
END
$$;

RESET ROLE;

SELECT 'tools RLS integration passed' AS result;
