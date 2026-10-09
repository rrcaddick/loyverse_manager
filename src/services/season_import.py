"""Clean, booking-driven import of a season: bookings first, then their mail.

The order matters and is the whole point (see the owner's brief, 2026-10-09):

1. Wipe the local workspace (bookings, mail, threads, reminders; bank matches
   are reset, bank rows and settings are kept).
2. Import the booking sheet from the season start, past visits included
   (marked completed).
3. Mirror the mailbox from two weeks before the earliest enquiry date.
4. Match every thread to a booking on strong evidence only: a booking
   reference, the contact's email, the mobile number (normalised), the exact
   group name, the exact contact name. The matched sender's address is learned
   onto the booking and propagated to that person's other threads.
5. For bookings still without a conversation, extend the mailbox window
   backwards in quarters until each finds one or the limit is reached.
6. Decide what is open: a thread is open only when its last activity is on or
   after ``open_from`` and the customer spoke last (or we never replied).
   Everything else is done, so the operator starts current.
7. Re-run bank matching and reminders, reset the document counter.
"""

from __future__ import annotations

import re
import shutil
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from config.settings import DATA_DIR, GMAIL_ADDRESS
from src.models import booking as booking_model
from src.models import email_message as em
from src.models import email_thread as thread_model
from src.models.base import execute, query, query_one
from src.services import conversations
from src.services.mail_ingest import extract_za_mobiles, find_references, sync_mailbox
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("season_import")

SCORE_REFERENCE = 100
SCORE_EMAIL = 90
SCORE_MOBILE = 80
SCORE_GROUP = 60
SCORE_FULL_NAME = 50
SCORE_SINGLE_NAME = 20
MATCH_THRESHOLD = 50
WINDOW_MARGIN_DAYS = 14
EXPAND_STEP_DAYS = 91
TEXT_PER_MESSAGE = 4000


@dataclass
class BookingKey:
    id: int
    reference: str
    doc_number: int | None
    group_name: str
    contact_name: str
    contact_email: str | None
    contact_mobile: str | None
    enquiry_date: date | None
    visit_date: date
    group_norm: str = field(init=False)
    name_norm: str = field(init=False)

    def __post_init__(self) -> None:
        self.group_norm = norm(self.group_name)
        self.name_norm = norm(self.contact_name)


def norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _contains_phrase(haystack_norm: str, phrase_norm: str) -> bool:
    return bool(phrase_norm) and f" {phrase_norm} " in f" {haystack_norm} "


# ----------------------------------------------------------------- wipe ----

def wipe_workspace() -> dict:
    """Local reset: everything derived from the previous import goes."""
    counts = {}
    for table in ("email_thread_notes", "email_threads", "email_attachments", "email_messages",
                  "mail_sync_state", "bounce_backs", "booking_reminders", "form_submissions"):
        counts[table] = execute(f"DELETE FROM {table}")
    counts["bank_matches_reset"] = execute(
        """
        UPDATE bank_transactions
        SET match_status = 'unmatched', matched_booking_id = NULL, matched_at = NULL,
            matched_by = NULL, match_method = NULL, suggestions = NULL
        WHERE match_status IN ('matched', 'suggested')
        """
    )
    counts["bookings"] = execute("DELETE FROM bookings")  # cascades payments, events, documents, questions
    for sub in ("documents", "attachments"):
        folder = DATA_DIR / sub
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True, exist_ok=True)
    logger.info(f"Workspace wiped: {counts}")
    return counts


# ------------------------------------------------------------- bookings ---

def import_bookings(sheet_file: Path, from_visit: date) -> dict:
    from scripts.import_sheet import build_plan, parse_sheet, read_csv, run_import

    today = get_today()
    bookings, notes = parse_sheet(read_csv(sheet_file))
    plan = build_plan(bookings, today, from_date=from_visit)
    max_doc = max((b.doc_number for b in bookings if b.doc_number is not None), default=None)
    summary = run_import(plan, today, max_doc)
    logger.info(
        f"Sheet import: {summary['created_count']} created, {len(summary['failed'])} failed, "
        f"{summary['skipped_count']} skipped"
    )
    return summary


