#!/usr/bin/env python3
"""Season migration: bookings from the sheet, then each booking's own mail.

Dry run by default: finds and scores every booking's conversations with
server-side Gmail searches, writes a report under data/migration/, changes
nothing. ``--apply`` stores the chosen conversations and links them.

    python -m scripts.migrate_season --limit 10 --upcoming           # report only
    python -m scripts.migrate_season --booking FY1719                # one booking
    python -m scripts.migrate_season --apply --with-enquiries        # the real run

Options: --sheet PATH (default data/import/fy-bookings-2026-27.csv),
--from-visit YYYY-MM-DD (default 2026-09-01), --enquiries-from YYYY-MM-DD
(default 2026-06-01), --limit N, --upcoming (visit on/after today), --booking
REF, --with-enquiries, --apply, --wipe (with --apply: clear bookings, mail and
reminders first; bank rows and settings stay), --no-bank.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime
from pathlib import Path

from config.settings import BASE_DIR


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sheet", type=Path, default=BASE_DIR / "data" / "import" / "fy-bookings-2026-27.csv")
    parser.add_argument("--from-visit", type=date.fromisoformat, default=date(2026, 9, 1))
    parser.add_argument("--enquiries-from", type=date.fromisoformat, default=date(2026, 6, 1))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--upcoming", action="store_true", help="only visits on or after today")
    parser.add_argument("--booking", help="one booking by reference (FY1719) or sheet group name")
    parser.add_argument("--with-enquiries", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--wipe", action="store_true")
    parser.add_argument("--no-bank", action="store_true")
    args = parser.parse_args(argv)

    from src.clients.gmail import GmailImap
    from src.services import migration
    from src.utils.date import get_today

    started = datetime.now()
    today = get_today()
    rows = migration.load_sheet_bookings(args.sheet, args.from_visit)
    if args.upcoming:
        rows = [r for r in rows if r["visit_date"] >= today]
    if args.booking:
        key = args.booking.strip().lower()
        rows = [r for r in rows if (r.get("reference") or "").lower() == key or r["group_name"].lower() == key]
    if args.limit:
        rows = rows[: args.limit]
    if not rows:
        print("No bookings selected")
        return 1

    if args.apply and args.wipe:
        from src.services.season_import import wipe_workspace

        print("Wiping the workspace:", wipe_workspace())
    if args.apply:
        from src.services.season_import import import_bookings

        print("Importing the sheet:", {k: v for k, v in import_bookings(args.sheet, args.from_visit).items() if k != "failed"})
    migration.attach_db_ids(rows)

    plans = []
    own = migration.own_addresses()
    with GmailImap() as imap:
        for i, row in enumerate(rows, 1):
            plan = migration.plan_booking(imap, row, own, include_bank=not args.no_bank)
            plans.append(plan)
            status = f"{len(plan.chosen)} conversation(s)" if plan.chosen else "nothing"
            print(f"[{i}/{len(rows)}] {row.get('reference') or '-':8} {row['group_name'][:40]:40} -> {status}  ({plan.cluster_note})", flush=True)
            if args.apply and plan.chosen and plan.booking.id:
                print("    stored:", migration.apply_plan(plan))
        enquiries = None
        if args.with_enquiries:
            known = {t for p in plans for t in p.chosen}
            try:
                from src.models.base import query

                known |= {int(r["gmail_thrid"]) for r in query("SELECT gmail_thrid FROM email_threads WHERE booking_id IS NOT NULL")}
            except Exception:  # noqa: BLE001
                pass
            enquiries = migration.plan_enquiries(imap, args.enquiries_from, known, own)
            print(f"Enquiries waiting on us: {len(enquiries)}")
            if args.apply:
                from src.services import enquiries as enquiry_service
                from src.services.migration import apply_plan  # noqa: F401 - same session

                for tp in enquiries:
                    plan = migration.BookingPlan(booking=migration.mt.BookingFacts(None, None, None, "", ""), sheet_row=None)
                    plan.threads[tp.facts.thrid] = tp
                    # Store the conversation, then wrap the newest inbound message as the enquiry.
                    from src.models import email_message as em
                    from src.services.conversations import refresh_thread
                    from src.services.mail_ingest import build_row, store_attachments

                    newest_id = None
                    for fm in tp.messages:
                        item = {"uid": fm.uid, "gmail_msgid": fm.gmail_msgid, "gmail_thrid": fm.gmail_thrid, "internaldate": fm.internaldate, "raw": fm.raw}
                        r = build_row(item, fm.parsed, migration.ALL_MAIL)
                        r["direction"] = fm.direction
                        mid, outcome, _ = em.upsert_by_gmail_msgid(r)
                        if outcome == "inserted" and fm.parsed.attachments and not em.list_attachments(mid):
                            store_attachments(mid, fm.gmail_msgid or mid, fm.parsed)
                        if fm.direction == "inbound":
                            newest_id = mid
                    refresh_thread(tp.facts.thrid)
                    if newest_id:
                        enquiry_service.create_from_message(em.get(newest_id))

    if args.apply:
        try:
            from src.services import bank, reminders

            print("Bank:", {k: v for k, v in bank.match_new().items()})
            print("Reminders:", reminders.recompute_all() if hasattr(reminders, "recompute_all") else "skipped")
        except Exception as exc:  # noqa: BLE001
            print("Bank/reminders step failed:", exc)

    text = migration.render_report(plans, enquiries, started=started, dry_run=not args.apply)
    data = {"started": started.isoformat(), "dry_run": not args.apply, "bookings": [migration.plan_to_dict(p) for p in plans],
            "enquiries": [{"thrid": str(t.facts.thrid), "subject": t.subject, "participants": sorted(t.facts.participants), "why": t.why} for t in (enquiries or [])]}
    md, js = migration.write_report(text, data, started)
    print(f"\nReport: {md}\n        {js}")
    print(f"{sum(1 for p in plans if p.found)} of {len(plans)} bookings found their conversation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
