"""The admin action queue and reminder dismissal.

    GET  /api/v1/queue                       sections, see docs/handoff/ops.md
    POST /api/v1/reminders/<id>/dismiss      {reminder}
"""

from __future__ import annotations

from src.services import reminders
from web.api import ApiError, current_user_id, make_blueprint, ok, require_role

bp = make_blueprint("queue", "")


@bp.get("/queue")
@require_role("admin")
def get_queue():
    return ok(reminders.build_queue())


@bp.post("/reminders/<int:reminder_id>/dismiss")
@require_role("admin")
def dismiss_reminder(reminder_id: int):
    row = reminders.dismiss_reminder(reminder_id, current_user_id())
    if row is None:
        raise ApiError("not_found", "Reminder not found", 404)
    return ok({"reminder": row})
