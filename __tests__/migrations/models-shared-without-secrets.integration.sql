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

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

CREATE TABLE public.models (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    sharing text NOT NULL DEFAULT 'private',
    api_key text NOT NULL
);

ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to own models"
    ON public.models
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Allow view access to non-private models"
    ON public.models
    FOR SELECT
    USING (sharing <> 'private');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.models TO authenticated;
GRANT SELECT ON public.models TO anon;

INSERT INTO public.models (id, user_id, sharing, api_key)
VALUES
    (
        '10000000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'private',
        'private-key'
    ),
    (
        '10000000-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111',
        'public',
        ''
    ),
    (
        '10000000-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111',
        'public',
        'historical-secret'
    );

\ir ../../supabase/migrations/20260726010000_models_shared_without_secrets.sql

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'models'
          AND policyname = 'Allow view access to non-private models'
    ) THEN
        RAISE EXCEPTION 'the original permissive model policy still exists';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'models'
          AND policyname = 'Allow full access to own models'
    ) THEN
        RAISE EXCEPTION 'the model owner policy was removed';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'models'
          AND policyname = 'Allow authenticated view of shared models without keys'
          AND roles = ARRAY['authenticated'::name]
    ) THEN
        RAISE EXCEPTION 'the authenticated shared-model policy is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'public.models'::regclass
          AND conname = 'models_shared_without_api_key'
          AND NOT convalidated
    ) THEN
        RAISE EXCEPTION 'the historical model constraint is missing or validated';
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
    FROM public.models;

    IF visible_ids IS DISTINCT FROM ARRAY[
        '10000000-0000-0000-0000-000000000002'::uuid
    ] THEN
        RAISE EXCEPTION 'non-owner saw unexpected models: %', visible_ids;
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
    FROM public.models;

    IF visible_count <> 3 THEN
        RAISE EXCEPTION 'owner lost access to models: % visible', visible_count;
    END IF;

    BEGIN
        INSERT INTO public.models (id, user_id, sharing, api_key)
        VALUES (
            '10000000-0000-0000-0000-000000000004',
            auth.uid(),
            'public',
            'new-secret'
        );
        RAISE EXCEPTION 'shared model with key was inserted';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        UPDATE public.models
        SET sharing = sharing
        WHERE id = '10000000-0000-0000-0000-000000000003';
        RAISE EXCEPTION 'historical shared model with key was updated';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    UPDATE public.models
    SET sharing = 'private'
    WHERE id = '10000000-0000-0000-0000-000000000003';
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
    FROM public.models;

    IF visible_count <> 0 THEN
        RAISE EXCEPTION 'anonymous role can read % models', visible_count;
    END IF;
END
$$;

RESET ROLE;

SELECT 'models RLS integration passed' AS result;
