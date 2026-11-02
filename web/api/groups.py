"""Groups: the thing that comes back (2 Nov 2026).

GET /api/v1/groups?q=  — groups by name, alias, a booking's name, reference or
contact, newest visit first; the picker behind "Link to another group".
"""

from __future__ import annotations

from flask import request

from src.models import booking_group as group_model
from src.services import groups as group_service
from web.api import make_blueprint, ok

bp = make_blueprint("groups", "/groups")


@bp.get("")
def list_groups():
    q = (request.args.get("q") or "").strip()
    try:
        limit = max(1, min(50, int(request.args.get("limit") or 20)))
    except ValueError:
        limit = 20
    rows = [group_service.serialize_group_row(r) for r in group_model.search(q, limit=limit)]
    return ok({"items": rows, "total": len(rows), "page": 1, "page_size": limit})
