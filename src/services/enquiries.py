"""Enquiries: unmatched conversations that are waiting on us.

An enquiry is a wrapper for a conversation: reply, convert to a booking
request (re-send the form with a token so the request attaches on arrival),
create the request on the customer's behalf, attach to an existing booking,
or resolve. "Not a booking" is a per-thread decision that hands the thread
back to Gmail; nothing is learned about the sender.
"""

from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any, Iterable
from urllib.parse import urlencode

from config.settings import BOOKING_FORM_URL
from src.models import email_message as em
from src.models import email_thread as et
from src.models import enquiry as enquiry_model
from src.models.base import serialize_row
from src.services import conversations
from src.utils.logging import setup_logger

logger = setup_logger("enquiries")


class EnquiryError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "enquiry_error"):
        super().__init__(message)
        self.status = status
        self.code = code


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _require(enquiry_id: int) -> dict:
    e = enquiry_model.get(int(enquiry_id))
    if e is None:
        raise EnquiryError("Enquiry not found", 404, "not_found")
    return e


def create_from_message(row: dict) -> int:
    """One enquiry per conversation; the message is attached to it."""
    thrid = int(row["gmail_thrid"]) if row.get("gmail_thrid") else None
    existing = enquiry_model.get_by_thread(thrid) if thrid else None
    if existing:
        enquiry_model.touch_inbound(int(existing["id"]), row.get("sent_at"), row.get("snippet"))
        em.update(int(row["id"]), enquiry_id=int(existing["id"]), inbound_outcome="enquiry", processed_at=_now())
        return int(existing["id"])
    count = len(em.thread(thrid)) if thrid else 1
    eid = enquiry_model.create(
        thrid or 0, row.get("from_email") or "", row.get("from_name"), row.get("subject"),
        row.get("sent_at"), row.get("sent_at"), row.get("snippet"), max(1, count),
    )
    em.update(int(row["id"]), enquiry_id=eid, inbound_outcome="enquiry", processed_at=_now())
    if thrid:
        from src.models.base import execute

        execute("UPDATE email_messages SET enquiry_id = %s WHERE gmail_thrid = %s AND enquiry_id IS NULL", (eid, thrid))
    logger.info(f"Enquiry {eid} created from {row.get('from_email')} ({(row.get('subject') or '')[:60]!r})")
    return eid


def serialize(e: dict) -> dict:
    out = serialize_row(e) or {}
    out["waiting"] = e["status"] in enquiry_model.OPEN_STATUSES
    return out


def list_enquiries(status: str | None = "open", q: str | None = None, page: int = 1, page_size: int = 50) -> dict:
    data = enquiry_model.list_enquiries(status, q, page, page_size)
    data["items"] = [serialize(e) for e in data["items"]]
    data["counts"] = enquiry_model.counts()
    return data


def detail(enquiry_id: int) -> dict:
    e = _require(enquiry_id)
    conversation = None
    if e.get("gmail_thrid"):
        try:
            conversation = conversations.get_conversation(int(e["gmail_thrid"]))
        except Exception:  # noqa: BLE001
            conversation = None
    return {"enquiry": serialize(e), "conversation": conversation, "form_link": form_link(e)}


def reply(enquiry_id: int, *, body_html: str, body_text: str | None, cc: Iterable[str], actor: int | None) -> dict:
    e = _require(enquiry_id)
    result = conversations.reply(int(e["gmail_thrid"]), body_html=body_html, body_text=body_text, cc=cc, actor=actor)
    enquiry_model.touch_outbound(int(e["id"]), _now())
    return {"enquiry": serialize(enquiry_model.get(int(e["id"]))), "sent": result}


def resolve(enquiry_id: int, actor: int | None) -> dict:
    e = _require(enquiry_id)
    enquiry_model.set_status(int(e["id"]), "resolved", actor)
    try:
        conversations.mark_done(int(e["gmail_thrid"]), actor)
    except Exception:  # noqa: BLE001
        pass
    return serialize(enquiry_model.get(int(e["id"])))


