from flask import Flask, render_template

from web.config import Config
from web.routes import scripts as scripts_routes
from web.routes.api import api_bp
from web.routes.groups import groups_bp


def create_app(config_class=Config):
    """Application factory pattern"""
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Ensure PDF directory exists
    app.config["PDF_OUTPUT_DIR"].mkdir(parents=True, exist_ok=True)

    # Register blueprints
    app.register_blueprint(api_bp, url_prefix="/api")
    app.register_blueprint(groups_bp)

    app.register_blueprint(scripts_routes.bp)

    # Root route
    @app.route("/")
    def home():
        return render_template("dashboard.html")

    return app
