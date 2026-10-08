"""Count a group's arrivals from Loyverse receipts on the visit day.

The morning sync creates a Loyverse item per confirmed booking whose variant
``sku`` is the booking barcode. Gate staff scan the vehicle ticket, so each
receipt line for that SKU carries the passenger count as its quantity. We sum
those for the SAST visit date; if nothing matched by SKU (older items were
created without one) we fall back to matching on the item name.

    count = fetch_loyverse_arrivals(booking_row)   # raises ArrivalsError
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import requests

from config.constants import CATEGORIES, GAZEBO_MAP, LOYVERSE_STORE_ID
from config.settings import LOYVERSE_API_KEY
from src.clients.loyverse import LoyverseClient
from src.services.loyverse import LoyverseService
from src.utils.logging import setup_logger

logger = setup_logger("arrivals")

SAST = ZoneInfo("Africa/Johannesburg")


class ArrivalsError(RuntimeError):
    """Loyverse could not be queried (no key, network, HTTP error)."""


def sast_day_bounds_utc(d: date) -> tuple[str, str]:
    """The SAST calendar day as RFC 3339 UTC instants for created_at_min/max."""
    start = datetime.combine(d, time.min, tzinfo=SAST).astimezone(timezone.utc)
    end = start + timedelta(days=1) - timedelta(milliseconds=1)
    fmt = "%Y-%m-%dT%H:%M:%S.000Z"
    return start.strftime(fmt), end.strftime(fmt)


def count_arrivals(receipts: list[dict], barcode: str, group_name: str) -> int:
    """Sum line quantities for ``barcode`` (SKU), else for ``group_name`` (item name).

    Refund receipts subtract. Quantities are summed as floats then rounded, as
    Loyverse returns them as numbers.
    """
    by_sku = 0.0
    by_name = 0.0
    sku_seen = False
    wanted_name = (group_name or "").strip().casefold()
    for receipt in receipts:
        sign = -1.0 if receipt.get("receipt_type") == "REFUND" else 1.0
        for line in receipt.get("line_items") or []:
            quantity = float(line.get("quantity") or 0) * sign
            if barcode and str(line.get("sku") or "") == str(barcode):
                sku_seen = True
                by_sku += quantity
            elif wanted_name and str(line.get("item_name") or "").strip().casefold() == wanted_name:
                by_name += quantity
    total = by_sku if sku_seen else by_name
    return max(int(round(total)), 0)


def fetch_loyverse_arrivals(booking: dict) -> int:
    """Arrivals for ``booking`` from Loyverse receipts on its visit date."""
    if not LOYVERSE_API_KEY:
        raise ArrivalsError("Loyverse API key is not configured")
    visit_date = booking["visit_date"]
    if isinstance(visit_date, str):
        visit_date = date.fromisoformat(visit_date)
    created_min, created_max = sast_day_bounds_utc(visit_date)

    client = LoyverseClient(LOYVERSE_API_KEY)
    service = LoyverseService(client, LOYVERSE_STORE_ID, CATEGORIES, GAZEBO_MAP)
    try:
        payload = service.get_receipts(created_at_min=created_min, created_at_max=created_max)
    except requests.RequestException as exc:
        logger.error(f"Loyverse receipts fetch failed for {booking.get('reference')}: {exc}")
        raise ArrivalsError(f"Loyverse request failed: {exc}") from exc
    except (KeyError, ValueError) as exc:
        raise ArrivalsError(f"Unexpected Loyverse response: {exc}") from exc

    receipts = payload.get("receipts") or []
    count = count_arrivals(receipts, booking.get("barcode"), booking.get("group_name"))
    logger.info(
        f"Loyverse arrivals for {booking.get('reference')} on {visit_date}: {count} "
        f"({len(receipts)} receipts scanned)"
    )
    return count
