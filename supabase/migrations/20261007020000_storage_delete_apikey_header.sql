-- Send the Storage key the way Supabase's new API keys require.
--
-- The project's legacy JWT secret no longer verifies the 2026-05-17 service_role key
-- (Storage answers 403 "signature verification failed"), so storage cleanup moves to a
-- dedicated secret key (sb_secret_..., named "storagecleanup") in the same Vault secret.
-- New keys are not JWTs: they go in the `apikey` header, never `Authorization: Bearer`
-- (supabase.com/docs/guides/api/api-keys). A legacy JWT — the local stack's demo key —
-- still goes in both headers, as before.
--
-- Only the headers change. The function keeps its owner, ACL (no anon/authenticated),
-- SECURITY DEFINER, search_path and the warn-don't-block guard from 20261007010000.

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
  req_headers extensions.http_header[];
BEGIN
  -- A missing secret must not block the user's delete that fired the trigger: warn instead.
  IF project_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'storage_delete Vault secrets missing; % % left in Storage', bucket, object;
    status := 0;
    content := 'vault secret missing';
    RETURN;
  END IF;
  req_headers := ARRAY[extensions.http_header('apikey', service_role_key)];
  IF service_role_key LIKE 'eyJ%' THEN
    req_headers := req_headers || extensions.http_header('authorization', 'Bearer ' || service_role_key);
  END IF;
  SELECT
      INTO status, content
           result.status::INT, result.content::TEXT
      FROM extensions.http((
    'DELETE',
    url,
    req_headers,
    NULL,
    NULL)::extensions.http_request) AS result;
END;
$$;

-- CREATE OR REPLACE keeps the ACL; prove it, as the lockdown migration does.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.delete_storage_object(text,text)', 'execute')
     OR has_function_privilege('authenticated', 'public.delete_storage_object(text,text)', 'execute') THEN
    RAISE EXCEPTION 'anon or authenticated can execute delete_storage_object';
  END IF;
END
$$;
