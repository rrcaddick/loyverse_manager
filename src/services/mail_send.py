"""Outbound email: build MIME, send over Gmail SMTP, record the message.

    row = send_email(to=[addr], rendered=RenderedEmail(...), attachments=[(name, data, mime)],
                     booking_id=12, kind="proforma", actor=user_id)
    row = send_bounce_back(message_id, actor)

Safety: outside production (``ENV != "prod"``) every recipient is rewritten to
``DEV_MAIL_RECIPIENT`` and the subject is prefixed ``[DEV → original@address]``.
``apply_dev_rewrite`` is the single place that decides this; do not bypass it.
Nothing in this module runs automatically; every call is a user action.
"""

from __future__ import annotations

import mimetypes
import re
from dataclasses import dataclass
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from typing import Any, Iterable, Sequence

from config.settings import BOOKING_FORM_URL, DEV_MAIL_RECIPIENT, ENV, GMAIL_ADDRESS, PUBLIC_BASE_URL
from src.clients.gmail import GmailError, GmailSmtp
from src.models import email_message as em
from src.services import conversations
from src.services.mail_ingest import add_booking_event, html_to_text, make_snippet, split_body
from src.utils.logging import setup_logger

logger = setup_logger("mail_send")

MESSAGE_ID_DOMAIN = "farmyardpark.co.za"
DEV_PREFIX = "[DEV → {original}] "

Attachment = tuple[str, bytes, str]  # (filename, data, content_type)


class MailSendError(Exception):
    """Raised for caller mistakes (no recipients, unknown message); send failures
    are recorded on the row and do not raise."""


@dataclass
class RenderedEmail:
    """Local stand-in for src.services.email_templates.RenderedEmail (same shape)."""

    subject: str
    html: str
    text: str


# ------------------------------------------------------------- helpers ---


def is_prod(env: str | None = None) -> bool:
    return (env if env is not None else ENV or "").strip().lower() == "prod"


def apply_dev_rewrite(
    to: Sequence[str], cc: Sequence[str], subject: str, env: str | None = None
) -> tuple[list[str], list[str], str]:
    """Outside prod, redirect everything to DEV_MAIL_RECIPIENT and tag the subject.

    Returns (to, cc, subject) to actually use.
    """
    to_clean = _clean_addresses(to)
    cc_clean = _clean_addresses(cc)
    if is_prod(env):
        return to_clean, cc_clean, subject
    originals = to_clean + [c for c in cc_clean if c not in to_clean]
    prefix = DEV_PREFIX.format(original=", ".join(originals) or "nobody")
    return [DEV_MAIL_RECIPIENT], [], prefix + (subject or "")


def _clean_addresses(values: Iterable[str] | None) -> list[str]:
    out: list[str] = []
    for v in values or []:
        addr = (v or "").strip()
        if addr and "@" in addr and addr.lower() not in {o.lower() for o in out}:
            out.append(addr)
    return out


def sender_name(settings=None) -> str:
    try:
        if settings is None:
            from src.services.settings import get_settings

            settings = get_settings()
        return str(settings.email.sender_name or "The Farmyard Park")
    except Exception:  # noqa: BLE001
        return "The Farmyard Park"


def _references_for(thread_message_id: str | None) -> tuple[str | None, str | None]:
    """(In-Reply-To, References) for a reply to ``thread_message_id``."""
    if not thread_message_id:
        return None, None
    parent = em.get_by_message_id_header(thread_message_id)
    chain: list[str] = []
    if parent and parent.get("references_header"):
        chain = re.findall(r"<[^>]+>", parent["references_header"])
    if thread_message_id not in chain:
        chain.append(thread_message_id)
    return thread_message_id, " ".join(chain[-20:])


def build_mime(
    *,
    from_addr: str,
    from_name: str,
    to: Sequence[str],
    subject: str,
    text: str,
    html: str | None,
    cc: Sequence[str] = (),
    attachments: Sequence[Attachment] = (),
    in_reply_to: str | None = None,
    references: str | None = None,
    message_id: str | None = None,
    date: datetime | None = None,
) -> EmailMessage:
    """multipart/mixed(multipart/alternative(text, html), attachments...)."""
    msg = EmailMessage()
    msg["From"] = formataddr((from_name, from_addr))
    msg["Reply-To"] = formataddr((from_name, from_addr))
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject or "(no subject)"
    msg["Date"] = formatdate(date.timestamp() if date else None, localtime=True)
    msg["Message-ID"] = message_id or make_msgid(domain=MESSAGE_ID_DOMAIN)
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
    if references:
        msg["References"] = references
    msg["X-Mailer"] = "Farmyard Manager"

    msg.set_content(text or html_to_text(html or "") or " ")
    if html:
        msg.add_alternative(html, subtype="html")
    for filename, data, content_type in attachments:
        ctype = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        maintype, _, subtype = ctype.partition("/")
        msg.add_attachment(data, maintype=maintype, subtype=subtype or "octet-stream", filename=filename)
    return msg


# --------------------------------------------------------------- send ---


