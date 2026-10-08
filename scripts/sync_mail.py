#!/usr/bin/env python3
"""Incremental mailbox sync, meant for cron every minute.

    * * * * *  cd /app && python -m scripts.sync_mail >> logs/sync_mail.log 2>&1

A lock file under DATA_DIR/locks stops overlapping runs (the second run exits 0
without doing anything). Exit code 0 on success, 1 when the sync reported
errors, 2 on an unexpected crash.
"""

from __future__ import annotations

import fcntl
import json
import sys
import traceback

from config.settings import DATA_DIR

LOCK_PATH = DATA_DIR / "locks" / "sync_mail.lock"


def main() -> int:
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOCK_PATH, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("sync_mail: another run is still in progress, skipping")
            return 0
        try:
            from src.services.mail_ingest import sync_mailbox

            summary = sync_mailbox(full=False)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return 2
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    compact = {k: v for k, v in summary.items() if k != "folders"}
    compact["folders"] = {
        f: {k: s[k] for k in ("mode", "fetched", "inserted", "matched", "pending", "errors", "last_uid") if k in s}
        for f, s in summary.get("folders", {}).items()
    }
    print(json.dumps(compact, default=str))
    return 0 if summary.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
