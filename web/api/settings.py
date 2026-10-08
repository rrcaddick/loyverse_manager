"""Settings, price tiers and season days (admin only)."""

from __future__ import annotations

from datetime import date

from src.services import settings as settings_service
from web.api import ApiError, current_user_id, make_blueprint, ok, parse_json, require_role

bp = make_blueprint("settings", "/settings")


@bp.get("")
@require_role("admin")
def get_settings():
    s = settings_service.get_settings()
    return ok(
        {
            "settings": s.to_dict(),
            "price_tiers": settings_service.list_price_tiers(),
            "season_days": settings_service.list_season_days(),
        }
    )


@bp.put("/price-tiers")
@require_role("admin")
def put_price_tiers():
    data = parse_json(("items",))
    try:
        tiers = settings_service.replace_price_tiers(list(data["items"]))
    except (ValueError, KeyError) as exc:
        raise ApiError("validation_error", str(exc), 422)
    return ok({"price_tiers": tiers})


@bp.put("/season-days")
@require_role("admin")
def put_season_days():
    data = parse_json(("items",))
    items = []
    for d in data["items"]:
        try:
            items.append({"day": date.fromisoformat(d["day"]), "kind": d.get("kind", "closed"), "label": d.get("label")})
        except (KeyError, ValueError):
            raise ApiError("validation_error", f"Invalid season day: {d!r}", 422)
    return ok({"season_days": settings_service.replace_season_days(items)})


@bp.put("/<section>")
@require_role("admin")
def put_section(section: str):
    if section in ("price-tiers", "season-days"):
        raise ApiError("not_found", "Unknown section", 404)
    data = parse_json()
    try:
        s = settings_service.update_settings(section, data, current_user_id())
    except ValueError as exc:
        raise ApiError("validation_error", str(exc), 422)
    return ok({"settings": s.to_dict()})
