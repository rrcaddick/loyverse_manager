"""JSON API helpers shared by every ``web/api/*`` module.

    from web.api import ok, fail, ApiError, require_role, allow_manager, current_user, parse_json

Conventions (docs/booking-system.md §6): errors are
``{"error": {"code", "message", "fields"}}``; lists are ``{"items", "total", "page", "page_size"}``.
Managers are denied by default; mark a view with ``@allow_manager`` to open it.
"""

from __future__ import annotations

import secrets
from functools import wraps
from typing import Any, Callable

from flask import Blueprint, Response, g, jsonify, request, session

from src.models import user as user_model

SESSION_USER_KEY = "user_id"
SESSION_CSRF_KEY = "csrf_token"
CSRF_HEADER = "X-CSRF-Token"


class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, fields: dict | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.fields = fields or {}

    def to_response(self):
        body: dict[str, Any] = {"error": {"code": self.code, "message": self.message}}
        if self.fields:
            body["error"]["fields"] = self.fields
        return jsonify(body), self.status


def ok(data: Any = None, status: int = 200):
    if data is None:
        return Response(status=204)
    return jsonify(data), status


def fail(code: str, message: str, status: int = 400, fields: dict | None = None):
    raise ApiError(code, message, status, fields)


def not_found(what: str = "Resource"):
    raise ApiError("not_found", f"{what} not found", 404)


def paginated(items: list, total: int, page: int, page_size: int):
    return jsonify({"items": items, "total": total, "page": page, "page_size": page_size})


def page_args(default_size: int = 25, max_size: int = 200) -> tuple[int, int]:
    try:
        page = max(1, int(request.args.get("page", 1)))
        size = min(max_size, max(1, int(request.args.get("page_size", default_size))))
    except ValueError:
        raise ApiError("validation_error", "page and page_size must be integers")
    return page, size


def parse_json(required: tuple[str, ...] = ()) -> dict:
    data = request.get_json(silent=True)
    if data is None or not isinstance(data, dict):
        raise ApiError("validation_error", "A JSON object body is required")
    missing = {k: "This field is required" for k in required if data.get(k) in (None, "", [])}
    if missing:
        raise ApiError("validation_error", "Missing required fields", 422, missing)
    return data


# ----------------------------------------------------------------- auth ---

def current_user() -> dict | None:
    """The logged-in user's row (cached per request) or None."""
    if "current_user" in g:
        return g.current_user
    user_id = session.get(SESSION_USER_KEY)
    user = user_model.get_by_id(user_id) if user_id else None
    if user is not None and not user.get("is_active"):
        user = None
    g.current_user = user
    return user


def current_user_id() -> int | None:
    user = current_user()
    return user["id"] if user else None


def ensure_csrf_token() -> str:
    token = session.get(SESSION_CSRF_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        session[SESSION_CSRF_KEY] = token
    return token


def csrf_valid() -> bool:
    expected = session.get(SESSION_CSRF_KEY)
    presented = request.headers.get(CSRF_HEADER, "")
    return bool(expected) and secrets.compare_digest(expected, presented)


def login_session(user: dict) -> str:
    session.clear()
    session[SESSION_USER_KEY] = user["id"]
    session.permanent = True
    g.current_user = user
    return ensure_csrf_token()


def logout_session() -> None:
    session.clear()
    g.pop("current_user", None)


def require_role(*roles: str) -> Callable:
    """Explicit role gate for a view (the app guard already denies anonymous callers)."""

    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = current_user()
            if user is None:
                raise ApiError("unauthenticated", "Sign in required", 401)
            if roles and user["role"] not in roles:
                raise ApiError("forbidden", "You do not have access to this", 403)
            return view(*args, **kwargs)

        wrapped._allowed_roles = roles  # type: ignore[attr-defined]
        return wrapped

    return decorator


def allow_manager(view):
    """Opt a view in for the manager role. Everything else is admin-only."""
    view._allow_manager = True  # type: ignore[attr-defined]
    return view


def public_endpoint(view):
    """Opt a view out of the login guard and CSRF check (public form, webhooks)."""
    view._public = True  # type: ignore[attr-defined]
    return view


def make_blueprint(name: str, prefix: str = "") -> Blueprint:
    """Blueprint under /api/v1 with the JSON error handler attached."""
    bp = Blueprint(f"api_{name}", __name__, url_prefix=f"/api/v1{prefix}")

    @bp.errorhandler(ApiError)
    def _api_error(err: ApiError):
        return err.to_response()

    return bp


# Modules registered by web/app.py. Each exposes a module-level ``bp``.
API_MODULES = (
    "web.api.auth",
    "web.api.users",
    "web.api.settings",
    "web.api.bookings",
    "web.api.calendar",
    "web.api.documents",
    "web.api.inbox",
    "web.api.payments",
    "web.api.queue",
    "web.api.work",
    "web.api.today",
    "web.api.gate",
    "web.api.ops",
    "web.api.public",
)
