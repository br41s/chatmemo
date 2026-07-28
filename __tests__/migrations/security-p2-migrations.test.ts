/** @jest-environment node */

import { readFileSync } from "node:fs"
import { join } from "node:path"

const toolMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260728010000_tools_shared_public_config.sql"
  ),
  "utf8"
)
const collectionMigration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260728020000_file_items_visible_through_collections.sql"
  ),
  "utf8"
)

describe("remaining P2 security migrations", () => {
  it("replaces shared-tool visibility with one reusable predicate", () => {
    expect(toolMigration).toContain(
      'DROP POLICY IF EXISTS "Allow authenticated view of shared tools without headers"'
    )
    expect(toolMigration).toContain(
      'CREATE POLICY "Allow authenticated view of shared tools without secrets"'
    )
    expect(toolMigration).toContain(
      "public.tool_config_is_shareable(schema, url, custom_headers)"
    )
    expect(toolMigration).toContain(
      "ADD CONSTRAINT tools_shared_without_embedded_secrets"
    )
    expect(toolMigration).toContain("NOT VALID")
    expect(toolMigration).toMatch(
      /FUNCTION public\.tool_config_is_shareable[\s\S]+SECURITY DEFINER[\s\S]+SET search_path = ''/
    )
    expect(toolMigration).toContain(
      "REVOKE ALL ON FUNCTION public.tool_json_contains_credentials(jsonb) FROM PUBLIC"
    )
    expect(toolMigration).toContain(
      "public.tool_text_contains_embedded_secret"
    )
  })

  it("does not rewrite historical tool rows", () => {
    expect(toolMigration).not.toMatch(
      /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?tools\b/i
    )
  })

  it("derives fragment visibility from the visible parent file", () => {
    expect(collectionMigration).toContain(
      'DROP POLICY IF EXISTS "Allow view access to non-private file items"'
    )
    expect(collectionMigration).toContain(
      'CREATE POLICY "Allow view access to visible file items"'
    )
    expect(collectionMigration).toMatch(
      /FROM public\.files AS visible_file[\s\S]+visible_file\.id = file_items\.file_id/
    )
    expect(collectionMigration).toContain("file_items.active")
    expect(collectionMigration).toContain(
      "private.collection_file_link_is_owned"
    )
    expect(collectionMigration).toContain(
      'CREATE POLICY "Allow access to owned collection file links"'
    )
    expect(collectionMigration).toMatch(
      /FUNCTION private\.collection_file_link_is_owned[\s\S]+SECURITY DEFINER[\s\S]+SET search_path = ''/
    )
    expect(collectionMigration).toContain(
      "REVOKE ALL ON FUNCTION private.collection_file_link_is_owned(uuid, uuid, uuid)"
    )
    expect(collectionMigration).not.toContain(
      "FUNCTION public.collection_file_link_is_owned"
    )
    expect(collectionMigration).not.toMatch(
      /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)\s+(?:public\.)?file_items\b/i
    )
  })

  it("bounds both migrations with a lock timeout", () => {
    expect(toolMigration).toContain("SET LOCAL lock_timeout = '5s'")
    expect(collectionMigration).toContain("SET LOCAL lock_timeout = '5s'")
  })
})
