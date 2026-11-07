#!/usr/bin/env python3
"""Long-running inbox watcher: IMAP IDLE on INBOX, a sync on every change,
the periodic sweep, and a safety poll in case a notice is missed.

    python -m scripts.inbound_worker        # runs until stopped

Env: INBOUND_IDLE_SECONDS (default 1500, the 29-minute protocol limit),
INBOUND_POLL_SECONDS (default 300), the sweep interval comes from Settings.
"""

from __future__ import annotations

import os
import sys
import time
import traceback
from datetime import datetime, timedelta


def main() -> int:
    from src.clients.gmail import INBOX, GmailImap, GmailTransientError
    from src.services import inbound
    from src.services.mail_ingest import sync_mailbox

    idle_seconds = int(os.getenv("INBOUND_IDLE_SECONDS", "1500"))
    poll_seconds = int(os.getenv("INBOUND_POLL_SECONDS", "300"))
    last_sync = datetime.min
    last_sweep = datetime.min
    print("inbound_worker: starting", flush=True)
    while True:
        try:
            with GmailImap() as imap:
                imap.select(INBOX, readonly=True)
                while True:
                    sweep_every = timedelta(hours=float(inbound._cfg().get("sweep_interval_hours", 24)))
                    now = datetime.now()
                    if now - last_sync >= timedelta(seconds=poll_seconds):
                        sync_mailbox(full=False)
                        last_sync = datetime.now()
                    if now - last_sweep >= sweep_every:
                        inbound.sweep()
                        last_sweep = datetime.now()
                    else:
                        inbound.apply_labels()
                    changed = imap.idle_wait(timeout=min(idle_seconds, poll_seconds))
                    if changed:
                        sync_mailbox(full=False)
                        last_sync = datetime.now()
                        inbound.apply_labels()
        except GmailTransientError as exc:
            print(f"inbound_worker: transient: {exc}; reconnecting in 30 s", flush=True)
            time.sleep(30)
        except KeyboardInterrupt:
            return 0
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            time.sleep(60)


if __name__ == "__main__":
    sys.exit(main())
