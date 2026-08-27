#!/bin/bash
# Manual one-off run of the Quicket event-hiding bot.
set -euo pipefail
cd "$(dirname "$0")/.."
exec docker compose run --rm scheduler hide-quicket-event
