#!/usr/bin/env bash
set -euo pipefail

test -n "${DATABASE_URL:-}" || { echo 'DATABASE_URL is required' >&2; exit 1; }
backup_dir="${BACKUP_DIR:-./backups/production}"
mkdir -p "$backup_dir"
backup_file="$backup_dir/thinktutor-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --file="$backup_file" "$DATABASE_URL"
sha256sum "$backup_file" > "$backup_file.sha256"
echo "Database backup created: $backup_file"
