#!/bin/bash
# Nightly ChatMemo backup: every row of summaries and user_lessons, as a compressed pg_dump
# custom-format file. Restore with pg_restore (docs/ADMIN_GUIDE.md, section 12.2).
#
# - Runs as chatmemo_backup, a role that can only read those two tables
#   (supabase/migrations/20261007000000_backup_readonly_role.sql). Its password lives in
#   ~/.pgpass (mode 600), written by `node scripts/backup-setup.mjs`.
# - Connects through the Supabase session pooler: the direct db.<ref> host is IPv6-only and
#   unreachable from this Mac.
# - Scheduled by ~/Library/LaunchAgents/com.chatmemo.backup.plist (03:00); its stdout and
#   stderr go to ~/backups/chatmemo/backup.log and backup.err.
# - A failure posts a macOS notification. Until 2026-10 this job failed every night, silently.
set -euo pipefail
umask 077
# launchd starts jobs with a bare PATH; pg_dump comes from Homebrew's libpq.
export PATH="/opt/homebrew/opt/libpq/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

REF="oemjzjahpqjrhyyqxylj"
HOST="${CHATMEMO_BACKUP_HOST:-aws-1-ap-northeast-2.pooler.supabase.com}"
PORT="${CHATMEMO_BACKUP_PORT:-5432}"
DB_USER="${CHATMEMO_BACKUP_USER:-chatmemo_backup.$REF}"
DIR="${CHATMEMO_BACKUP_DIR:-$HOME/backups/chatmemo}"
KEEP_DAYS="${CHATMEMO_BACKUP_KEEP_DAYS:-30}" # 0 keeps every dump

fail() {
  echo "$(date '+%F %T') backup FAILED: $1" >&2
  osascript -e "display notification \"$1\" with title \"ChatMemo backup failed\"" 2>/dev/null || true
  exit 1
}
trap 'fail "exit $? at line $LINENO, details in backup.err"' ERR

mkdir -p "$DIR"
chmod 700 "$DIR"
# The dump lands in one scratch file, overwritten every run, and is copied to its dated
# name only once verified: a failed run never leaves a backup-looking file, nor truncates
# a good one from earlier the same day.
TMP="$DIR/.in-progress.dump"
OUT="$DIR/chatmemo-$(date +%Y-%m-%d).dump"

pg_dump "host=$HOST port=$PORT dbname=postgres user=$DB_USER sslmode=require connect_timeout=20" \
  --format=custom --data-only --no-owner --no-privileges --enable-row-security \
  --table=public.summaries --table=public.user_lessons \
  --file="$TMP"

# A file pg_restore cannot list is not a backup.
TABLES=$(pg_restore --list "$TMP" | grep -c "TABLE DATA public" || true)
[ "$TABLES" -eq 2 ] || fail "the dump holds $TABLES of 2 tables"
cp "$TMP" "$OUT"

if [ "$KEEP_DAYS" -gt 0 ]; then
  find "$DIR" -maxdepth 1 -type f -name 'chatmemo-*.dump' -mtime +"$KEEP_DAYS" -delete
fi
echo "$(date '+%F %T') backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
