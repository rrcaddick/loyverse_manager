"""Arrivals from Loyverse receipts, kept current through the visit day.

The morning sync creates a Loyverse item per confirmed booking whose variant
``sku`` is the booking barcode. Gate staff scan the vehicle ticket, so each
receipt line for that SKU carries the passenger count as its quantity. We sum
those for the SAST visit date; if nothing matched by SKU (older items were
created without one) we fall back to matching on the item name.

Arrivals are real time, not a button: ``poll_arrivals`` runs from the worker
every couple of minutes through opening hours (scripts/poll_arrivals.py), reads
the day's receipts once and records each visiting booking's count whenever it
has changed (``booking.record_arrivals``: an event, and completion on the first
arrival). Loyverse is the only source of a count; there is no manual entry.

    count = fetch_loyverse_arrivals(booking_row)   # one booking, raises ArrivalsError
    summary = poll_arrivals()                       # every booking visiting today
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


def fetch_day_receipts(visit_date: date) -> list[dict]:
    """Every Loyverse receipt on the SAST calendar day ``visit_date``."""
    if not LOYVERSE_API_KEY:
        raise ArrivalsError("Loyverse API key is not configured")
    created_min, created_max = sast_day_bounds_utc(visit_date)
    client = LoyverseClient(LOYVERSE_API_KEY)
    service = LoyverseService(client, LOYVERSE_STORE_ID, CATEGORIES, GAZEBO_MAP)
    try:
        payload = service.get_receipts(created_at_min=created_min, created_at_max=created_max)
    except requests.RequestException as exc:
        logger.error(f"Loyverse receipts fetch failed for {visit_date}: {exc}")
        raise ArrivalsError(f"Loyverse request failed: {exc}") from exc
    except (KeyError, ValueError) as exc:
        raise ArrivalsError(f"Unexpected Loyverse response: {exc}") from exc
    return payload.get("receipts") or []


def fetch_loyverse_arrivals(booking: dict) -> int:
    """Arrivals for ``booking`` from Loyverse receipts on its visit date."""
    visit_date = booking["visit_date"]
    if isinstance(visit_date, str):
        visit_date = date.fromisoformat(visit_date)
    receipts = fetch_day_receipts(visit_date)
    count = count_arrivals(receipts, booking.get("barcode"), booking.get("group_name"))
    logger.info(
        f"Loyverse arrivals for {booking.get('reference')} on {visit_date}: {count} "
        f"({len(receipts)} receipts scanned)"
    )
    return count


POLL_STATUSES = ("confirmed", "completed")


def poll_arrivals(day: date | None = None) -> dict:
    """Record the current Loyverse count for every booking visiting ``day``
    (today by default). One receipts fetch serves them all; a booking is only
    written, and only gets an event, when its count has changed. A count of
    zero before any arrival is left as "nothing yet" (NULL), so a no-show still
    reads as no arrivals rather than a counted zero."""
    from src.models import booking as booking_model
    from src.services import booking as booking_service
    from src.utils.date import get_today

    visit_date = day or get_today()
    bookings = booking_model.list_for_date(visit_date, POLL_STATUSES)
    summary = {"ok": True, "date": visit_date.isoformat(), "bookings": len(bookings), "changed": [], "unchanged": 0}
    if not bookings:
        return summary
    receipts = fetch_day_receipts(visit_date)
    summary["receipts"] = len(receipts)
    for b in bookings:
        count = count_arrivals(receipts, b.get("barcode"), b.get("group_name"))
        current = b.get("arrived_count")
        if current is None and count == 0:
            summary["unchanged"] += 1
            continue
        if current is not None and int(current) == count:
            summary["unchanged"] += 1
            continue
        booking_service.record_arrivals(int(b["id"]), count, "loyverse", None)
        summary["changed"].append({"booking_id": int(b["id"]), "reference": b.get("reference"), "from": current, "to": count})
        logger.info(f"Arrivals for {b.get('reference')}: {current} -> {count} (Loyverse)")
    return summary
