#!/bin/bash
# Manual one-off run of the morning sync.
# The scheduler container normally does this on its own cron; this wrapper is
# for running it by hand from the host.
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose run --rm scheduler add-inventory
