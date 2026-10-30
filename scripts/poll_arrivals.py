#!/usr/bin/env python3
"""Record the day's arrivals from Loyverse for every booking visiting today.
Cron every two minutes through opening hours (the worker container):

    */2 7-19 * * *  cd /app && python -m scripts.poll_arrivals

Arrivals are real time as the gate sells against the vehicle ticket; this is
the pull that keeps the bookings in step (src/services/arrivals.poll_arrivals).
A lock file under DATA_DIR/locks stops overlapping runs. With no booking
visiting today the run is a no-op and Loyverse is not called.

Exit codes: 0 polled (summary JSON on stdout), 1 Loyverse failed, 2 Loyverse is
not configured, 3 another poll still holds the lock.
"""

from __future__ import annotations

import fcntl
import json
import sys

from config.settings import DATA_DIR, LOYVERSE_API_KEY

LOCK_PATH = DATA_DIR / "locks" / "poll_arrivals.lock"

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_NOT_CONFIGURED = 2
EXIT_LOCKED = 3


def main() -> int:
    if not LOYVERSE_API_KEY:
        print("poll_arrivals: LOYVERSE_API_KEY must be set", file=sys.stderr)
        return EXIT_NOT_CONFIGURED
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_PATH, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("poll_arrivals: another poll is still running", file=sys.stderr)
            return EXIT_LOCKED
        from src.services.arrivals import ArrivalsError, poll_arrivals

        try:
            summary = poll_arrivals()
        except ArrivalsError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}))
            return EXIT_FAILED
        print(json.dumps(summary, default=str))
        return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
