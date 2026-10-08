"""Helpdesk inbox API (admin only). Contract: docs/booking-system.md §6,
shapes: docs/handoff/mail.md."""

from __future__ import annotations

from pathlib import Path

from flask import request, send_file

from config.settings import DATA_DIR
from src.models import email_message as em
from src.services import extraction, mail_ingest, mail_send
from web.api import ApiError, current_user_id, make_blueprint, ok, page_args, parse_json, require_role

bp = make_blueprint("inbox", "/inbox")

RESOLVE_STATUSES = ("resolved", "not_booking", "pending")


def _message_or_404(message_id: int) -> dict:
    msg = em.get(message_id)
    if msg is None:
        raise ApiError("not_found", "Message not found", 404)
    return msg


def _int_arg(name: str) -> int | None:
    raw = request.args.get(name)
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        raise ApiError("validation_error", f"{name} must be an integer", 400)


def _full(row: dict) -> dict:
    """Full API shape with the attachment list attached."""
    item = em.to_api(row, full=True) or {}
    item["attachments"] = [
        {
            "id": a["id"],
            "filename": a["filename"],
            "size_bytes": a["size_bytes"],
            "content_type": a["content_type"],
            "url": f"/api/v1/inbox/attachments/{a['id']}",
        }
        for a in em.list_attachments(row["id"])
    ]
    return item


