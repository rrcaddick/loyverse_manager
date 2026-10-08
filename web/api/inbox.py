"""Helpdesk inbox API (admin only). Contract: docs/booking-system.md §6,
shapes: docs/handoff/mail.md (per-message endpoints, kept for the current UI)
and docs/handoff/mail-v2.md (conversations).

The blueprint has no prefix of its own so that ``/bookings/:id/conversation``
can be served from here as well; every inbox rule carries ``/inbox`` itself.
"""

from __future__ import annotations

from flask import request, send_file

from config.settings import DATA_DIR, PUBLIC_BASE_URL
from src.models import email_message as em
from src.services import conversations, extraction, mail_ingest, mail_send, quote_split
from web.api import ApiError, current_user_id, make_blueprint, ok, page_args, parse_json, require_role

bp = make_blueprint("inbox", "")

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


def _conversation_errors(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except conversations.ConversationNotFound as exc:
        raise ApiError("not_found", str(exc), 404)
    except conversations.ConversationError as exc:
        raise ApiError("validation_error", str(exc), 422)
    except mail_send.MailSendError as exc:
        raise ApiError("validation_error", str(exc), 422)


# --------------------------------------------------------------- lists ---


@bp.get("/inbox/messages")
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


@bp.get("/inbox/messages/<int:message_id>")
@require_role("admin")
def get_message(message_id: int):
    msg = _message_or_404(message_id)
    item = _full(msg)
    item["thread"] = em.thread_summary(msg.get("gmail_thrid"))
    if msg.get("from_email"):
        item["bounce_back"] = em.get_bounce_back(msg["from_email"])
    return ok(item)


@bp.get("/inbox/messages/<int:message_id>/original")
@require_role("admin")
def get_message_original(message_id: int):
    """The whole sanitised original: remote images parked in ``data-src``."""
    msg = _message_or_404(message_id)
    html = quote_split.sanitise_html(msg.get("body_html"), allowed_image_prefixes=(PUBLIC_BASE_URL,))
    return ok(
        {
            "id": msg["id"],
            "gmail_thrid": str(msg["gmail_thrid"]) if msg.get("gmail_thrid") else None,
            "subject": msg.get("subject"),
            "body_html": html,
            "body_text": msg.get("body_text"),
            "split_version": int(msg.get("split_version") or 0),
        }
    )


@bp.get("/inbox/threads/<thrid>")
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


@bp.get("/inbox/messages/<int:message_id>/suggestions")
@require_role("admin")
def suggestions(message_id: int):
    msg = _message_or_404(message_id)
    return ok({"items": mail_ingest.suggest_bookings(msg)})


# ------------------------------------------------------------- actions ---


@bp.post("/inbox/messages/<int:message_id>/attach")
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
        conversations.refresh_thread(int(msg["gmail_thrid"]))
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


@bp.post("/inbox/messages/<int:message_id>/detach")
@require_role("admin")
def detach(message_id: int):
    msg = _message_or_404(message_id)
    if not msg.get("booking_id"):
        raise ApiError("conflict", "Message is not attached to a booking", 409)
    pending = msg.get("direction") == "inbound" and not msg.get("is_auto_generated")
    em.detach(message_id, pending=pending)
    if msg.get("gmail_thrid"):
        thrid = int(msg["gmail_thrid"])
        # The thread keeps the booking only while another message still carries it.
        if not any(m.get("booking_id") for m in em.thread(thrid)):
            from src.models import email_thread as et

            et.set_booking(thrid, None)
            em.clear_booking_thread_if(int(msg["booking_id"]), thrid)
        conversations.refresh_thread(thrid)
    return ok({"message": _full(_message_or_404(message_id))})


@bp.post("/inbox/messages/<int:message_id>/resolve")
@require_role("admin")
def resolve(message_id: int):
    data = parse_json(("status",))
    status = str(data["status"])
    if status not in RESOLVE_STATUSES:
        raise ApiError("validation_error", f"status must be one of {', '.join(RESOLVE_STATUSES)}", 422)
    _message_or_404(message_id)
    em.set_review_status(message_id, status, current_user_id())
    return ok({"message": _full(_message_or_404(message_id)), "counts": em.counts()})


@bp.post("/inbox/messages/<int:message_id>/extract")
@require_role("admin")
def extract(message_id: int):
    msg = _message_or_404(message_id)
    text = msg.get("body_new_text") if int(msg.get("split_version") or 0) > 0 else None
    fields = extraction.extract_booking_fields(text or msg.get("body_text") or "", subject=msg.get("subject") or "")
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


@bp.post("/inbox/messages/<int:message_id>/bounce-back")
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


@bp.get("/inbox/attachments/<int:attachment_id>")
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


@bp.post("/inbox/sync")
@require_role("admin")
def sync():
    summary = mail_ingest.sync_mailbox(full=False)
    summary["counts"] = em.counts()
    summary["conversation_counts"] = conversations.counts()
    return ok(summary, 200 if summary.get("ok") else 502)


@bp.post("/inbox/compose")
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
            body_text=(str(data["body_text"]) if data.get("body_text") else None),
            booking_id=booking_id,
            actor=current_user_id(),
        )
    except mail_send.MailSendError as exc:
        raise ApiError("validation_error", str(exc), 422)
    return ok({"message": row}, 201 if row.get("send_status") == "sent" else 502)


