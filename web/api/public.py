"""Public booking-request form endpoints. No session, no CSRF.

    GET  /api/v1/public/form-config          what the form needs to render
    POST /api/v1/public/booking-request      create an enquiry → {id, token, ...}
    GET  /api/v1/public/requests/<id>?token=  the public summary for the confirmation page

All views are ``@public_endpoint``: the app guard skips them. Abuse control is
the honeypot + Turnstile + per-IP rate limit in ``src/services/public_form.py``.
Nothing is emailed from here unless Settings › Booking form has
"acknowledgement_enabled" on (off by default); the enquiry lands in Work
under new requests either way.
"""

from __future__ import annotations

from datetime import timedelta

from flask import request

from config.settings import TURNSTILE_SITE_KEY
from src.services import public_form
from src.services.settings import get_settings
from src.utils.date import get_today
from src.utils.logging import setup_logger
from web.api import ApiError, make_blueprint, ok, public_endpoint

logger = setup_logger("public_api")
bp = make_blueprint("public", "/public")


def _client_ip() -> str:
    # ProxyFix has already folded X-Forwarded-For into remote_addr.
    return request.remote_addr or ""


@bp.get("/form-config")
@public_endpoint
def form_config():
    s = get_settings()
    today = get_today()
    season_start = public_form.parse_iso_date(s["season"].start)
    season_end = public_form.parse_iso_date(s["season"].end)
    min_date = max(today + timedelta(days=1), season_start) if season_start else today + timedelta(days=1)
    closed = public_form.season_days_by_kind("closed")
    peak = public_form.season_days_by_kind("peak")
    in_range = lambda d: d >= min_date and (season_end is None or d <= season_end)  # noqa: E731
    body = {
        "intro": s["form"].get("intro"),
        "group_types": [
            {"code": g["code"], "label": g.get("label") or g["code"]}
            for g in s["form"].group_types
            if isinstance(g, dict) and g.get("code")
        ],
        "min_date": min_date.isoformat(),
        "max_date": season_end.isoformat() if season_end else None,
        "closed_weekdays": [int(w) for w in (s["season"].closed_weekdays or [])],
        "avoid_weekdays": [int(w) for w in (s["season"].get("avoid_weekdays") or [])],
        "closed_days": [d.isoformat() for d in sorted(closed) if in_range(d)],
        "peak_days": [d.isoformat() for d in sorted(peak) if in_range(d)],
        "max_questions": int(s["form"].get("max_questions") or 0),
        "min_group_size": int(s["form"].get("min_group_size") or 0),
        "max_group_size": int(s["form"].get("max_group_size") or public_form.DEFAULT_MAX_GROUP_SIZE),
        "max_gazebos": public_form.MAX_GAZEBOS,
        "arrival_slots": [str(x) for x in (s["form"].get("arrival_slots") or public_form.DEFAULT_ARRIVAL_SLOTS)],
        "acknowledgement_enabled": bool(s["form"].get("acknowledgement_enabled")),
        "turnstile_site_key": TURNSTILE_SITE_KEY or None,
        "park": {
            "name": s["documents"].get("trading_name") or s["email"].get("sender_name"),
            "phone": s["email"].get("phone"),
            "website": s["email"].get("website"),
            "email": s["documents"].get("pop_email"),
        },
    }
    response, status = ok(body)
    response.headers["Cache-Control"] = "no-store"
    return response, status


@bp.post("/booking-request")
@public_endpoint
def booking_request():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise ApiError("validation_error", "A JSON object body is required", 400)
    ip = _client_ip()
    user_agent = request.headers.get("User-Agent", "")

    if public_form.rate_limited(ip):
        logger.warning(f"Form rate limit hit from {ip}")
        raise ApiError(
            "rate_limited", "Too many requests from this connection. Please try again later.", 429
        )

    settings = get_settings()
    clean, errors = public_form.validate_request(data, settings)
    if errors:
        if "website" in errors:
            logger.warning(f"Form honeypot tripped from {ip}")
        raise ApiError("validation_error", "Please check the highlighted fields", 422, errors)

    token = data.get("turnstile_token") or data.get("cf-turnstile-response")
    if not public_form.verify_turnstile(str(token) if token else None, ip):
        public_form.record_submission(None, data, ip, user_agent, False)
        raise ApiError(
            "turnstile_failed", "We could not confirm you are not a robot. Please try again.", 400
        )

    clean.pop("policy_accepted", None)
    booking = public_form.create_booking_compat(clean, source="form", actor=None)
    booking_id = int(booking["id"])
    public_form.record_submission(booking_id, data, ip, user_agent, True)
    logger.info(f"Form enquiry {booking.get('reference')} created for '{clean['group_name']}' from {ip}")

    sent = public_form.send_acknowledgement_if_enabled(booking, settings)
    summary = public_form.public_summary(booking)
    if sent is not None and sent.get("send_status", "sent") == "sent":
        summary["acknowledged"] = True
    summary["token"] = public_form.request_receipt_token(booking_id)
    return ok(summary, 201)


@bp.get("/requests/<int:booking_id>")
@public_endpoint
def request_receipt(booking_id: int):
    """The confirmation page's data, gated by the signed token from the POST."""
    ok_token, error = public_form.verify_request_receipt_token(request.args.get("token"), booking_id)
    if not ok_token:
        code = "token_expired" if error == "expired" else "invalid_token"
        raise ApiError(code, "This link is no longer valid", 403)
    row = public_form.booking_row(booking_id)
    if row is None:
        raise ApiError("not_found", "Request not found", 404)
    response, status = ok(public_form.public_summary(row))
    response.headers["Cache-Control"] = "no-store"
    return response, status
