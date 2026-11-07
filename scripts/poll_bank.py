#!/usr/bin/env python3
"""Poll FNB for new transactions and match credits to bookings. Cron every 5 min:

    */5 * * * *  cd /app && python -m scripts.poll_bank

A lock file under DATA_DIR/locks stops overlapping runs. One poll is one token
call plus one history call per page; the window rotates so the gateway's result
cache is never reused (src/services/bank.py).

Exit codes: 0 polled (summary JSON on stdout), 1 the poll failed (recorded in
bank_poll_log), 2 FNB is not configured, 3 another poll still holds the lock.
"""

from __future__ import annotations

import fcntl
import json
import sys
import traceback

from config.settings import DATA_DIR, FNB_ACCOUNT_NUMBER, FNB_CLIENT_ID, FNB_CLIENT_SECRET

LOCK_PATH = DATA_DIR / "locks" / "poll_bank.lock"

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_NOT_CONFIGURED = 2
EXIT_LOCKED = 3


def main() -> int:
    if not (FNB_CLIENT_ID and FNB_CLIENT_SECRET and FNB_ACCOUNT_NUMBER):
        print("poll_bank: FNB_CLIENT_ID, FNB_CLIENT_SECRET and FNB_ACCOUNT_NUMBER must be set", file=sys.stderr)
        return EXIT_NOT_CONFIGURED

    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_PATH, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("poll_bank: another poll is still running, skipping")
            return EXIT_LOCKED
        try:
            from src.services.bank import BankPollError, poll_transactions

            try:
                result = poll_transactions()
            except BankPollError as exc:
                print(f"poll_bank: failed: {exc}", file=sys.stderr)
                return EXIT_FAILED
        except Exception:  # noqa: BLE001 - anything unexpected is still a failure
            traceback.print_exc()
            return EXIT_FAILED
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)

    print(json.dumps(result, default=str))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