def send_email(
    *,
    to: list[str],
    rendered,
    attachments: Sequence[Attachment] = (),
    booking_id: int | None,
    kind: str,
    actor: int | None,
    thread_message_id: str | None = None,
    cc: list[str] | tuple[str, ...] = (),
    gmail_thrid: int | None = None,
) -> dict:
    """Send a rendered email and record it. Returns the stored row (API shape).

    ``rendered`` is any object with ``.subject``, ``.html`` and ``.text``.
    A transport failure is recorded as ``send_status="failed"`` with the error
    and an ``email_failed`` booking event; it does not raise.

    ``gmail_thrid`` places the row in an existing conversation straight away
    (a reply from the inbox); otherwise the row borrows the booking's primary
    thread until the Sent-folder sync reports Gmail's real thread id. The
    conversation row is refreshed either way.
    """
    if not _clean_addresses(to):
        raise MailSendError("At least one recipient is required")
    if not GMAIL_ADDRESS:
        raise MailSendError("GMAIL_ADDRESS is not configured")

    booking = em.booking_by_id(booking_id) if booking_id else None
    if booking_id and booking is None:
        raise MailSendError(f"Booking {booking_id} not found")

    name = sender_name()
    parent_id = thread_message_id or (em.latest_message_id_for_booking(booking_id) if booking_id else None)
    in_reply_to, references = _references_for(parent_id)

    actual_to, actual_cc, actual_subject = apply_dev_rewrite(to, cc, rendered.subject)
    message_id = make_msgid(domain=MESSAGE_ID_DOMAIN)
    now = datetime.now().replace(microsecond=0)
    mime = build_mime(
        from_addr=GMAIL_ADDRESS,
        from_name=name,
        to=actual_to,
        cc=actual_cc,
        subject=actual_subject,
        text=rendered.text,
        html=rendered.html,
        attachments=attachments,
        in_reply_to=in_reply_to,
        references=references,
        message_id=message_id,
        date=now,
    )

    send_status, send_error = "sent", None
    try:
        GmailSmtp().send(GMAIL_ADDRESS, actual_to + actual_cc, mime.as_bytes())
    except GmailError as exc:
        send_status, send_error = "failed", str(exc)[:2000]
        logger.error(f"Send failed ({kind}) to {actual_to}: {exc}")
    except Exception as exc:  # noqa: BLE001
        send_status, send_error = "failed", f"{type(exc).__name__}: {exc}"[:2000]
        logger.error(f"Send failed ({kind}) to {actual_to}: {exc}", exc_info=True)

    thrid = int(gmail_thrid) if gmail_thrid else ((booking or {}).get("email_thread_id") if booking else None)
    split = split_body(rendered.html, rendered.text, own_template=True)
    row_id = em.insert_outbound(
        {
            "gmail_thrid": thrid,
            "message_id_header": message_id,
            "in_reply_to": in_reply_to,
            "references_header": references,
            "kind": kind,
            "from_name": name,
            "from_email": GMAIL_ADDRESS.lower(),
            "to_emails": actual_to,
            "cc_emails": actual_cc,
            "subject": actual_subject[:500],
            "sent_at": now,
            "snippet": make_snippet(split["new_text"] or rendered.text or ""),
            "body_text": rendered.text,
            "body_html": rendered.html,
            "body_new_html": split["new_html"],
            "body_new_text": split["new_text"] or None,
            "body_quoted_html": split["quoted_html"],
            "signature_text": split["signature_text"],
            "split_version": split["split_version"],
            "has_attachments": bool(attachments),
            "booking_id": booking_id,
            "match_method": "sent" if booking_id else None,
            "is_auto_generated": False,
            "send_status": send_status,
            "send_error": send_error,
            "sent_by": actor,
            "attachments_meta": [
                {"filename": fn, "size": len(data), "content_type": ct} for fn, data, ct in attachments
            ]
            or None,
        }
    )
    if booking_id:
        add_booking_event(
            booking_id,
            "email_sent" if send_status == "sent" else "email_failed",
            actual_subject[:255],
            {
                "email_message_id": row_id,
                "kind": kind,
                "to": actual_to,
                "error": send_error,
                "attachments": [fn for fn, _d, _c in attachments],
            },
            actor,
        )
    if thrid:
        try:
            conversations.refresh_thread(int(thrid))
        except Exception as exc:  # noqa: BLE001 - the send already happened; never fail it here
            logger.error(f"Thread refresh after send failed for {thrid}: {exc}")
    logger.info(f"Email {kind} -> {actual_to}: {send_status} (row {row_id})")
    return em.to_api(em.get(row_id), full=True) or {"id": row_id, "send_status": send_status}


# -------------------------------------------------------- bounce back ---


def _form_url() -> str:
    return BOOKING_FORM_URL


def logo_url() -> str:
    """Public https URL of the email logo (templates fall back to a wordmark)."""
    return f"{PUBLIC_BASE_URL}/static/brand/logo-black-600.png"


def reply_subject_for(original_subject: str | None, default: str = "Your enquiry to The Farmyard Park") -> str:
    """'Re: <original>' unless it already starts with Re:/RE:; default when blank."""
    subject = (original_subject or "").strip()
    if not subject:
        return default
    if re.match(r"^(re|aw|antw)\s*:", subject, re.IGNORECASE):
        return subject[:200]
    return f"Re: {subject}"[:200]