def load_bookings() -> list[BookingKey]:
    rows = query(
        """
        SELECT id, reference, doc_number, group_name, contact_name, contact_email, contact_mobile,
               enquiry_date, visit_date
        FROM bookings ORDER BY visit_date, id
        """
    )
    return [BookingKey(
        id=r["id"], reference=r["reference"], doc_number=r["doc_number"], group_name=r["group_name"] or "",
        contact_name=r["contact_name"] or "", contact_email=(r["contact_email"] or "").lower() or None,
        contact_mobile=r["contact_mobile"], enquiry_date=r["enquiry_date"], visit_date=r["visit_date"],
    ) for r in rows]


def mail_window_start(bookings: list[BookingKey]) -> date:
    enquiries = [b.enquiry_date for b in bookings if b.enquiry_date]
    earliest = min(enquiries) if enquiries else get_today() - timedelta(days=120)
    start = earliest - timedelta(days=WINDOW_MARGIN_DAYS)
    return start.replace(day=1)


# ------------------------------------------------------------- matching ---

@dataclass
class ThreadFacts:
    thrid: int
    first_at: datetime | None
    last_at: datetime | None
    counterparts: Counter
    emails: set[str]
    mobiles: set[str]
    references: set[int]
    text_norm: str


def thread_facts(thrid: int, own: str) -> ThreadFacts:
    messages = thread_model.messages_for_thread(thrid)
    counterparts: Counter = Counter()
    emails: set[str] = set()
    mobiles: set[str] = set()
    references: set[int] = set()
    parts: list[str] = []
    first_at = last_at = None
    for m in messages:
        sent = m.get("sent_at")
        if sent:
            first_at = sent if first_at is None or sent < first_at else first_at
            last_at = sent if last_at is None or sent > last_at else last_at
        frm = (m.get("from_email") or "").lower()
        tos = m.get("to_emails") or []
        if isinstance(tos, str):
            try:
                import json
                tos = json.loads(tos)
            except ValueError:
                tos = []
        addresses = {frm} | {str(t).lower() for t in tos}
        for a in addresses:
            if a and a != own:
                emails.add(a)
                if m.get("direction") == "inbound" and a == frm:
                    counterparts[a] += 1
        body = (m.get("body_new_text") or m.get("body_text") or "")[:TEXT_PER_MESSAGE]
        subject = m.get("subject") or ""
        from_name = m.get("from_name") or ""
        # The address itself often spells the name: winefred.daniels16@… → "winefred daniels".
        local_parts = " ".join(re.sub(r"[^a-z]+", " ", a.split("@")[0]) for a in addresses if a and a != own)
        parts.extend([subject, from_name, local_parts, body])
        references.update(find_references(subject, body))
        mobiles |= extract_za_mobiles(f"{subject}\n{body}")
    return ThreadFacts(thrid, first_at, last_at, counterparts, emails, mobiles, references, norm("\n".join(parts)))


def score(facts: ThreadFacts, b: BookingKey) -> tuple[int, list[str]]:
    total, why = 0, []
    if b.doc_number is not None and b.doc_number in facts.references:
        total += SCORE_REFERENCE; why.append("reference")
    if b.contact_email and b.contact_email in facts.emails:
        total += SCORE_EMAIL; why.append("email")
    if b.contact_mobile and b.contact_mobile in facts.mobiles:
        total += SCORE_MOBILE; why.append("mobile")
    if len(b.group_norm) >= 4 and _contains_phrase(facts.text_norm, b.group_norm):
        total += SCORE_GROUP; why.append("group name")
    if b.name_norm:
        words = b.name_norm.split()
        if len(words) >= 2 and _contains_phrase(facts.text_norm, b.name_norm):
            total += SCORE_FULL_NAME; why.append("contact name")
        elif len(words) == 1 and len(words[0]) >= 6 and _contains_phrase(facts.text_norm, b.name_norm):
            total += SCORE_SINGLE_NAME; why.append("first name")
    return total, why


