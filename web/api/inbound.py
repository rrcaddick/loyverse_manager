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
    data = parse_json(("booking_id",))
    row = em.get(message_id)
    if row is None:
        raise ApiError("not_found", "Message not found", 404)
    booking = em.booking_by_id(int(data["booking_id"]))
    if booking is None:
        raise ApiError("not_found", "Booking not found", 404)
    inbound.attach_to_booking(message_id, row, booking, "assigned")
    return ok({"message_id": message_id, "booking_id": int(booking["id"])})
