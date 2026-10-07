#!/usr/bin/env node
/**
 * Nightly backup setup — run once (again to rotate the password):
 *
 *   node scripts/backup-setup.mjs
 *
 * What it does:
 *  1. Generates a random password for chatmemo_backup, the read-only role the
 *     backup logs in as (supabase/migrations/20261007000000_backup_readonly_role.sql)
 *  2. Stores it in ~/.pgpass (mode 600), replacing any earlier line for the
 *     same host and user — scripts/backup-chatmemo.sh reads it from there
 *  3. Prints the ALTER ROLE to run once in the Supabase SQL editor
 *
 * The statement carries only the SCRAM-SHA-256 verifier — what psql's
 * \password sends — so the password never leaves this laptop: not through the
 * clipboard, the SQL editor's history or the database logs. Postgres stores a
 * verifier it is given as is.
 *
 * Overrides (for a local test database): CHATMEMO_BACKUP_HOST, _PORT, _USER,
 * and libpq's PGPASSFILE.
 */

import { createHash, createHmac, pbkdf2Sync, randomBytes } from "crypto"
import { chmodSync, existsSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const REF = "oemjzjahpqjrhyyqxylj"
const HOST =
  process.env.CHATMEMO_BACKUP_HOST || "aws-1-ap-northeast-2.pooler.supabase.com"
const PORT = process.env.CHATMEMO_BACKUP_PORT || "5432"
const USER = process.env.CHATMEMO_BACKUP_USER || `chatmemo_backup.${REF}`
const PGPASS = process.env.PGPASSFILE || join(homedir(), ".pgpass")

// RFC 5802 / 7677, as Postgres stores it: SCRAM-SHA-256$<iter>:<salt>$<StoredKey>:<ServerKey>
function scramVerifier(password, iterations = 4096) {
  const salt = randomBytes(16)
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256")
  const clientKey = createHmac("sha256", salted).update("Client Key").digest()
  const storedKey = createHash("sha256").update(clientKey).digest()
  const serverKey = createHmac("sha256", salted).update("Server Key").digest()
  const b64 = buf => buf.toString("base64")
  return `SCRAM-SHA-256$${iterations}:${b64(salt)}$${b64(storedKey)}:${b64(serverKey)}`
}

// base64url has no ":" or "\", so the .pgpass line needs no escaping.
const password = randomBytes(32).toString("base64url")
const prefix = `${HOST}:${PORT}:postgres:${USER}:`
const exists = existsSync(PGPASS)
// Lock an existing file before the new password goes in: `mode` below only
// applies when the file is created.
if (exists) chmodSync(PGPASS, 0o600)
const kept = exists
  ? readFileSync(PGPASS, "utf8")
      .split("\n")
      .filter(line => line && !line.startsWith(prefix))
  : []
writeFileSync(PGPASS, [...kept, prefix + password].join("\n") + "\n", {
  mode: 0o600
})

console.log(`Stored the password for ${USER} in ${PGPASS}.`)
console.log(
  "\nRun this once in the Supabase SQL editor (it holds a hash, not the password):\n"
)
console.log(
  `ALTER ROLE chatmemo_backup WITH PASSWORD '${scramVerifier(password)}';\n`
)