def _date_distance(facts: ThreadFacts, b: BookingKey) -> int:
    if facts.first_at is None:
        return 10_000
    anchor = b.enquiry_date or b.visit_date
    return abs((facts.first_at.date() - anchor).days)


def best_booking(facts: ThreadFacts, bookings: list[BookingKey]) -> tuple[BookingKey | None, int, list[str]]:
    ranked = []
    for b in bookings:
        s, why = score(facts, b)
        if s >= MATCH_THRESHOLD:
            ranked.append((s, -0, _date_distance(facts, b), b, why))
    if not ranked:
        return None, 0, []
    ranked.sort(key=lambda t: (-t[0], t[2], t[3].visit_date))
    s, _, _, b, why = ranked[0]
    return b, s, why


METHOD_CODES = {"reference": "ref", "email": "mail", "mobile": "mob", "group name": "grp", "contact name": "name", "first name": "first"}


def method_code(why: list[str]) -> str:
    """Compact match_method (the column holds 30 chars): 'season:ref+mob+grp'."""
    return ("season:" + "+".join(METHOD_CODES.get(w, w) for w in why))[:30]


def link(thrid: int, b: BookingKey, method: str, facts: ThreadFacts, learned: dict[str, set[int]]) -> None:
    em.link_thread(thrid, b.id, method)
    thread_model.set_booking(thrid, b.id)
    conversations.refresh_thread(thrid)
    # Learn the customer's address onto the booking when it has none.
    if facts.counterparts:
        address = facts.counterparts.most_common(1)[0][0]
        learned.setdefault(address, set()).add(b.id)
        if not b.contact_email:
            booking_model.update_fields(b.id, {"contact_email": address})
            b.contact_email = address
            execute(
                """
                INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
                VALUES (%s, 'updated', %s, %s, NULL)
                """,
                (b.id, f"Email address learned from the conversation: {address}",
                 '{"field": "contact_email", "source": "season_import"}'),
            )


def match_threads(bookings: list[BookingKey], learned: dict[str, set[int]]) -> dict:
    own = (GMAIL_ADDRESS or "").lower()
    stats = {"threads": 0, "matched": 0, "propagated": 0, "by_method": Counter()}
    unmatched: list[ThreadFacts] = []
    for row in query("SELECT gmail_thrid FROM email_threads WHERE booking_id IS NULL"):
        thrid = int(row["gmail_thrid"])
        facts = thread_facts(thrid, own)
        stats["threads"] += 1
        b, s, why = best_booking(facts, bookings)
        if b is None:
            unmatched.append(facts)
            continue
        link(thrid, b, method_code(why), facts, learned)
        stats["matched"] += 1
        stats["by_method"][why[0] if why else "?"] += 1
    # Propagation: a known person's other threads follow them.
    for facts in unmatched:
        candidates: set[int] = set()
        for address in facts.counterparts or facts.emails:
            candidates |= learned.get(address, set())
        if not candidates:
            continue
        by_id = {b.id: b for b in bookings}
        options = [by_id[c] for c in candidates if c in by_id]
        if not options:
            continue
        chosen = _booking_for_date(options, facts.last_at)
        link(facts.thrid, chosen, "season:contact", facts, learned)
        stats["propagated"] += 1
    stats["by_method"] = dict(stats["by_method"])
    return stats


def _booking_for_date(options: list[BookingKey], when: datetime | None) -> BookingKey:
    if when is None:
        return max(options, key=lambda b: b.visit_date)
    d = when.date()
    inside = [b for b in options
              if (b.enquiry_date or b.visit_date) - timedelta(days=WINDOW_MARGIN_DAYS) <= d <= b.visit_date + timedelta(days=7)]
    if inside:
        return min(inside, key=lambda b: b.visit_date)
    return min(options, key=lambda b: abs((b.visit_date - d).days))


def bookings_without_conversation(bookings: list[BookingKey]) -> list[BookingKey]:
    linked = {int(r["booking_id"]) for r in query("SELECT DISTINCT booking_id FROM email_threads WHERE booking_id IS NOT NULL")}
    return [b for b in bookings if b.id not in linked]


