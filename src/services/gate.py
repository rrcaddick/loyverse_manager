"""The Gate page (docs/redesign-spec.md §1): today's arrivals, the open
tickets held on the tills and the state of the morning Loyverse sync.

    snapshot(today) -> {"date", "arrivals", "open_tickets", "sync"}

Arrivals reuse the day view (``booking.day_detail``); open tickets are read
from ``open_tickets_current`` (the bridge's table, read-only here); the sync
state comes from the CSV log the inventory scripts write, because the
scheduler runs in another container and leaves no database trace.
"""

from __future__ import annotations

import csv
import os
from collections import deque
from datetime import date, datetime
from pathlib import Path
from typing import Any

from config.settings import BASE_DIR
from src.models.base import loads, query, serialize_row
from src.services import booking as booking_service
from src.utils.date import get_today

LOG_FILE = Path(BASE_DIR) / "logs" / "inventory_updates.log"
LOG_TAIL_LINES = 2000
DEFAULT_ADD_INVENTORY_CRON = "1 6 * * *"
DEFAULT_CLEAR_INVENTORY_CRON = "0 18 * * *"

# What the inventory scripts log at their start and their ends (scripts/add_inventory.py,
# scripts/clear_inventory.py). The last start row is the run; the first terminal row
# after it is its outcome.
START_MESSAGES = {
    "add_inventory": ("Starting inventory update process",),
    "clear_inventory": ("Starting inventory clear", "Starting inventory clearing", "Starting inventory"),
}
SUCCESS_PREFIXES = ("Successfully processed", "Successfully cleared", "Successfully", "Inventory cleared", "Inventory levels reset successfully")
NO_EVENT_PREFIXES = ("No tickets or groups to process", "No Quicket event", "Nothing to clear", "No items")
FAILURE_PREFIXES = ("Error:",)

BOOKING_FIELDS = (
    "id", "reference", "group_name", "group_type", "status", "status_label",
    "people_booked", "arrival_time", "vehicles", "gazebos",
    "arrived_count", "arrived_source", "arrived_at", "barcode",
    "contact_name", "contact_mobile", "ticket_sent_at", "ticket_emailed_at",
)


# -------------------------------------------------------------- arrivals ---

def arrivals(today: date) -> dict:
    day = booking_service.day_detail(today)
    rows = []
    for b in day["bookings"]:
        item = {k: b.get(k) for k in BOOKING_FIELDS}
        item["status_label"] = booking_service.STATUS_LABELS.get(b.get("status"), b.get("status"))
        item["arrived"] = b.get("arrived_count") is not None
        fin = b.get("finance") or {}
        item["finance"] = {
            "total_amount": fin.get("total_amount"),
            "paid_total": fin.get("paid_total"),
            "balance_due": fin.get("balance_due"),
            "deposit_covered": fin.get("deposit_covered"),
        }
        rows.append(item)
    rows.sort(key=lambda r: (r.get("arrival_time") or "99:99", r.get("group_name") or ""))
    totals = dict(day.get("totals") or {})
    return {
        "is_closed": day.get("is_closed"),
        "day_type": day.get("day_type"),
        "label": day.get("label"),
        "totals": {
            "groups": totals.get("bookings", 0),
            "expected_people": totals.get("total_people", 0),
            "confirmed_people": totals.get("confirmed_people", 0),
            "arrived_people": totals.get("arrived_total", 0),
            "arrived_groups": sum(1 for r in rows if r["arrived"]),
            "balance_due_total": totals.get("balance_due_total", 0),
        },
        "bookings": rows,
    }


# ---------------------------------------------------------- open tickets ---

