"""The Today page (docs/research/01): ``GET /api/v1/today?date=YYYY-MM-DD``.

Open to managers; their variant leaves out the money tile, the Needs-you tile
and Up next (they cannot open Work). See docs/handoff/work-today.md.
"""

from __future__ import annotations

from datetime import date

from flask import request

from src.services import today as today_service
from src.utils.date import get_today
from web.api import ApiError, allow_manager, current_user, make_blueprint, ok

bp = make_blueprint("today", "")


@bp.get("/today")
@allow_manager
def get_today_page():
    raw = request.args.get("date")
    if raw:
        try:
            d = date.fromisoformat(raw[:10])
        except ValueError:
            raise ApiError("validation_error", "Invalid date", 422, {"date": "Use YYYY-MM-DD"})
    else:
        d = get_today()
    user = current_user()
    for_manager = user is None or user.get("role") != "admin"
    return ok(today_service.today(d, for_manager=for_manager))
