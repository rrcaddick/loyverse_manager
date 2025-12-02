from __future__ import annotations

from flask import Blueprint, jsonify, render_template, request

from scripts.add_inventory import add_inventory
from scripts.clear_inventory import clear_inventory
from scripts.hide_quicket_event import hide_quicket_event  # your new script
from src.utils.logging import setup_logger

bp = Blueprint("scripts", __name__)

logger = setup_logger("scripts_web")


@bp.get("/scripts")
def manage_scripts():
    return render_template("scripts.html")


@bp.post("/scripts/run")
def run_script():
    data = request.get_json(silent=True) or {}
    script_name = data.get("name")

    if script_name not in {"add_inventory", "clear_inventory", "hide_quicket_event"}:
        return (
            jsonify({"success": False, "error": f"Unknown script: {script_name}"}),
            400,
        )

    try:
        if script_name == "add_inventory":
            add_inventory()
        elif script_name == "clear_inventory":
            clear_inventory()
        elif script_name == "hide_quicket_event":
            hide_quicket_event()
    except Exception as e:  # noqa: BLE001
        logger.error(
            "Error running script %s: %s: %s", script_name, type(e).__name__, e
        )
        return (
            jsonify(
                {
                    "success": False,
                    "error": f"{type(e).__name__}: {str(e)}",
                }
            ),
            500,
        )

    return jsonify({"success": True})
