#!/usr/bin/env bash
#
# Role dispatcher for the farmyard-manager image.
#
#   web                 gunicorn serving the Flask admin portal
#   scheduler           supercronic running the daily inventory jobs
#   migrate             apply migrations/*.sql, then exit
#   add-inventory       one-off run of the morning sync
#   clear-inventory     one-off run of the end-of-day teardown
#   hide-quicket-event  one-off run of the Selenium bot
#   <anything else>     executed verbatim (e.g. bash, python)
#
set -euo pipefail

cd /app

log() { echo "[entrypoint] $*"; }

case "${1:-web}" in
  web)
    log "starting gunicorn on 0.0.0.0:${PORT:-8000}"
    # The Scripts page runs add-inventory synchronously inside the request and
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

  scheduler)
    : "${ADD_INVENTORY_CRON:=1 6 * * *}"
    : "${CLEAR_INVENTORY_CRON:=0 18 * * *}"

    crontab_file="$(mktemp)"
    {
      echo "${ADD_INVENTORY_CRON} cd /app && python -m scripts.add_inventory"
      echo "${CLEAR_INVENTORY_CRON} cd /app && python -m scripts.clear_inventory"
    } > "$crontab_file"

    log "timezone: ${TZ:-UTC}"
    log "schedule:"
    sed 's/^/[entrypoint]   /' "$crontab_file"

    exec supercronic -passthrough-logs "$crontab_file"
    ;;

  migrate)
    log "applying database migrations"
    exec python -m scripts.run_migrations
    ;;

  add-inventory)      exec python -m scripts.add_inventory ;;
  clear-inventory)    exec python -m scripts.clear_inventory ;;
  hide-quicket-event) exec python -m scripts.hide_quicket_event ;;

  *) exec "$@" ;;
esac