# ------------------------------------------------------------ open rule ---

def apply_open_rule(open_from: date) -> dict:
    rows = query("SELECT gmail_thrid, last_message_at, last_direction, last_outbound_at, has_automated_only FROM email_threads")
    counts = Counter()
    for r in rows:
        thrid = int(r["gmail_thrid"])
        last = r["last_message_at"]
        if r["has_automated_only"]:
            status = "done"; counts["automated"] += 1
        elif last is None or last.date() < open_from:
            status = "done"; counts["before_window"] += 1
        elif r["last_direction"] == "inbound" or r["last_outbound_at"] is None:
            status = "open"; counts["open"] += 1
        else:
            status = "done"; counts["answered"] += 1
        thread_model.set_status(thrid, status, None)
    execute("UPDATE email_messages SET review_status = 'none' WHERE review_status = 'pending'")
    return dict(counts)


# ------------------------------------------------------------------ run ---

def run(sheet_file: Path, from_visit: date, open_from: date, max_expand_months: int = 24) -> dict:
    report: dict[str, Any] = {"started_at": datetime.now().replace(microsecond=0).isoformat()}
    report["wipe"] = wipe_workspace()
    report["sheet"] = {k: v for k, v in import_bookings(sheet_file, from_visit).items() if k in ("created_count", "skipped_count")}

    bookings = load_bookings()
    report["bookings"] = {"total": len(bookings), "by_status": {r["status"]: r["n"] for r in query("SELECT status, COUNT(*) n FROM bookings GROUP BY status")}}

    start = mail_window_start(bookings)
    report["mail_window_start"] = start.isoformat()
    sync = sync_mailbox(full=True, since=start)
    report["mail_sync"] = {"fetched": sync["fetched"], "inserted": sync["inserted"], "errors": sync["errors"]}

    learned: dict[str, set[int]] = {}
    for b in bookings:
        if b.contact_email:
            learned.setdefault(b.contact_email, set()).add(b.id)
    report["match"] = match_threads(bookings, learned)

    # Expansion for bookings that still have no conversation.
    limit = start - timedelta(days=30 * max_expand_months)
    expansions = []
    missing = bookings_without_conversation(bookings)
    while missing and start > limit:
        new_start = max(limit, start - timedelta(days=EXPAND_STEP_DAYS))
        slice_sync = sync_mailbox(full=True, since=new_start, before=start)
        fetched = slice_sync["fetched"]
        stats = match_threads(bookings, learned) if fetched else {"matched": 0, "propagated": 0}
        missing_after = bookings_without_conversation(bookings)
        expansions.append({"from": new_start.isoformat(), "to": start.isoformat(), "fetched": fetched,
                           "matched": stats["matched"], "propagated": stats["propagated"],
                           "still_missing": len(missing_after)})
        logger.info(f"Expansion {new_start}..{start}: fetched {fetched}, missing now {len(missing_after)}")
        start = new_start
        if fetched == 0 and new_start <= limit:
            break
        missing = missing_after
    report["expansions"] = expansions
    report["bookings_without_conversation"] = [f"{b.reference} {b.group_name}" for b in bookings_without_conversation(bookings)]
    report["emails_learned"] = query_one("SELECT COUNT(*) n FROM bookings WHERE contact_email IS NOT NULL")["n"]

    report["open_rule"] = apply_open_rule(open_from)
    report["conversation_counts"] = thread_model.counts()

    from src.services.settings import bump_document_number_past
    mx = query_one("SELECT MAX(doc_number) m FROM bookings")["m"]
    if mx:
        bump_document_number_past(int(mx))
    try:
        from src.services.bank import poll_transactions
        poll = poll_transactions()
        report["bank"] = poll.get("matching", poll)
    except Exception as exc:  # noqa: BLE001
        report["bank"] = {"error": str(exc)}
    from src.services.reminders import recompute_reminders
    report["reminders"] = recompute_reminders()
    report["finished_at"] = datetime.now().replace(microsecond=0).isoformat()
    return report
