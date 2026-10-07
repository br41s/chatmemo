\set ON_ERROR_STOP on

\if :{?chatmemo_rls_test}
\else
    \echo 'Refusing to run: pass -v chatmemo_rls_test=1 and use a disposable database.'
    \quit 1
\endif

-- Audit M5. Production's delete_storage_object held the real project URL and service-role
-- key, executable by anon. This rebuilds that state, applies the lockdown and checks that
-- the key leaves the function body, that only the owner can call it, and that the cleanup
-- trigger still reaches Storage with the right URL and key.

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

-- Stand-ins for Supabase Vault and the http extension, only where they are missing.
-- The http stand-in records each request instead of sending it.
DO $$
BEGIN
    IF to_regclass('vault.secrets') IS NULL THEN
        CREATE SCHEMA IF NOT EXISTS vault;
        CREATE TABLE vault.secrets (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name text UNIQUE,
            description text,
            secret text
        );
        CREATE FUNCTION vault.create_secret(
            new_secret text, new_name text DEFAULT NULL,
            new_description text DEFAULT '', new_key_id uuid DEFAULT NULL)
        RETURNS uuid LANGUAGE sql AS $f$
            INSERT INTO vault.secrets (name, description, secret)
            VALUES (new_name, new_description, new_secret) RETURNING id
        $f$;
        CREATE VIEW vault.decrypted_secrets AS
            SELECT id, name, description, secret, secret AS decrypted_secret FROM vault.secrets;
        REVOKE ALL ON SCHEMA vault FROM PUBLIC;
    END IF;

    IF to_regprocedure('extensions.http(extensions.http_request)') IS NULL THEN
        CREATE SCHEMA IF NOT EXISTS extensions;
        GRANT USAGE ON SCHEMA extensions TO PUBLIC;
        CREATE TYPE extensions.http_header AS (field text, value text);
        CREATE TYPE extensions.http_request AS (
            method text, uri text, headers extensions.http_header[],
            content_type text, content text);
        CREATE TYPE extensions.http_response AS (
            status int, content_type text, headers extensions.http_header[], content text);
        CREATE TABLE extensions.calls (method text, uri text, auth text);
        GRANT INSERT ON extensions.calls TO PUBLIC;
        CREATE FUNCTION extensions.http_header(field text, value text)
        RETURNS extensions.http_header LANGUAGE sql AS $f$
            SELECT ROW(field, value)::extensions.http_header
        $f$;
        CREATE FUNCTION extensions.http(req extensions.http_request)
        RETURNS extensions.http_response LANGUAGE plpgsql AS $f$
        BEGIN
            INSERT INTO extensions.calls VALUES (req.method, req.uri, (req.headers[1]).value);
            RETURN ROW(200, 'text/plain', NULL, 'ok')::extensions.http_response;
        END
        $f$;
    END IF;
END
$$;

-- The functions as production had them: real-looking URL and key in the body, anon allowed.
CREATE OR REPLACE FUNCTION public.delete_storage_object(bucket TEXT, object TEXT, OUT status INT, OUT content TEXT)
RETURNS RECORD
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  project_url TEXT := 'https://abcdefghijkl.supabase.co';
  service_role_key TEXT := 'eyJtestHeader.eyJtestPayload.testSignature';
  url TEXT := project_url || '/storage/v1/object/' || bucket || '/' || object;
BEGIN
  SELECT INTO status, content result.status::INT, result.content::TEXT
    FROM extensions.http(('DELETE', url,
      ARRAY[extensions.http_header('authorization', 'Bearer ' || service_role_key)],
      NULL, NULL)::extensions.http_request) AS result;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_storage_object_from_bucket(bucket_name TEXT, object_path TEXT, OUT status INT, OUT content TEXT)
RETURNS RECORD
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  SELECT INTO status, content result.status, result.content
    FROM public.delete_storage_object(bucket_name, object_path) AS result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_storage_object(text, text),
    public.delete_storage_object_from_bucket(text, text) TO PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.m5_files (id int PRIMARY KEY, file_path text);
GRANT SELECT, DELETE ON public.m5_files TO authenticated;
CREATE OR REPLACE FUNCTION public.m5_delete_old_file()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  status INT;
  content TEXT;
BEGIN
  SELECT INTO status, content result.status, result.content
    FROM public.delete_storage_object_from_bucket('files', OLD.file_path) AS result;
  IF status <> 200 THEN
    RAISE WARNING 'Could not delete file: % %', status, content;
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS m5_delete_old_file ON public.m5_files;
CREATE TRIGGER m5_delete_old_file BEFORE DELETE ON public.m5_files
    FOR EACH ROW EXECUTE PROCEDURE public.m5_delete_old_file();
INSERT INTO public.m5_files VALUES (1, 'user-a/report.pdf') ON CONFLICT DO NOTHING;

\ir ../../supabase/migrations/20261007010000_storage_delete_lockdown.sql
-- Applying it twice must change nothing.
\ir ../../supabase/migrations/20261007010000_storage_delete_lockdown.sql

DO $$
BEGIN
    IF (SELECT prosrc ~ 'eyJ|supabase\.co' FROM pg_proc
         WHERE oid = 'public.delete_storage_object(text,text)'::regprocedure) THEN
        RAISE EXCEPTION 'the URL or key is still in the function body';
    END IF;
    IF (SELECT count(*) FROM vault.decrypted_secrets
         WHERE (name = 'storage_delete_project_url'
                AND decrypted_secret = 'https://abcdefghijkl.supabase.co')
            OR (name = 'storage_delete_service_role_key'
                AND decrypted_secret = 'eyJtestHeader.eyJtestPayload.testSignature')) <> 2 THEN
        RAISE EXCEPTION 'Vault does not hold the URL and key the function had';
    END IF;
    IF has_function_privilege('anon', 'public.delete_storage_object(text,text)', 'execute')
       OR has_function_privilege('authenticated', 'public.delete_storage_object(text,text)', 'execute')
       OR has_function_privilege('anon', 'public.delete_storage_object_from_bucket(text,text)', 'execute')
       OR has_function_privilege('authenticated', 'public.delete_storage_object_from_bucket(text,text)', 'execute') THEN
        RAISE EXCEPTION 'anon or authenticated can still execute a storage-delete function';
    END IF;
END
$$;

-- A signed-in user deleting their row still cleans up Storage through the trigger.
SET ROLE authenticated;
DELETE FROM public.m5_files WHERE id = 1;
RESET ROLE;

DO $$
BEGIN
    IF to_regclass('extensions.calls') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM extensions.calls
         WHERE method = 'DELETE'
           AND uri = 'https://abcdefghijkl.supabase.co/storage/v1/object/files/user-a/report.pdf'
           AND auth = 'Bearer eyJtestHeader.eyJtestPayload.testSignature') THEN
        RAISE EXCEPTION 'the cleanup trigger did not reach Storage with the Vault URL and key';
    END IF;
END
$$;

-- anon calling it directly is refused.
SET ROLE anon;
DO $$
BEGIN
    PERFORM public.delete_storage_object('files', 'user-b/photo.png');
    RAISE EXCEPTION 'anon could call delete_storage_object';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END
$$;
RESET ROLE;

DROP TABLE public.m5_files;
DROP FUNCTION public.m5_delete_old_file();

SELECT 'storage delete lockdown integration passed' AS result;
