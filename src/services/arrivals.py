"""Arrivals, read from what the terminals have already sent.

The patched Loyverse terminals (the bridge) post every closed ticket with its
receipt into ``open_tickets_history``, every group payment into
``pos_group_payments`` and every conversion of public admissions onto a group
into ``pos_group_conversions``. Gate staff scan the vehicle ticket, so each
receipt line for the booking's barcode carries the passenger count as its
quantity. A booking's arrivals on its visit day are therefore a read of this
database, not a call to Loyverse: the heads admitted under the ticket plus
the heads converted onto the group (``PosGroupPaymentService.status``).

The count is kept on the booking (``arrived_count``, source ``loyverse``) so
documents, Work and the lists see it without the join. It is refreshed when
a page reads a booking visiting today (``refresh_booking`` / ``refresh_rows``)
and nudged from the two ingest points, a closed ticket and a paid group
payment (``refresh_for_barcodes``), so it is right the moment a car is through
the gate. There is no manual count and nothing polls Loyverse.

    count = arrivals_from_terminals(booking_row)   # the figure as of now
    refresh_booking(booking_row)                    # record it if it changed
    refresh_day()                                   # every booking visiting today (Ops)
"""

from __future__ import annotations

from datetime import date
from typing import Iterable

from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("arrivals")

# Bookings whose arrivals are worth counting: the group has a ticket and may turn up.
ARRIVAL_STATUSES = ("confirmed", "completed")


class ArrivalsError(RuntimeError):
    """The terminal data could not be read."""


def _service():
    from src.services.pos_group_payments import PosGroupPaymentService

    return PosGroupPaymentService()


def arrivals_from_terminals(booking: dict, day: date | None = None) -> int:
    """Heads through the gate for ``booking`` on ``day`` (its visit date by
    default): the group's own ticket sales plus conversions onto the group."""
    visit = day or booking.get("visit_date")
    if isinstance(visit, str):
        visit = date.fromisoformat(visit)
    try:
        status = _service().status(booking.get("barcode"), booking.get("group_name"), visit)
    except Exception as exc:  # noqa: BLE001 - the terminal tables are another feature's
        raise ArrivalsError(f"Terminal data could not be read: {exc}") from exc
    return max(int(status.get("heads_today") or 0) + int(status.get("heads_converted") or 0), 0)


def refresh_booking(booking: dict, day: date | None = None) -> int | None:
    """Record the current count on ``booking`` when it has changed, and return
    it. A zero before any arrival stays "nothing yet" (NULL), so a no-show
    still reads as no arrivals rather than a counted zero."""
    from src.services import booking as booking_service

    count = arrivals_from_terminals(booking, day)
    current = booking.get("arrived_count")
    if current is None and count == 0:
        return None
    if current is not None and int(current) == count:
        return count
    booking_service.record_arrivals(int(booking["id"]), count, "loyverse", None)
    booking["arrived_count"] = count
    booking["arrived_source"] = "loyverse"
    logger.info(f"Arrivals for {booking.get('reference')}: {current} -> {count} (terminals)")
    return count


def refresh_rows(rows: Iterable[dict], day: date | None = None) -> int:
    """``refresh_booking`` over the rows visiting ``day`` (today by default),
    updating them in place. Returns how many changed. Never raises: a page
    read must not fail because the terminal tables did."""
    today = day or get_today()
    changed = 0
    for row in rows:
        visit = row.get("visit_date")
        if isinstance(visit, str):
            visit = date.fromisoformat(visit)
        if visit != today or row.get("status") not in ARRIVAL_STATUSES:
            continue
        before = row.get("arrived_count")
        try:
            after = refresh_booking(row, today)
        except ArrivalsError as exc:
            logger.warning(f"Arrivals refresh skipped for {row.get('reference')}: {exc}")
            continue
        if after != before:
            changed += 1
    return changed


def refresh_day(day: date | None = None) -> dict:
    """Every booking visiting ``day`` (today by default). The Ops job."""
    from src.models import booking as booking_model

    visit_date = day or get_today()
    rows = booking_model.list_for_date(visit_date, ARRIVAL_STATUSES)
    summary = {"ok": True, "date": visit_date.isoformat(), "bookings": len(rows), "changed": []}
    for row in rows:
        before = row.get("arrived_count")
        try:
            after = refresh_booking(row, visit_date)
        except ArrivalsError as exc:
            summary["ok"] = False
            summary.setdefault("errors", []).append({"reference": row.get("reference"), "error": str(exc)})
            continue
        if after != before:
            summary["changed"].append({"booking_id": int(row["id"]), "reference": row.get("reference"), "from": before, "to": after})
    return summary


def refresh_for_barcodes(barcodes: Iterable[str | None], day: date | None = None) -> int:
    """Nudge from an ingest point: the bookings visiting ``day`` whose barcode
    is among ``barcodes``. Quiet on any failure (the feed must keep flowing)."""
    from src.models import booking as booking_model

    wanted = {str(b).strip() for b in barcodes if b}
    if not wanted:
        return 0
    visit_date = day or get_today()
    try:
        rows = [r for r in booking_model.list_for_date(visit_date, ARRIVAL_STATUSES) if str(r.get("barcode") or "") in wanted]
        return refresh_rows(rows, visit_date)
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Arrivals nudge failed: {exc}")
        return 0


def barcodes_in_receipt(receipt: dict | None) -> list[str]:
    """The SKUs on a closed ticket's receipt (the bridge's receipt JSON)."""
    out: list[str] = []
    for line in (receipt or {}).get("items") or []:
        sku = str(line.get("sku") or "").strip()
        if sku and not line.get("voided"):
            out.append(sku)
    return out
