\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable database.'
    \quit 1
\endif

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE,
    username text NOT NULL UNIQUE
        CHECK (char_length(username) BETWEEN 3 AND 25)
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to own profiles"
    ON public.profiles
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;

INSERT INTO public.profiles (id, user_id, username)
VALUES
    (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-4111-8111-111111111111',
        'alice_name'
    ),
    (
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '22222222-2222-4222-8222-222222222222',
        'bob_name'
    );

\ir ../../supabase/migrations/20260728000000_authenticated_username_lookup.sql

DO $$
BEGIN
    IF has_function_privilege(
        'anon',
        'public.is_username_available(text)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'anon can execute is_username_available';
    END IF;

    IF has_function_privilege(
        'anon',
        'public.get_username_by_user_id(uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'anon can execute get_username_by_user_id';
    END IF;
END
$$;

SET ROLE authenticated;
SELECT set_config(
    'request.jwt.claim.sub',
    '11111111-1111-4111-8111-111111111111',
    false
);

DO $$
DECLARE
    visible_profiles integer;
BEGIN
    SELECT count(*) INTO visible_profiles FROM public.profiles;
    IF visible_profiles <> 1 THEN
        RAISE EXCEPTION 'RLS exposed % profiles instead of one', visible_profiles;
    END IF;

    IF public.is_username_available('alice_name') IS NOT TRUE THEN
        RAISE EXCEPTION 'current username should remain available to its owner';
    END IF;

    IF public.is_username_available('bob_name') IS NOT FALSE THEN
        RAISE EXCEPTION 'another user username was reported available';
    END IF;

    IF public.is_username_available('new_name') IS NOT TRUE THEN
        RAISE EXCEPTION 'unused username was reported unavailable';
    END IF;

    IF public.is_username_available('bad name') IS NOT FALSE THEN
        RAISE EXCEPTION 'invalid username was reported available';
    END IF;

    IF public.get_username_by_user_id(
        '22222222-2222-4222-8222-222222222222'
    ) IS DISTINCT FROM 'bob_name' THEN
        RAISE EXCEPTION 'authenticated scalar username lookup failed';
    END IF;
END
$$;

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);

DO $$
BEGIN
    IF public.is_username_available('new_name') IS NOT FALSE THEN
        RAISE EXCEPTION 'missing auth.uid was treated as authenticated';
    END IF;

    IF public.get_username_by_user_id(
        '11111111-1111-4111-8111-111111111111'
    ) IS NOT NULL THEN
        RAISE EXCEPTION 'missing auth.uid could retrieve a username';
    END IF;
END
$$;

RESET ROLE;

SELECT 'authenticated username lookup RLS integration passed' AS result;
