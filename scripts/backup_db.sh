#!/usr/bin/env bash
#
# Nightly MySQL dump: gzip to $DATA_DIR/backups/farmyard-YYYY-MM-DD.sql.gz,
# prune anything older than 14 days, optionally hand the file to an offsite
# command. Needs mysqldump on PATH (Debian: default-mysql-client).
#
#   MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DB   required
#   DATA_DIR                                                   default /app/data
#   BACKUP_OFFSITE_CMD   e.g. "rclone copyto" -> run as: $CMD <file>
#   BACKUP_KEEP_DAYS     default 14
#
# The password only ever travels through MYSQL_PWD; it is never echoed or put
# on a command line. Exit status is non-zero on any failure.
set -euo pipefail

: "${MYSQL_HOST:?MYSQL_HOST is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"
: "${MYSQL_DB:?MYSQL_DB is required}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
DATA_DIR="${DATA_DIR:-/app/data}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

log() { echo "[backup_db] $(date +'%F %T') $*"; }

if ! command -v mysqldump >/dev/null 2>&1; then
  log "mysqldump not found on PATH (install default-mysql-client)"
  exit 2
fi

dest="${DATA_DIR}/backups"
mkdir -p "$dest"
file="${dest}/farmyard-$(date +%F).sql.gz"
tmp="${file}.part"
trap 'rm -f "$tmp"' EXIT

export MYSQL_PWD="$MYSQL_PASSWORD"
log "dumping ${MYSQL_DB} from ${MYSQL_HOST}:${MYSQL_PORT} to ${file}"
mysqldump \
  --host="$MYSQL_HOST" --port="$MYSQL_PORT" --user="$MYSQL_USER" \
  --single-transaction --quick --no-tablespaces --triggers --routines \
  --default-character-set=utf8mb4 \
  "$MYSQL_DB" | gzip -9 > "$tmp"
unset MYSQL_PWD

if [[ ! -s "$tmp" ]]; then
  log "dump produced an empty file"
  exit 3
fi
mv "$tmp" "$file"
trap - EXIT
log "wrote $(du -h "$file" | cut -f1) ${file}"

removed=$(find "$dest" -maxdepth 1 -type f -name 'farmyard-*.sql.gz' -mtime "+${KEEP_DAYS}" -print -delete | wc -l)
log "pruned ${removed} backup(s) older than ${KEEP_DAYS} days"

if [[ -n "${BACKUP_OFFSITE_CMD:-}" ]]; then
  log "running offsite command"
  sh -c "${BACKUP_OFFSITE_CMD} \"\$1\"" offsite "$file"
  log "offsite copy done"
fi
