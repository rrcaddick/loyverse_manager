"""Stock availability for the Loyverse bridge's stock guard.

The patched POS asks, before adding an item, how much of a product is already held in
open tickets on *other* devices. The feed gives this service every open ticket from
every terminal, so the answer does not depend on the terminals syncing with each other.

POST /api/stock/availability
    {"product_id": 123, "variant_id": null, "requested": 6000,
     "exclude_sync_id": 1759830000000, "local_stock": 6000}
    -> {"product_id": 123, "held_elsewhere": 5000, "stock_on_hand": 6000}

POST /api/stock/availability   (bulk: the bridge refreshes its cache in the background)
    {"products": [{"product_id": 123, "variant_id": null}, ...], "exclude_sync_id": 0}
    -> {"results": [{"product_id": 123, "variant_id": null, "held_elsewhere": 5000}, ...]}

Quantities are Loyverse's integer thousandths (1 unit = 1000).
"""

from flask import Blueprint, jsonify, request

from src.models.open_ticket import OpenTicket
from web.routes.bridge_auth import require_bridge_token

stock_bp = Blueprint("stock", __name__)


@stock_bp.route("/stock/availability", methods=["POST"])
@require_bridge_token
def availability():
    payload = request.get_json(force=True, silent=True) or {}
    if isinstance(payload.get("products"), list):
        return _bulk(payload)
    try:
        product_id = int(payload["product_id"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "product_id required"}), 400
    variant_id = payload.get("variant_id")
    exclude_sync_id = payload.get("exclude_sync_id") or 0
    local_stock = int(payload.get("local_stock") or 0)

    held = OpenTicket.held_quantity(
        product_id=product_id,
        variant_id=int(variant_id) if variant_id not in (None, "") else None,
        exclude_sync_id=int(exclude_sync_id),
    )
    return jsonify(
        {"product_id": product_id, "held_elsewhere": held, "stock_on_hand": local_stock}
    )


def _bulk(payload):
    exclude_sync_id = int(payload.get("exclude_sync_id") or 0)
    keys = []
    for p in payload["products"][:200]:
        try:
            product_id = int(p["product_id"])
        except (KeyError, TypeError, ValueError):
            continue
        variant_id = p.get("variant_id")
        keys.append((product_id, int(variant_id) if variant_id not in (None, "") else None))
    held = OpenTicket.held_quantities(keys, exclude_sync_id=exclude_sync_id)
    return jsonify(
        {
            "results": [
                {"product_id": pid, "variant_id": vid, "held_elsewhere": held.get((pid, vid), 0)}
                for pid, vid in keys
            ]
        }
    )
