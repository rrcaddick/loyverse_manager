from datetime import datetime

from flask import Blueprint, jsonify, request

from src.models.open_ticket import OpenTicket

open_tickets_bp = Blueprint("open_tickets", __name__)


@open_tickets_bp.route("/open_tickets/events", methods=["POST"])
def open_ticket_events():
    payload = request.get_json(force=True)
    events = payload.get("events", [])

    for evt in events:
        OpenTicket.upsert_open(
            ticket_id=evt["ticket_id"],
            semantic_hash=evt["semantic_hash"],
            receipt_json=evt["receipt"],
            observed_at=datetime.fromtimestamp(evt["observed_at"] / 1000),
        )

    return jsonify({"status": "ok"})


@open_tickets_bp.route("/open_tickets/heartbeat", methods=["POST"])
def open_ticket_heartbeat():
    payload = request.get_json(force=True)

    open_ids = set(payload.get("open_ticket_ids", []))
    observed_at = datetime.fromtimestamp(payload["observed_at"] / 1000)

    OpenTicket.close_missing(open_ids, observed_at)

    return jsonify({"status": "ok"})