def _first(d: dict, *keys: str) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _money_value(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def open_tickets() -> list[dict]:
    """Tickets the tills currently hold, newest change first."""
    rows = query(
        """
        SELECT id, ticket_id, status, receipt_json, plate, vehicle_make, vehicle_model,
               vehicle_colour, vehicle_source, opened_at, last_modified_at, last_seen_at
        FROM open_tickets_current
        WHERE status = 'open'
        ORDER BY last_modified_at DESC, id DESC
        """
    )
    out = []
    for r in rows:
        receipt = loads(r.get("receipt_json")) or {}
        if not isinstance(receipt, dict):
            receipt = {}
        items = _first(receipt, "line_items", "items") or []
        quantity = 0
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict):
                    try:
                        quantity += float(it.get("quantity") or 0)
                    except (TypeError, ValueError):
                        pass
        vehicle = receipt.get("vehicle") if isinstance(receipt.get("vehicle"), dict) else {}
        out.append(
            {
                "id": r["id"],
                "ticket_id": r["ticket_id"],
                "name": _first(receipt, "name", "ticket_name", "title"),
                "device": _first(receipt, "device", "device_name", "pos_device_name"),
                "employee_id": _first(receipt, "employee_id", "employee"),
                "reason": receipt.get("reason"),
                "total": _money_value(_first(receipt, "total", "total_money", "amount")),
                "item_count": len(items) if isinstance(items, list) else 0,
                "quantity": quantity,
                "plate": r.get("plate") or vehicle.get("plate"),
                "vehicle_make": r.get("vehicle_make") or vehicle.get("make"),
                "vehicle_model": r.get("vehicle_model") or vehicle.get("model"),
                "vehicle_colour": r.get("vehicle_colour") or vehicle.get("colour"),
                "vehicle_source": r.get("vehicle_source") or vehicle.get("source"),
                "opened_at": r.get("opened_at"),
                "updated_at": r.get("last_modified_at"),
                "last_seen_at": r.get("last_seen_at"),
            }
        )
    return [serialize_row(o) for o in out]


# ------------------------------------------------------------------ sync ---

def _tail_rows(path: Path = LOG_FILE, lines: int = LOG_TAIL_LINES) -> list[list[str]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", errors="replace") as fh:
        tail = list(deque(fh, maxlen=lines))
    rows = []
    for row in csv.reader(tail):
        if len(row) >= 4 and row[0] != "timestamp":
            rows.append(row)
    return rows


def _parse_ts(value: str) -> str | None:
    try:
        return datetime.strptime(value.strip()[:19], "%Y-%m-%d %H:%M:%S").isoformat(timespec="seconds")
    except ValueError:
        return value.strip() or None


def last_run(name: str, rows: list[list[str]]) -> dict:
    """The last run of a logger: ``{last_run_at, finished_at, status, summary}``.

    status ∈ success | no_event | failed | running | null (never ran in the tail).
    """
    starts = START_MESSAGES.get(name, ())
    start_index = None
    for i, row in enumerate(rows):
        if row[1] == name and any(row[3].startswith(p) for p in starts):
            start_index = i
    if start_index is None:
        return {"last_run_at": None, "finished_at": None, "status": None, "summary": None}
    started = _parse_ts(rows[start_index][0])
    for row in rows[start_index + 1:]:
        if row[1] != name:
            continue
        message = row[3]
        if row[2] == "ERROR" or message.startswith(FAILURE_PREFIXES):
            return {"last_run_at": started, "finished_at": _parse_ts(row[0]), "status": "failed", "summary": message[:255]}
        if message.startswith(NO_EVENT_PREFIXES):
            return {"last_run_at": started, "finished_at": _parse_ts(row[0]), "status": "no_event", "summary": message[:255]}
        if message.startswith(SUCCESS_PREFIXES):
            return {"last_run_at": started, "finished_at": _parse_ts(row[0]), "status": "success", "summary": message[:255]}
    return {"last_run_at": started, "finished_at": None, "status": "running", "summary": None}


def sync_status(rows: list[list[str]] | None = None) -> dict:
    rows = _tail_rows() if rows is None else rows
    profiles = [p.strip() for p in os.environ.get("COMPOSE_PROFILES", "").split(",") if p.strip()]
    add = last_run("add_inventory", rows)
    clear = last_run("clear_inventory", rows)
    return {
        "scheduled": "scheduled" in profiles,
        "cron": os.environ.get("ADD_INVENTORY_CRON", DEFAULT_ADD_INVENTORY_CRON),
        "clear_cron": os.environ.get("CLEAR_INVENTORY_CRON", DEFAULT_CLEAR_INVENTORY_CRON),
        "last_run_at": add["last_run_at"],
        "finished_at": add["finished_at"],
        "status": add["status"],
        "summary": add["summary"],
        "clear_inventory": clear,
        "log_rows_scanned": len(rows),
    }


# -------------------------------------------------------------- snapshot ---

def snapshot(today: date | None = None) -> dict:
    today = today or get_today()
    return {
        "date": today.isoformat(),
        "arrivals": arrivals(today),
        "open_tickets": open_tickets(),
        "sync": sync_status(),
    }