def _thrid(value: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError("validation_error", "Thread id must be numeric", 400)


# --------------------------------------------------------------- lists ---


@bp.get("/messages")
@require_role("admin")
def list_messages():
    view = request.args.get("view", "all")
    if view not in em.VIEWS:
        raise ApiError("validation_error", f"view must be one of {', '.join(em.VIEWS)}", 400)
    booking_id = _int_arg("booking_id")
    if view == "booking" and not booking_id:
        raise ApiError("validation_error", "booking_id is required for view=booking", 400)
    page, page_size = page_args(default_size=25, max_size=200)
    items, total = em.list_messages(
        view=view, booking_id=booking_id, q=request.args.get("q") or None, page=page, page_size=page_size
    )
    return ok(
        {"items": items, "total": total, "page": page, "page_size": page_size, "counts": em.counts()}
    )


@bp.get("/messages/<int:message_id>")
@require_role("admin")
def get_message(message_id: int):
    msg = _message_or_404(message_id)
    item = _full(msg)
    item["thread"] = em.thread_summary(msg.get("gmail_thrid"))
    if msg.get("from_email"):
        item["bounce_back"] = em.get_bounce_back(msg["from_email"])
    return ok(item)


@bp.get("/threads/<thrid>")
@require_role("admin")
def get_thread(thrid: str):
    gmail_thrid = _thrid(thrid)
    rows = em.thread(gmail_thrid)
    if not rows:
        raise ApiError("not_found", "Thread not found", 404)
    messages = [_full(row) for row in rows]
    booking = next((m["booking"] for m in messages if m.get("booking")), None)
    return ok({"gmail_thrid": str(gmail_thrid), "booking": booking, "messages": messages,
               "summary": em.thread_summary(gmail_thrid)})


@bp.get("/messages/<int:message_id>/suggestions")
@require_role("admin")
def suggestions(message_id: int):
    msg = _message_or_404(message_id)
    return ok({"items": mail_ingest.suggest_bookings(msg)})


# ------------------------------------------------------------- actions ---


@bp.post("/messages/<int:message_id>/attach")
@require_role("admin")
def attach(message_id: int):
    data = parse_json(("booking_id",))
    msg = _message_or_404(message_id)
    try:
        booking_id = int(data["booking_id"])
    except (TypeError, ValueError):
        raise ApiError("validation_error", "booking_id must be an integer", 422)
    booking = em.booking_by_id(booking_id)
    if booking is None:
        raise ApiError("not_found", "Booking not found", 404)
    whole_thread = bool(data.get("whole_thread", False))
    ids = em.link_to_booking(message_id, booking_id, "manual", whole_thread=whole_thread)
    if msg.get("gmail_thrid"):
        em.set_booking_thread_if_null(booking_id, int(msg["gmail_thrid"]))
    actor = current_user_id()
    if msg.get("direction") == "inbound":
        mail_ingest.add_booking_event(
            booking_id,
            "email_received",
            (msg.get("subject") or "(no subject)")[:255],
            {"email_message_id": message_id, "from": msg.get("from_email"), "match_method": "manual",
             "whole_thread": whole_thread, "linked_ids": ids},
            actor,
        )
    return ok({"linked_ids": ids, "message": _full(_message_or_404(message_id))})


@bp.post("/messages/<int:message_id>/detach")
@require_role("admin")
def detach(message_id: int):
    msg = _message_or_404(message_id)
    if not msg.get("booking_id"):
        raise ApiError("conflict", "Message is not attached to a booking", 409)
    pending = msg.get("direction") == "inbound" and not msg.get("is_auto_generated")
    em.detach(message_id, pending=pending)
    return ok({"message": _full(_message_or_404(message_id))})


@bp.post("/messages/<int:message_id>/resolve")
@require_role("admin")
def resolve(message_id: int):
    data = parse_json(("status",))
    status = str(data["status"])
    if status not in RESOLVE_STATUSES:
        raise ApiError("validation_error", f"status must be one of {', '.join(RESOLVE_STATUSES)}", 422)
    _message_or_404(message_id)
    em.set_review_status(message_id, status, current_user_id())
    return ok({"message": _full(_message_or_404(message_id)), "counts": em.counts()})


@bp.post("/messages/<int:message_id>/extract")
@require_role("admin")
def extract(message_id: int):
    msg = _message_or_404(message_id)
    fields = extraction.extract_booking_fields(msg.get("body_text") or "", subject=msg.get("subject") or "")
    if fields == {}:
        raise ApiError("not_configured", "ANTHROPIC_API_KEY is not set", 503)
    if "error" in fields and len(fields) == 1:
        raise ApiError("extraction_failed", fields["error"], 502)
    # Sensible defaults the model cannot know: fall back to the sender's details.
    if not fields.get("contact_email") and msg.get("from_email"):
        fields["contact_email"] = msg["from_email"]
    if not fields.get("contact_name") and msg.get("from_name"):
        fields["contact_name"] = msg["from_name"]
    return ok({"fields": fields, "message_id": message_id})


@bp.post("/messages/<int:message_id>/bounce-back")
@require_role("admin")
def bounce_back(message_id: int):
    _message_or_404(message_id)
    try:
        row = mail_send.send_bounce_back(message_id, current_user_id())
    except mail_send.MailSendError as exc:
        raise ApiError("validation_error", str(exc), 422)
    status = 200 if row.get("send_status") == "sent" else 502
    return ok({"sent": row, "message": _full(_message_or_404(message_id))}, status)


# --------------------------------------------------------- attachments ---


@bp.get("/attachments/<int:attachment_id>")
@require_role("admin")
def download_attachment(attachment_id: int):
    att = em.get_attachment(attachment_id)
    if att is None:
        raise ApiError("not_found", "Attachment not found", 404)
    root = (DATA_DIR / "attachments").resolve()
    path = (DATA_DIR / att["file_path"]).resolve()
    if root not in path.parents or not path.is_file():
        raise ApiError("not_found", "Attachment file is missing", 404)
    inline = request.args.get("inline") == "1"
    response = send_file(
        path,
        mimetype=att.get("content_type") or "application/octet-stream",
        as_attachment=not inline,
        download_name=att["filename"],
        conditional=True,
    )
    response.headers["Cache-Control"] = "private, no-store"
    return response


# -------------------------------------------------------- sync/compose ---


@bp.post("/sync")
@require_role("admin")
def sync():
    summary = mail_ingest.sync_mailbox(full=False)
    summary["counts"] = em.counts()
    return ok(summary, 200 if summary.get("ok") else 502)


@bp.post("/compose")
@require_role("admin")
def compose():
    data = parse_json(("to", "subject", "body_html"))
    to = data["to"] if isinstance(data["to"], list) else [data["to"]]
    cc = data.get("cc") or []
    if not isinstance(cc, list):
        cc = [cc]
    booking_id = data.get("booking_id")
    if booking_id is not None:
        try:
            booking_id = int(booking_id)
        except (TypeError, ValueError):
            raise ApiError("validation_error", "booking_id must be an integer", 422)
    try:
        row = mail_send.compose(
            to=[str(a) for a in to],
            cc=[str(a) for a in cc],
            subject=str(data["subject"]),
            body_html=str(data["body_html"]),
            booking_id=booking_id,
            actor=current_user_id(),
        )
    except mail_send.MailSendError as exc:
        raise ApiError("validation_error", str(exc), 422)
    return ok({"message": row}, 201 if row.get("send_status") == "sent" else 502)
