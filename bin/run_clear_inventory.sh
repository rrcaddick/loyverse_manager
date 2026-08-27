#!/bin/bash
# Manual one-off run of the end-of-day teardown. See run_add_inventory.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose run --rm scheduler clear-inventory
