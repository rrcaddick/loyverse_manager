"""Bookings API: CRUD, status, notes, questions, payments, arrivals and the
one-click actions that send documents and emails (docs/booking-system.md §6).

Routes validate and orchestrate; rules live in ``src/services/booking.py``.
Actions call the documents and mail agents' services through lazy imports so
this module loads (and the rest of the API works) while those are still being
built: a missing module answers 503 ``not_available``.
"""

from __future__ import annotations

import dataclasses
import importlib
from datetime import date
from decimal import Decimal
from typing import Any, Callable

from flask import Blueprint, request

from config.settings import BOOKING_FORM_URL, PUBLIC_BASE_URL
from src.models import booking as booking_model
from src.models import booking_event as event_model
from src.models import booking_question as question_model
from src.models import payment as payment_model
from src.models.base import loads, serialize_row
from src.models.booking import ACTIVE_STATUSES, FIRM_STATUSES, STATUSES, TENTATIVE_STATUSES
from src.services import booking as booking_service
from src.services import tickets as ticket_service
from src.services.arrivals import ArrivalsError, fetch_loyverse_arrivals
from src.services.booking import BookingError, BookingNotFound, InvalidTransition
from src.services.settings import get_settings
from src.utils.date import get_today
from src.utils.logging import setup_logger
from web.api import (
    ApiError,
    allow_manager,
    current_user,
    current_user_id,
    make_blueprint,
    ok,
    page_args,
    paginated,
    parse_json,
)

logger = setup_logger("api_bookings")
bp = make_blueprint("bookings", "/bookings")

MANAGER_PAYMENT_KINDS = ("cash", "card")
REMINDER_KINDS = ("still_interested", "deposit_reminder", "final_details")
STATUS_ALIASES = {
    "active": list(ACTIVE_STATUSES),
    "tentative": list(TENTATIVE_STATUSES),
    "firm": list(FIRM_STATUSES),
}
DOCUMENT_LABELS = {"proforma": "Proforma", "invoice": "Statement", "final_invoice": "Tax invoice"}
PDF = "application/pdf"
# Emails need an absolute https logo URL (the templates fall back to a wordmark).
LOGO_URL = f"{PUBLIC_BASE_URL}/static/brand/logo-black-600.png"


# -------------------------------------------------------------- errors -------

def register_booking_errors(blueprint: Blueprint) -> None:
    """Map service exceptions to JSON errors (shared with web/api/calendar.py)."""

    @blueprint.errorhandler(BookingNotFound)
    def _not_found(err: BookingNotFound):
        return ApiError("not_found", str(err) or "Not found", 404).to_response()

    @blueprint.errorhandler(InvalidTransition)
    def _conflict(err: InvalidTransition):
        return ApiError("invalid_transition", str(err), 409, err.fields).to_response()

    @blueprint.errorhandler(BookingError)
    def _invalid(err: BookingError):
        return ApiError("validation_error", str(err), 422, err.fields).to_response()


register_booking_errors(bp)


# -------------------------------------------------------------- helpers ------

def _arg_date(name: str) -> date | None:
    raw = request.args.get(name)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        raise ApiError("validation_error", f"Invalid date for '{name}'", 422, {name: "Use YYYY-MM-DD"})


