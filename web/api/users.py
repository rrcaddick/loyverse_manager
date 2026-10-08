"""User administration (admin only), plus the caller's own appearance preferences.

    PUT /api/v1/users/me/preferences {theme?, mode?, text_size?}   any signed-in role
"""

from __future__ import annotations

import re

from src.models import user as user_model
from src.services import users as users_service
from web.api import (
    ApiError,
    allow_manager,
    current_user,
    make_blueprint,
    ok,
    parse_json,
    require_role,
)

bp = make_blueprint("users", "/users")

THEME_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


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


@bp.put("/me/preferences")
@allow_manager
@require_role("admin", "manager")
def update_my_preferences():
    """Merge appearance preferences for the signed-in user (docs/research/07).

    ``theme`` is a slug of at most 32 characters (the frontend owns the list),
    ``mode`` is light/dark/system and ``text_size`` default/large/xlarge. Keys
    left out keep their stored value; unknown keys are ignored.
    """
    data = parse_json()
    changes: dict[str, str] = {}
    fields: dict[str, str] = {}
    if "theme" in data:
        theme = data["theme"]
        if not isinstance(theme, str) or not THEME_SLUG.match(theme.strip().lower()):
            fields["theme"] = "Use a slug of 1 to 32 letters, digits, dashes or underscores"
        else:
            changes["theme"] = theme.strip().lower()
    if "mode" in data:
        if data["mode"] not in user_model.PREFERENCE_MODES:
            fields["mode"] = f"Choose one of: {', '.join(user_model.PREFERENCE_MODES)}"
        else:
            changes["mode"] = data["mode"]
    if "text_size" in data:
        if data["text_size"] not in user_model.PREFERENCE_TEXT_SIZES:
            fields["text_size"] = f"Choose one of: {', '.join(user_model.PREFERENCE_TEXT_SIZES)}"
        else:
            changes["text_size"] = data["text_size"]
    if fields:
        raise ApiError("validation_error", "Invalid preferences", 422, fields)
    if not changes:
        raise ApiError(
            "validation_error",
            "Nothing to change",
            422,
            {"preferences": "Send at least one of theme, mode, text_size"},
        )
    me = current_user()
    user_model.update_preferences(me["id"], changes)
    return ok({"user": user_model.public(user_model.get_by_id(me["id"]))})