def _fallback_bounce_back(settings, form_url: str, original_subject: str | None) -> RenderedEmail:
    s = settings.email
    subject = reply_subject_for(original_subject)
    text = (
        "Good day\n\n"
        "Thank you for contacting The Farmyard Park about a group visit.\n\n"
        "So that we can send you a quote quickly, please complete our short booking request form:\n"
        f"{form_url}\n\n"
        "It asks for your group's name, the date you have in mind, how many adults and children "
        "are coming and how you will be travelling. We will come back to you with a proforma and "
        "your booking reference.\n\n"
        f"Kind regards\n{s.signature_name}\n{s.signature_title}\n{s.signature_company}\n"
        f"{s.phone} | {s.website}\n"
    )
    html = (
        "<p>Good day</p><p>Thank you for contacting The Farmyard Park about a group visit.</p>"
        "<p>So that we can send you a quote quickly, please complete our short booking request form:</p>"
        f'<p><a href="{form_url}">{form_url}</a></p>'
        "<p>It asks for your group's name, the date you have in mind, how many adults and children "
        "are coming and how you will be travelling. We will come back to you with a proforma and "
        "your booking reference.</p>"
        f"<p>Kind regards<br>{s.signature_name}<br>{s.signature_title}<br>{s.signature_company}<br>"
        f"{s.phone} | {s.website}</p>"
    )
    return RenderedEmail(subject=subject, html=html, text=text)


def render(kind: str, booking: dict | None, settings, **ctx):
    """Render through src.services.email_templates when it exists."""
    try:
        from src.services.email_templates import render_email  # type: ignore[import-not-found]
    except Exception:  # noqa: BLE001
        return None
    return render_email(kind, booking, settings, **ctx)


def send_bounce_back(message_id: int, actor: int | None) -> dict:
    """Reply to an unknown sender with the booking-form link. Manual action only."""
    from src.services.settings import get_settings

    msg = em.get(message_id)
    if msg is None:
        raise MailSendError("Message not found")
    if msg.get("direction") != "inbound" or not msg.get("from_email"):
        raise MailSendError("Only inbound messages with a sender can be bounced back")
    settings = get_settings()
    if not settings.email.bounce_back_enabled:  # type: ignore[attr-defined]
        raise MailSendError("Bounce-backs are disabled in settings")

    form_url = _form_url()
    # Keep the customer's subject: Gmail only threads replies whose normalised
    # subject matches, even when In-Reply-To/References are right.
    reply_subject = reply_subject_for(msg.get("subject"))
    rendered = render(
        "bounce_back", None, settings, form_url=form_url, subject=reply_subject, logo_url=logo_url()
    ) or _fallback_bounce_back(settings, form_url, msg.get("subject"))

    row = send_email(
        to=[msg["from_email"]],
        rendered=rendered,
        booking_id=None,
        kind="bounce_back",
        actor=actor,
        thread_message_id=msg.get("message_id_header"),
    )
    if row and row.get("send_status") == "sent":
        now = datetime.now().replace(microsecond=0)
        em.set_bounce_back(msg["from_email"], now)
        em.set_bounce_back_sent(message_id, now)
        if msg.get("gmail_thrid"):
            em.update(row["id"], gmail_thrid=msg["gmail_thrid"])
            row["gmail_thrid"] = str(msg["gmail_thrid"])
            conversations.refresh_thread(int(msg["gmail_thrid"]))
    return row


# ------------------------------------------------------------ compose ---


def compose(
    *,
    to: list[str],
    subject: str,
    body_html: str,
    booking_id: int | None,
    actor: int | None,
    cc: list[str] | tuple[str, ...] = (),
    attachments: Sequence[Attachment] = (),
    body_text: str | None = None,
    thread_message_id: str | None = None,
    gmail_thrid: int | None = None,
    kind: str | None = None,
) -> dict:
    """Free-text email from the inbox. kind 'reply' on a booking, else 'custom'
    (or the ``kind`` given). ``thread_message_id``/``gmail_thrid`` thread a
    reply into an existing conversation."""
    from src.services.settings import get_settings

    settings = get_settings()
    booking = em.booking_by_id(booking_id) if booking_id else None
    if booking_id and booking is None:
        raise MailSendError(f"Booking {booking_id} not found")
    rendered = render("reply", booking, settings, subject=subject, body_html=body_html, logo_url=logo_url())
    if rendered is None:
        rendered = RenderedEmail(subject=subject, html=body_html, text=body_text or html_to_text(body_html))
    elif body_text and body_text.strip():
        # The template's own text rendering is fine, but the composer's plain text is truer.
        rendered = RenderedEmail(subject=rendered.subject, html=rendered.html, text=body_text)
    return send_email(
        to=to,
        cc=cc,
        rendered=rendered,
        attachments=attachments,
        booking_id=booking_id,
        kind=kind or ("reply" if booking_id else "custom"),
        actor=actor,
        thread_message_id=thread_message_id,
        gmail_thrid=gmail_thrid,
    )
