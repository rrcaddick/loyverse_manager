"""Shared-secret authentication for calls from the patched Loyverse terminals.

The terminals have no portal session; they send `Authorization: Bearer <BRIDGE_TOKEN>`
(and `X-Bridge-Token`). When BRIDGE_TOKEN is unset the check is skipped so a
loopback-only deployment keeps working unchanged.
"""

import hmac
from functools import wraps

from flask import jsonify, request

from config.settings import BRIDGE_TOKEN


def _presented_token() -> str:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[len("Bearer ") :].strip()
    return request.headers.get("X-Bridge-Token", "").strip()


def bridge_token_ok() -> bool:
    if not BRIDGE_TOKEN:
        return True
    return hmac.compare_digest(_presented_token(), BRIDGE_TOKEN)


def require_bridge_token(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if not bridge_token_ok():
            return jsonify({"error": "invalid bridge token"}), 401
        return view(*args, **kwargs)

    return wrapper
