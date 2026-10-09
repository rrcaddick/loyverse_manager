"""Staff roster and audit endpoints for the patched Loyverse terminals.

Both calls need the shared bridge token *and* the terminal's own enrolment
(``device_id`` + ``device_secret`` in the body; see ``PosStaffService``). There is no
management UI here; roles, employees, PINs and devices are managed through the service
(``scripts/pos_staff.py`` until the portal pages exist).

POST /api/pos/roster
    {"device_id": "p5-till-1", "device_secret": "<hex>", "known_version": "<sha256>|null"}
    -> {"version", "generated_at", "auth": {...}, "policy": {...}, "employees": [...]}
       or {"version": "<same>", "unchanged": true} when known_version still matches

POST /api/pos/devices/register
    {"device_id": "redmi-a3-gate", "device_secret": "<hex the terminal made>", "model": "Xiaomi 23129RAA4G"}
    -> {"status": "ok", "device_id": ...}   (403 for a revoked device)

POST /api/pos/events
    {"device_id": ..., "device_secret": ..., "events": [
        {"uuid": "...", "event": "login", "employee_id": 3, "employee_name": "Thandi",
         "occurred_at": 1760000000000, "detail": {...}}, ...]}
    -> {"status": "ok", "accepted": n, "rejected": m}
"""

from flask import Blueprint, jsonify, request

from src.services.pos_staff import DeviceAuthError, PosStaffService
from web.routes.bridge_auth import require_bridge_token

pos_staff_bp = Blueprint("pos_staff", __name__)


def _device_or_403(service, payload):
    try:
        return service.authenticate_device(payload.get("device_id"), payload.get("device_secret")), None
    except DeviceAuthError:
        return None, (jsonify({"error": "device not authorised"}), 403)


@pos_staff_bp.route("/pos/roster", methods=["POST"])
@require_bridge_token
def roster():
    payload = request.get_json(force=True, silent=True) or {}
    service = PosStaffService()
    device, error = _device_or_403(service, payload)
    if error:
        return error
    body = service.roster_for_device(device)
    known = payload.get("known_version")
    if isinstance(known, str) and known == body["version"]:
        return jsonify({"version": body["version"], "unchanged": True})
    return jsonify(body)


@pos_staff_bp.route("/pos/events", methods=["POST"])
@require_bridge_token
def events():
    payload = request.get_json(force=True, silent=True) or {}
    service = PosStaffService()
    device, error = _device_or_403(service, payload)
    if error:
        return error
    accepted, rejected = service.record_events(device, payload.get("events"))
    return jsonify({"status": "ok", "accepted": accepted, "rejected": rejected})


@pos_staff_bp.route("/pos/devices/register", methods=["POST"])
@require_bridge_token
def register_device():
    payload = request.get_json(force=True, silent=True) or {}
    try:
        device = PosStaffService.register_device(
            payload.get("device_id"), payload.get("device_secret"), str(payload.get("model") or "")
        )
    except DeviceAuthError:
        return jsonify({"error": "device not authorised"}), 403
    return jsonify({"status": "ok", "device_id": device["device_id"]})
