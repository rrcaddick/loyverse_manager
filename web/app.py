from flask import Flask, jsonify, redirect, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from web.config import Config
from web.routes import scripts as scripts_routes
from web.routes.api import api_bp
from web.routes.auth import auth_bp, register_auth_guard
from web.routes.groups import groups_bp
from web.routes.open_tickets import open_tickets_bp


def create_app(config_class=Config):
    """Application factory pattern"""
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Trust the forwarded headers set by the reverse proxy in front of us.
    # Without this Flask builds external URLs as http://, and the WhatsApp
    # ticket image link handed to Meta has to be https.
    app.wsgi_app = ProxyFix(  # type: ignore[method-assign]
        app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1
    )

    # Ensure PDF directory exists
    app.config["PDF_OUTPUT_DIR"].mkdir(parents=True, exist_ok=True)

    # Register blueprints
    app.register_blueprint(auth_bp)
    app.register_blueprint(api_bp, url_prefix="/api")
    app.register_blueprint(groups_bp)

    app.register_blueprint(open_tickets_bp)

    app.register_blueprint(scripts_routes.bp)

    # Deny-by-default gate. Must be registered after the blueprints so every
    # endpoint is covered; the exempt list lives in web/routes/auth.py.
    register_auth_guard(app)

    # Root route. The dashboard had no content and its nav entry is gone, so
    # "/" lands on the page the portal actually exists for. Kept as a route so
    # existing bookmarks and the sidebar brand link still work.
    @app.route("/")
    def home():
        return redirect(url_for("groups.manage_bookings"))

    # Liveness probe for the container healthcheck. Deliberately touches
    # neither the database nor any upstream API.
    @app.route("/healthz")
    def healthz():
        return jsonify({"status": "ok"})

    return app
