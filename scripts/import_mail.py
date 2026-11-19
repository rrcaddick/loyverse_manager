#!/usr/bin/env python3
"""One-off helpdesk import: full mailbox sync, then link each current booking
to its most recent thread, then flag recent unmatched mail for review.

    python -m scripts.import_mail                      # since GMAIL_IMPORT_SINCE
    python -m scripts.import_mail --since 2026-08-01 --review-days 14
    python -m scripts.import_mail --dry-run            # sync, then only print the link plan
    python -m scripts.import_mail --skip-sync          # linking pass only

Idempotent: re-running re-links the same threads and never duplicates rows.
Run it after the sheet import so the bookings exist. Writes an import_runs row
(kind "mail").
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import date

from src.models import email_message as em
from src.services import conversations
from src.services.mail_ingest import link_current_threads, sync_mailbox


def _date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("use YYYY-MM-DD")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", type=_date, default=None, help="oldest mail to import (default GMAIL_IMPORT_SINCE)")
    parser.add_argument("--review-days", type=int, default=14, help="flag unmatched inbound mail newer than today - N days")
    parser.add_argument("--dry-run", action="store_true", help="sync, but only print the linking plan")
    parser.add_argument("--skip-sync", action="store_true", help="do not talk to Gmail, only run the linking pass")
    args = parser.parse_args(argv)

    run_id = None if args.dry_run else em.start_import_run("mail")
    summary: dict = {"since": args.since.isoformat() if args.since else None, "review_days": args.review_days,
                     "dry_run": args.dry_run}
    try:
        if not args.skip_sync:
            summary["sync"] = sync_mailbox(full=True, since=args.since)
            print(f"sync: fetched={summary['sync']['fetched']} inserted={summary['sync']['inserted']} "
                  f"matched={summary['sync']['matched']} errors={len(summary['sync']['errors'])}")
        linking = link_current_threads(review_days=args.review_days, dry_run=args.dry_run)
        summary["linking"] = {k: v for k, v in linking.items() if k != "plan"}
        summary["linking"]["plan_size"] = len(linking["plan"])
        print(f"linking: bookings={linking['bookings_considered']} messages={linking['messages_considered']} "
              f"threads_linked={linking['threads_linked']} messages_linked={linking['messages_linked']} "
              f"pending_flagged={linking['pending_flagged']}")
        for entry in linking["plan"]:
            print(f"  {entry['reference']:<10} {entry['group_name'][:40]:<40} thread={entry['gmail_thrid']} "
                  f"msgs={entry['messages']} via={','.join(entry['reasons'])} latest={entry['latest']}")
        summary["counts"] = em.counts()
        summary["conversations"] = conversations.counts()
        print(f"conversations: {summary['conversations']}")
        status = "done" if not summary.get("sync", {}).get("errors") else "done_with_errors"
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        summary["error"] = str(exc)
        status = "failed"
    if run_id is not None:
        em.finish_import_run(run_id, summary, status)
    print(json.dumps({k: v for k, v in summary.items() if k != "sync"}, default=str))
    return 0 if status != "failed" else 1


if __name__ == "__main__":
    sys.exit(main())