@bp.get("/inbox/templates")
@require_role("admin")
def templates():
    return ok({"items": conversations.templates()})


# ------------------------------------------------------- conversations ---


@bp.get("/inbox/conversations")
@require_role("admin")
def list_conversations():
    view = request.args.get("view", "needs_reply")
    if view not in conversations.VIEWS:
        raise ApiError("validation_error", f"view must be one of {', '.join(conversations.VIEWS)}", 400)
    chip = request.args.get("chip") or None
    if chip is not None and chip not in conversations.CHIPS:
        raise ApiError("validation_error", f"chip must be one of {', '.join(conversations.CHIPS)}", 400)
    page, page_size = page_args(default_size=25, max_size=200)
    items, total = conversations.list_conversations(
        view=view, q=request.args.get("q") or None, chip=chip, page=page, page_size=page_size
    )
    return ok(
        {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "view": view,
            "chip": chip,
            "counts": conversations.counts(),
        }
    )


@bp.get("/inbox/conversations/<thrid>")
@require_role("admin")
def get_conversation(thrid: str):
    return ok(_conversation_errors(conversations.get_conversation, _thrid(thrid)))


@bp.get("/inbox/conversations/<thrid>/suggestions")
@require_role("admin")
def conversation_suggestions(thrid: str):
    return ok({"items": _conversation_errors(conversations.suggestions, _thrid(thrid))})


@bp.post("/inbox/conversations/<thrid>/done")
@require_role("admin")
def conversation_done(thrid: str):
    thread = _conversation_errors(conversations.mark_done, _thrid(thrid), current_user_id())
    return ok({"thread": thread, "counts": conversations.counts()})


@bp.post("/inbox/conversations/<thrid>/reopen")
@require_role("admin")
def conversation_reopen(thrid: str):
    thread = _conversation_errors(conversations.reopen, _thrid(thrid), current_user_id())
    return ok({"thread": thread, "counts": conversations.counts()})


@bp.post("/inbox/conversations/<thrid>/not-booking")
@require_role("admin")
def conversation_not_booking(thrid: str):
    data = request.get_json(silent=True) or {}
    value = bool(data.get("value", True)) if isinstance(data, dict) else True
    thread = _conversation_errors(conversations.set_not_booking, _thrid(thrid), current_user_id(), value)
    return ok({"thread": thread, "counts": conversations.counts()})


@bp.post("/inbox/conversations/<thrid>/attach")
@require_role("admin")
def conversation_attach(thrid: str):
    data = parse_json(("booking_id",))
    try:
        booking_id = int(data["booking_id"])
    except (TypeError, ValueError):
        raise ApiError("validation_error", "booking_id must be an integer", 422)
    thread = _conversation_errors(conversations.attach, _thrid(thrid), booking_id, current_user_id())
    return ok({"thread": thread, "counts": conversations.counts()})


@bp.post("/inbox/conversations/<thrid>/detach")
@require_role("admin")
def conversation_detach(thrid: str):
    try:
        thread = conversations.detach(_thrid(thrid), current_user_id())
    except conversations.ConversationNotFound as exc:
        raise ApiError("not_found", str(exc), 404)
    except conversations.ConversationError as exc:
        raise ApiError("conflict", str(exc), 409)
    return ok({"thread": thread, "counts": conversations.counts()})


@bp.post("/inbox/conversations/<thrid>/notes")
@require_role("admin")
def conversation_note(thrid: str):
    data = parse_json(("body",))
    item = _conversation_errors(conversations.add_note, _thrid(thrid), str(data["body"]), current_user_id())
    return ok({"item": item}, 201)


@bp.post("/inbox/conversations/<thrid>/reply")
@require_role("admin")
def conversation_reply(thrid: str):
    data = parse_json(("body_html",))
    cc = data.get("cc") or []
    if not isinstance(cc, list):
        cc = [cc]
    doc_ids: list[int] = []
    for raw in data.get("attach_document_ids") or []:
        try:
            doc_ids.append(int(raw))
        except (TypeError, ValueError):
            raise ApiError("validation_error", "attach_document_ids must be integers", 422,
                           {"attach_document_ids": "Integers only"})
    result = _conversation_errors(
        conversations.reply,
        _thrid(thrid),
        body_html=str(data["body_html"]),
        body_text=(str(data["body_text"]) if data.get("body_text") else None),
        subject=(str(data["subject"]) if data.get("subject") else None),
        cc=[str(c) for c in cc],
        attach_document_ids=doc_ids,
        mark_done_after=bool(data.get("mark_done", False)),
        actor=current_user_id(),
    )
    sent = (result.get("item") or {}).get("send_status") == "sent"
    result["counts"] = conversations.counts()
    return ok(result, 201 if sent else 502)


@bp.get("/bookings/<int:booking_id>/conversation")
@require_role("admin")
def booking_conversation(booking_id: int):
    return ok(_conversation_errors(conversations.booking_conversation, booking_id))
