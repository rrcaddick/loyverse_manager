"""The Gate page: arrivals today, open tickets on the tills, the morning sync.

    GET /api/v1/gate?date=YYYY-MM-DD   admin and manager

See docs/handoff/backend-v2-misc.md for the shape.
"""

from __future__ import annotations

from datetime import date

from flask import request

from src.services import gate as gate_service
from web.api import ApiError, allow_manager, make_blueprint, ok

bp = make_blueprint("gate", "/gate")


@bp.get("")
@allow_manager
def gate():
    raw = request.args.get("date")
    today: date | None = None
    if raw:
        try:
            today = date.fromisoformat(raw[:10])
        except ValueError:
            raise ApiError("validation_error", "date must be YYYY-MM-DD", 422, {"date": "Use YYYY-MM-DD"})
    return ok(gate_service.snapshot(today))
