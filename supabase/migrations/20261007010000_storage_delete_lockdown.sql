-- Audit M5: lock down the storage-delete functions.
--
-- delete_storage_object(_from_bucket) are SECURITY DEFINER and were executable by PUBLIC,
-- anon and authenticated (Supabase's default privileges). The repo's copy holds the local
-- demo URL and key, but production's was edited to the real project URL and service-role
-- key (checked 2026-10-07), so anyone with the public anon key could delete any stored
-- object by path through PostgREST. The five storage-cleanup triggers that call them are
-- SECURITY DEFINER and owned by postgres, so they keep working; the app never calls these
-- functions directly.
--
-- The key also sat in the function body, and every role that can log in reads
-- pg_proc.prosrc — the read-only chatmemo_backup role included. URL and key move to Vault
-- (readable by the owner, not by that role), copied from whatever the deployed body holds,
-- so their values appear neither in git nor in this file. Any step that fails aborts the
-- migration and leaves the old function in place.

DO $$
DECLARE
  src text;
  found_url text;
  found_key text;
BEGIN
  SELECT p.prosrc INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'delete_storage_object';

  found_url := (regexp_match(src, 'project_url\s+text\s*:=\s*''([^'']+)''', 'i'))[1];
  found_key := (regexp_match(src, 'service_role_key\s+text\s*:=\s*''([^'']+)''', 'i'))[1];

  IF NOT EXISTS (SELECT FROM vault.secrets WHERE name = 'storage_delete_project_url') THEN
    IF found_url IS NULL THEN
      RAISE EXCEPTION 'delete_storage_object holds no project_url to move to Vault';
    END IF;
    PERFORM vault.create_secret(found_url, 'storage_delete_project_url',
      'Storage API base URL for public.delete_storage_object');
  END IF;

  IF NOT EXISTS (SELECT FROM vault.secrets WHERE name = 'storage_delete_service_role_key') THEN
    IF found_key IS NULL THEN
      RAISE EXCEPTION 'delete_storage_object holds no service_role_key to move to Vault';
    END IF;
    PERFORM vault.create_secret(found_key, 'storage_delete_service_role_key',
      'Service-role key for public.delete_storage_object');
  END IF;

  -- The function will read these as its owner: prove the round trip before replacing it.
  IF (SELECT count(decrypted_secret) FROM vault.decrypted_secrets
       WHERE name IN ('storage_delete_project_url', 'storage_delete_service_role_key')) <> 2 THEN
    RAISE EXCEPTION 'Vault does not return both storage_delete secrets';
  END IF;
  IF found_key IS NOT NULL AND found_key IS DISTINCT FROM
     (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'storage_delete_service_role_key') THEN
    RAISE EXCEPTION 'Vault holds a different storage_delete_service_role_key than the function';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.delete_storage_object(bucket TEXT, object TEXT, OUT status INT, OUT content TEXT)
RETURNS RECORD
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  project_url TEXT := (SELECT decrypted_secret FROM vault.decrypted_secrets
                        WHERE name = 'storage_delete_project_url');
  service_role_key TEXT := (SELECT decrypted_secret FROM vault.decrypted_secrets
                             WHERE name = 'storage_delete_service_role_key');
  url TEXT := project_url || '/storage/v1/object/' || bucket || '/' || object;
BEGIN
  SELECT
      INTO status, content
           result.status::INT, result.content::TEXT
      FROM extensions.http((
    'DELETE',
    url,
    ARRAY[extensions.http_header('authorization', 'Bearer ' || service_role_key)],
    NULL,
    NULL)::extensions.http_request) AS result;
END;
$$;

ALTER FUNCTION public.delete_storage_object_from_bucket(text, text) SET search_path = '';

REVOKE ALL ON FUNCTION public.delete_storage_object(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_storage_object_from_bucket(text, text) FROM PUBLIC, anon, authenticated;
