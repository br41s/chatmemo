-- Read-only role for the laptop's nightly backup (scripts/backup-chatmemo.sh).
--
-- The laptop holds no write-capable database key (PR #70). The backup needs to read every
-- memory row, so it gets its own login with SELECT on summaries and user_lessons and no
-- other table privilege: no table writes, no other tables, no RLS bypass. (Like every role
-- it can still call functions granted to PUBLIC; revoking those is audit item M5.)
--
-- No password here. `node scripts/backup-setup.mjs` generates one on the laptop, writes it
-- to ~/.pgpass and prints an ALTER ROLE carrying only its SCRAM verifier, which is run once
-- in the Supabase SQL editor. Until then the role cannot log in.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'chatmemo_backup') THEN
    CREATE ROLE chatmemo_backup
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT 5; -- one pg_dump, plus slack for pooler connections
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO chatmemo_backup;
GRANT SELECT ON public.summaries, public.user_lessons TO chatmemo_backup;

-- Both tables have RLS. The owner-only policies compare auth.uid() with user_id, which is
-- null for this role, so it needs its own read policy (pg_dump runs with
-- --enable-row-security rather than asking for BYPASSRLS).
DROP POLICY IF EXISTS "Backup role reads all summaries" ON public.summaries;
CREATE POLICY "Backup role reads all summaries"
  ON public.summaries FOR SELECT TO chatmemo_backup USING (true);

DROP POLICY IF EXISTS "Backup role reads all lessons" ON public.user_lessons;
CREATE POLICY "Backup role reads all lessons"
  ON public.user_lessons FOR SELECT TO chatmemo_backup USING (true);
