"""Conversations: the thread-level layer over ``email_messages``.

    refresh_thread(thrid)                       # recompute the email_threads row (ingest, send, backfill)
    list_conversations(view, q, chip, page, page_size) -> (items, total)
    counts()                                    # {needs_reply, unmatched, waiting, done, all}
    get_conversation(thrid)                     # thread + the merged stream
    booking_conversation(booking_id)            # the same stream for every thread on a booking
    mark_done / reopen / set_not_booking / attach / detach / add_note / suggestions / reply
    templates()                                 # canned snippets for the composer

The stream is one chronological list of items typed ``inbound``, ``outbound``,
``note`` and ``event``; shapes are documented in docs/handoff/mail-v2.md.

Thread rows are derived (``derive_thread`` is pure) and refreshed whenever a
message lands, is sent, is linked or unlinked. Operator state on the thread
(``status``, ``done_*``, ``not_booking``) survives refreshes; a new inbound
message newer than ``done_at`` reopens the thread.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Iterable

from config.settings import BOOKING_FORM_URL, GMAIL_ADDRESS, PUBLIC_BASE_URL
from src.models import email_message as em
from src.models import email_thread as et
from src.models.base import loads, query_one, serialize_row
from src.services import quote_split
from src.utils.logging import setup_logger

logger = setup_logger("conversations")

SNIPPET_CHARS = 200
OWN_SNIPPET_PREFIX = "You: "

VIEWS = et.VIEWS
CHIPS = et.CHIPS

TEMPLATES_SETTING_KEY = "templates"
DEFAULT_TEMPLATES: list[dict[str, str]] = [
    {
        "key": "price_list",
        "label": "Price list",
        "body_html": (
            "<p>Our group prices for the 2026/27 season are on our website: "
            '<a href="https://{website}">{website}</a>. Group rates apply to pre-booked groups of '
            "{min_people} or more on weekdays and to approved groups on weekends; school groups "
            "pay the school rate on weekdays.</p>"
        ),
    },
    {
        "key": "availability",
        "label": "Availability",
        "body_html": (
            "<p>Thank you for your enquiry. The date you have in mind is available for your group. "
            "If you would like us to hold it, let us know how many visitors are coming and we will "
            "send you a proforma invoice with your booking reference.</p>"
        ),
    },
    {
        "key": "deposit_terms",
        "label": "Deposit terms",
        "body_html": (
            "<p>A deposit of {deposit_percent}% of the proforma total secures your date (the minimum "
            "group size for group rates is {min_people}). The balance is payable on the day of your "
            "visit, based on the number of visitors who arrive. Please use your booking reference as "
            "the payment reference and send us the proof of payment.</p>"
        ),
    },
    {
        "key": "form_link",
        "label": "Booking request form",
        "body_html": (
            "<p>So that we can send you a quote quickly, please complete our short booking request "
            'form: <a href="{form_url}">{form_url}</a>. It asks for your group\'s name, the date you '
            "have in mind, how many visitors are coming and how you will be travelling.</p>"
        ),
    },
]


class ConversationError(Exception):
    """Caller mistake (unknown document, no recipient). Maps to 422."""


class ConversationNotFound(ConversationError):
    """No email_threads row for the id. Maps to 404."""


# ------------------------------------------------------------------ helpers ---


def _own_address() -> str:
    return (GMAIL_ADDRESS or "").lower()


def make_snippet(text: str | None, limit: int = SNIPPET_CHARS) -> str:
    collapsed = re.sub(r"\s+", " ", text or "").strip()
    return collapsed[:limit]


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = loads(value)
    return [str(v) for v in (value or [])]


def _iso(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    return value


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _counts_for_queue(message: dict) -> bool:
    """Does the message move the thread between Needs reply and Waiting?"""
    if message.get("is_auto_generated"):
        return False
    if message.get("direction") == "outbound" and message.get("send_status") == "failed":
        return False
    return True


def _new_text_of(message: dict) -> str:
    if int(message.get("split_version") or 0) > 0 and message.get("body_new_text") is not None:
        return message.get("body_new_text") or ""
    return message.get("body_text") or message.get("snippet") or ""


# ------------------------------------------------------------- derivation ---


def derive_thread(messages: list[dict], own_address: str | None = None) -> dict:
    """The derived ``email_threads`` columns for a thread's messages (oldest
    first). Pure: works on plain dicts and never touches the database."""
    own = (own_address if own_address is not None else _own_address()).lower()
    ordered = sorted(messages, key=lambda m: (m.get("sent_at") or datetime.min, m.get("id") or 0))
    if not ordered:
        return {}
    counting = [m for m in ordered if _counts_for_queue(m)]
    newest = ordered[-1]
    newest_counting = counting[-1] if counting else newest

    inbound = [m for m in ordered if m.get("direction") == "inbound"]
    inbound_real = [m for m in inbound if not m.get("is_auto_generated")]
    outbound_ok = [
        m for m in ordered
        if m.get("direction") == "outbound" and m.get("send_status") in (None, "sent")
    ]

    counterpart_email = None
    counterpart_name = None
    for m in inbound_real + inbound:
        addr = (m.get("from_email") or "").lower()
        if addr and addr != own:
            counterpart_email, counterpart_name = addr, (m.get("from_name") or None)
            break
    if counterpart_email is None:
        for m in ordered:
            for addr in _as_list(m.get("to_emails")) + _as_list(m.get("cc_emails")):
                if addr and addr.lower() != own:
                    counterpart_email = addr.lower()
                    break
            if counterpart_email:
                break

    booking_id = None
    for m in reversed(ordered):
        if m.get("booking_id"):
            booking_id = int(m["booking_id"])
            break

    snippet = make_snippet(_new_text_of(newest))
    if newest.get("direction") == "outbound":
        snippet = (OWN_SNIPPET_PREFIX + snippet)[:255]

    last_inbound_pool = inbound_real or inbound
    return {
        "booking_id": booking_id,
        "subject": quote_split.strip_reply_prefixes(ordered[0].get("subject"))[:500] or None,
        "counterpart_name": (counterpart_name or None),
        "counterpart_email": counterpart_email,
        "message_count": len(ordered),
        "last_message_at": newest.get("sent_at"),
        "last_inbound_at": max((m.get("sent_at") for m in last_inbound_pool if m.get("sent_at")), default=None),
        "last_outbound_at": max((m.get("sent_at") for m in outbound_ok if m.get("sent_at")), default=None),
        "last_direction": newest_counting.get("direction"),
        "last_snippet": snippet[:255] or None,
        "has_automated_only": all(bool(m.get("is_auto_generated")) for m in ordered),
    }


def should_reopen(existing: dict | None, derived: dict) -> bool:
    """A done thread reopens when a counting inbound message is newer than done_at."""
    if not existing or existing.get("status") != "done":
        return False
    if derived.get("last_direction") != "inbound":
        return False
    last_inbound = derived.get("last_inbound_at")
    done_at = existing.get("done_at")
    if last_inbound is None:
        return False
    if done_at is None:
        return True
    return last_inbound > done_at


def refresh_thread(gmail_thrid: int | None) -> dict | None:
    """Recompute the thread row from its messages. Returns the row, or None
    when the thread has no messages (its row is removed)."""
    if not gmail_thrid:
        return None
    thrid = int(gmail_thrid)
    messages = et.messages_for_thread(thrid)
    if not messages:
        if et.exists(thrid):
            et.delete(thrid)
        return None
    derived = derive_thread(messages)
    if derived.get("booking_id") is None:
        pointing = em.bookings_pointing_at_thread(thrid)
        if pointing:
            derived["booking_id"] = int(pointing[0]["id"])
    if derived.get("counterpart_name") is None and derived.get("booking_id"):
        booking = em.booking_by_id(derived["booking_id"])
        if booking and (booking.get("contact_email") or "").lower() == (derived.get("counterpart_email") or ""):
            derived["counterpart_name"] = booking.get("contact_name")
    existing = et.get(thrid)
    et.upsert(thrid, derived)
    if should_reopen(existing, derived):
        # Open again, but keep done_at: the party computation (waiting.py)
        # still needs to know everything up to the mark was handled.
        et.set_status(thrid, "open", None, keep_mark=True)
        logger.info(f"Thread {thrid} reopened by a new inbound message")
    return et.get(thrid)


def refresh_threads(thrids: Iterable[int | None]) -> int:
    seen: set[int] = set()
    for thrid in thrids:
        if thrid and int(thrid) not in seen:
            seen.add(int(thrid))
            refresh_thread(int(thrid))
    return len(seen)


# ---------------------------------------------------------------- shaping ---


def booking_summary(row: dict | None, prefix: str = "booking_") -> dict | None:
    if not row or not row.get("booking_id"):
        return None
    out = {
        "id": int(row["booking_id"]),
        "reference": row.get(f"{prefix}reference"),
        "group_name": row.get(f"{prefix}group_name"),
    }
    for extra in ("status", "visit_date", "contact_name"):
        if f"{prefix}{extra}" in row:
            out[extra] = _iso(row.get(f"{prefix}{extra}"))
    return out


def thread_to_api(row: dict | None) -> dict | None:
    if row is None:
        return None
    r = serialize_row(row) or {}
    last_in = row.get("last_inbound_at")
    last_out = row.get("last_outbound_at")
    unread = bool(last_in) and (last_out is None or last_in > last_out) and row.get("status") == "open"
    return {
        "thrid": str(row["gmail_thrid"]),
        "booking": booking_summary(row),
        "counterpart_name": r.get("counterpart_name"),
        "counterpart_email": r.get("counterpart_email"),
        "subject": r.get("subject"),
        "last_snippet": r.get("last_snippet"),
        "last_message_at": r.get("last_message_at"),
        "last_inbound_at": r.get("last_inbound_at"),
        "last_outbound_at": r.get("last_outbound_at"),
        "last_direction": r.get("last_direction"),
        "message_count": int(r.get("message_count") or 0),
        "status": r.get("status"),
        "not_booking": bool(r.get("not_booking")),
        "unread": unread,
        "has_attachments": bool(r.get("has_attachments")),
        "has_automated_only": bool(r.get("has_automated_only")),
        "done_at": r.get("done_at"),
        "done_by": r.get("done_by"),
        "created_at": r.get("created_at"),
        "updated_at": r.get("updated_at"),
    }


def _attachments_for(message_id: int) -> list[dict]:
    return [
        {
            "id": a["id"],
            "filename": a["filename"],
            "size_bytes": a["size_bytes"],
            "content_type": a["content_type"],
            "url": f"/api/v1/inbox/attachments/{a['id']}",
        }
        for a in em.list_attachments(message_id)
    ]


def message_item(row: dict, attachments: list[dict] | None = None) -> dict:
    """A stream item for an email_messages row (full select shape)."""
    r = serialize_row(row) or {}
    split = int(r.get("split_version") or 0) > 0
    new_html = r.get("body_new_html") if split else r.get("body_html")
    new_text = r.get("body_new_text") if split else r.get("body_text")
    quoted_html = r.get("body_quoted_html") if split else None
    quoted_lines = quote_split.count_lines(quote_split.html_to_text(quoted_html)) if quoted_html else 0
    signature = r.get("signature_text") if split else None
    direction = r.get("direction") or "inbound"
    return {
        "type": direction,
        "key": f"msg-{r['id']}",
        "id": r["id"],
        "at": r.get("sent_at"),
        "gmail_thrid": str(row["gmail_thrid"]) if row.get("gmail_thrid") else None,
        "from_name": r.get("from_name"),
        "from_email": r.get("from_email"),
        "to_emails": _as_list(row.get("to_emails")),
        "cc_emails": _as_list(row.get("cc_emails")),
        "subject": r.get("subject"),
        "kind": r.get("kind"),
        "snippet": r.get("snippet"),
        "body_new_html": new_html,
        "body_new_text": new_text,
        "body_quoted_html": quoted_html,
        "has_quoted": bool(quoted_html),
        "quoted_lines": quoted_lines,
        "signature_text": signature,
        "has_signature": bool(signature),
        "has_original_html": bool(r.get("body_html")),
        "split_version": int(r.get("split_version") or 0),
        "attachments": attachments if attachments is not None else _attachments_for(int(r["id"])),
        "has_attachments": bool(r.get("has_attachments")),
        "send_status": r.get("send_status"),
        "send_error": r.get("send_error"),
        "sent_by": r.get("sent_by"),
        "sent_by_name": r.get("sent_by_name"),
        "is_auto_generated": bool(r.get("is_auto_generated")),
        "booking": booking_summary(r),
        "match_method": r.get("match_method"),
        "review_status": r.get("review_status"),
        "message_id_header": r.get("message_id_header"),
    }


def note_item(row: dict) -> dict:
    r = serialize_row(row) or {}
    return {
        "type": "note",
        "key": f"note-{r['id']}",
        "id": r["id"],
        "at": r.get("created_at"),
        "body": r.get("body"),
        "author_user_id": r.get("author_user_id"),
        "author_name": r.get("author_name"),
        "source": "thread",
        "gmail_thrid": str(row["gmail_thrid"]) if row.get("gmail_thrid") else None,
        "booking_id": None,
    }


def _event_link(kind: str, booking_id: int, data: dict) -> dict | None:
    if kind == "document_issued" and data.get("document_id"):
        return {"kind": "document", "id": int(data["document_id"]), "booking_id": booking_id}
    if kind in ("email_sent", "email_failed", "email_received") and data.get("email_message_id"):
        return {"kind": "message", "id": int(data["email_message_id"]), "booking_id": booking_id}
    if kind in ("payment_recorded", "payment_matched", "payment_deleted", "payment_unmatched"):
        payment_id = data.get("payment_id") or (data.get("payment") or {}).get("id")
        return {
            "kind": "payment",
            "id": int(payment_id) if payment_id else None,
            "bank_transaction_id": data.get("bank_transaction_id"),
            "booking_id": booking_id,
        }
    return {"kind": "booking", "id": booking_id, "booking_id": booking_id}


def event_item(row: dict) -> dict:
    r = serialize_row(row) or {}
    data = loads(row.get("data")) or {}
    kind = r.get("kind") or ""
    booking_id = int(r["booking_id"])
    if kind == "note":
        return {
            "type": "note",
            "key": f"bnote-{r['id']}",
            "id": r["id"],
            "at": r.get("created_at"),
            "body": data.get("text") or r.get("summary"),
            "author_user_id": r.get("actor_user_id"),
            "author_name": r.get("actor_name"),
            "source": "booking",
            "gmail_thrid": data.get("gmail_thrid"),
            "booking_id": booking_id,
        }
    return {
        "type": "event",
        "key": f"event-{r['id']}",
        "id": r["id"],
        "at": r.get("created_at"),
        "kind": kind,
        "summary": r.get("summary"),
        "data": data,
        "actor_user_id": r.get("actor_user_id"),
        "actor_name": r.get("actor_name"),
        "booking_id": booking_id,
        "link": _event_link(kind, booking_id, data),
    }


_TYPE_RANK = {"inbound": 0, "outbound": 0, "note": 1, "event": 2}


def build_stream(
    messages: list[dict],
    thread_notes: list[dict],
    booking_events: list[dict],
) -> list[dict]:
    """Merge messages, notes and booking events into one chronological list.

    Booking-event mirrors of thread notes (``data.thread_note_id``) and
    email events for messages already in the stream are dropped so nothing
    shows twice.
    """
    items = [message_item(m) for m in messages]
    message_ids = {int(m["id"]) for m in messages}
    items.extend(note_item(n) for n in thread_notes)
    for ev in booking_events:
        data = loads(ev.get("data")) or {}
        if ev.get("kind") == "note" and data.get("thread_note_id"):
            continue
        if ev.get("kind") in ("email_sent", "email_failed", "email_received"):
            try:
                if int(data.get("email_message_id") or 0) in message_ids:
                    continue
            except (TypeError, ValueError):
                pass
        items.append(event_item(ev))
    items.sort(key=lambda i: (i.get("at") or "", _TYPE_RANK.get(i["type"], 9), int(i["id"])))
    return items


# ------------------------------------------------------------------ reads ---


def list_conversations(
    view: str = "needs_reply",
    q: str | None = None,
    chip: str | None = None,
    page: int = 1,
    page_size: int = 25,
    snap=None,
) -> tuple[list[dict], int]:
    """``needs_reply`` returns PARTIES (waiting.party_summary items, oldest
    unanswered first); every other view returns thread items, each with
    ``party_key`` and its own ``unanswered_count``."""
    from src.services import waiting

    snap = snap if snap is not None else waiting.build_snapshot()
    if view == "needs_reply":
        parties = waiting.waiting_parties(q=q, snap=snap)
        start = (max(1, int(page)) - 1) * int(page_size)
        return parties[start : start + int(page_size)], len(parties)
    rows, total = et.list_conversations(view=view, q=q, chip=chip, page=page, page_size=page_size)
    return waiting.annotate_threads([thread_to_api(r) or {} for r in rows], snap), total


def counts(snap=None) -> dict[str, int]:
    """Thread counts per view, except ``needs_reply`` which counts parties."""
    from src.services import waiting

    out = et.counts()
    out["needs_reply"] = waiting.waiting_count(snap)
    return out


def _thread_or_404(gmail_thrid: int) -> dict:
    row = et.get(int(gmail_thrid))
    if row is None:
        # Messages may exist without a thread row (pre-backfill); derive it on demand.
        row = refresh_thread(int(gmail_thrid))
    if row is None:
        raise ConversationNotFound(f"Conversation {gmail_thrid} not found")
    return row


def _booking_events(booking_id: int | None) -> list[dict]:
    if not booking_id:
        return []
    return em.booking_events_for(int(booking_id))


def get_conversation(gmail_thrid: int, snap=None) -> dict:
    """Thread + merged stream; message items carry ``unanswered`` (decided
    per party, docs/handoff/waiting-v3.md) and the thread its ``party_key``."""
    from src.services import waiting

    row = _thread_or_404(gmail_thrid)
    thrid = int(row["gmail_thrid"])
    messages = em.thread(thrid)
    notes = et.list_notes([thrid])
    events = _booking_events(row.get("booking_id"))
    snap = snap if snap is not None else waiting.build_snapshot()
    thread = waiting.annotate_threads([thread_to_api(row) or {}], snap)[0]
    items = waiting.mark_unanswered(build_stream(messages, notes, events), thread.get("party_key"), snap)
    return {
        "thread": thread,
        "booking": booking_summary(row),
        "party_key": thread.get("party_key"),
        "unanswered_count": thread.get("unanswered_count", 0),
        "items": items,
    }


def booking_conversation(booking_id: int, snap=None) -> dict:
    """The party stream for ``b:<id>``: every thread on the booking merged
    with its events; items carry ``unanswered`` and the response the party's
    ``unanswered_count``."""
    from src.services import waiting

    booking = em.booking_by_id(int(booking_id))
    if booking is None:
        raise ConversationNotFound(f"Booking {booking_id} not found")
    messages = em.messages_for_booking_threads(int(booking_id))
    thread_rows = et.list_for_booking(int(booking_id))
    thrids = {int(t["gmail_thrid"]) for t in thread_rows}
    for m in messages:
        if m.get("gmail_thrid") and int(m["gmail_thrid"]) not in thrids:
            refreshed = refresh_thread(int(m["gmail_thrid"]))
            if refreshed:
                thread_rows.append(refreshed)
                thrids.add(int(m["gmail_thrid"]))
                snap = None  # the snapshot predates this thread row
    notes = et.list_notes(sorted(thrids))
    events = _booking_events(int(booking_id))
    snap = snap if snap is not None else waiting.build_snapshot()
    party_key = f"b:{int(booking_id)}"
    threads = waiting.annotate_threads(
        [thread_to_api(t) or {} for t in sorted(thread_rows, key=lambda t: (t.get("last_message_at") or datetime.min))],
        snap,
    )
    return {
        "booking": {
            "id": int(booking["id"]),
            "reference": booking.get("reference"),
            "group_name": booking.get("group_name"),
            "status": booking.get("status"),
            "visit_date": _iso(booking.get("visit_date")),
            "contact_name": booking.get("contact_name"),
            "contact_email": booking.get("contact_email"),
            "email_thread_id": str(booking["email_thread_id"]) if booking.get("email_thread_id") else None,
        },
        "party_key": party_key,
        "unanswered_count": len(waiting.unanswered_messages(party_key, snap)),
        "threads": threads,
        "items": waiting.mark_unanswered(build_stream(messages, notes, events), party_key, snap),
    }


def suggestions(gmail_thrid: int) -> list[dict]:
    from src.services.mail_ingest import suggest_bookings

    _thread_or_404(gmail_thrid)
    latest = em.latest_for_thread(int(gmail_thrid), inbound_only=True) or em.latest_for_thread(int(gmail_thrid))
    if latest is None:
        return []
    return suggest_bookings(latest)


# ---------------------------------------------------------------- actions ---


def mark_done(gmail_thrid: int, actor: int | None) -> dict:
    thrid = int(_thread_or_404(gmail_thrid)["gmail_thrid"])
    et.set_status(thrid, "done", actor)
    em.set_review_status_for_thread(thrid, "resolved", actor, only_pending=True)
    return thread_to_api(et.get(thrid)) or {}


def reopen(gmail_thrid: int, actor: int | None) -> dict:
    thrid = int(_thread_or_404(gmail_thrid)["gmail_thrid"])
    et.set_status(thrid, "open", actor)
    return thread_to_api(et.get(thrid)) or {}


def set_not_booking(gmail_thrid: int, actor: int | None, value: bool = True) -> dict:
    """Flag a thread as not about a booking. Flagging also marks it done (it
    leaves every queue); a later inbound message reopens it but keeps the flag."""
    thrid = int(_thread_or_404(gmail_thrid)["gmail_thrid"])
    et.set_not_booking(thrid, value)
    if value:
        et.set_status(thrid, "done", actor)
        em.set_review_status_for_thread(thrid, "not_booking", actor)
    else:
        em.set_review_status_for_thread(thrid, "pending", actor)
    return thread_to_api(et.get(thrid)) or {}


# Hosts where an address says nothing about its neighbours: "Not a booking"
# learns the address, not the domain. Wildcards (yahoo.*, hotmail.*, …)
# are matched on the first label.
PUBLIC_MAILBOX_DOMAINS = frozenset(
    {
        "gmail.com", "googlemail.com", "icloud.com", "me.com", "mac.com", "webmail.co.za",
        "mweb.co.za", "telkomsa.net", "vodamail.co.za", "iafrica.com", "ymail.com", "msn.com",
        "aol.com", "protonmail.com", "proton.me", "lantic.net", "absamail.co.za", "polka.co.za",
    }
)
PUBLIC_MAILBOX_LABELS = frozenset({"gmail", "googlemail", "yahoo", "hotmail", "outlook", "live", "icloud", "ymail"})
NOT_BOOKING_SCOPES = ("address", "domain")


def is_public_mailbox(domain_or_address: str | None) -> bool:
    text = (domain_or_address or "").strip().lower()
    domain = text.rsplit("@", 1)[-1]
    if not domain:
        return False
    # yahoo.*, hotmail.*, outlook.*, live.* … including mail.yahoo.co.uk-style hosts.
    return domain in PUBLIC_MAILBOX_DOMAINS or bool(set(domain.split(".")) & PUBLIC_MAILBOX_LABELS)


def learn_scope_for(address: str | None, scope: str | None = None) -> str:
    """Explicit ``scope`` wins; else address for public mailboxes, domain otherwise."""
    if scope:
        if scope not in NOT_BOOKING_SCOPES:
            raise ConversationError("scope must be address or domain")
        return scope
    return "address" if is_public_mailbox(address) else "domain"


def not_booking(
    gmail_thrid: int,
    actor: int | None,
    *,
    learn: bool = False,
    scope: str | None = None,
    reason: str | None = None,
) -> dict:
    """Not a booking, per person: close every thread from the sender (done +
    not_booking) and, with ``learn``, remember the sender in
    ``mail_ignored_senders`` so the ingest drops its mail from now on.

    The scope (address vs the whole domain) follows ``learn_scope_for``; with
    domain scope every unlinked thread from that domain is closed too.
    Returns ``{"thread", "sender", "scope", "rule", "threads_closed"}``.
    """
    from src.models import ignored_sender

    row = _thread_or_404(gmail_thrid)
    thrid = int(row["gmail_thrid"])
    sender = (row.get("counterpart_email") or "").strip().lower() or None
    resolved_scope = learn_scope_for(sender, scope) if sender else "address"

    siblings: list[dict] = []
    if sender:
        siblings = et.list_for_counterpart(sender, domain=(resolved_scope == "domain"), unlinked_only=True)
    thrids = {thrid, *(int(t["gmail_thrid"]) for t in siblings)}
    et.set_not_booking_many(thrids, True)
    et.set_status_many(thrids, "done", actor)
    for t in sorted(thrids):
        em.set_review_status_for_thread(t, "not_booking", actor)

    rule = None
    if learn and sender:
        pattern = sender if resolved_scope == "address" else "@" + sender.rsplit("@", 1)[1]
        rule = ignored_sender.to_api(
            ignored_sender.add(pattern, reason or f"Not a booking (thread {thrid})", actor)
        )
        logger.info(f"Learned ignored sender {pattern} from thread {thrid}")
    return {
        "thread": thread_to_api(et.get(thrid)) or {},
        "sender": sender,
        "scope": resolved_scope,
        "rule": rule,
        "threads_closed": len(thrids),
    }


def _add_booking_event(booking_id: int, kind: str, summary: str, data: dict | None, actor: int | None) -> None:
    from src.services.mail_ingest import add_booking_event

    add_booking_event(booking_id, kind, summary, data, actor)


def attach(gmail_thrid: int, booking_id: int, actor: int | None, method: str = "manual") -> dict:
    """Link the whole thread (every message and the thread row) to a booking."""
    row = _thread_or_404(gmail_thrid)
    thrid = int(row["gmail_thrid"])
    booking = em.booking_by_id(int(booking_id))
    if booking is None:
        raise ConversationNotFound(f"Booking {booking_id} not found")
    linked = em.link_thread(thrid, int(booking_id), method)
    et.set_booking(thrid, int(booking_id))
    et.set_not_booking(thrid, False)
    em.set_booking_thread_if_null(int(booking_id), thrid)
    latest_inbound = em.latest_for_thread(thrid, inbound_only=True)
    if latest_inbound:
        _add_booking_event(
            int(booking_id),
            "email_received",
            (latest_inbound.get("subject") or row.get("subject") or "(no subject)")[:255],
            {
                "email_message_id": latest_inbound["id"],
                "from": latest_inbound.get("from_email"),
                "match_method": method,
                "gmail_thrid": str(thrid),
                "messages_linked": int(linked),
            },
            actor,
        )
    refresh_thread(thrid)
    return thread_to_api(et.get(thrid)) or {}


def detach(gmail_thrid: int, actor: int | None) -> dict:
    row = _thread_or_404(gmail_thrid)
    thrid = int(row["gmail_thrid"])
    booking_id = row.get("booking_id")
    if not booking_id:
        raise ConversationError("Conversation is not attached to a booking")
    em.detach_thread(thrid)
    et.set_booking(thrid, None)
    em.clear_booking_thread_if(int(booking_id), thrid)
    refresh_thread(thrid)
    return thread_to_api(et.get(thrid)) or {}


def add_note(gmail_thrid: int, body: str, actor: int | None) -> dict:
    row = _thread_or_404(gmail_thrid)
    thrid = int(row["gmail_thrid"])
    text = (body or "").strip()
    if not text:
        raise ConversationError("Note text is required")
    note_id = et.add_note(thrid, text, actor)
    if row.get("booking_id"):
        _add_booking_event(
            int(row["booking_id"]),
            "note",
            " ".join(text.split())[:255],
            {"text": text, "gmail_thrid": str(thrid), "thread_note_id": note_id},
            actor,
        )
    note = et.get_note(note_id)
    return note_item(note) if note else {"type": "note", "id": note_id, "body": text}


# ------------------------------------------------------------------ reply ---


def _document_attachment(doc_id: int, booking_id: int | None) -> tuple[tuple[str, bytes, str], int]:
    from src.services import documents as documents_service

    doc = documents_service.get_document(int(doc_id))
    if doc is None or not booking_id or int(doc["booking_id"]) != int(booking_id):
        raise ConversationError(f"Document {doc_id} does not belong to this conversation's booking")
    filename, data = documents_service.document_bytes(int(doc_id))
    return (filename, data, "application/pdf"), int(doc_id)


def _link_documents(document_ids: Iterable[int], email_message_id: int | None) -> None:
    if not email_message_id:
        return
    try:
        from src.models import document as document_model
    except Exception:  # noqa: BLE001
        return
    for doc_id in document_ids:
        try:
            document_model.set_email_message(int(doc_id), int(email_message_id))
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Could not link document {doc_id} to email {email_message_id}: {exc}")


def reply(
    gmail_thrid: int,
    *,
    body_html: str,
    body_text: str | None = None,
    subject: str | None = None,
    cc: Iterable[str] = (),
    attach_document_ids: Iterable[int] = (),
    mark_done_after: bool = False,
    actor: int | None,
) -> dict:
    """Send a reply into the thread. Returns ``{"item", "thread"}``; the item's
    ``send_status`` says whether the transport accepted it."""
    from src.services import mail_send

    row = _thread_or_404(gmail_thrid)
    thrid = int(row["gmail_thrid"])
    if not (body_html or "").strip():
        raise ConversationError("A reply body is required")
    latest = em.latest_for_thread(thrid)
    latest_inbound = em.latest_for_thread(thrid, inbound_only=True)
    parent = em.latest_for_thread(thrid, sendable_only=True)

    to: list[str] = []
    if latest_inbound and latest_inbound.get("from_email"):
        to = [latest_inbound["from_email"]]
    elif row.get("counterpart_email"):
        to = [row["counterpart_email"]]
    elif latest:
        to = [a for a in _as_list(latest.get("to_emails")) if a.lower() != _own_address()]
    if not to:
        raise ConversationError("The conversation has no address to reply to")

    reply_subject = (subject or "").strip() or mail_send.reply_subject_for(
        (latest_inbound or latest or {}).get("subject") or row.get("subject")
    )
    booking_id = int(row["booking_id"]) if row.get("booking_id") else None
    attachments: list[tuple[str, bytes, str]] = []
    link_ids: list[int] = []
    for doc_id in attach_document_ids:
        attachment, linked_id = _document_attachment(int(doc_id), booking_id)
        attachments.append(attachment)
        link_ids.append(linked_id)

    sent = mail_send.compose(
        to=to,
        cc=[str(c) for c in cc],
        subject=reply_subject,
        body_html=body_html,
        body_text=body_text,
        booking_id=booking_id,
        actor=actor,
        attachments=attachments,
        thread_message_id=(parent or {}).get("message_id_header"),
        gmail_thrid=thrid,
        kind="reply",
    )
    _link_documents(link_ids, sent.get("id"))
    refresh_thread(thrid)
    if mark_done_after and sent.get("send_status") == "sent":
        mark_done(thrid, actor)
    full = em.get(int(sent["id"])) if sent.get("id") else None
    return {
        "item": message_item(full) if full else sent,
        "thread": thread_to_api(et.get(thrid)),
    }


# -------------------------------------------------------------- templates ---


def _template_context() -> dict[str, str]:
    ctx = {
        "form_url": BOOKING_FORM_URL,
        "website": "www.farmyardpark.co.za",
        "phone": "",
        "signature_name": "",
        "deposit_percent": "30",
        "min_people": "40",
        "public_base_url": PUBLIC_BASE_URL,
    }
    try:
        from src.services.settings import get_settings

        s = get_settings()
        ctx.update(
            {
                "website": str(s.email.website or ctx["website"]).replace("https://", "").replace("http://", ""),
                "phone": str(s.email.phone or ""),
                "signature_name": str(s.email.signature_name or ""),
                "deposit_percent": str(s.deposit.percent),
                "min_people": str(s.deposit.min_people),
            }
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Template context falling back to defaults: {exc}")
    return ctx


def _render_template(text: str, ctx: dict[str, str]) -> str:
    out = text
    for key, value in ctx.items():
        out = out.replace("{" + key + "}", value)
    return out


def templates() -> list[dict]:
    """Canned composer snippets: the ``templates`` app_settings row
    (``{"items": [{key, label, subject?, body_html}]}`` or a bare list) merged
    over DEFAULT_TEMPLATES by key, with ``{form_url}``-style placeholders
    filled from settings."""
    stored: list[dict] = []
    try:
        row = query_one("SELECT value FROM app_settings WHERE setting_key = %s", (TEMPLATES_SETTING_KEY,))
        value = loads(row["value"]) if row else None
        if isinstance(value, dict):
            value = value.get("items")
        if isinstance(value, list):
            stored = [v for v in value if isinstance(v, dict) and v.get("key") and v.get("body_html")]
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not read templates setting: {exc}")
    merged: dict[str, dict] = {t["key"]: dict(t) for t in DEFAULT_TEMPLATES}
    for t in stored:
        merged[t["key"]] = {**merged.get(t["key"], {}), **t}
    ctx = _template_context()
    items = []
    for t in merged.values():
        body_html = _render_template(str(t.get("body_html") or ""), ctx)
        items.append(
            {
                "key": t["key"],
                "label": t.get("label") or t["key"].replace("_", " ").capitalize(),
                "subject": _render_template(str(t["subject"]), ctx) if t.get("subject") else None,
                "body_html": body_html,
                "body_text": quote_split.html_to_text(body_html),
            }
        )
    return items


__all__ = [
    "ConversationError",
    "ConversationNotFound",
    "VIEWS",
    "CHIPS",
    "DEFAULT_TEMPLATES",
    "TEMPLATES_SETTING_KEY",
    "derive_thread",
    "should_reopen",
    "refresh_thread",
    "refresh_threads",
    "thread_to_api",
    "message_item",
    "note_item",
    "event_item",
    "build_stream",
    "list_conversations",
    "counts",
    "get_conversation",
    "booking_conversation",
    "suggestions",
    "mark_done",
    "reopen",
    "set_not_booking",
    "not_booking",
    "is_public_mailbox",
    "learn_scope_for",
    "PUBLIC_MAILBOX_DOMAINS",
    "NOT_BOOKING_SCOPES",
    "attach",
    "detach",
    "add_note",
    "reply",
    "templates",
    "make_snippet",
]
