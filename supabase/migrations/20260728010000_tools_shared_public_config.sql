BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.tool_text_contains_embedded_secret(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT
        p_value ~* '(^|[^A-Za-z0-9])(Basic|Bearer)[[:space:]]+[A-Za-z0-9._~+/=-]{12,}'
        OR p_value ~* '-----BEGIN [A-Z ]*PRIVATE KEY-----'
        OR p_value ~* '(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}'
        OR p_value ~* '(^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}'
        OR p_value ~* '(^|[^A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}'
        OR p_value ~ '(^|[^A-Za-z0-9])AIza[0-9A-Za-z_-]{20,}'
        OR p_value ~ '(^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}'
        OR p_value ~* '(^|[^A-Za-z0-9])bot[0-9]{5,}:[A-Za-z0-9_-]{20,}'
        OR p_value ~* 'hooks[.]slack[.]com/services/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]{10,}'
        OR p_value ~* 'discord(app)?[.]com/api/webhooks/[0-9]+/[A-Za-z0-9._-]{20,}'
$$;

CREATE OR REPLACE FUNCTION public.tool_url_looks_like_secret_webhook(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT
        p_url ~* '^https?://(hook|hooks|webhook)[.]'
        OR p_url ~* '[.]m[.]pipedream[.]net([/:]|$)'
        OR p_url ~* '/(webhooks?|hooks/catch)(/|$)'
        OR p_url ~* '/with/key(/|$)'
$$;

CREATE OR REPLACE FUNCTION public.tool_public_url_is_shareable(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT
        p_url = ''
        OR (
            char_length(p_url) <= 2048
            AND p_url ~ '^https://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?)(:[0-9]{1,5})?(/[^[:space:]?#\\]*)?$'
            AND NOT public.tool_text_contains_embedded_secret(p_url)
            AND NOT public.tool_url_looks_like_secret_webhook(p_url)
        )
$$;

CREATE OR REPLACE FUNCTION public.tool_url_contains_credentials(p_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    SELECT
        p_url ~* '^[a-z][a-z0-9+.-]*://[^/?#[:space:]]+@'
        OR position('?' IN p_url) > 0
        OR position('#' IN p_url) > 0
        OR public.tool_url_looks_like_secret_webhook(p_url)
$$;

CREATE OR REPLACE FUNCTION public.tool_name_is_sensitive(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
    WITH normalized AS (
        SELECT pg_catalog.regexp_replace(
            pg_catalog.lower(p_name),
            '[^a-z0-9]',
            '',
            'g'
        ) AS value
    ), sensitive AS (
        SELECT ARRAY[
            'accesstoken', 'apikey', 'authorization', 'clientpassword',
            'clientsecret', 'cookie', 'credential', 'credentials', 'key',
            'ocpapimsubscriptionkey', 'password', 'passwd', 'privatekey',
            'proxyauthorization', 'refreshtoken', 'secret', 'setcookie',
            'signature', 'subscriptionkey', 'token'
        ]::text[] AS names
    )
    SELECT
        normalized.value = ANY (sensitive.names)
        OR (
            pg_catalog.left(normalized.value, 1) = 'x'
            AND pg_catalog.substr(normalized.value, 2) = ANY (sensitive.names)
        )
    FROM normalized, sensitive
$$;

CREATE OR REPLACE FUNCTION public.tool_json_contains_credentials(p_value jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
    item_key text;
    item_value jsonb;
    normalized_key text;
    parameter_name text;
    parameter_location text;
    scalar_value text;
BEGIN
    IF pg_catalog.jsonb_typeof(p_value) = 'string' THEN
        scalar_value := p_value #>> '{}';
        RETURN public.tool_text_contains_embedded_secret(scalar_value);
    END IF;

    IF pg_catalog.jsonb_typeof(p_value) = 'array' THEN
        FOR item_value IN
            SELECT value FROM pg_catalog.jsonb_array_elements(p_value)
        LOOP
            IF public.tool_json_contains_credentials(item_value) THEN
                RETURN true;
            END IF;
        END LOOP;

        RETURN false;
    END IF;

    IF pg_catalog.jsonb_typeof(p_value) <> 'object' THEN
        RETURN false;
    END IF;

    parameter_name := COALESCE(p_value ->> 'name', '');
    parameter_location := pg_catalog.lower(COALESCE(p_value ->> 'in', ''));

    IF public.tool_name_is_sensitive(parameter_name)
       AND parameter_location = ANY (ARRAY['header', 'query', 'cookie']) THEN
        RETURN true;
    END IF;

    FOR item_key, item_value IN
        SELECT key, value FROM pg_catalog.jsonb_each(p_value)
    LOOP
        normalized_key := pg_catalog.regexp_replace(
            pg_catalog.lower(item_key),
            '[^a-z0-9]',
            '',
            'g'
        );

        IF normalized_key = ANY (ARRAY['security', 'securityschemes'])
           AND item_value NOT IN ('null'::jsonb, '{}'::jsonb, '[]'::jsonb) THEN
            RETURN true;
        END IF;

        IF public.tool_name_is_sensitive(normalized_key) THEN
            RETURN true;
        END IF;

        IF normalized_key = 'url'
           AND pg_catalog.jsonb_typeof(item_value) = 'string'
           AND public.tool_url_contains_credentials(item_value #>> '{}') THEN
            RETURN true;
        END IF;

        IF public.tool_json_contains_credentials(item_value) THEN
            RETURN true;
        END IF;
    END LOOP;

    RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.tool_schema_contains_credentials(p_schema jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
    parsed_schema jsonb := p_schema;
BEGIN
    IF pg_catalog.jsonb_typeof(parsed_schema) = 'string' THEN
        BEGIN
            parsed_schema := (parsed_schema #>> '{}')::jsonb;
        EXCEPTION
            WHEN invalid_text_representation THEN
                RETURN true;
        END;
    END IF;

    IF pg_catalog.jsonb_typeof(parsed_schema) <> 'object' THEN
        RETURN true;
    END IF;

    RETURN public.tool_json_contains_credentials(parsed_schema);
END
$$;

CREATE OR REPLACE FUNCTION public.tool_config_is_shareable(
    p_schema jsonb,
    p_url text,
    p_custom_headers jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        (
            p_custom_headers IN (
                '{}'::jsonb,
                '""'::jsonb,
                'null'::jsonb
            )
            OR (
                pg_catalog.jsonb_typeof(p_custom_headers) = 'string'
                AND p_custom_headers #>> '{}' ~ E'^[ \t\n\r]*[{][ \t\n\r]*[}][ \t\n\r]*$'
            )
        )
        AND public.tool_public_url_is_shareable(p_url)
        AND NOT public.tool_schema_contains_credentials(p_schema)
$$;

REVOKE ALL ON FUNCTION public.tool_text_contains_embedded_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_url_looks_like_secret_webhook(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_public_url_is_shareable(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_url_contains_credentials(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_name_is_sensitive(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_json_contains_credentials(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_schema_contains_credentials(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tool_config_is_shareable(jsonb, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.tool_config_is_shareable(jsonb, text, jsonb)
    TO authenticated, service_role;

DROP POLICY IF EXISTS "Allow authenticated view of shared tools without headers"
ON public.tools;

CREATE POLICY "Allow authenticated view of shared tools without secrets"
    ON public.tools
    FOR SELECT
    TO authenticated
    USING (
        sharing <> 'private'
        AND public.tool_config_is_shareable(schema, url, custom_headers)
    );

ALTER TABLE public.tools
ADD CONSTRAINT tools_shared_without_embedded_secrets
CHECK (
    sharing = 'private'
    OR public.tool_config_is_shareable(schema, url, custom_headers)
)
NOT VALID;

COMMIT;
