"""User administration (admin only)."""

from __future__ import annotations

from src.models import user as user_model
from src.services import users as users_service
from web.api import ApiError, current_user, make_blueprint, ok, parse_json, require_role

bp = make_blueprint("users", "/users")


@bp.get("")
@require_role("admin")
def list_users():
    return ok({"items": user_model.list_users()})


@bp.post("")
@require_role("admin")
def create_user():
    data = parse_json(("email", "full_name", "role"))
    try:
        user, temp_password = users_service.create_user(
            str(data["email"]), str(data["full_name"]), str(data["role"])
        )
    except users_service.UserError as exc:
        raise ApiError("validation_error", str(exc), 422)
    return ok({"user": user, "temporary_password": temp_password}, 201)


@bp.patch("/<int:user_id>")
@require_role("admin")
def update_user(user_id: int):
    data = parse_json()
    me = current_user()
    if user_id == me["id"] and data.get("role") not in (None, me["role"]):
        raise ApiError("validation_error", "You cannot change your own role", 422)
    if user_id == me["id"] and data.get("is_active") is False:
        raise ApiError("validation_error", "You cannot deactivate yourself", 422)
    if user_model.get_by_id(user_id) is None:
        raise ApiError("not_found", "User not found", 404)
    try:
        user = users_service.update_user(
            user_id,
            full_name=data.get("full_name"),
            role=data.get("role"),
            is_active=data.get("is_active"),
        )
    except users_service.UserError as exc:
        raise ApiError("validation_error", str(exc), 422)
    return ok({"user": user})


@bp.post("/<int:user_id>/reset-password")
@require_role("admin")
def reset_password(user_id: int):
    try:
        temp = users_service.reset_password(user_id)
    except users_service.UserError as exc:
        raise ApiError("not_found", str(exc), 404)
    return ok({"temporary_password": temp})