def reopen(enquiry_id: int, actor: int | None) -> dict:
    e = _require(enquiry_id)
    enquiry_model.set_status(int(e["id"]), "open", actor)
    try:
        conversations.reopen(int(e["gmail_thrid"]), actor)
    except Exception:  # noqa: BLE001
        pass
    return serialize(enquiry_model.get(int(e["id"])))


def not_booking(enquiry_id: int, actor: int | None) -> dict:
    """Per-thread only: the conversation goes back to Gmail and later replies
    in it stay out of the app. Nothing is learned about the sender."""
    e = _require(enquiry_id)
    enquiry_model.set_status(int(e["id"]), "not_booking", actor)
    try:
        conversations.set_not_booking(int(e["gmail_thrid"]), actor, True)
    except Exception:  # noqa: BLE001
        et.set_not_booking(int(e["gmail_thrid"]), True)
    from src.models.base import execute

    execute(
        "UPDATE email_messages SET inbound_outcome = 'not_booking', label_applied = NULL WHERE enquiry_id = %s",
        (int(e["id"]),),
    )
    _unlabel(int(e["gmail_thrid"]))
    return serialize(enquiry_model.get(int(e["id"])))


def _unlabel(thrid: int) -> None:
    """Best effort: take the Enquiries label off the conversation."""
    try:
        from src.clients.gmail import INBOX, GmailImapWriter
        from src.services.inbound import _cfg

        cfg = _cfg()
        if not cfg.get("labels_enabled", True):
            return
        rows = em.thread(int(thrid))
        with GmailImapWriter() as imap:
            imap.select(INBOX, readonly=False)
            for r in rows:
                if r.get("gmail_msgid"):
                    uids = imap.search_msgid(int(r["gmail_msgid"]))
                    if uids:
                        imap.remove_label(uids, str(cfg["label_enquiries"]))
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Could not remove the label from thread {thrid}: {exc}")


def form_link(e: dict) -> str:
    """The public form, pre-filled and tied to the enquiry by token."""
    params: dict[str, Any] = {}
    if e.get("convert_token"):
        params["enquiry"] = e["convert_token"]
    if e.get("sender_email"):
        params["email"] = e["sender_email"]
    if e.get("sender_name"):
        params["name"] = e["sender_name"]
    extracted = e.get("extracted")
    if isinstance(extracted, str):
        import json

        try:
            extracted = json.loads(extracted)
        except Exception:  # noqa: BLE001
            extracted = None
    if isinstance(extracted, dict):
        for key, param in (("group_name", "group"), ("visit_date", "date"), ("people_booked", "people"), ("contact_mobile", "mobile")):
            if extracted.get(key):
                params[param] = extracted[key]
    return f"{BOOKING_FORM_URL}?{urlencode(params)}" if params else BOOKING_FORM_URL


def prefill(enquiry_id: int) -> dict:
    """What the conversation says (Claude extraction when configured)."""
    e = _require(enquiry_id)
    rows = em.thread(int(e["gmail_thrid"])) if e.get("gmail_thrid") else []
    text = "\n\n".join((r.get("body_new_text") or r.get("body_text") or "") for r in rows if r.get("direction") == "inbound")[:12000]
    data: dict[str, Any] = {"contact_email": e.get("sender_email"), "contact_name": e.get("sender_name")}
    try:
        from src.services.extraction import extract_booking_fields

        found = extract_booking_fields(text, e.get("subject") or "") or {}
        data.update({k: v for k, v in found.items() if v not in (None, "", [])})
    except Exception as exc:  # noqa: BLE001
        logger.info(f"Extraction unavailable for enquiry {enquiry_id}: {exc}")
    from src.services import matching as mt

    mobiles = mt.mobiles_in_text(text)
    if mobiles and not data.get("contact_mobile"):
        data["contact_mobile"] = sorted(mobiles)[0]
    enquiry_model.update(int(e["id"]), extracted=data)
    return data


