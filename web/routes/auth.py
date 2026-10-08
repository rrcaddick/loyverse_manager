"""
Single shared-account login for the admin portal.

There is one set of credentials, held as a password hash in the environment
(AUTH_USERNAME / AUTH_PASSWORD_HASH). That is deliberate: this is a standby
system used by a couple of people, and a user table buys accountability we do
not currently need. Swapping this for per-user accounts later means replacing
`_credentials_valid` and the session payload, nothing else.

The gate itself lives in web/app.py so it applies to every blueprint by
default; this module only owns the login and logout endpoints.
"""

import hmac
from functools import wraps

from flask import (
    Blueprint,
    flash,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash

from config.settings import AUTH_PASSWORD_HASH, AUTH_USERNAME
from src.utils.logging import setup_logger

logger = setup_logger("auth")

auth_bp = Blueprint("auth", __name__)

# Endpoints reachable without a session. Everything else is denied by default.
PUBLIC_ENDPOINTS = {
    "auth.login",
    "auth.logout",
    "static",
    "healthz",
    # Meta's servers fetch the WhatsApp ticket image and have no session.
    # This endpoint carries its own 5-minute JWT - see TokenService.
    "groups.get_ticket_image",
    # Called by the patched Loyverse terminals; protected by BRIDGE_TOKEN instead.
    "open_tickets.open_ticket_events",
    "open_tickets.open_ticket_heartbeat",
    "stock.availability",
    # Also require the terminal's own enrolment secret - see web/routes/pos_staff.py.
    "pos_staff.roster",
    "pos_staff.events",
}

SESSION_KEY = "authenticated_as"


def is_authenticated() -> bool:
    return bool(session.get(SESSION_KEY))


def auth_is_configured() -> bool:
    """False when no password hash is set, in which case we fail closed."""
    return bool(AUTH_PASSWORD_HASH)


def _credentials_valid(username: str, password: str) -> bool:
    """Constant-time-ish credential check.

    check_password_hash is already constant time for the password; the username
    gets compare_digest so a wrong username costs the same as a wrong password.
    """
    if not auth_is_configured():
        return False
    username_ok = hmac.compare_digest(
        (username or "").strip().lower(), (AUTH_USERNAME or "").strip().lower()
    )
    password_ok = check_password_hash(AUTH_PASSWORD_HASH, password or "")
    return username_ok and password_ok


def _safe_next(target: str | None) -> str:
    """Only allow relative, single-slash paths - never an off-site redirect."""
    if not target or not target.startswith("/") or target.startswith("//"):
        return url_for("home")
    return target


def login_required(view):
    """Belt-and-braces decorator. The app-wide before_request is the real gate;
    this exists so a blueprint registered without that guard is still covered."""

    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_authenticated():
            return redirect(url_for("auth.login", next=request.full_path))
        return view(*args, **kwargs)

    return wrapped


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if is_authenticated() and request.method == "GET":
        return redirect(url_for("home"))

    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")

        if not auth_is_configured():
            logger.error("Login attempted but AUTH_PASSWORD_HASH is not configured")
            flash(
                "Authentication is not configured on this server. "
                "Set AUTH_PASSWORD_HASH and restart.",
                "error",
            )
            return render_template("login.html", configured=False), 503

        if _credentials_valid(username, password):
            session.clear()
            session[SESSION_KEY] = AUTH_USERNAME
            session.permanent = True
            logger.info(
                f"Successful login as '{username}' from {request.remote_addr}"
            )
            return redirect(_safe_next(request.args.get("next")))

        # Logged so repeated bot attempts are visible in logs/inventory_updates.log
        logger.warning(
            f"Failed login attempt for '{username}' from {request.remote_addr}"
        )
        flash("Incorrect username or password.", "error")
        return render_template("login.html", configured=True), 401

    return render_template("login.html", configured=auth_is_configured())


@auth_bp.route("/logout", methods=["GET", "POST"])
def logout():
    was = session.get(SESSION_KEY)
    session.clear()
    if was:
        logger.info(f"Logged out '{was}' from {request.remote_addr}")
    flash("You have been signed out.", "success")
    return redirect(url_for("auth.login"))


def register_auth_guard(app):
    """Deny every request without a session, except PUBLIC_ENDPOINTS."""

    @app.before_request
    def _require_login():
        if request.endpoint in PUBLIC_ENDPOINTS:
            return None
        if is_authenticated():
            return None

        # AJAX and API callers get a status code they can act on rather than
        # an HTML login page rendered inside a toast.
        if _wants_json():
            return {"success": False, "error": "authentication required"}, 401

        return redirect(url_for("auth.login", next=request.full_path))

    if not auth_is_configured():
        app.logger.warning(
            "AUTH_PASSWORD_HASH is not set - the portal will refuse all logins"
        )


def _wants_json() -> bool:
    return (
        request.path.startswith("/api/")
        or request.headers.get("X-Requested-With") == "XMLHttpRequest"
        or request.accept_mimetypes.best == "application/json"
    )
