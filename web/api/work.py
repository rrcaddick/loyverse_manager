"""The Work list (docs/research/01): one list, views in a rail, fixed verbs.

    GET  /api/v1/work?view=&page=&page_size=     {items, total, page, page_size, view, counts, today}
    GET  /api/v1/work/counts                     {counts, today}
    POST /api/v1/work/reminders/dismiss          {ids: [int]} | {all_stale: true}
    POST /api/v1/work/holds/<booking_id>/extend  {hold_expires_on: YYYY-MM-DD}

All admin-only. Row shape and the action vocabulary: docs/handoff/work-today.md.
"""

from __future__ import annotations

from datetime import date

from flask import request

from src.models import booking as booking_model
from src.services import booking as booking_service
from src.services import reminders, work
from src.utils.date import get_today
from web.api import ApiError, current_user_id, make_blueprint, ok, page_args, require_role
from web.api.bookings import register_booking_errors

bp = make_blueprint("work", "/work")
register_booking_errors(bp)

DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


@bp.get("")
@require_role("admin")
def list_view():
    view = request.args.get("view", "up_next")
    if view not in work.VIEWS:
        raise ApiError(
            "validation_error",
            "Unknown view",
            422,
            {"view": f"Choose one of: {', '.join(work.VIEWS)}"},
        )
    page, page_size = page_args(DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
    return ok(work.list_work(view, page, page_size))


@bp.get("/counts")
@require_role("admin")
def counts():
    snap = work.snapshot()
    return ok({"counts": snap["counts"], "today": snap["today"]})


def _reminder_ids(raw) -> list[int]:
    """Accept ``[12, "reminder:13"]``; anything else is a 422."""
    if not isinstance(raw, list):
        raise ApiError("validation_error", "ids must be a list", 422, {"ids": "Send a list of ids"})
    out: list[int] = []
    for item in raw:
        text = str(item).strip()
        if text.startswith("reminder:"):
            text = text[len("reminder:"):]
        try:
            out.append(int(text))
        except ValueError:
            raise ApiError("validation_error", "ids must be integers", 422, {"ids": f"Not an id: {item!r}"})
    return out


@bp.post("/reminders/dismiss")
@require_role("admin")
def dismiss_reminders():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("validation_error", "A JSON object body is required")
    if data.get("all_stale") is True:
        ids = reminders.stale_reminder_ids()
    else:
        ids = _reminder_ids(data.get("ids"))
    result = reminders.bulk_dismiss(ids, current_user_id())
    return ok({**result, "counts": work.counts()})


@bp.post("/holds/<int:booking_id>/extend")
@require_role("admin")
def extend_hold(booking_id: int):
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data.get("hold_expires_on"):
        raise ApiError(
            "validation_error", "hold_expires_on is required", 422, {"hold_expires_on": "Required"}
        )
    try:
        new_hold = date.fromisoformat(str(data["hold_expires_on"])[:10])
    except ValueError:
        raise ApiError(
            "validation_error", "Invalid date", 422, {"hold_expires_on": "Use YYYY-MM-DD"}
        )
    today = get_today()
    if new_hold < today:
        raise ApiError(
            "validation_error", "The hold cannot expire in the past", 422,
            {"hold_expires_on": "Choose today or later"},
        )
    booking = booking_model.get(booking_id)
    if booking is None:
        raise ApiError("not_found", "Booking not found", 404)
    if booking["status"] not in ("enquiry", "proforma_sent"):
        raise ApiError(
            "invalid_state",
            f"Only a tentative booking has a hold (this one is {booking['status']})",
            409,
        )
    if new_hold > booking["visit_date"]:
        raise ApiError(
            "validation_error", "The hold cannot outlive the visit", 422,
            {"hold_expires_on": f"On or before {booking['visit_date'].isoformat()}"},
        )
    booking_service.update_booking(booking_id, {"hold_expires_on": new_hold.isoformat()}, current_user_id())
    reminders.reschedule_lapse(booking_id, new_hold)
    return ok({"booking": booking_service.get_booking_detail(booking_id), "counts": work.counts()})
