"""The shop till (Aronium) feed and its live view.

POST /api/shop/sales   one Aronium document, from the Farmyard card terminal module on the till
                       (header X-Shop-Token = SHOP_FEED_TOKEN; a body with "probe": true only checks the token)
GET  /shop/till        today's sales as they come in (login), auto-refreshing
GET  /shop/till/data   the rows behind it (login), ?day=YYYY-MM-DD
"""
import hmac
from datetime import date, datetime

from flask import Blueprint, jsonify, render_template, request

from config.settings import SHOP_FEED_TOKEN
from src.models.shop_sales import ShopSale
from web.routes.auth import login_required

shop_bp = Blueprint("shop", __name__)


def _token_ok():
    if not SHOP_FEED_TOKEN:
        return False
    return hmac.compare_digest(request.headers.get("X-Shop-Token", "").strip(), SHOP_FEED_TOKEN)


@shop_bp.route("/api/shop/sales", methods=["POST"])
def shop_sales():
    if not _token_ok():
        return jsonify({"error": "invalid shop token"}), 401
    doc = request.get_json(force=True, silent=True) or {}
    if doc.get("probe"):
        return jsonify({"status": "ok", "till": doc.get("till"), "received_at": datetime.now().isoformat(timespec="seconds")})
    if not (doc.get("uid") or doc.get("id") or doc.get("number")):
        return jsonify({"error": "document has no uid, id or number"}), 400
    row_id, created = ShopSale.upsert(doc)
    return jsonify({"status": "ok", "id": row_id, "created": created})


@shop_bp.route("/shop/till")
@login_required
def till():
    return render_template("shop_till.html", today=date.today().isoformat())


@shop_bp.route("/shop/till/data")
@login_required
def till_data():
    try:
        day = datetime.strptime(request.args.get("day") or date.today().isoformat(), "%Y-%m-%d").date()
    except ValueError:
        day = date.today()
    rows = ShopSale.for_day(day)
    by_type = {}
    for r in rows:
        if r["type_code"] not in ("200", ""):
            continue
        for p in (r["document"].get("payments") or []):
            key = p.get("type") or "?"
            by_type[key] = by_type.get(key, 0) + int(round(float(p.get("amount") or 0) * 100))
    out = []
    for r in rows:
        out.append(
            {
                "id": r["id"],
                "number": r["document_number"],
                "type": r["type_name"] or r["type_code"],
                "type_code": r["type_code"],
                "time": r["created_at"].strftime("%H:%M:%S") if r["created_at"] else "",
                "total": r["total_cents"] / 100,
                "user": r["user_name"],
                "register": r["register_name"],
                "customer": r["customer_name"],
                "payments": r["payment_summary"],
                "card": {"trans_no": r["card_trans_no"], "auth_no": r["card_auth_no"], "masked": r["card_masked"]} if r["card_trans_no"] else None,
                "items": [
                    {"product": i.get("product"), "quantity": i.get("quantity"), "price": i.get("price"), "total": i.get("total")}
                    for i in (r["document"].get("items") or [])
                ],
            }
        )
    sales = [r for r in rows if r["type_code"] in ("200", "")]
    return jsonify(
        {
            "day": day.isoformat(),
            "latest_id": max([r["id"] for r in rows] or [0]),
            "count": len(sales),
            "total": sum(r["total_cents"] for r in sales) / 100,
            "by_type": {k: v / 100 for k, v in by_type.items()},
            "rows": out,
        }
    )