def _parse_statuses(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    out: list[str] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if part in STATUS_ALIASES:
            out.extend(STATUS_ALIASES[part])
        elif part in STATUSES:
            out.append(part)
        else:
            raise ApiError("validation_error", f"Unknown status '{part}'", 422, {"status": "Unknown status"})
    return list(dict.fromkeys(out)) or None


def _booking_or_404(booking_id: int) -> dict:
    row = booking_model.get(booking_id)
    if row is None:
        raise ApiError("not_found", "Booking not found", 404)
    return row


def _detail(booking_id: int):
    return ok(booking_service.get_booking_detail(booking_id))


def _list_item(row: dict, settings) -> dict:
    item = booking_model.serialize(row)
    finance = booking_service.booking_finance(row, paid_total=row.get("paid_total"), settings=settings)
    item["total_amount"] = float(finance["total_amount"])
    item["paid_total"] = float(finance["paid_total"])
    item["balance_due"] = float(finance["balance_due"])
    item["deposit_covered"] = finance["deposit_covered"]
    item["status_label"] = booking_service.STATUS_LABELS.get(row["status"], row["status"])
    return item


def _json_body() -> dict:
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ApiError("validation_error", "A JSON object body is required")
    return data


def _lazy(dotted: str, label: str):
    try:
        return importlib.import_module(dotted)
    except ModuleNotFoundError as exc:
        if exc.name == dotted:
            raise ApiError("not_available", f"{label} is not built yet", 503)
        raise


def _as_dict(obj: Any) -> dict:
    if obj is None:
        return {}
    if isinstance(obj, dict):
        return obj
    if dataclasses.is_dataclass(obj):
        return dataclasses.asdict(obj)
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return dict(vars(obj))


# ---------------------------------------------------------- collection -------

def _parse_bucket(raw: str | None) -> list[str] | None:
    """``bucket=pending|confirmed|lapsed|past|all`` → statuses (None for all)."""
    if not raw:
        return None
    bucket = raw.strip()
    if bucket not in booking_model.BUCKETS:
        raise ApiError(
            "validation_error",
            f"Unknown bucket '{bucket}'",
            422,
            {"bucket": f"Choose one of: {', '.join(booking_model.BUCKETS)}"},
        )
    return None if bucket == "all" else list(booking_model.BUCKETS[bucket])


@bp.get("")
def list_bookings():
    page, size = page_args(max_size=500)
    statuses = _parse_statuses(request.args.get("status"))
    bucket_statuses = _parse_bucket(request.args.get("bucket"))
    if bucket_statuses is not None:
        statuses = [s for s in statuses if s in bucket_statuses] if statuses else bucket_statuses
        if not statuses:  # status and bucket exclude each other: nothing matches
            return paginated([], 0, page, size)
    rows, total = booking_model.list_bookings(
        statuses=statuses,
        from_date=_arg_date("from"),
        to_date=_arg_date("to"),
        q=request.args.get("q") or None,
        page=page,
        page_size=size,
        sort=request.args.get("sort"),
    )
    settings = get_settings()
    actions = booking_service.latest_actions([int(r["id"]) for r in rows])
    items = []
    for r in rows:
        item = _list_item(r, settings)
        act = actions.get(int(r["id"]))
        item["latest_action"] = (
            {"label": act["label"], "at": act["at"].isoformat(), "who": act["who"]} if act else None
        )
        items.append(item)
    return paginated(items, total, page, size)


BUCKET_STATUSES = {
    "requests": ("requested",),
    "pending": ("enquiry", "proforma_sent"),
    "confirmed": ("confirmed",),
    "lapsed": ("lapsed", "cancelled"),
    "past": ("completed", "no_show"),
}


def _attention_by_bucket() -> dict[str, int]:
    """How many bookings in each list bucket have a Work item (the tab badges
    show work to do, not how many bookings there are; owner, 29 Oct 2026)."""
    from src.services import work as work_service

    snap = work_service.snapshot()
    status_of: dict[int, str] = {}
    for view in work_service.LIVE_VIEWS:
        for row in snap["views"].get(view, []):
            b = row.get("booking") or {}
            bid = b.get("booking_id") or b.get("id")
            if bid:
                status_of[int(bid)] = str(b.get("status") or "")
    out = {bucket: sum(1 for s in status_of.values() if s in statuses) for bucket, statuses in BUCKET_STATUSES.items()}
    out["all"] = len(status_of)
    return out


@bp.get("/counts")
def status_counts():
    """Per-status counts, the list tabs' buckets (pending, confirmed, lapsed,
    past, all) and ``attention``: bookings with Work items per bucket."""
    by_status = booking_model.counts_by_status()
    try:
        attention = _attention_by_bucket()
    except Exception:  # noqa: BLE001 - the badges are a convenience, never a failure
        attention = {}
    return ok({"counts": by_status, **booking_model.counts_by_bucket(by_status), "attention": attention})


@bp.post("")
def create_booking():
    data = parse_json()
    source = data.get("source") or "manual"
    booking = booking_service.create_booking(data, source, current_user_id())
    return ok(booking_service.get_booking_detail(booking["id"]), 201)


# -------------------------------------------------------------- single -------

@bp.get("/<int:booking_id>")
@allow_manager
def get_booking(booking_id: int):
    return _detail(booking_id)


@bp.patch("/<int:booking_id>")
def update_booking(booking_id: int):
    data = parse_json()
    booking_service.update_booking(booking_id, data, current_user_id())
    return _detail(booking_id)


@bp.post("/<int:booking_id>/status")
def set_status(booking_id: int):
    data = parse_json(("status",))
    booking_service.set_status(
        booking_id, str(data["status"]), current_user_id(), reason=data.get("reason") or None
    )
    return _detail(booking_id)


@bp.post("/<int:booking_id>/notes")
def add_note(booking_id: int):
    data = parse_json(("text",))
    booking_service.add_note(booking_id, str(data["text"]), current_user_id())
    return _detail(booking_id)


@bp.post("/<int:booking_id>/questions")
def add_question(booking_id: int):
    data = parse_json(("question",))
    booking_service.add_question(booking_id, str(data["question"]), current_user_id())
    return _detail(booking_id)


@bp.post("/<int:booking_id>/questions/<int:question_id>")
def answer_question(booking_id: int, question_id: int):
    data = parse_json(("answer",))
    booking_service.answer_question(booking_id, question_id, str(data["answer"]), current_user_id())
    return _detail(booking_id)


# ------------------------------------------------------------ payments -------

@bp.post("/<int:booking_id>/payments")
@allow_manager
def record_payment(booking_id: int):
    data = parse_json(("kind", "amount"))
    user = current_user()
    kind = str(data["kind"])
    if user and user["role"] != "admin" and kind not in MANAGER_PAYMENT_KINDS:
        raise ApiError(
            "forbidden",
            "Managers can record cash and card payments only",
            403,
            {"kind": "Use cash or card"},
        )
    booking_service.record_payment(
        booking_id,
        kind,
        data["amount"],
        data.get("paid_on"),
        data.get("reference"),
        data.get("note"),
        current_user_id(),
        bank_transaction_id=data.get("bank_transaction_id"),
    )
    return _detail(booking_id)


@bp.delete("/<int:booking_id>/payments/<int:payment_id>")
def delete_payment(booking_id: int, payment_id: int):
    booking_service.delete_payment(booking_id, payment_id, current_user_id())
    return _detail(booking_id)


# ------------------------------------------------------------ arrivals -------

@bp.get("/<int:booking_id>/arrivals")
@allow_manager
def fetch_arrivals(booking_id: int):
    booking = _booking_or_404(booking_id)
    try:
        count = fetch_loyverse_arrivals(booking)
    except ArrivalsError as exc:
        raise ApiError("loyverse_unavailable", str(exc), 502)
    return ok(
        {
            "booking_id": booking_id,
            "visit_date": booking["visit_date"].isoformat(),
            "count": count,
            "source": "loyverse",
            "recorded_count": booking.get("arrived_count"),
            "recorded_source": booking.get("arrived_source"),
        }
    )


@bp.post("/<int:booking_id>/arrivals")
@allow_manager
def record_arrivals(booking_id: int):
    data = parse_json()
    if data.get("count") is None:
        raise ApiError("validation_error", "Missing required fields", 422, {"count": "This field is required"})
    booking_service.record_arrivals(
        booking_id, data["count"], str(data.get("source") or "manual"), current_user_id()
    )
    return _detail(booking_id)


# ----------------------------------------------------- timeline, emails ------

@bp.get("/<int:booking_id>/events")
def list_events(booking_id: int):
    _booking_or_404(booking_id)
    return ok({"items": event_model.list_for_booking(booking_id)})


@bp.get("/<int:booking_id>/emails")
def list_emails(booking_id: int):
    _booking_or_404(booking_id)
    return ok({"items": booking_service.list_emails(booking_id)})


# ------------------------------------------------------- send helpers --------

def _documents_service():
    return _lazy("src.services.documents", "Document generation")


def _document_attachment(doc: dict) -> tuple[str, bytes, str]:
    """(filename, pdf, mimetype) from the documents service, which owns the files."""
    documents = _documents_service()
    try:
        filename, pdf = documents.document_bytes(int(doc["id"]))
    except Exception as exc:  # noqa: BLE001 - DocumentError (missing row or file)
        logger.error(f"document_bytes({doc.get('id')}) failed: {exc}")
        raise ApiError("not_found", f"Document {doc.get('number')} is not available: {exc}", 404)
    return filename, pdf, PDF


def _document_public(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    return serialize_row({k: v for k, v in doc.items() if k not in ("snapshot", "file_path")})


def _issue(booking: dict, kind: str, actor: int | None) -> dict:
    """Issue a new document version; returns the full serialized row (with snapshot)."""
    documents = _documents_service()
    try:
        issued = _as_dict(documents.issue_document(booking["id"], kind, actor))
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001 - surfaced as a clean API error
        logger.error(f"issue_document({booking['reference']}, {kind}) failed: {exc}", exc_info=True)
        raise ApiError("document_failed", f"Could not generate the {DOCUMENT_LABELS.get(kind, kind).lower()}: {exc}", 502)
    doc_id = issued.get("id")
    full = documents.get_document(int(doc_id), with_snapshot=True) if doc_id else None
    return full or issued


def _get_document(document_id: int) -> dict | None:
    return _documents_service().get_document(document_id)


def _link_documents(document_ids: tuple[int, ...] | list[int], email_message_id: Any) -> None:
    """Back-link documents to the outbound email they were attached to."""
    if not document_ids or not email_message_id:
        return
    try:
        document_model = importlib.import_module("src.models.document")
    except ModuleNotFoundError:
        return
    for doc_id in document_ids:
        try:
            document_model.set_email_message(int(doc_id), int(email_message_id))
        except Exception as exc:  # noqa: BLE001 - a missing back-link is not worth failing the send
            logger.warning(f"Could not link document {doc_id} to email {email_message_id}: {exc}")


def _send(
    kind: str,
    booking: dict,
    actor: int | None,
    attachments: list[tuple[str, bytes, str]] | None = None,
    *,
    link_document_ids: tuple[int, ...] = (),
    **ctx: Any,
) -> dict:
    """Render ``kind`` for the booking and send it to the contact email.

    ``link_document_ids`` are stamped with the resulting email_messages id.
    """
    to_email = booking.get("contact_email")
    if not to_email:
        raise ApiError(
            "validation_error",
            "The booking has no contact email address",
            422,
            {"contact_email": "Add an email address before sending"},
        )
    templates = _lazy("src.services.email_templates", "Email templates")
    mail = _lazy("src.services.mail_send", "Email sending")
    settings = get_settings()
    # render_email takes the raw bookings row (Decimals, dates) and derives the
    # money figures itself from the payments list.
    ctx.setdefault("payments", payment_model.list_for_booking(booking["id"]))
    ctx.setdefault("logo_url", LOGO_URL)
    try:
        rendered = templates.render_email(kind, booking, settings, **ctx)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"render_email({kind}) failed for {booking['reference']}: {exc}", exc_info=True)
        raise ApiError("render_failed", f"Could not render the {kind.replace('_', ' ')} email: {exc}", 500)
    try:
        sent = mail.send_email(
            to=[to_email],
            rendered=rendered,
            attachments=list(attachments or ()),
            booking_id=booking["id"],
            kind=kind,
            actor=actor,
            thread_message_id=booking_service.latest_message_id_header(booking),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(f"send_email({kind}) failed for {booking['reference']}: {exc}", exc_info=True)
        raise ApiError("send_failed", f"The email could not be sent: {exc}", 502)
    result = _as_dict(sent)
    if result.get("send_status") == "failed":
        # mail_send records the failure (email_messages row + email_failed event)
        # instead of raising; surface it so the button shows the error.
        raise ApiError(
            "send_failed",
            f"The email could not be sent: {result.get('send_error') or 'unknown error'}",
            502,
        )
    _link_documents(link_document_ids, result.get("id"))
    return {
        "email_message_id": result.get("id"),
        "kind": kind,
        "to": to_email,
        "subject": getattr(rendered, "subject", None),
    }


def _require_status(booking: dict, allowed: tuple[str, ...], what: str) -> None:
    if booking["status"] not in allowed:
        labels = ", ".join(booking_service.STATUS_LABELS[s].lower() for s in allowed)
        raise ApiError(
            "invalid_state",
            f"{what} is only available while the booking is {labels}",
            409,
            {"status": f"Currently {booking_service.STATUS_LABELS[booking['status']].lower()}"},
        )


def _proforma_is_stale(booking: dict, latest: dict) -> bool:
    """True when the booking's money changed since ``latest`` was issued."""
    finance = booking_service.booking_finance(booking)
    if Decimal(str(latest.get("total") or 0)).quantize(Decimal("0.01")) != finance["total_amount"]:
        return True
    snapshot = loads(latest.get("snapshot"))
    if not isinstance(snapshot, dict):
        return False
    inner = snapshot.get("booking") if isinstance(snapshot.get("booking"), dict) else snapshot
    for key, current in (
        ("people_booked", finance["people_booked"]),
        ("price_per_person", finance["price_per_person"]),
    ):
        if key in inner and inner[key] is not None:
            if Decimal(str(inner[key])) != Decimal(str(current)):
                return True
    return False


def _ticket_attachment(booking: dict) -> tuple[str, bytes, str]:
    return ticket_service.ticket_filename(booking), ticket_service.ticket_pdf_bytes(booking), PDF


# ------------------------------------------------------------- actions -------

def act_send_acknowledgement(booking: dict, data: dict, actor: int | None) -> dict:
    _require_status(booking, ACTIVE_STATUSES, "Sending an acknowledgement")
    return _send("acknowledgement", booking, actor, form_url=BOOKING_FORM_URL)


def act_issue_proforma(booking: dict, data: dict, actor: int | None) -> dict:
    doc = _issue(booking, "proforma", actor)
    return {"document": _document_public(doc)}


def act_send_proforma(booking: dict, data: dict, actor: int | None) -> dict:
    _require_status(booking, ACTIVE_STATUSES, "Sending a proforma")
    latest = booking_service.latest_document(booking["id"], "proforma")
    if latest is None or _proforma_is_stale(booking, latest):
        latest = _issue(booking, "proforma", actor)
    result = _send(
        "proforma",
        booking,
        actor,
        [_document_attachment(latest)],
        link_document_ids=(latest["id"],),
        document=_document_public(latest),
        hold_expires_on=booking.get("hold_expires_on"),
    )
    booking_service.stamp(booking["id"], "proforma_sent_at")
    if booking["status"] == "enquiry":
        booking_service.set_status(booking["id"], "proforma_sent", actor, reason="Proforma emailed")
    return {**result, "document": _document_public(latest)}


def act_send_invoice(booking: dict, data: dict, actor: int | None) -> dict:
    finance = booking_service.booking_finance(booking)
    if finance["paid_total"] <= 0:
        raise ApiError(
            "invalid_state", "An invoice can only be sent once a payment has been received", 409
        )
    doc = _issue(booking, "invoice", actor)
    result = _send(
        "invoice",
        booking,
        actor,
        [_document_attachment(doc)],
        link_document_ids=(doc["id"],),
        document=_document_public(doc),
    )
    booking_service.stamp(booking["id"], "invoice_sent_at")
    return {**result, "document": _document_public(doc)}


def act_send_final_invoice(booking: dict, data: dict, actor: int | None) -> dict:
    if booking.get("arrived_count") is None:
        raise ApiError("invalid_state", "Record the arrivals before sending the final invoice", 409)
    doc = _issue(booking, "final_invoice", actor)
    result = _send(
        "final_invoice",
        booking,
        actor,
        [_document_attachment(doc)],
        link_document_ids=(doc["id"],),
        document=_document_public(doc),
    )
    booking_service.stamp(booking["id"], "final_invoice_sent_at")
    return {**result, "document": _document_public(doc)}


def act_send_ticket_email(booking: dict, data: dict, actor: int | None) -> dict:
    _require_status(booking, FIRM_STATUSES, "Sending the vehicle ticket")
    result = _send("ticket", booking, actor, [_ticket_attachment(booking)])
    booking_service.stamp(booking["id"], "ticket_emailed_at")
    return result


def act_send_ticket_whatsapp(booking: dict, data: dict, actor: int | None) -> dict:
    _require_status(booking, FIRM_STATUSES, "Sending the vehicle ticket")
    if not ticket_service.ticket_numbers(booking["id"]):
        raise ApiError(
            "validation_error",
            "The booking has no mobile number",
            422,
            {"contact_mobile": "Add a mobile number before sending"},
        )
    try:
        return ticket_service.send_ticket_whatsapp_all(booking["id"], actor)
    except ticket_service.TicketError as exc:
        raise ApiError("send_failed", str(exc), 502)


def act_send_ticket(booking: dict, data: dict, actor: int | None) -> dict:
    """The vehicle ticket both ways in one click: the PDF by email when there
    is an address, the image on WhatsApp to every primary number. Either
    channel may be missing; both missing is an error."""
    _require_status(booking, FIRM_STATUSES, "Sending the vehicle ticket")
    numbers = ticket_service.ticket_numbers(booking["id"])
    if not booking.get("contact_email") and not numbers:
        raise ApiError("validation_error", "No email address or mobile number to send to", 422, {"contact_email": "Add an email address or a mobile number first"})
    result: dict = {"email": None, "whatsapp": None, "errors": []}
    if booking.get("contact_email"):
        try:
            result["email"] = act_send_ticket_email(booking, data, actor)
        except ApiError as exc:
            result["errors"].append(f"Email: {exc.message}")
    if numbers:
        try:
            result["whatsapp"] = ticket_service.send_ticket_whatsapp_all(booking["id"], actor)
        except ticket_service.TicketError as exc:
            result["errors"].append(f"WhatsApp: {exc}")
    if result["email"] is None and result["whatsapp"] is None:
        raise ApiError("send_failed", "; ".join(result["errors"]) or "Nothing was sent", 502)
    result["success"] = True
    return result


def act_send_payment_confirmation(booking: dict, data: dict, actor: int | None) -> dict:
    latest_payment = payment_model.latest_for_booking(booking["id"])
    if latest_payment is None:
        raise ApiError("invalid_state", "No payment has been recorded on this booking", 409)
    invoice = booking_service.latest_document(booking["id"], "invoice")
    attach_invoice = bool(invoice) and bool(data.get("attach_invoice"))
    attachments = [_document_attachment(invoice)] if attach_invoice else []
    return _send(
        "payment_confirmation",
        booking,
        actor,
        attachments,
        link_document_ids=(invoice["id"],) if attach_invoice else (),
        payment=latest_payment,
        document=_document_public(invoice),
        invoice_attached=attach_invoice,
    )


def act_send_reminder(booking: dict, data: dict, actor: int | None) -> dict:
    kind = str(data.get("kind") or "")
    if kind not in REMINDER_KINDS:
        raise ApiError(
            "validation_error",
            "Unknown reminder kind",
            422,
            {"kind": f"Must be one of {', '.join(REMINDER_KINDS)}"},
        )
    attachments: list[tuple[str, bytes, str]] = []
    link_ids: tuple[int, ...] = ()
    ctx: dict[str, Any] = {}
    visit_date = booking["visit_date"]
    if isinstance(visit_date, date):
        ctx["days_left"] = (visit_date - get_today()).days
    if kind in ("still_interested", "deposit_reminder"):
        _require_status(booking, TENTATIVE_STATUSES, "This reminder")
        ctx["hold_expires_on"] = booking.get("hold_expires_on")
        proforma = booking_service.latest_document(booking["id"], "proforma")
        if proforma is not None:
            attachments.append(_document_attachment(proforma))
            link_ids = (proforma["id"],)
            ctx["document"] = _document_public(proforma)
    else:  # final_details
        _require_status(booking, FIRM_STATUSES, "The final details email")
        ctx["ticket_attached"] = booking.get("ticket_emailed_at") is None
        if ctx["ticket_attached"]:
            attachments.append(_ticket_attachment(booking))
    result = _send(kind, booking, actor, attachments, link_document_ids=link_ids, **ctx)
    if kind == "final_details" and ctx.get("ticket_attached"):
        booking_service.stamp(booking["id"], "ticket_emailed_at")
    booking_service.mark_reminder_sent(booking["id"], kind)
    return {**result, "reminder_kind": kind}


def act_send_expiry(booking: dict, data: dict, actor: int | None) -> dict:
    _require_status(booking, TENTATIVE_STATUSES, "The expiry notice")
    result = _send("expiry", booking, actor)
    booking_service.set_status(booking["id"], "lapsed", actor, reason=data.get("reason") or "Hold expired")
    booking_service.mark_reminder_sent(booking["id"], "lapse")
    return result


def act_send_answers(booking: dict, data: dict, actor: int | None) -> dict:
    answered = [q for q in question_model.list_for_booking(booking["id"]) if q.get("answer")]
    if not answered:
        raise ApiError("invalid_state", "Answer at least one question before sending", 409)
    return _send("answers", booking, actor, questions=answered)


def act_confirm(booking: dict, data: dict, actor: int | None) -> dict:
    _require_status(booking, TENTATIVE_STATUSES, "Confirming")
    finance = booking_service.booking_finance(booking)
    reason = (data.get("reason") or "").strip() or None
    if finance["deposit_covered"] and finance["paid_total"] > 0:
        reason = reason or "Deposit received"
    elif booking.get("deposit_waived"):
        reason = reason or "Deposit waived"
    elif not reason:
        raise ApiError(
            "validation_error",
            "A reason is required to confirm a booking before the deposit is paid",
            422,
            {"reason": "Required when the deposit is outstanding"},
        )
    booking_service.set_status(booking["id"], "confirmed", actor, reason=reason)
    return {"confirmed": True, "reason": reason}


ACTIONS: dict[str, Callable[[dict, dict, int | None], dict]] = {
    "send-acknowledgement": act_send_acknowledgement,
    "issue-proforma": act_issue_proforma,
    "send-proforma": act_send_proforma,
    "send-invoice": act_send_invoice,
    "send-final-invoice": act_send_final_invoice,
    "send-ticket-email": act_send_ticket_email,
    "send-ticket-whatsapp": act_send_ticket_whatsapp,
    "send-ticket": act_send_ticket,
    "send-payment-confirmation": act_send_payment_confirmation,
    "send-reminder": act_send_reminder,
    "send-expiry": act_send_expiry,
    "send-answers": act_send_answers,
    "confirm": act_confirm,
}


@bp.post("/<int:booking_id>/actions/<action>")
def run_action(booking_id: int, action: str):
    handler = ACTIONS.get(action)
    if handler is None:
        raise ApiError("not_found", f"Unknown action '{action}'", 404)
    booking = _booking_or_404(booking_id)
    data = _json_body()
    result = handler(booking, data, current_user_id())
    detail = booking_service.get_booking_detail(booking_id)
    detail["action"] = action
    detail["action_result"] = result
    logger.info(f"Action {action} on {booking['reference']} by user {current_user_id()}")
    return ok(detail)


@bp.post("/<int:booking_id>/emails/reply")
def reply_email(booking_id: int):
    booking = _booking_or_404(booking_id)
    data = parse_json(("body_html",))
    attachments: list[tuple[str, bytes, str]] = []
    link_ids: list[int] = []
    for raw_id in data.get("attach_document_ids") or []:
        try:
            doc_id = int(raw_id)
        except (TypeError, ValueError):
            raise ApiError("validation_error", "Invalid document id", 422, {"attach_document_ids": "Integers only"})
        doc = _get_document(doc_id)
        if doc is None or int(doc["booking_id"]) != booking_id:
            raise ApiError("not_found", f"Document {doc_id} does not belong to this booking", 404)
        attachments.append(_document_attachment(doc))
        link_ids.append(doc_id)
    result = _send(
        "reply",
        booking,
        current_user_id(),
        attachments,
        link_document_ids=tuple(link_ids),
        body_html=str(data["body_html"]),
        subject=(data.get("subject") or None),
    )
    detail = booking_service.get_booking_detail(booking_id)
    detail["action"] = "reply"
    detail["action_result"] = result
    return ok(detail)


# ------------------------------------------------- requests, contacts, money ---


@bp.post("/<int:booking_id>/accept")
def accept_request(booking_id: int):
    """Review done: the request becomes an enquiry on the calendar and, unless
    ``send_proforma`` is false, the proforma goes out in the same step."""
    data = _json_body()
    send_proforma = data.pop("send_proforma", True)
    try:
        booking_service.accept_request(booking_id, data, current_user_id())
    except Exception as exc:  # noqa: BLE001
        fields = getattr(exc, "fields", None)
        if fields is not None:
            raise ApiError("validation_error", str(exc), 422, fields)
        raise
    result = None
    if send_proforma:
        booking = _booking_or_404(booking_id)
        result = ACTIONS["send-proforma"](booking, {}, current_user_id())
    detail = booking_service.get_booking_detail(booking_id)
    detail["action"] = "accept"
    detail["action_result"] = result
    return ok(detail)


@bp.post("/<int:booking_id>/decline")
def decline_request(booking_id: int):
    data = _json_body()
    try:
        booking_service.decline_request(booking_id, data.get("reason"), current_user_id())
    except Exception as exc:  # noqa: BLE001
        fields = getattr(exc, "fields", None)
        if fields is not None:
            raise ApiError("validation_error", str(exc), 422, fields)
        raise
    return ok(booking_service.get_booking_detail(booking_id))


@bp.get("/<int:booking_id>/contacts")
def list_contacts(booking_id: int):
    from src.models import booking_contact

    _booking_or_404(booking_id)
    return ok({"items": [serialize_row(r) for r in booking_contact.list_for_booking(booking_id)]})


@bp.post("/<int:booking_id>/contacts")
def add_contact(booking_id: int):
    from src.models import booking_contact

    _booking_or_404(booking_id)
    data = _json_body()
    email = str(data.get("email") or "").strip().lower()
    if "@" not in email:
        raise ApiError("validation_error", "Enter an email address", 422, {"email": "Enter a valid email address"})
    try:
        mobile = booking_service.normalise_mobile(data.get("mobile")) if data.get("mobile") else None
    except booking_service.BookingError:
        raise ApiError("validation_error", "Enter a valid South African mobile number", 422, {"mobile": "Enter a valid mobile number"})
    booking_contact.upsert(booking_id, email, name=data.get("name"), mobile=mobile, role="cc", source="manual")
    return ok({"items": [serialize_row(r) for r in booking_contact.list_for_booking(booking_id)]}, 201)


@bp.patch("/<int:booking_id>/contacts/<int:contact_id>")
def update_contact(booking_id: int, contact_id: int):
    """Edit a contact's name or mobile, or set ``on_site`` (the person in
    charge on the day; only one per booking, so setting it clears the rest)."""
    from src.models import booking_contact

    booking = _booking_or_404(booking_id)
    data = _json_body()
    on_site = data.get("on_site")
    if on_site is not None and not isinstance(on_site, bool):
        raise ApiError("validation_error", "on_site must be true or false", 422, {"on_site": "true or false"})
    role = data.get("role")
    if role is not None and role not in ("primary", "cc"):
        raise ApiError("validation_error", "role must be primary or cc", 422, {"role": "primary or cc"})
    own_row = next((c for c in booking_contact.list_for_booking(booking_id) if int(c["id"]) == contact_id and c.get("source") == "booking"), None)
    if own_row is not None and role == "cc":
        role = None  # the booking's own contact is always primary
    email = data.get("email")
    if email is not None and "@" not in str(email):
        raise ApiError("validation_error", "Enter a valid email address", 422, {"email": "Enter a valid email address"})
    before = next((c for c in booking_contact.list_for_booking(booking_id) if int(c["id"]) == contact_id), None)
    if before is None:
        raise ApiError("not_found", "No such contact on this booking", 404)
    mobile = data.get("mobile")
    if mobile:
        try:
            mobile = booking_service.normalise_mobile(mobile)
        except booking_service.BookingError:
            raise ApiError("validation_error", "Enter a valid South African mobile number", 422, {"mobile": "Enter a valid mobile number"})
    changed = booking_contact.update(
        booking_id, contact_id, name=data.get("name"), mobile=mobile, on_site=on_site, role=role, email=email
    )
    if not changed and not any(k in data for k in ("name", "mobile", "on_site", "role", "email")):
        raise ApiError("validation_error", "Nothing to change", 422, {"contact": "Send name, mobile, email, role or on_site"})
    after = next((c for c in booking_contact.list_for_booking(booking_id) if int(c["id"]) == contact_id), before)
    # The mirrored primary contact is the booking's own contact: keep them in step.
    is_own = (before.get("email") or "") == (booking.get("contact_email") or "").lower() and (before.get("email") or booking.get("role") or before.get("role") == "primary")
    if is_own:
        sync = {}
        if "name" in data and after.get("name"):
            sync["contact_name"] = after["name"]
        if "mobile" in data:
            sync["contact_mobile"] = after.get("mobile")
        if "email" in data and after.get("email"):
            sync["contact_email"] = after["email"]
        if sync:
            booking_service.update_booking(booking_id, sync, current_user_id())
    # A new number on a primary contact gets the ticket again, if one has gone out.
    whatsapp = None
    new_mobile = after.get("mobile")
    if "mobile" in data and new_mobile and new_mobile != before.get("mobile") and after.get("role") == "primary" and booking.get("ticket_sent_at"):
        try:
            whatsapp = ticket_service.send_ticket_whatsapp(booking_id, current_user_id(), mobile=str(new_mobile))
        except ticket_service.TicketError as exc:
            whatsapp = {"success": False, "error": str(exc), "to": str(new_mobile)}
    return ok({"items": [serialize_row(r) for r in booking_contact.list_for_booking(booking_id)], "whatsapp": whatsapp})


@bp.delete("/<int:booking_id>/contacts/<int:contact_id>")
def delete_contact(booking_id: int, contact_id: int):
    from src.models import booking_contact

    _booking_or_404(booking_id)
    booking_contact.delete(booking_id, contact_id)
    return ok()


@bp.get("/<int:booking_id>/payment-search")
def payment_search(booking_id: int):
    from src.services import payment_search as ps

    booking = _booking_or_404(booking_id)
    return ok(
        ps.search(
            booking,
            reference=request.args.get("reference") or None,
            amount=request.args.get("amount") or None,
            tolerance=request.args.get("tolerance") or None,
            date_from=_arg_date("from"),
            date_to=_arg_date("to"),
        )
    )


@bp.post("/<int:booking_id>/payment-search/allocate")
def payment_allocate(booking_id: int):
    from src.services import payment_search as ps

    _booking_or_404(booking_id)
    data = _json_body()
    if not data.get("tx_id"):
        raise ApiError("validation_error", "tx_id is required", 422, {"tx_id": "Required"})
    result = ps.allocate(int(data["tx_id"]), booking_id, current_user_id())
    detail = booking_service.get_booking_detail(booking_id)
    detail["action_result"] = result
    return ok(detail)


@bp.get("/<int:booking_id>/pops")
def list_pops(booking_id: int):
    from src.models import pop as pop_model
    from src.services import pop

    _booking_or_404(booking_id)
    return ok({"items": [pop.serialize(r) for r in pop_model.list_for_booking(booking_id)]})


@bp.post("/<int:booking_id>/pops/<int:pop_id>/allocate")
def pop_allocate(booking_id: int, pop_id: int):
    from src.services import pop

    _booking_or_404(booking_id)
    data = _json_body()
    if not data.get("tx_id"):
        raise ApiError("validation_error", "tx_id is required", 422, {"tx_id": "Required"})
    try:
        pop.allocate(pop_id, int(data["tx_id"]), current_user_id())
    except ValueError as exc:
        raise ApiError("not_found", str(exc), 404)
    return ok(booking_service.get_booking_detail(booking_id))


@bp.post("/<int:booking_id>/pops/<int:pop_id>/dismiss")
def pop_dismiss(booking_id: int, pop_id: int):
    from src.services import pop

    _booking_or_404(booking_id)
    pop.dismiss(pop_id, current_user_id())
    return ok(booking_service.get_booking_detail(booking_id))
