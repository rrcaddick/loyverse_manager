"""Calendar and day views (docs/booking-system.md §6).

``GET /calendar?from&to`` rolls bookings up per day for the month grid;
``GET /days/<date>`` is the day view with arrivals and payments. Both are open
to the manager role, which is what Marcelino uses at the gate.
"""

from __future__ import annotations

from datetime import date, timedelta

from flask import request

from src.services import booking as booking_service
from src.utils.date import get_today
from web.api import ApiError, allow_manager, make_blueprint, ok
from web.api.bookings import register_booking_errors

bp = make_blueprint("calendar", "")
register_booking_errors(bp)

DEFAULT_SPAN_DAYS = 42  # a six-week month grid
MAX_SPAN_DAYS = 400


def _parse_day(raw: str | None, name: str) -> date | None:
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        raise ApiError("validation_error", f"Invalid date for '{name}'", 422, {name: "Use YYYY-MM-DD"})


@bp.get("/calendar")
@allow_manager
def calendar():
    from_date = _parse_day(request.args.get("from"), "from")
    to_date = _parse_day(request.args.get("to"), "to")
    if from_date is None:
        from_date = get_today().replace(day=1)
    if to_date is None:
        to_date = from_date + timedelta(days=DEFAULT_SPAN_DAYS - 1)
    if to_date < from_date:
        raise ApiError("validation_error", "'to' must not be before 'from'", 422, {"to": "Before from"})
    if (to_date - from_date).days >= MAX_SPAN_DAYS:
        raise ApiError(
            "validation_error", f"Range may not exceed {MAX_SPAN_DAYS} days", 422, {"to": "Range too long"}
        )
    days = booking_service.calendar_days(from_date, to_date)
    return ok({"from": from_date.isoformat(), "to": to_date.isoformat(), "days": days})


@bp.get("/days/<day>")
@allow_manager
def day_view(day: str):
    d = _parse_day(day, "date")
    if d is None:
        raise ApiError("validation_error", "A date is required", 422, {"date": "Use YYYY-MM-DD"})
    return ok(booking_service.day_detail(d))
