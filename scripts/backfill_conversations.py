#!/usr/bin/env python3
"""Backfill the conversation layer over existing mail.

    python -m scripts.backfill_conversations            # split unsplit messages, rebuild email_threads
    python -m scripts.backfill_conversations --force    # re-split every message (new splitter version)
    python -m scripts.backfill_conversations --threads-only

Idempotent: a message is split again only when its ``split_version`` is older
than ``quote_split.SPLIT_VERSION`` (or ``--force``); thread rows are derived
from ``email_messages`` and keep their operator state (status, done, not a
booking). Nothing here talks to Gmail or sends anything.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

from src.models import email_message as em
from src.models import email_thread as et
from src.services import conversations
from src.services.mail_ingest import make_snippet, split_body
from src.services.quote_split import SPLIT_VERSION


def split_messages(force: bool = False, batch: int = 200) -> dict:
    version = 10_000 if force else SPLIT_VERSION
    stats = {"split": 0, "with_quote": 0, "with_signature": 0, "errors": 0}
    last_id = 0
    while True:
        rows = em.unsplit_rows(version, limit=batch, after_id=last_id)
        if not rows:
            break
        for row in rows:
            last_id = max(last_id, int(row["id"]))
            try:
                own_template = row.get("direction") == "outbound" and bool(row.get("kind"))
                result = split_body(row.get("body_html"), row.get("body_text"), own_template=own_template)
                em.update_split(row["id"], result)
                snippet = make_snippet(result.get("new_text") or "")
                if snippet and snippet != (row.get("snippet") or ""):
                    em.update(row["id"], snippet=snippet)
                stats["split"] += 1
                stats["with_quote"] += int(bool(result.get("quoted_html")))
                stats["with_signature"] += int(bool(result.get("signature_text")))
            except Exception as exc:  # noqa: BLE001 - keep going, report at the end
                stats["errors"] += 1
                print(f"message {row['id']}: {exc}", file=sys.stderr)
                # Mark it so the loop terminates; the row keeps its bodies as "all new".
                em.update(row["id"], split_version=SPLIT_VERSION)
    return stats


def rebuild_threads() -> dict:
    thrids = et.all_thrids()
    stats = {"threads": 0, "removed": 0}
    for thrid in thrids:
        if conversations.refresh_thread(thrid):
            stats["threads"] += 1
    # Thread rows whose messages are all gone.
    orphans = em.query(
        """
        SELECT t.gmail_thrid FROM email_threads t
        WHERE NOT EXISTS (SELECT 1 FROM email_messages m WHERE m.gmail_thrid = t.gmail_thrid)
        """
    )
    for row in orphans:
        et.delete(int(row["gmail_thrid"]))
        stats["removed"] += 1
    return stats


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="re-split every message, whatever its split_version")
    parser.add_argument("--threads-only", action="store_true", help="skip the split pass; rebuild email_threads only")
    parser.add_argument("--batch", type=int, default=200)
    args = parser.parse_args(argv)

    started = time.monotonic()
    summary: dict = {"split_version": SPLIT_VERSION}
    if not args.threads_only:
        summary["messages"] = split_messages(force=args.force, batch=args.batch)
        print(f"split: {summary['messages']}")
    summary["threads"] = rebuild_threads()
    print(f"threads: {summary['threads']}")
    summary["counts"] = conversations.counts()
    summary["duration_s"] = round(time.monotonic() - started, 2)
    print(json.dumps(summary, default=str))
    return 0 if not summary.get("messages", {}).get("errors") else 1


if __name__ == "__main__":
    sys.exit(main())
