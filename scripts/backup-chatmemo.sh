#!/bin/bash
DATE=$(date +%Y-%m-%d)
BACKUP_DIR="$HOME/backups/chatmemo"
mkdir -p "$BACKUP_DIR"

pg_dump \
  "postgresql://postgres:[YOUR-PASSWORD]@db.oemjzjahpqjrhyyqxylj.supabase.co:5432/postgres" \
  --table=summaries \
  --data-only \
  --no-owner \
  --no-privileges \
  -f "$BACKUP_DIR/summaries-$DATE.sql"

# Keep only last 30 days
find "$BACKUP_DIR" -name "*.sql" -mtime +30 -delete

echo "Backup complete: $BACKUP_DIR/summaries-$DATE.sql"