"""The inbound pipeline's small admin surface.

    GET  /api/v1/inbound/state                  config + sync watermarks + counts
    GET  /api/v1/inbound/skipped?days=7         what the automated filter stopped (headers only)
    POST /api/v1/inbound/skipped/<id>/rescue    fetch it and run it as if it had just arrived
    POST /api/v1/inbound/sweep                  run the periodic pass now
    POST /api/v1/inbound/messages/<id>/assign   {booking_id}  settle an "allocate" message
"""

from __future__ import annotations

from flask import request

from src.models import email_message as em
from src.models import mail_skipped
from src.models.base import serialize_row
from src.services import inbound
from web.api import ApiError, current_user_id, make_blueprint, ok, parse_json

bp = make_blueprint("inbound", "/inbound")


@bp.get("/state")
def state():
    return ok(serialize_row(inbound.state()))


@bp.get("/skipped")
def skipped():
    days = min(90, max(1, int(request.args.get("days", 7) or 7)))
    rows = mail_skipped.list_recent(days, include_rescued=request.args.get("all") == "1")
    return ok({"items": [serialize_row(r) for r in rows], "total": len(rows), "days": days})


@bp.post("/skipped/<int:skipped_id>/rescue")
def rescue(skipped_id: int):
    try:
        return ok(inbound.rescue_skipped(skipped_id, current_user_id()))
    except LookupError as exc:
        raise ApiError("not_found", str(exc), 404)


@bp.post("/sweep")
def sweep():
    return ok(serialize_row(inbound.sweep()))


@bp.post("/messages/<int:message_id>/assign")
def assign(message_id: int):
    """``{"booking_id": n}``, ``{"booking_ids": [...]}`` or ``{"all": true}``
    (every candidate): the mail, and its conversation, go on each (3 Nov 2026)."""
    import json as _json

    data = parse_json()
    row = em.get(message_id)
    if row is None:
        raise ApiError("not_found", "Message not found", 404)
    ids: list[int] = []
    if data.get("all"):
        try:
            ids = [int(x) for x in _json.loads(row.get("candidate_booking_ids") or "[]")]
        except (TypeError, ValueError):
            ids = []
    elif data.get("booking_ids"):
        try:
            ids = [int(x) for x in data["booking_ids"]]
        except (TypeError, ValueError) as exc:
            raise ApiError("validation_error", "booking_ids must be integers", 422) from exc
    elif data.get("booking_id") is not None:
        ids = [int(data["booking_id"])]
    if not ids:
        raise ApiError("validation_error", "Say which booking, or all of them", 422, {"booking_id": "Required"})
    bookings = []
    for bid in ids:
        b = em.booking_by_id(bid)
        if b is None:
            raise ApiError("not_found", f"Booking {bid} not found", 404)
        bookings.append(b)
    inbound.attach_to_bookings(message_id, row, bookings, "assigned")
    return ok({"message_id": message_id, "booking_id": int(bookings[0]["id"]), "booking_ids": [int(b["id"]) for b in bookings]})
