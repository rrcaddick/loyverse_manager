"""Session endpoints: who am I, login, logout, change password."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from flask import request

from src.models import user as user_model
from src.services import users as users_service
from src.utils.logging import setup_logger
from web.api import (
    ApiError,
    current_user,
    ensure_csrf_token,
    login_session,
    logout_session,
    make_blueprint,
    ok,
    parse_json,
    public_endpoint,
)

logger = setup_logger("auth")
bp = make_blueprint("auth", "/auth")

# Per-process throttle: 10 failed attempts per IP per 5 minutes. nginx can add
# a harder limit in front; this keeps a single worker honest.
_FAILED: dict[str, deque] = defaultdict(deque)
_WINDOW_SECONDS = 300
_MAX_FAILURES = 10


def _throttled(ip: str) -> bool:
    q = _FAILED[ip]
    now = time.monotonic()
    while q and now - q[0] > _WINDOW_SECONDS:
        q.popleft()
    return len(q) >= _MAX_FAILURES


def _record_failure(ip: str) -> None:
    _FAILED[ip].append(time.monotonic())


def _session_payload(user: dict) -> dict:
    return {"user": user_model.public(user), "csrf_token": ensure_csrf_token()}


@bp.get("/session")
@public_endpoint
def get_session():
    user = current_user()
    if user is None:
        raise ApiError("unauthenticated", "Not signed in", 401)
    return ok(_session_payload(user))


@bp.post("/login")
@public_endpoint
def login():
    data = parse_json(("email", "password"))
    ip = request.remote_addr or "?"
    if _throttled(ip):
        logger.warning(f"Login throttled for {ip}")
        raise ApiError("throttled", "Too many attempts. Try again in a few minutes.", 429)
    user = users_service.authenticate(str(data["email"]), str(data["password"]))
    if user is None:
        _record_failure(ip)
        logger.warning(f"Failed login for '{data['email']}' from {ip}")
        raise ApiError("invalid_credentials", "Incorrect email or password", 401)
    login_session(user)
    logger.info(f"Login: {user['email']} ({user['role']}) from {ip}")
    return ok(_session_payload(user))


@bp.post("/logout")
@public_endpoint
def logout():
    user = current_user()
    if user:
        logger.info(f"Logout: {user['email']}")
    logout_session()
    return ok()


@bp.post("/change-password")
def change_password():
    user = current_user()
    data = parse_json(("current_password", "new_password"))
    try:
        users_service.change_password(user["id"], str(data["current_password"]), str(data["new_password"]))
    except users_service.UserError as exc:
        raise ApiError("validation_error", str(exc), 422)
    return ok(_session_payload(user_model.get_by_id(user["id"])))
