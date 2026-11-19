"""Groups: the thing that comes back (2 Nov 2026).

GET    /api/v1/groups?q=                      — groups by name, alias, a booking's name,
                                                 reference or contact (the Change group picker)
GET    /api/v1/groups/<id>                     — the group with its spellings
POST   /api/v1/groups/<id>/aliases             — {"name"}: add a spelling
POST   /api/v1/groups/<id>/aliases/<aid>/use   — make it the name
DELETE /api/v1/groups/<id>/aliases/<aid>       — drop a spelling (not the selected one)

The name is just the selected spelling (3 Nov 2026): switching it is a click,
a wrong one is deleted, and the bookings keep their own names regardless.
"""

from __future__ import annotations

from flask import request

from src.models import booking_group as group_model
from src.services import groups as group_service
from web.api import ApiError, current_user, make_blueprint, ok, parse_json

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


def _actor() -> int | None:
    u = current_user()
    return int(u["id"]) if u else None


def _group(group_id: int) -> dict:
    g = group_service.group_detail(group_id)
    if g is None:
        raise ApiError("not_found", "Group not found", 404)
    return g


@bp.get("/<int:group_id>")
def get_group(group_id: int):
    """The group page: aliases, bookings with their metrics, the summary, the people."""
    page = group_service.group_page(group_id)
    if page is None:
        raise ApiError("not_found", "Group not found", 404)
    return ok(page)


@bp.post("/<int:group_id>/aliases")
def add_alias(group_id: int):
    data = parse_json(("name",))
    _group(group_id)
    try:
        return ok(group_service.add_spelling(group_id, str(data.get("name") or ""), _actor()))
    except ValueError as exc:
        raise ApiError("validation_error", str(exc), 422, {"name": str(exc)}) from exc


@bp.post("/<int:group_id>/aliases/<int:alias_id>/use")
def use_alias(group_id: int, alias_id: int):
    _group(group_id)
    try:
        return ok(group_service.use_spelling(group_id, alias_id, _actor()))
    except LookupError as exc:
        raise ApiError("not_found", str(exc), 404) from exc


@bp.delete("/<int:group_id>/aliases/<int:alias_id>")
def delete_alias(group_id: int, alias_id: int):
    _group(group_id)
    try:
        return ok(group_service.remove_spelling(group_id, alias_id, _actor()))
    except LookupError as exc:
        raise ApiError("not_found", str(exc), 404) from exc
    except ValueError as exc:
        raise ApiError("invalid_state", str(exc), 409) from exc
