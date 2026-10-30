"""One-off season migration: bookings first, then each booking's own mail.

This is the owner's method (docs/handoff/migration-and-inbound.md §1), and
it is deliberately not how the live app works:

1. Read the booking sheet from the season start and normalise it.
2. For every booking, ask Gmail (server-side search, All Mail) for its mail
   in order of certainty: the FY/INV reference (subject, body, attachment
   name), the contact's address, the mobile in every written form, the
   distinctive words of the group name, the contact's surname. Every hit is
   fetched as a whole conversation and scored (``src/services/matching.py``).
3. Addresses on the attached conversations are searched once more (one hop:
   the people cc'd on a booking are its contacts too).
4. Conversations are clustered by date; the newest cluster is the booking's
   season, older clusters are previous visits, and nothing before the hard
   floor is attached unless the cluster straddles it.
5. The chosen conversations are stored whole (sent mail included), linked to
   the booking, and their people recorded as the booking's contacts.
6. Bank credits are matched by reference (and group name with a plausible
   amount) from the transactions already polled.
7. Enquiries: inbox mail since ``enquiries_from`` that belongs to no booking,
   where the customer wrote last or was never answered, minus automated mail.

``plan_*`` functions only read; ``apply_plan`` writes. The CLI is
``scripts/migrate_season.py``; its default is a dry run that writes a report.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from config.settings import DATA_DIR, GMAIL_ADDRESS
from src.clients.gmail import ALL_MAIL, INBOX, GmailImap
from src.services import matching as mt
from src.services.mail_ingest import ParsedMessage, parse_message, split_body, to_sast_naive
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("migration")

MAX_HITS_PER_QUERY = 400  # a surname like Smith: skip the query, say so
MAX_THREADS_PER_BOOKING = 40
MAX_EXPAND_ADDRESSES = 6
TEXT_PER_MESSAGE = 4000
DEFAULT_FROM_VISIT = date(2026, 9, 1)
DEFAULT_ENQUIRIES_FROM = date(2026, 6, 1)
REPORT_DIR = DATA_DIR / "migration"


def own_addresses() -> set[str]:
    out = {(GMAIL_ADDRESS or "").lower()}
    out.discard("")
    return out


def is_own(address: str | None, own: set[str]) -> bool:
    return mt.is_park_address(address, own)


# ------------------------------------------------------------- shapes ---


@dataclass
class FetchedMessage:
    uid: int
    gmail_msgid: int | None
    gmail_thrid: int | None
    internaldate: Any
    raw: bytes
    parsed: ParsedMessage
    direction: str
    sent_at: datetime | None


@dataclass
class ThreadPlan:
    facts: mt.ThreadFacts
    messages: list[FetchedMessage]
    found_by: set[str] = field(default_factory=set)
    score: int = 0
    why: list[str] = field(default_factory=list)
    verdict: str = "no"

    @property
    def subject(self) -> str:
        return next(iter(sorted(self.facts.subjects, key=len)), "") if self.facts.subjects else ""


@dataclass
class BookingPlan:
    booking: mt.BookingFacts
    sheet_row: dict | None
    queries: list[dict] = field(default_factory=list)
    threads: dict[int, ThreadPlan] = field(default_factory=dict)
    chosen: list[int] = field(default_factory=list)
    review: list[int] = field(default_factory=list)
    rejected_old: list[int] = field(default_factory=list)
    learned_emails: set[str] = field(default_factory=set)
    cluster_note: str = ""
    bank: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def found(self) -> bool:
        return bool(self.chosen)


# ------------------------------------------------------------ bookings ---


def load_sheet_bookings(sheet_file: Path, from_visit: date) -> list[dict]:
    """Normalised sheet rows (visit on/after ``from_visit``) as booking-like dicts."""
    from scripts.import_sheet import parse_sheet, read_csv

    bookings, _notes = parse_sheet(read_csv(sheet_file))
    out: list[dict] = []
    for b in bookings:
        if b.visit_date is None or b.visit_date < from_visit:
            continue
        out.append(
            {
                "id": None,
                "reference": f"FY{b.doc_number}" if b.doc_number else None,
                "doc_number": b.doc_number,
                "group_name": re.sub(r"\s+", " ", b.group_name or "").strip(),
                "contact_name": re.sub(r"\s+", " ", (b.contact_name or "")).strip().title(),
                "contact_email": None,
                "contact_mobile": b.contact_mobile,
                "visit_date": b.visit_date,
                "enquiry_date": b.enquiry_date,
                "people_booked": b.people_booked,
                "deposit": b.deposit,
                "price_per_person": b.price_per_person,
                "sheet_row": b.row_number,
                "status": b.status,
            }
        )
    out.sort(key=lambda r: (r["visit_date"], r["sheet_row"]))
    return out


def attach_db_ids(rows: list[dict]) -> None:
    """When the sheet was already imported, carry the booking ids and any
    learned addresses across so the plan can report and write against them."""
    try:
        from src.models.base import query
    except Exception:  # noqa: BLE001
        return
    try:
        existing = query("SELECT id, doc_number, group_name, visit_date, contact_email FROM bookings")
    except Exception:  # noqa: BLE001
        return
    by_doc = {int(r["doc_number"]): r for r in existing if r.get("doc_number")}
    by_key = {((r["group_name"] or "").lower(), r["visit_date"]): r for r in existing}
    for row in rows:
        hit = by_doc.get(int(row["doc_number"])) if row.get("doc_number") else None
        hit = hit or by_key.get((row["group_name"].lower(), row["visit_date"]))
        if hit:
            row["id"] = int(hit["id"])
            if hit.get("contact_email") and not row.get("contact_email"):
                row["contact_email"] = str(hit["contact_email"]).lower()


# ----------------------------------------------------------- fetching ---


def _sast(dt: Any) -> datetime | None:
    try:
        return to_sast_naive(dt) if dt else None
    except Exception:  # noqa: BLE001
        return None


def fetch_thread(imap: GmailImap, thrid: int, own: set[str]) -> ThreadPlan | None:
    """Fetch one whole conversation from All Mail and digest it."""
    uids = imap.search_thread(thrid)
    if not uids:
        return None
    facts = mt.ThreadFacts(thrid=int(thrid))
    messages: list[FetchedMessage] = []
    texts: list[str] = []
    for item in imap.fetch(uids):
        try:
            parsed = parse_message(item["raw"], item.get("internaldate"))
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"thread {thrid} uid {item['uid']}: unparseable: {exc}")
            continue
        direction = "outbound" if is_own(parsed.from_email, own) else "inbound"
        sent_at = parsed.date or _sast(item.get("internaldate"))
        messages.append(
            FetchedMessage(
                uid=int(item["uid"]), gmail_msgid=item.get("gmail_msgid"), gmail_thrid=item.get("gmail_thrid"),
                internaldate=item.get("internaldate"), raw=item["raw"], parsed=parsed, direction=direction,
                sent_at=sent_at,
            )
        )
        for a in parsed.participant_emails:
            if not is_own(a, own):
                facts.participants.add(a)
        if direction == "inbound" and parsed.from_email and not is_own(parsed.from_email, own):
            facts.senders.add(parsed.from_email.lower())
        if direction == "inbound" and parsed.from_name:
            facts.from_names.add(parsed.from_name)
        if parsed.subject:
            facts.subjects.add(re.sub(r"^\s*((re|fw|fwd|aw|wg)\s*:\s*)+", "", parsed.subject, flags=re.I).strip())
        try:
            new_text = split_body(parsed.html, parsed.text)["new_text"] or parsed.text
        except Exception:  # noqa: BLE001
            new_text = parsed.text
        texts.append((new_text or "")[:TEXT_PER_MESSAGE])
        for att in parsed.attachments:
            facts.filenames.add(att.filename)
        for skipped in parsed.skipped_attachments:
            if skipped.get("filename"):
                facts.filenames.add(str(skipped["filename"]))
        facts.message_count += 1
        if direction == "inbound":
            facts.inbound_count += 1
        else:
            facts.outbound_count += 1
        if sent_at:
            facts.first_at = min(facts.first_at, sent_at) if facts.first_at else sent_at
            if not facts.last_at or sent_at > facts.last_at:
                facts.last_at = sent_at
                facts.last_direction = direction
    facts.text = "\n".join(texts)
    messages.sort(key=lambda m: (m.sent_at or datetime.min, m.uid))
    return ThreadPlan(facts=facts, messages=messages)


def _run_query(imap: GmailImap, kind: str, query: str, plan: BookingPlan) -> list[dict]:
    """Run one Gmail search and return header metadata; records the query."""
    entry = {"kind": kind, "query": query, "hits": 0, "threads": 0, "note": None}
    plan.queries.append(entry)
    try:
        uids = imap.search_gmail(query)
    except Exception as exc:  # noqa: BLE001
        entry["note"] = f"search failed: {exc}"
        return []
    entry["hits"] = len(uids)
    if not uids:
        return []
    if len(uids) > MAX_HITS_PER_QUERY:
        entry["note"] = f"too broad ({len(uids)} hits), skipped"
        return []
    metas = list(imap.fetch_meta(uids))
    entry["threads"] = len({m.get("gmail_thrid") for m in metas if m.get("gmail_thrid")})
    return metas


# ----------------------------------------------------------- planning ---


def plan_booking(
    imap: GmailImap,
    row: dict,
    own: set[str] | None = None,
    *,
    floor: date = mt.HARD_FLOOR,
    include_bank: bool = True,
    others: list[dict] | None = None,
) -> BookingPlan:
    """Find, fetch and score the conversations of one booking. Read-only.

    ``others`` are the rest of the season's bookings: a conversation that
    fits one of them better (a shared contact's other visit) is not attached
    here but reported for that booking."""
    own = own if own is not None else own_addresses()
    bf = mt.BookingFacts.from_row(row)
    plan = BookingPlan(booking=bf, sheet_row=row)
    imap.select(ALL_MAIL, readonly=True)

    candidates: dict[int, set[str]] = {}
    newest: dict[int, datetime] = {}

    def _collect(kind: str, metas: Iterable[dict]) -> None:
        for m in metas:
            thrid = m.get("gmail_thrid")
            if not thrid:
                continue
            candidates.setdefault(int(thrid), set()).add(kind)
            when = _sast(m.get("internaldate")) or datetime.min
            if when > newest.get(int(thrid), datetime.min):
                newest[int(thrid)] = when

    # 1. reference, 2. addresses, 3. phone, 4. group name, 5. surname.
    q = mt.reference_query(bf.doc_number)
    if q:
        _collect("reference", _run_query(imap, "reference", q, plan))
    for address in sorted(bf.emails):
        _collect("email", _run_query(imap, "email", mt.address_query(address), plan))
    q = mt.phone_query(bf.mobile)
    if q:
        _collect("phone", _run_query(imap, "phone", q, plan))
    q = mt.group_query(bf.group_name)
    if q:
        _collect("group", _run_query(imap, "group", q, plan))
    else:
        plan.notes.append("group name has no distinctive words")
    q = mt.surname_query(bf.contact_name)
    if q:
        _collect("surname", _run_query(imap, "surname", q, plan))

    # Fetch whole conversations, newest first, within the cap.
    order = sorted(candidates, key=lambda t: newest.get(t, datetime.min), reverse=True)
    if len(order) > MAX_THREADS_PER_BOOKING:
        plan.notes.append(f"{len(order)} candidate conversations, newest {MAX_THREADS_PER_BOOKING} examined")
        order = order[:MAX_THREADS_PER_BOOKING]
    for thrid in order:
        tp = fetch_thread(imap, thrid, own)
        if tp is None:
            continue
        tp.found_by = candidates[thrid]
        tp.score, tp.why = mt.score(tp.facts, bf)
        tp.verdict = mt.verdict(tp.score)
        plan.threads[thrid] = tp

    # One hop of address expansion from what attached.
    seen_addresses = set(bf.emails)
    expand: list[str] = []
    for tp in plan.threads.values():
        if tp.verdict != "attach":
            continue
        for a in sorted(mt.expandable_addresses(tp.facts, own)):
            if a not in seen_addresses and a not in expand:
                expand.append(a)
    if len(expand) > MAX_EXPAND_ADDRESSES:
        plan.notes.append(f"{len(expand)} addresses on the matched mail, first {MAX_EXPAND_ADDRESSES} searched")
        expand = expand[:MAX_EXPAND_ADDRESSES]
    if expand:
        # People who wrote to us on an attached conversation are the booking's
        # contacts; people who were only copied are weaker evidence.
        wrote = {a for tp in plan.threads.values() if tp.verdict == "attach" for a in tp.facts.senders}
        for a in expand:
            (bf.emails if a in wrote else bf.cc_emails).add(a)
        plan.learned_emails.update(expand)
        for address in expand:
            new_thrids = []
            for m in _run_query(imap, "email+", mt.address_query(address), plan):
                thrid = m.get("gmail_thrid")
                if thrid and int(thrid) not in plan.threads and int(thrid) not in new_thrids:
                    new_thrids.append(int(thrid))
            for thrid in new_thrids[:MAX_THREADS_PER_BOOKING]:
                tp = fetch_thread(imap, thrid, own)
                if tp is None:
                    continue
                tp.found_by = {"email+"}
                tp.score, tp.why = mt.score(tp.facts, bf)
                tp.verdict = mt.verdict(tp.score)
                plan.threads[thrid] = tp
        # Addresses learned from expansion rescore the first set too.
        for tp in plan.threads.values():
            tp.score, tp.why = mt.score(tp.facts, bf)
            tp.verdict = mt.verdict(tp.score)

    # A shared contact's other booking: hand the conversation to the better fit.
    if others:
        other_facts = [
            mt.BookingFacts.from_row(o) for o in others
            if o is not row and (o.get("doc_number") != row.get("doc_number") or o.get("group_name") != row.get("group_name"))
        ]
        for tp in plan.threads.values():
            if tp.verdict != "attach":
                continue
            mentioned = mt.dates_in(" ".join(tp.facts.subjects) + " " + tp.facts.text[:3000])
            best: tuple[int, mt.BookingFacts] | None = None
            for of in other_facts:
                pts, _why = mt.score(tp.facts, of)
                if pts >= mt.REVIEW_THRESHOLD and (best is None or pts > best[0]):
                    best = (pts, of)
            if best is None:
                continue
            o_pts, of = best
            date_says_other = bool(of.visit_date in mentioned and bf.visit_date not in mentioned)
            if o_pts > tp.score or (date_says_other and o_pts >= mt.REVIEW_THRESHOLD):
                tp.verdict = "review"
                tp.why.append(f"fits {of.reference or of.group_name} ({of.group_name}, {of.visit_date:%-d %b}) better")

    # Seasons: newest cluster of the attachable conversations wins.
    attachable = [tp.facts for tp in plan.threads.values() if tp.verdict == "attach"]
    chosen, rejected, note = mt.choose_cluster(attachable, floor=floor)
    plan.chosen = [t.thrid for t in sorted(chosen, key=lambda t: t.last_at or datetime.min)]
    plan.rejected_old = [t.thrid for t in rejected]
    plan.cluster_note = note
    window_start = min((t.first_at for t in chosen if t.first_at), default=None)
    last_chosen = max((t.last_at for t in chosen if t.last_at), default=None)
    if last_chosen and bf.visit_date and (bf.visit_date - last_chosen.date()).days > 240:
        months = (bf.visit_date - last_chosen.date()).days // 30
        plan.notes.append(f"conversation ended {months} months before the visit; may be an earlier visit of the same group")
    plan.review = [
        thrid
        for thrid, tp in plan.threads.items()
        if tp.verdict == "review"
        and tp.facts.last_at
        and tp.facts.last_at.date() >= floor
        and (window_start is None or tp.facts.last_at >= window_start - timedelta(days=mt.CLUSTER_GAP_DAYS))
    ]
    # Only addresses that are on chosen conversations are the booking's contacts.
    on_chosen: set[str] = set()
    for thrid in plan.chosen:
        on_chosen |= mt.expandable_addresses(plan.threads[thrid].facts, own)
    plan.learned_emails = {a for a in on_chosen if a not in (row.get("contact_email") or "",)}

    if include_bank:
        try:
            plan.bank = bank_candidates(row)
        except Exception as exc:  # noqa: BLE001
            plan.notes.append(f"bank lookup unavailable: {exc}")
    return plan


# ---------------------------------------------------------------- bank ---


def bank_candidates(row: dict, tolerance_pct: float = 0.02) -> list[dict]:
    """Credits already polled from FNB that could be this booking's money:
    the reference in the description, or a distinctive group word with a
    plausible amount (deposit or total). Read-only."""
    from decimal import Decimal

    from src.models.base import query

    doc = row.get("doc_number")
    tokens = mt.distinctive_tokens(row.get("group_name"))
    since = (row.get("enquiry_date") or (row.get("visit_date") - timedelta(days=120))) - timedelta(days=7)
    credits = query(
        """
        SELECT t.id, t.booking_date, t.amount, t.description, t.end_to_end_id, t.match_status,
               (SELECT p.booking_id FROM payments p WHERE p.bank_transaction_id = t.id LIMIT 1) AS booking_id
        FROM bank_transactions t
        WHERE t.credit_debit = 'CREDIT' AND t.booking_date >= %s
        ORDER BY t.booking_date
        """,
        (since,),
    )
    deposit = Decimal(str(row.get("deposit") or 0))
    people = int(row.get("people_booked") or 0)
    price = Decimal(str(row.get("price_per_person") or 0))
    total = price * people if price and people else Decimal(0)
    out = []
    for c in credits:
        desc = f"{c.get('description') or ''} {c.get('end_to_end_id') or ''}"
        why = []
        if doc and re.search(rf"(?<!\d){int(doc)}(?!\d)", desc):
            why.append("reference")
        hay = set(mt.words(desc))
        if tokens and any(mt.fuzzy_word_in(t, hay) for t in tokens):
            why.append("group word")
        amount = Decimal(str(c["amount"]))
        plausible = any(
            x > 0 and abs(amount - x) <= x * Decimal(str(tolerance_pct)) for x in (deposit, total)
        )
        if plausible:
            why.append("amount fits")
        if "reference" in why or ("group word" in why and plausible):
            out.append({**c, "amount": float(amount), "why": why})
    return out


# ----------------------------------------------------------- enquiries ---


def plan_enquiries(
    imap: GmailImap,
    since: date,
    known_thrids: set[int],
    own: set[str] | None = None,
    *,
    limit_threads: int = 400,
) -> list[ThreadPlan]:
    """Inbox conversations since ``since`` that belong to no booking and are
    still waiting on us (customer last, or never answered), minus automated
    mail. Read-only; each is fetched whole for the decision."""
    from src.services.inbound import classify_automated

    own = own if own is not None else own_addresses()
    imap.select(INBOX, readonly=True)
    uids = imap.search_gmail(f"after:{since:%Y/%m/%d}")
    metas = list(imap.fetch_meta(uids))
    by_thread: dict[int, list[dict]] = {}
    for m in metas:
        thrid = m.get("gmail_thrid")
        if not thrid or int(thrid) in known_thrids:
            continue
        if is_own(m.get("from_email"), own):
            continue
        by_thread.setdefault(int(thrid), []).append(m)
    # Quick header-level filter before fetching bodies.
    candidates = []
    for thrid, ms in by_thread.items():
        newest = max(ms, key=lambda x: _sast(x.get("internaldate")) or datetime.min)
        grade, _reason = classify_automated(newest.get("headers") or {}, newest.get("from_email"), newest.get("from_name"), newest.get("subject"))
        if grade == "certain":
            continue
        candidates.append((thrid, _sast(newest.get("internaldate")) or datetime.min))
    candidates.sort(key=lambda x: x[1], reverse=True)
    out: list[ThreadPlan] = []
    imap.select(ALL_MAIL, readonly=True)
    for thrid, _when in candidates[:limit_threads]:
        tp = fetch_thread(imap, thrid, own)
        if tp is None or tp.facts.inbound_count == 0:
            continue
        if tp.facts.last_direction != "inbound":
            continue  # we answered last
        last = max((m for m in tp.messages if m.direction == "inbound"), key=lambda m: m.sent_at or datetime.min)
        grade, reason = classify_automated(last.parsed.headers, last.parsed.from_email, last.parsed.from_name, last.parsed.subject, body=last.parsed.text)
        if grade is not None:
            tp.why = [f"automated: {reason}"]
            tp.verdict = "skip"
            continue
        tp.verdict = "enquiry"
        tp.why = ["never answered" if tp.facts.outbound_count == 0 else "customer wrote last"]
        out.append(tp)
    return out


# -------------------------------------------------------------- report ---


def _fmt_dt(dt: datetime | None) -> str:
    return dt.strftime("%-d %b %Y") if dt else "?"


def plan_to_dict(plan: BookingPlan) -> dict:
    b = plan.booking

    def thread_dict(thrid: int) -> dict:
        tp = plan.threads[thrid]
        f = tp.facts
        return {
            "thrid": str(thrid),
            "subject": tp.subject,
            "first_at": f.first_at.isoformat() if f.first_at else None,
            "last_at": f.last_at.isoformat() if f.last_at else None,
            "messages": f.message_count,
            "inbound": f.inbound_count,
            "outbound": f.outbound_count,
            "last_direction": f.last_direction,
            "participants": sorted(f.participants),
            "found_by": sorted(tp.found_by),
            "score": tp.score,
            "why": tp.why,
            "verdict": tp.verdict,
        }

    return {
        "booking": {
            "id": b.id, "reference": b.reference, "group_name": b.group_name, "contact_name": b.contact_name,
            "contact_mobile": b.mobile, "emails": sorted(b.emails), "visit_date": b.visit_date.isoformat() if b.visit_date else None,
            "enquiry_date": b.enquiry_date.isoformat() if b.enquiry_date else None, "sheet_row": (plan.sheet_row or {}).get("sheet_row"),
        },
        "queries": plan.queries,
        "chosen": [thread_dict(t) for t in plan.chosen],
        "review": [thread_dict(t) for t in plan.review],
        "rejected_old": [thread_dict(t) for t in plan.rejected_old],
        "other": [thread_dict(t) for t in plan.threads if t not in plan.chosen and t not in plan.review and t not in plan.rejected_old],
        "learned_emails": sorted(plan.learned_emails),
        "cluster_note": plan.cluster_note,
        "bank": plan.bank,
        "notes": plan.notes,
    }


def render_report(plans: list[BookingPlan], enquiries: list[ThreadPlan] | None, *, started: datetime, dry_run: bool) -> str:
    lines = [f"# Season migration {'plan (dry run)' if dry_run else 'run'}", "", f"Started {started:%Y-%m-%d %H:%M}. {len(plans)} bookings.", ""]
    found = sum(1 for p in plans if p.found)
    lines.append(f"**{found} of {len(plans)} bookings found their conversation.**")
    lines.append("")
    for p in plans:
        b = p.booking
        lines.append(f"## {b.reference or '(no ref)'} · {b.group_name} · {b.contact_name or '?'} · visit {b.visit_date:%a %-d %b %Y}")
        bits = []
        if b.mobile:
            bits.append(f"mobile {b.mobile}")
        if b.emails:
            bits.append("emails " + ", ".join(sorted(b.emails)))
        lines.append("  " + (" · ".join(bits) if bits else "no email or mobile on the sheet"))
        for q in p.queries:
            note = f" ({q['note']})" if q.get("note") else ""
            lines.append(f"  - search {q['kind']}: {q['hits']} messages / {q['threads']} conversations{note}")
        lines.append(f"  - clusters: {p.cluster_note}")
        if not p.chosen:
            lines.append("  - **no conversation attached**")
        for t in p.chosen:
            f = p.threads[t].facts
            tp = p.threads[t]
            lines.append(
                f"  - ATTACH [{tp.score} {'+'.join(tp.why)}] \"{tp.subject[:70]}\" · {f.message_count} msgs "
                f"({f.inbound_count} in / {f.outbound_count} out) · {_fmt_dt(f.first_at)} → {_fmt_dt(f.last_at)} · "
                f"last: {f.last_direction} · {', '.join(sorted(f.participants))[:120]}"
            )
        for t in p.review:
            tp = p.threads[t]
            f = tp.facts
            lines.append(f"  - review [{tp.score} {'+'.join(tp.why)}] \"{tp.subject[:70]}\" · {_fmt_dt(f.last_at)} · {', '.join(sorted(f.participants))[:100]}")
        for t in p.rejected_old:
            tp = p.threads[t]
            f = tp.facts
            lines.append(f"  - older season [{tp.score}] \"{tp.subject[:60]}\" · {_fmt_dt(f.first_at)} → {_fmt_dt(f.last_at)}")
        if p.learned_emails:
            lines.append("  - contacts learned: " + ", ".join(sorted(p.learned_emails)))
        for c in p.bank:
            lines.append(f"  - bank: {c['booking_date']} R{c['amount']:,.2f} \"{(c.get('description') or '')[:40]}\" ({', '.join(c['why'])}; {c['match_status']})")
        for n in p.notes:
            lines.append(f"  - note: {n}")
        lines.append("")
    if enquiries is not None:
        lines.append(f"## Enquiries waiting on us: {len(enquiries)}")
        for tp in enquiries:
            f = tp.facts
            lines.append(f"  - \"{tp.subject[:70]}\" · {', '.join(sorted(f.participants))[:80]} · {_fmt_dt(f.last_at)} · {'; '.join(tp.why)}")
        lines.append("")
    return "\n".join(lines)


def write_report(text: str, data: dict, stamp: datetime) -> tuple[Path, Path]:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    md = REPORT_DIR / f"report-{stamp:%Y%m%d-%H%M%S}.md"
    js = REPORT_DIR / f"report-{stamp:%Y%m%d-%H%M%S}.json"
    md.write_text(text)
    js.write_text(json.dumps(data, indent=1, default=str))
    return md, js


# ------------------------------------------------------------- writing ---


def apply_plan(plan: BookingPlan, *, today: date | None = None) -> dict:
    """Store the chosen conversations and link them to the booking. The
    booking must exist (``plan.booking.id``)."""
    from src.models import booking_contact
    from src.models import email_message as em
    from src.services import conversations
    from src.services.mail_ingest import build_row, store_attachments

    bid = plan.booking.id
    if not bid:
        raise ValueError("apply_plan needs a booking id")
    today = today or get_today()
    stats = {"threads": 0, "messages": 0, "inserted": 0, "attachments": 0, "contacts": 0}
    for thrid in plan.chosen:
        tp = plan.threads[thrid]
        stats["threads"] += 1
        for fm in tp.messages:
            item = {"uid": fm.uid, "gmail_msgid": fm.gmail_msgid, "gmail_thrid": fm.gmail_thrid, "internaldate": fm.internaldate, "raw": fm.raw}
            row = build_row(item, fm.parsed, ALL_MAIL)
            row["direction"] = fm.direction
            row["folder"] = ALL_MAIL
            if fm.direction == "inbound":
                row["inbound_outcome"] = "booking"
                row["processed_at"] = fm.sent_at
            message_id, outcome, _prev = em.upsert_by_gmail_msgid(row)
            stats["messages"] += 1
            if outcome == "inserted":
                stats["inserted"] += 1
                if fm.parsed.attachments and not em.list_attachments(message_id):
                    stats["attachments"] += len(store_attachments(message_id, fm.gmail_msgid or message_id, fm.parsed))
        em.link_thread(int(thrid), int(bid), "migration:" + "+".join(tp.why)[:19])
        em.set_booking_thread_if_null(int(bid), int(thrid))
        conversations.refresh_thread(int(thrid))
    for address in sorted(plan.learned_emails):
        if booking_contact.upsert(int(bid), address, role="learned", source="migration"):
            stats["contacts"] += 1
    # The sheet has no email column: the booking's own address is the person who
    # wrote to us most on its conversations. Without it nothing can be sent.
    learned_primary = primary_email_for(plan)
    if learned_primary:
        stats["primary_email"] = set_primary_email(int(bid), learned_primary)
    if plan.chosen:
        em.insert_booking_event(
            int(bid), "updated",
            f"Migration attached {stats['threads']} conversation(s), {stats['messages']} messages",
            {"threads": [str(t) for t in plan.chosen], "learned": sorted(plan.learned_emails)}, None,
        )
    return stats


def primary_email_for(plan: BookingPlan) -> str | None:
    """The most frequent outside sender on the chosen conversations (the
    customer, not us, not a robot); the reference-matched conversations count
    double, since the proforma thread is the one the customer answers from."""
    from collections import Counter

    own = own_addresses()
    tally: Counter = Counter()
    for thrid in plan.chosen:
        tp = plan.threads[thrid]
        weight = 2 if "reference" in tp.why else 1
        for fm in tp.messages:
            if fm.direction != "inbound":
                continue
            address = (fm.parsed.from_email or "").lower().strip()
            if not address or is_own(address, own) or mt.is_noreply(address):
                continue
            tally[address] += weight
    return tally.most_common(1)[0][0] if tally else None


def set_primary_email(booking_id: int, address: str) -> bool:
    """Give the booking its email address when it has none (mirrors the primary
    contact and records the change). False when it already had one."""
    from src.models import booking as booking_model
    from src.services import booking as booking_service

    row = booking_model.get(booking_id)
    if row is None or row.get("contact_email"):
        return False
    try:
        booking_service.update_booking(booking_id, {"contact_email": address}, None)
    except booking_service.BookingError as exc:
        logger.warning(f"Learned address rejected for {row.get('reference')}: {exc}")
        return False
    return True


def learn_primary_emails() -> dict:
    """Backfill for bookings stored without an address: the most frequent
    inbound sender across the conversations linked to each."""
    from collections import Counter

    from src.models.base import query

    own = own_addresses()
    out = {"bookings": 0, "learned": 0, "still_without": []}
    for b in query("SELECT id, reference FROM bookings WHERE contact_email IS NULL ORDER BY visit_date, id"):
        out["bookings"] += 1
        rows = query(
            """
            SELECT m.from_email, m.match_method
            FROM email_messages m JOIN email_threads t ON t.gmail_thrid = m.gmail_thrid
            WHERE t.booking_id = %s AND m.direction = 'inbound'
            """,
            (int(b["id"]),),
        )
        tally: Counter = Counter()
        for r in rows:
            address = (r.get("from_email") or "").lower().strip()
            if not address or is_own(address, own) or mt.is_noreply(address):
                continue
            tally[address] += 2 if "reference" in str(r.get("match_method") or "") else 1
        if tally and set_primary_email(int(b["id"]), tally.most_common(1)[0][0]):
            out["learned"] += 1
        else:
            out["still_without"].append(b["reference"])
    return out

