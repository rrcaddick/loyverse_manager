"""Flask application factory.

The portal is a React single-page app (built into web/static/app) talking to
the JSON API under /api/v1. Flask also keeps three legacy surfaces alive:

- the WhatsApp ticket endpoints under /group-bookings (Meta fetches the image),
- the Loyverse bridge webhooks (/open_tickets/*, /api/stock/*), token-protected,
- the legacy /api/groups receipts feed.

Access control is deny-by-default and lives in ``_register_guard``:
anonymous callers get 401 JSON on /api and the SPA shell elsewhere; managers
are denied on every API view unless it opted in with ``@allow_manager``;
state-changing API calls need the session's CSRF token.
"""

from __future__ import annotations

import importlib
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_file
from werkzeug.middleware.proxy_fix import ProxyFix

from config.settings import BOOKING_FORM_HOST, DATA_DIR
from src.utils.logging import setup_logger
from web.api import API_MODULES, ApiError, csrf_valid, current_user
from web.config import Config
from web.routes.api import api_bp
from web.routes.groups import groups_bp
from web.routes.open_tickets import open_tickets_bp
from web.routes.stock import stock_bp

logger = setup_logger("web")

SPA_DIR = Path(__file__).resolve().parent / "static" / "app"

# Endpoints reachable without a session. Everything else is denied by default.
PUBLIC_ENDPOINTS = {
    "static",
    "healthz",
    "spa",
    # Meta's servers fetch the WhatsApp ticket image; it carries its own JWT.
    "groups.get_ticket_image",
}
# Blueprints that authenticate themselves with the bridge token.
BRIDGE_BLUEPRINTS = ("open_tickets.", "stock.")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Trust the forwarded headers set by nginx. Without this Flask builds
    # external URLs as http:// and the WhatsApp ticket image link breaks.
    app.wsgi_app = ProxyFix(  # type: ignore[method-assign]
        app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1
    )

    for sub in ("documents", "attachments", "backups"):
        (DATA_DIR / sub).mkdir(parents=True, exist_ok=True)
    app.config["PDF_OUTPUT_DIR"].mkdir(parents=True, exist_ok=True)

    # Legacy surfaces
    app.register_blueprint(api_bp, url_prefix="/api")
    app.register_blueprint(groups_bp)
    app.register_blueprint(open_tickets_bp)
    app.register_blueprint(stock_bp, url_prefix="/api")

    _register_api(app)
    _register_guard(app)
    _register_errors(app)
    _register_spa(app)
    _register_headers(app)

    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app


def _register_api(app: Flask) -> None:
    """Register every web/api module that exists. Missing modules are logged,
    not fatal, so the app boots while parts are still being built."""
    for dotted in API_MODULES:
        try:
            module = importlib.import_module(dotted)
        except ModuleNotFoundError as exc:
            if exc.name == dotted:
                logger.warning(f"API module not present yet: {dotted}")
                continue
            raise
        app.register_blueprint(module.bp)


def _register_guard(app: Flask) -> None:
    @app.before_request
    def _guard():
        endpoint = request.endpoint
        if endpoint is None:
            return None  # falls through to the 404 handler
        if endpoint in PUBLIC_ENDPOINTS or endpoint.startswith(BRIDGE_BLUEPRINTS):
            return None
        view = app.view_functions.get(endpoint)
        if getattr(view, "_public", False):
            return None

        user = current_user()
        is_api = request.path.startswith("/api/")
        if user is None:
            if is_api:
                return ApiError("unauthenticated", "Sign in required", 401).to_response()
            return redirect("/login?next=" + request.full_path.rstrip("?"))

        if is_api and request.method not in SAFE_METHODS and not csrf_valid():
            return ApiError("csrf", "Invalid or missing CSRF token", 403).to_response()

        is_auth_endpoint = endpoint.startswith("api_auth.")
        if user.get("must_change_password") and is_api and not is_auth_endpoint:
            return ApiError(
                "password_change_required", "Set a new password to continue", 403
            ).to_response()

        if user["role"] != "admin" and not is_auth_endpoint:
            if not getattr(view, "_allow_manager", False):
                if is_api:
                    return ApiError("forbidden", "You do not have access to this", 403).to_response()
                abort(403)
        return None


def _register_errors(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def _api_error(err: ApiError):
        return err.to_response()

    @app.errorhandler(404)
    def _not_found(err):
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "not_found", "message": "Not found"}}), 404
        return err

    @app.errorhandler(405)
    def _method_not_allowed(err):
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "method_not_allowed", "message": "Method not allowed"}}), 405
        return err

    @app.errorhandler(500)
    def _server_error(err):
        logger.error(f"Unhandled error on {request.method} {request.path}: {err}", exc_info=True)
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "server_error", "message": "Something went wrong"}}), 500
        return err


def _register_spa(app: Flask) -> None:
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def spa(path: str):
        if path.startswith(("api/", "static/", "group-bookings/", "open_tickets/")):
            abort(404)
        host = request.host.split(":")[0].lower()
        if path == "" and BOOKING_FORM_HOST and host == BOOKING_FORM_HOST.lower():
            return redirect("/request")
        index = SPA_DIR / "index.html"
        if not index.exists():
            return (
                "The web app has not been built. Run `pnpm install && pnpm build` in frontend/.",
                503,
                {"Content-Type": "text/plain; charset=utf-8"},
            )
        response = send_file(index)
        response.headers["Cache-Control"] = "no-store"
        return response


def _register_headers(app: Flask) -> None:
    @app.after_request
    def _security_headers(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault(
            "Permissions-Policy", "camera=(), microphone=(), geolocation=()"
        )
        if request.path.startswith("/static/app/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
