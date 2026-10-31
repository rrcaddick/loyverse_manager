"""Live handling of mail arriving in the bookings inbox.

The app is not a mail client. Every inbound message gets exactly one of
these outcomes (docs/handoff/migration-and-inbound.md §2):

    booking        it belongs to an open booking (or names one by reference):
                   attached, the booking gets a reply action, label applied
    allocate       it belongs to one of several bookings of the same people:
                   attached to all as candidates, one click assigns it
    enquiry        it continues an open enquiry
    started_by_us  a reply in a conversation we opened: left in Gmail
    pending_form   a cold enquiry: the bounce-back with the form link went
                   out (once per sender per window); the sweep turns it into
                   an enquiry if no form arrives
    skipped        automated mail: logged, never stored, left in the inbox

The automated filter has two grades. ``certain`` (auto-submitted, delivery
failures, bulk providers, addresses that cannot receive mail) is skipped
outright. ``likely`` (bulk or list headers, receipt-style senders) gets a
second look: a personal sender writing about a visit is treated as human.
When unsure, mail is treated as human: a wrong form costs one click, a
wrong skip costs a customer.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from config.settings import GMAIL_ADDRESS
from src.models import booking_contact
from src.models import email_message as em
from src.models import email_thread as et
from src.models import enquiry as enquiry_model
from src.models import mail_skipped
from src.models.base import query
from src.services import matching as mt
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("inbound")

OPEN_STATUSES = ("requested", "enquiry", "proforma_sent", "confirmed")
LABEL_OUTCOMES = {"booking": "label_bookings", "allocate": "label_bookings", "enquiry": "label_enquiries"}

CERTAIN_LOCAL_RE = re.compile(r"^(no-?reply|donotreply|do-?not-?reply|mailer-daemon|postmaster|bounce[s]?|bounces?-)", re.I)
LIKELY_LOCAL_TOKENS = frozenset(
    {"receipts", "receipt", "notifications", "notification", "ibreply", "billing", "invoices", "statements",
     "alerts", "alert", "newsletter", "news", "marketing", "noreply-", "support", "updates", "info-"}
)
BULK_PROVIDER_RE = re.compile(
    r"(mailchimp|mcsv\.net|mcdlv\.net|mandrill|sendgrid|sendinblue|brevo|mailgun|amazonses|ses\.amazonaws"
    r"|articulationmail|everlytic|constantcontact|campaignmonitor|createsend|klaviyo|hubspot|sparkpost"
    r"|postmarkapp|mailjet|mailerlite|activecampaign|exacttarget|marketo|pardot|touchbasepro|graphicmail)",
    re.I,
)
DELIVERY_FAILURE_RE = re.compile(
    r"(delivery status notification|undeliverable|mail delivery failed|delivery failure|returned mail|"
    r"failure notice|could not be delivered)",
    re.I,
)
BOOKING_WORDS_RE = re.compile(
    r"\b(book|booking|visit|outing|excursion|school|church|group|kids|children|learners|grade|gr\s?\d|"
    r"creche|crèche|educare|quote|quotation|price|prices|cost|availability|available|tickets?|"
    r"gazebo|bus|buses|date|december|january|february|march|april|october|november)\b",
    re.I,
)
PEOPLE_RE = re.compile(r"\b\d{1,3}\s*(people|persons|pax|kids|children|learners|adults|visitors|guests)\b", re.I)
BANK_NOTICE_RE = re.compile(r"(proof of payment|payment notification|payment confirmation|notice of payment|inContact|has been paid)", re.I)


def _cfg() -> dict:
    from src.services.settings import get_settings

    try:
        return dict(get_settings()["inbound"])
    except Exception:  # noqa: BLE001
        from src.services.settings import DEFAULTS

        return dict(DEFAULTS["inbound"])


def _own() -> set[str]:
    out = {(GMAIL_ADDRESS or "").lower()}
    out.discard("")
    return out


def _is_own(address: str | None) -> bool:
    return mt.is_park_address(address, _own())


def _learn_contacts(booking_id: int, row: dict) -> None:
    """Every outside address on an inbound email becomes a learned contact of
    the booking: the sender with their name, and whoever was on the To or Cc
    line (the office is often copied in, and so are colleagues). Learned
    contacts are for the record; only a primary receives correspondence."""
    sender = (row.get("from_email") or "").lower()
    names = row.get("participant_names") or {}
    if isinstance(names, str):
        try:
            import json

            names = json.loads(names) or {}
        except ValueError:
            names = {}
    seen: set[str] = set()
    for address, name in [(sender, row.get("from_name"))] + [
        (str(a).lower(), None) for a in list(row.get("to_emails") or []) + list(row.get("cc_emails") or [])
    ]:
        if not address or address in seen or _is_own(address) or mt.is_noreply(address):
            continue
        seen.add(address)
        booking_contact.upsert(booking_id, address, name=name or names.get(address), role="learned", source="inbound")


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


# ----------------------------------------------------------- the filter ---


def looks_like_booking(from_name: str | None, subject: str | None, body: str | None) -> bool:
    """A person writing about a visit: a personal sender name and the words
    of an enquiry. The second look that keeps a 'likely' automated mail human."""
    name = (from_name or "").strip()
    personal = bool(name) and len(name.split()) >= 2 and not re.search(
        r"(team|support|info|no-?reply|notification|receipts?|billing|news|admin|office)", name, re.I
    )
    text = f"{subject or ''}\n{(body or '')[:3000]}"
    hits = len(BOOKING_WORDS_RE.findall(text))
    return personal and (hits >= 2 or bool(PEOPLE_RE.search(text)))


def classify_automated(
    headers: dict | None, from_email: str | None, from_name: str | None, subject: str | None, body: str | None = None,
) -> tuple[str | None, str]:
    """('certain' | 'likely' | None, reason). None means a person wrote it."""
    h = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    sender = (from_email or "").lower()
    local, _, domain = sender.partition("@")
    auto = h.get("auto-submitted", "").strip().lower()
    if auto and auto != "no":
        return "certain", f"Auto-Submitted: {auto}"
    if CERTAIN_LOCAL_RE.match(local):
        return "certain", f"sender {local}@ cannot receive mail"
    if DELIVERY_FAILURE_RE.search(subject or "") and ("mailer-daemon" in sender or "postmaster" in sender or h.get("x-failed-recipients")):
        return "certain", "delivery failure notice"
    provider_text = " ".join(v for k, v in h.items() if k in ("return-path", "received", "x-mailer", "sender", "x-original-sender", "x-mc-user", "x-sg-eid"))
    if BULK_PROVIDER_RE.search(provider_text) or BULK_PROVIDER_RE.search(domain):
        if not BANK_NOTICE_RE.search(subject or ""):
            return "certain", "sent through a bulk-mail provider"
    if h.get("x-failed-recipients"):
        return "certain", "delivery failure notice"
    # Likely: bulk/list headers or receipt-style senders; a second look applies.
    likely: str | None = None
    precedence = h.get("precedence", "").strip().lower()
    if precedence in ("bulk", "list", "junk"):
        likely = f"Precedence: {precedence}"
    elif "list-id" in h or "list-unsubscribe" in h:
        likely = "mailing-list headers"
    elif any(tok in local for tok in LIKELY_LOCAL_TOKENS):
        likely = f"sender {local}@ looks automated"
    elif h.get("x-auto-response-suppress"):
        likely = "X-Auto-Response-Suppress"
    if likely:
        if looks_like_booking(from_name, subject, body):
            return None, f"{likely}, but reads like a person about a visit"
        return "likely", likely
    return None, "person"


# --------------------------------------------------------- open bookings ---


def open_bookings(today: date | None = None) -> list[dict]:
    """Bookings that mail can still belong to: anything not closed, and
    completed visits inside the configurable after-window."""
    today = today or get_today()
    days = int(_cfg().get("active_days_after_visit", 14))
    rows = query(
        f"""
        SELECT b.id, b.reference, b.doc_number, b.group_name, b.contact_name, b.contact_email, b.contact_mobile,
               b.visit_date, b.status, b.enquiry_date, b.email_thread_id
        FROM bookings b
        WHERE b.status IN ({','.join(['%s'] * len(OPEN_STATUSES))})
           OR (b.status = 'completed' AND b.visit_date >= %s)
        ORDER BY b.visit_date, b.id
        """,
        (*OPEN_STATUSES, today - timedelta(days=days)),
    )
    contacts = query("SELECT booking_id, email, mobile FROM booking_contacts")
    extra: dict[int, set[str]] = {}
    mobiles: dict[int, set[str]] = {}
    for c in contacts:
        extra.setdefault(int(c["booking_id"]), set()).add(c["email"])
        if c.get("mobile"):
            mobiles.setdefault(int(c["booking_id"]), set()).add(c["mobile"])
    for r in rows:
        r["emails"] = {str(r["contact_email"]).lower()} if r.get("contact_email") else set()
        r["emails"] |= extra.get(int(r["id"]), set())
        r["mobiles"] = {m for m in {mt.normalise_za_mobile(r.get("contact_mobile"))} | mobiles.get(int(r["id"]), set()) if m}
    return rows


def _facts_for_message(row: dict) -> mt.ThreadFacts:
    f = mt.ThreadFacts(thrid=int(row.get("gmail_thrid") or 0))
    for a in [row.get("from_email")] + list(row.get("to_emails") or []) + list(row.get("cc_emails") or []):
        if a and not _is_own(a):
            f.participants.add(str(a).lower())
    if row.get("from_name"):
        f.from_names.add(str(row["from_name"]))
    if row.get("subject"):
        f.subjects.add(re.sub(r"^\s*((re|fw|fwd|aw)\s*:\s*)+", "", str(row["subject"]), flags=re.I))
    f.text = (row.get("body_new_text") or row.get("body_text") or "")[:8000]
    for a in row.get("attachments_meta") or []:
        if isinstance(a, dict) and a.get("filename"):
            f.filenames.add(str(a["filename"]))
    f.last_at = row.get("sent_at")
    return f


def _booking_facts(b: dict) -> mt.BookingFacts:
    bf = mt.BookingFacts.from_row(b, extra_emails=b.get("emails") or ())
    return bf


# ----------------------------------------------------------- matching ---


def _dates_in(text: str) -> set[date]:
    from dateutil import parser as dateparser

    out: set[date] = set()
    for m in re.finditer(r"\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?[A-Za-z]{3,9}(?:\s+\d{4})?|\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b", text[:6000]):
        try:
            d = dateparser.parse(m.group(1), dayfirst=True, default=datetime(get_today().year, 1, 1))
            out.add(d.date())
        except Exception:  # noqa: BLE001
            continue
    return out


def disambiguate(row: dict, candidates: list[dict]) -> tuple[dict | None, str]:
    """Several bookings share the people on this mail: pick one by thread,
    reference, group words or a visit date in the text; else None."""
    if len(candidates) == 1:
        return candidates[0], "only one open booking"
    thrid = row.get("gmail_thrid")
    if thrid:
        for b in candidates:
            if b.get("email_thread_id") and int(b["email_thread_id"]) == int(thrid):
                return b, "thread"
        linked = query("SELECT DISTINCT booking_id FROM email_messages WHERE gmail_thrid = %s AND booking_id IS NOT NULL", (int(thrid),))
        ids = {int(r["booking_id"]) for r in linked}
        hits = [b for b in candidates if int(b["id"]) in ids]
        if len(hits) == 1:
            return hits[0], "thread"
    facts = _facts_for_message(row)
    refs = facts.references()
    hits = [b for b in candidates if b.get("doc_number") and int(b["doc_number"]) in refs]
    if len(hits) == 1:
        return hits[0], "reference"
    hay = facts.word_set()
    scored = []
    for b in candidates:
        cover, _ = mt.group_coverage(b.get("group_name"), hay)
        scored.append((cover, b))
    scored.sort(key=lambda x: -x[0])
    if scored and scored[0][0] >= 0.999 and (len(scored) == 1 or scored[1][0] < 0.999):
        return scored[0][1], "group name"
    mentioned = _dates_in(facts.text + " " + " ".join(facts.subjects))
    hits = [b for b in candidates if b.get("visit_date") in mentioned]
    if len(hits) == 1:
        return hits[0], "visit date"
    return None, "ambiguous"


def match_open_booking(row: dict, bookings: list[dict] | None = None) -> tuple[dict | None, list[dict], str]:
    """(booking, candidates, method). Reference first (any status), then
    people (address, mobile), then a corroborated group name."""
    facts = _facts_for_message(row)
    for n in sorted(facts.references()):
        b = em.booking_by_doc_number(int(n))
        if b:
            return b, [], "reference"
    bookings = bookings if bookings is not None else open_bookings()
    senders = {a for a in facts.participants}
    by_people = [b for b in bookings if (b["emails"] & senders)]
    if not by_people:
        mobs = facts.mobiles()
        by_people = [b for b in bookings if (b["mobiles"] & mobs)]
        method = "mobile"
    else:
        method = "email"
    if by_people:
        chosen, how = disambiguate(row, by_people)
        if chosen:
            return chosen, by_people, f"{method}" if how == "only one open booking" else f"{method}+{how}"
        return None, by_people, method
    best: tuple[int, dict] | None = None
    for b in bookings:
        pts, _why = mt.score(facts, _booking_facts(b))
        if pts >= mt.AUTO_THRESHOLD and (best is None or pts > best[0]):
            best = (pts, b)
    if best:
        return best[1], [], "group+name"
    return None, [], "none"


def started_by_us(row: dict) -> bool:
    """Is this a reply in a conversation we opened?"""
    irt = (row.get("in_reply_to") or "").strip()
    if irt:
        parent = em.get_by_message_id_header(irt)
        if parent and parent.get("direction") == "outbound" and parent.get("kind") != "bounce_back":
            return True
    thrid = row.get("gmail_thrid")
    if not thrid:
        return False
    rows = em.thread(int(thrid))
    older = [m for m in rows if m.get("id") != row.get("id") and (m.get("sent_at") or datetime.min) <= (row.get("sent_at") or datetime.max)]
    if not older:
        return False
    first = min(older, key=lambda m: (m.get("sent_at") or datetime.min, m.get("id") or 0))
    return first.get("direction") == "outbound" and first.get("kind") != "bounce_back"


# ----------------------------------------------------------- outcomes ---


def _record(message_id: int, outcome: str, *, booking_id: int | None = None, enquiry_id: int | None = None,
            candidates: Iterable[int] = (), method: str | None = None) -> None:
    fields: dict[str, Any] = {"inbound_outcome": outcome, "processed_at": _now()}
    cands = sorted({int(c) for c in candidates})
    fields["candidate_booking_ids"] = json.dumps(cands) if cands else None
    if enquiry_id is not None:
        fields["enquiry_id"] = int(enquiry_id)
    if booking_id is not None:
        fields["booking_id"] = int(booking_id)
        fields["match_method"] = (method or outcome)[:30]
        fields["review_status"] = "none"
    em.update(int(message_id), **fields)


def attach_to_booking(message_id: int, row: dict, booking: dict, method: str) -> None:
    from src.services import conversations, pop

    bid = int(booking["id"])
    em.link_to_booking(int(message_id), bid, method[:30], whole_thread=False)
    thrid = row.get("gmail_thrid")
    if thrid:
        em.set_booking_thread_if_null(bid, int(thrid))
        em.link_unlinked_in_thread(int(thrid), bid, "thread")
        conversations.refresh_thread(int(thrid))
    _learn_contacts(bid, row)
    if not row.get("is_auto_generated"):
        em.insert_booking_event(
            bid, "email_received", (row.get("subject") or "(no subject)")[:255],
            {"email_message_id": int(message_id), "from": sender, "match_method": method}, None,
        )
    _record(int(message_id), "booking", booking_id=bid, method=method)
    try:
        pop.inspect_message(int(message_id), bid)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"POP inspection failed for message {message_id}: {exc}", exc_info=True)


def attach_to_enquiry(message_id: int, row: dict, enquiry: dict) -> None:
    enquiry_model.touch_inbound(int(enquiry["id"]), row.get("sent_at"), row.get("snippet"))
    _record(int(message_id), "enquiry", enquiry_id=int(enquiry["id"]))


def bounce_back_decision(row: dict, now: datetime | None = None) -> tuple[bool, str]:
    """(send, reason) for a cold message that matched nothing."""
    cfg = _cfg()
    now = now or _now()
    if not cfg.get("bounce_back_enabled", True):
        return False, "bounce-backs disabled"
    sender = (row.get("from_email") or "").lower()
    if not sender or _is_own(sender) or mt.is_noreply(sender):
        return False, "no sendable sender"
    if row.get("is_auto_generated"):
        return False, "automated mail"
    last = em.get_bounce_back(sender)
    window = timedelta(hours=int(cfg.get("form_window_hours", 24)))
    if last and last.get("last_sent_at") and now - last["last_sent_at"] < window:
        return False, f"form sent {last['last_sent_at']:%-d %b %H:%M}, inside the window"
    return True, "cold enquiry"


def process_message(
    message_id: int, row: dict | None = None, *, bypass_filter: bool = False, send: bool = True,
    bookings: list[dict] | None = None, now: datetime | None = None,
) -> dict:
    """Decide and record the outcome of one stored inbound message."""
    row = row or em.get(int(message_id))
    if row is None:
        return {"outcome": "missing"}
    if row.get("direction") != "inbound" or _is_own(row.get("from_email")):
        return {"outcome": "not_inbound"}
    now = now or _now()
    thrid = int(row["gmail_thrid"]) if row.get("gmail_thrid") else None

    # 1. The conversation already knows where it belongs.
    if thrid:
        t = et.get(thrid)
        if t and t.get("booking_id"):
            b = em.booking_by_id(int(t["booking_id"]))
            if b:
                attach_to_booking(int(message_id), row, b, "thread")
                return {"outcome": "booking", "booking_id": int(b["id"]), "method": "thread"}
        if t and t.get("not_booking"):
            _record(int(message_id), "not_booking")
            return {"outcome": "not_booking"}
        e = enquiry_model.get_by_thread(thrid)
        if e and e["status"] in enquiry_model.OPEN_STATUSES:
            attach_to_enquiry(int(message_id), row, e)
            return {"outcome": "enquiry", "enquiry_id": int(e["id"])}
        if e and e.get("booking_id"):
            b = em.booking_by_id(int(e["booking_id"]))
            if b:
                attach_to_booking(int(message_id), row, b, "enquiry")
                return {"outcome": "booking", "booking_id": int(b["id"]), "method": "enquiry"}

    # 2. Reference, people, group name.
    booking, candidates, method = match_open_booking(row, bookings)
    if booking:
        attach_to_booking(int(message_id), row, booking, method)
        return {"outcome": "booking", "booking_id": int(booking["id"]), "method": method}
    if candidates:
        ids = [int(b["id"]) for b in candidates]
        _record(int(message_id), "allocate", candidates=ids, method=method)
        sender = (row.get("from_email") or "").lower()
        for b in candidates:
            if sender and sender not in b["emails"] and not mt.is_noreply(sender):
                booking_contact.upsert(int(b["id"]), sender, name=row.get("from_name"), role="learned", source="inbound")
        return {"outcome": "allocate", "candidates": ids, "method": method}

    # 3. A conversation we opened is ours to drive, in Gmail.
    if started_by_us(row):
        _record(int(message_id), "started_by_us")
        return {"outcome": "started_by_us"}

    # 4. An open enquiry from the same person.
    e = enquiry_model.open_for_sender(row.get("from_email") or "")
    if e:
        attach_to_enquiry(int(message_id), row, e)
        return {"outcome": "enquiry", "enquiry_id": int(e["id"])}

    # 5. Cold: the form goes out once per sender per window; the sweep follows up.
    ok, reason = bounce_back_decision(row, now)
    sent = None
    if ok and send:
        try:
            from src.services import mail_send

            sent = mail_send.send_bounce_back(int(message_id), None)
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Bounce-back failed for message {message_id}: {exc}")
            reason = f"bounce-back failed: {exc}"
    _record(int(message_id), "pending_form")
    return {"outcome": "pending_form", "bounce_back": bool(sent and sent.get("send_status") == "sent"), "reason": reason}


# ---------------------------------------------------------------- sweep ---


def _rematch_pending(now: datetime) -> dict:
    """Pending-form mail past its window: try the other signals against open
    bookings, requests and enquiries; what still matches nothing becomes an
    enquiry (one per conversation)."""
    from src.services import enquiries

    cfg = _cfg()
    cutoff = now - timedelta(hours=int(cfg.get("form_window_hours", 24)))
    rows = query(
        """
        SELECT * FROM email_messages
        WHERE direction = 'inbound' AND inbound_outcome = 'pending_form' AND booking_id IS NULL
          AND enquiry_id IS NULL AND processed_at <= %s
        ORDER BY sent_at, id
        """,
        (cutoff,),
    )
    bookings = open_bookings()
    out = {"checked": 0, "attached": 0, "enquiries": 0, "joined": 0}
    for r in rows:
        row = em.get(int(r["id"]))
        if row is None:
            continue
        out["checked"] += 1
        booking, candidates, method = match_open_booking(row, bookings)
        if booking:
            attach_to_booking(int(row["id"]), row, booking, "sweep:" + method)
            out["attached"] += 1
            continue
        if candidates:
            _record(int(row["id"]), "allocate", candidates=[int(b["id"]) for b in candidates], method=method)
            out["attached"] += 1
            continue
        thrid = row.get("gmail_thrid")
        e = enquiry_model.get_by_thread(int(thrid)) if thrid else None
        e = e or enquiry_model.open_for_sender(row.get("from_email") or "")
        if e and e["status"] in enquiry_model.OPEN_STATUSES:
            attach_to_enquiry(int(row["id"]), row, e)
            out["joined"] += 1
            continue
        enquiries.create_from_message(row)
        out["enquiries"] += 1
    return out


def apply_labels(limit: int = 200) -> dict:
    """Put the Gmail label on processed mail (and archive it when enabled).
    The only write to the mailbox; labels only, never deletes."""
    cfg = _cfg()
    out = {"labelled": 0, "archived": 0, "missing": 0, "skipped": 0}
    if not cfg.get("labels_enabled", True):
        out["skipped"] = -1
        return out
    rows = query(
        """
        SELECT id, gmail_msgid, inbound_outcome FROM email_messages
        WHERE direction = 'inbound' AND label_applied IS NULL AND gmail_msgid IS NOT NULL
          AND inbound_outcome IN ('booking','allocate','enquiry') AND processed_at >= %s
        ORDER BY id DESC LIMIT %s
        """,
        (datetime.now() - timedelta(days=30), int(limit)),
    )
    if not rows:
        return out
    from src.clients.gmail import INBOX, GmailImapWriter

    with GmailImapWriter() as imap:
        for key in ("label_bookings", "label_enquiries"):
            imap.ensure_label(str(cfg[key]))
        imap.select(INBOX, readonly=False)
        for r in rows:
            label = str(cfg[LABEL_OUTCOMES[r["inbound_outcome"]]])
            uids = imap.search_msgid(int(r["gmail_msgid"]))
            if not uids:
                em.update(int(r["id"]), label_applied="n/a")
                out["missing"] += 1
                continue
            imap.add_label(uids, label)
            out["labelled"] += 1
            if cfg.get("archive_enabled", False):
                imap.archive(uids)
                out["archived"] += 1
            em.update(int(r["id"]), label_applied=label[:60])
    return out


def process_label_folder() -> dict:
    """Mail Linda labelled by hand (``label_process``) is pushed through the
    pipeline with the filter bypassed, then the label is removed."""
    cfg = _cfg()
    label = str(cfg.get("label_process") or "")
    out = {"found": 0, "processed": 0}
    if not label:
        return out
    from src.clients.gmail import GmailImapWriter

    with GmailImapWriter() as imap:
        if label not in set(imap.list_folders()):
            return out
        imap.select(label, readonly=False)
        uids = imap.search_gmail("")  # everything carrying the label
        if not uids:
            return out
        out["found"] = len(uids)
        for item in list(imap.fetch(uids)):
            try:
                result = store_and_process(item, bypass_filter=True)
                out["processed"] += int(result.get("outcome") not in ("not_inbound", "missing"))
            except Exception as exc:  # noqa: BLE001
                logger.error(f"Process label uid {item['uid']}: {exc}", exc_info=True)
        imap.remove_label(uids, label)
    return out


def store_and_process(item: dict, *, bypass_filter: bool, actor: int | None = None) -> dict:
    """Parse, store and process one fetched message (rescue and label paths)."""
    from src.clients.gmail import INBOX
    from src.services.mail_ingest import build_row, parse_message, store_attachments

    parsed = parse_message(item["raw"], item.get("internaldate"))
    row = build_row(item, parsed, INBOX)
    if row.get("direction") != "inbound":
        return {"outcome": "not_inbound"}
    message_id, outcome, _prev = em.upsert_by_gmail_msgid(row)
    from src.services import conversations

    conversations.refresh_thread(row.get("gmail_thrid"))
    if outcome == "inserted" and parsed.attachments and not em.list_attachments(message_id):
        store_attachments(message_id, item.get("gmail_msgid") or message_id, parsed)
    stored = em.get(message_id)
    return process_message(message_id, stored, bypass_filter=bypass_filter)


def rescue_skipped(skipped_id: int, actor: int | None) -> dict:
    """Fetch a skipped message from Gmail and run it as if it had just arrived."""
    from src.clients.gmail import ALL_MAIL, GmailImap

    s = mail_skipped.get(int(skipped_id))
    if s is None:
        raise LookupError("Skipped mail not found")
    with GmailImap() as imap:
        imap.select(ALL_MAIL, readonly=True)
        uids = imap.search_msgid(int(s["gmail_msgid"]))
        if not uids:
            raise LookupError("The message is no longer in the mailbox")
        item = next(iter(imap.fetch(uids[:1])), None)
    if item is None:
        raise LookupError("The message could not be fetched")
    result = store_and_process(item, bypass_filter=True, actor=actor)
    mail_skipped.mark_rescued(int(skipped_id), actor)
    return result


def sweep(now: datetime | None = None) -> dict:
    """The periodic pass: pending forms past their window, the hand-applied
    label, then labels for everything processed. Never raises for one part."""
    now = now or _now()
    summary: dict[str, Any] = {"started_at": now.isoformat()}
    for name, fn in (("pending", lambda: _rematch_pending(now)), ("label_folder", process_label_folder), ("labels", apply_labels)):
        try:
            summary[name] = fn()
        except Exception as exc:  # noqa: BLE001
            logger.error(f"Sweep {name} failed: {exc}", exc_info=True)
            summary[name] = {"error": str(exc)}
    try:
        from src.models.base import execute

        execute(
            "INSERT INTO mail_sync_state (folder, last_uid, last_synced_at) VALUES ('sweep', 0, %s) "
            "ON DUPLICATE KEY UPDATE last_synced_at = VALUES(last_synced_at)",
            (now,),
        )
    except Exception:  # noqa: BLE001
        pass
    logger.info(f"Inbound sweep: {json.dumps(summary, default=str)}")
    return summary


def state() -> dict:
    cfg = _cfg()
    last = query("SELECT folder, last_uid, last_synced_at, last_error FROM mail_sync_state")
    return {
        "config": cfg,
        "sync": {r["folder"]: {"last_uid": r["last_uid"], "last_synced_at": r["last_synced_at"], "error": r.get("last_error")} for r in last},
        "skipped_recent": mail_skipped.count_recent(int(cfg.get("skipped_days", 7))),
        "pending_form": int(query("SELECT COUNT(*) AS n FROM email_messages WHERE inbound_outcome = 'pending_form' AND booking_id IS NULL AND enquiry_id IS NULL")[0]["n"]),
        "to_allocate": int(query("SELECT COUNT(*) AS n FROM email_messages WHERE inbound_outcome = 'allocate' AND booking_id IS NULL")[0]["n"]),
    }
