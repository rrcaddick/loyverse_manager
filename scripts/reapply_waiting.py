#!/usr/bin/env python3
"""Re-run the automated filter over stored mail and report the party counts.

    python -m scripts.reapply_waiting --dry-run   # show what would be marked, print the counts
    python -m scripts.reapply_waiting             # mark is_auto_generated, refresh threads, print counts

Nothing is deleted. Stored rows keep no headers, so layer 1 can only fire on
a bulk-provider sender domain here; layers 2–3 and the learned ignored-sender
list apply in full (src/services/mail_ingest.automated_layer). The counts at
the end are the per-person "waiting on us" numbers (src/services/waiting.py)
next to the old per-thread Needs-reply count, for comparison.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from src.models import email_message as em
from src.models import email_thread as et
from src.models import ignored_sender
from src.models.base import query_one
from src.services import conversations, waiting, work
from src.services.mail_ingest import LAYER_NAMES, automated_layer
from src.utils.date import get_today


def reclassify(dry_run: bool) -> dict:
    rules = ignored_sender.list_all()
    stats: dict = {"scanned": 0, "marked": 0, "by_layer": {}, "examples": []}
    to_mark: list[int] = []
    thrids: set[int] = set()
    for row in em.inbound_for_reclassify():
        stats["scanned"] += 1
        layer = automated_layer({}, row.get("from_email"), row.get("subject"))
        rule = None if layer else ignored_sender.matches(row.get("from_email"), rules)
        if layer is None and rule is None:
            continue
        if layer is not None:
            name, reason = LAYER_NAMES[layer[0]], layer[1]
        else:
            name = "ignored"
            reason = f"ignored sender {rule['pattern']}"
        stats["by_layer"][name] = stats["by_layer"].get(name, 0) + 1
        stats["examples"].append(
            {
                "id": int(row["id"]), "from": row.get("from_email"), "subject": (row.get("subject") or "")[:70],
                "booking_id": row.get("booking_id"), "layer": name, "reason": reason,
            }
        )
        to_mark.append(int(row["id"]))
        if row.get("gmail_thrid"):
            thrids.add(int(row["gmail_thrid"]))
    stats["marked"] = len(to_mark)
    if not dry_run and to_mark:
        em.set_auto_generated(to_mark, True)
        for thrid in sorted(thrids):
            conversations.refresh_thread(thrid)
    stats["threads_refreshed"] = 0 if dry_run else len(thrids)
    return stats


def party_counts() -> dict:
    snap = waiting.build_snapshot()
    parties = waiting.waiting_parties(snap=snap)
    old = query_one(f"SELECT COUNT(*) AS n FROM email_threads t WHERE {et._VIEW_WHERE['needs_reply']}")
    return {
        "needs_reply_parties": len(parties),
        "booking_parties": sum(1 for p in parties if p["booking"]),
        "address_parties": sum(1 for p in parties if not p["booking"]),
        "unanswered_messages": sum(int(p["unanswered_count"]) for p in parties),
        "old_needs_reply_threads": int((old or {}).get("n") or 0),
        "work_reply_rows": len(work._reply_rows(get_today(), parties)),
        "threads": len(snap.threads),
        "parties_total": len(snap.party_threads),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="report only; mark nothing")
    parser.add_argument("--quiet", action="store_true", help="skip the per-message list")
    args = parser.parse_args(argv)

    started = time.monotonic()
    stats = reclassify(dry_run=args.dry_run)
    verb = "would mark" if args.dry_run else "marked"
    print(f"reclassify: scanned {stats['scanned']} inbound rows, {verb} {stats['marked']} automated {stats['by_layer']}")
    if not args.quiet:
        for ex in stats["examples"]:
            print(f"  {ex['id']:>6} [{ex['layer']}] {ex['from']}  |  {ex['subject']}  ({ex['reason']})"
                  + (f"  booking {ex['booking_id']}" if ex["booking_id"] else ""))
    counts = party_counts()
    print(
        f"waiting: {counts['needs_reply_parties']} parties "
        f"({counts['booking_parties']} bookings, {counts['address_parties']} addresses), "
        f"{counts['unanswered_messages']} unanswered messages; "
        f"old per-thread needs_reply = {counts['old_needs_reply_threads']}; "
        f"Work reply rows = {counts['work_reply_rows']}"
    )
    print(json.dumps({"reclassify": {k: v for k, v in stats.items() if k != "examples"}, "counts": counts,
                      "dry_run": args.dry_run, "duration_s": round(time.monotonic() - started, 2)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