def convert(enquiry_id: int, actor: int | None) -> dict:
    """Send the customer the form link, tied to the enquiry by token. The
    request that arrives through it is attached automatically."""
    e = _require(enquiry_id)
    if e["status"] not in enquiry_model.OPEN_STATUSES:
        raise EnquiryError("Only an open enquiry can be converted", 409, "invalid_state")
    token = e.get("convert_token") or secrets.token_urlsafe(24)[:64]
    enquiry_model.update(int(e["id"]), convert_token=token)
    e = enquiry_model.get(int(e["id"])) or e
    link = form_link(e)
    from src.services import mail_send
    from src.services.settings import get_settings

    settings = get_settings()
    rendered = mail_send.render("convert_enquiry", None, settings, form_url=link, logo_url=mail_send.logo_url(),
                                subject=mail_send.reply_subject_for(e.get("subject"), default="Your group visit"))
    if rendered is None:
        raise EnquiryError("The convert email template is missing", 500, "render_failed")
    latest = em.latest_for_thread(int(e["gmail_thrid"]), inbound_only=True)
    sent = mail_send.send_email(
        to=[e["sender_email"]], rendered=rendered, booking_id=None, kind="convert_enquiry", actor=actor,
        thread_message_id=(latest or {}).get("message_id_header"), gmail_thrid=int(e["gmail_thrid"]),
    )
    enquiry_model.update(int(e["id"]), convert_sent_at=_now())
    enquiry_model.touch_outbound(int(e["id"]), _now())
    return {"enquiry": serialize(enquiry_model.get(int(e["id"]))), "sent": sent, "form_link": link}


def create_request(enquiry_id: int, data: dict, actor: int | None) -> dict:
    """Linda fills the form on the customer's behalf: a booking request that
    still goes through the accept step, with the conversation attached."""
    e = _require(enquiry_id)
    from src.services import booking as booking_service

    payload = dict(data or {})
    payload.setdefault("contact_email", e.get("sender_email"))
    payload.setdefault("contact_name", e.get("sender_name") or payload.get("contact_email"))
    payload["status"] = "requested"
    booking = booking_service.create_booking(payload, source="email", actor=actor)
    return attach(int(e["id"]), int(booking["id"]), actor, converted=True)


def attach(enquiry_id: int, booking_id: int, actor: int | None, *, converted: bool = False) -> dict:
    e = _require(enquiry_id)
    booking = em.booking_by_id(int(booking_id))
    if booking is None:
        raise EnquiryError("Booking not found", 404, "not_found")
    conversations.attach(int(e["gmail_thrid"]), int(booking_id), actor, method="enquiry")
    from src.models.base import execute

    execute("UPDATE bookings SET enquiry_id = %s WHERE id = %s AND enquiry_id IS NULL", (int(e["id"]), int(booking_id)))
    execute(
        "UPDATE email_messages SET inbound_outcome = 'booking', label_applied = NULL WHERE enquiry_id = %s AND booking_id = %s",
        (int(e["id"]), int(booking_id)),
    )
    enquiry_model.update(int(e["id"]), booking_id=int(booking_id))
    enquiry_model.set_status(int(e["id"]), "converted" if converted else "attached", actor)
    return {"enquiry": serialize(enquiry_model.get(int(e["id"]))), "booking_id": int(booking_id)}


def attach_request_by_token(token: str, booking_id: int) -> dict | None:
    """Called by the public form: the request created through a convert link
    attaches to its enquiry whatever address the customer typed."""
    e = enquiry_model.get_by_token(token) if token else None
    if not e or e["status"] not in enquiry_model.OPEN_STATUSES:
        return None
    return attach(int(e["id"]), int(booking_id), None, converted=True)
