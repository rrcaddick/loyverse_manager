#!/usr/bin/env bash
#
# Role dispatcher for the farmyard-manager image.
#
#   web                 gunicorn serving the JSON API and the React app
#   worker              supercronic: mail sync, bank poll, reminders, nightly backup
#   scheduler           supercronic: the daily Loyverse inventory jobs
#   migrate             apply migrations/*.sql, then exit
#   add-inventory       one-off run of the morning sync
#   clear-inventory     one-off run of the end-of-day teardown
#   hide-quicket-event  one-off run of the Selenium bot
#   sync-mail           one-off incremental mailbox sync
#   poll-bank           one-off FNB poll + payment matching
#   recompute-reminders one-off reminder recompute
#   backup              one-off database dump
#   import-sheet        one-off import of the old booking sheet CSV (args passed through)
#   import-mail         one-off full mailbox import + thread linking (args passed through)
#   create-user         create a portal user (args passed through)
#   <anything else>     executed verbatim (e.g. bash, python)
#
set -euo pipefail

cd /app

log() { echo "[entrypoint] $*"; }

run_supercronic() {
  local crontab_file
  crontab_file="$(mktemp)"
  printf '%s\n' "$@" > "$crontab_file"
  log "timezone: ${TZ:-UTC}"
  log "schedule:"
  sed 's/^/[entrypoint]   /' "$crontab_file"
  exec supercronic -passthrough-logs "$crontab_file"
}

case "${1:-web}" in
  web)
    log "starting gunicorn on 0.0.0.0:${PORT:-8000}"
    # The Ops page can run add-inventory synchronously inside the request and
    # that drives Selenium, so the worker timeout has to be generous.
    exec gunicorn web.wsgi:application \
      --bind "0.0.0.0:${PORT:-8000}" \
      --worker-class gthread \
      --workers "${GUNICORN_WORKERS:-2}" \
      --threads "${GUNICORN_THREADS:-4}" \
      --timeout "${GUNICORN_TIMEOUT:-1800}" \
      --graceful-timeout 30 \
      --access-logfile - \
      --error-logfile -
    ;;

  worker)
    : "${MAIL_SYNC_CRON:=* * * * *}"
    : "${BANK_POLL_CRON:=*/5 * * * *}"
    : "${REMINDERS_CRON:=30 6 * * *}"
    : "${BACKUP_CRON:=15 2 * * *}"
    run_supercronic \
      "${MAIL_SYNC_CRON} cd /app && python -m scripts.sync_mail" \
      "${BANK_POLL_CRON} cd /app && python -m scripts.poll_bank" \
      "${REMINDERS_CRON} cd /app && python -m scripts.recompute_reminders" \
      "${BACKUP_CRON} cd /app && bash scripts/backup_db.sh"
    ;;

  scheduler)
    : "${ADD_INVENTORY_CRON:=1 6 * * *}"
    : "${CLEAR_INVENTORY_CRON:=0 18 * * *}"
    run_supercronic \
      "${ADD_INVENTORY_CRON} cd /app && python -m scripts.add_inventory" \
      "${CLEAR_INVENTORY_CRON} cd /app && python -m scripts.clear_inventory"
    ;;

  migrate)
    log "applying database migrations"
    exec python -m scripts.run_migrations
    ;;

  add-inventory)       exec python -m scripts.add_inventory ;;
  clear-inventory)     exec python -m scripts.clear_inventory ;;
  hide-quicket-event)  exec python -m scripts.hide_quicket_event ;;
  sync-mail)           exec python -m scripts.sync_mail ;;
  poll-bank)           exec python -m scripts.poll_bank ;;
  recompute-reminders) exec python -m scripts.recompute_reminders ;;
  backup)              exec bash scripts/backup_db.sh ;;
  import-sheet)        shift; exec python -m scripts.import_sheet "$@" ;;
  import-mail)         shift; exec python -m scripts.import_mail "$@" ;;
  create-user)         shift; exec python -m scripts.create_user "$@" ;;

  *) exec "$@" ;;
esac
