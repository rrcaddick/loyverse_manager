"""The Today page: the day picture, the five most urgent Work rows, machine health.

docs/research/01 makes Today the home: one screen read in seconds. Four tiles
with total + remaining (Cloudbeds), today's groups as compact cards, the next
visit day when today is closed or empty, a seven-day strip, "Up next" from the
Work list, and a one-line System status (mail sync, bank poll, Loyverse
morning sync). ``system_status`` is shared with ``GET /ops/status``.

The groups and tile maths reuse ``booking.day_detail`` and ``calendar_days``
so Today never disagrees with the day view or the calendar.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from config.settings import BASE_DIR
from src.models import bank_transaction as bank_model
from src.models.base import query, query_one
from src.models.booking import ACTIVE_STATUSES, FIRM_STATUSES
from src.services import booking as booking_service
from src.services import work
from src.utils.date import get_today

SAST = ZoneInfo("Africa/Johannesburg")
LOG_FILE = BASE_DIR / "logs" / "inventory_updates.log"
LOG_TAIL_BYTES = 64 * 1024

# How recent a run must be before the status line says the machine is fine.
MAIL_FRESH = timedelta(minutes=15)  # sync_mail runs every minute
BANK_FRESH = timedelta(minutes=30)  # poll_bank runs every five

UP_NEXT_ON_TODAY = 5
STRIP_DAYS = 7


def _now_naive() -> datetime:
    """Naive SAST now, comparable with the DB's NOW()-written datetimes."""
    return datetime.now(SAST).replace(tzinfo=None)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _as_datetime(value: Any) -> datetime | None:
    """DB rows arrive as datetimes; serialised rows (bank_model.last_poll) as ISO text."""
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def _fresh(when: Any, within: timedelta) -> bool:
    at = _as_datetime(when)
    if at is None:
        return False
    return _now_naive() - at <= within


def day_label(d: date) -> str:
    """``Thursday 8 October``."""
    return f"{d:%A} {d.day} {d:%B}"


# ---------------------------------------------------------------- system ---


def loyverse_last_run() -> dict | None:
    """The last ``add_inventory`` run from the tail of the CSV log, or None.

    Cheap: reads the last LOG_TAIL_BYTES of ``logs/inventory_updates.log``.
    Returns ``{"at", "outcome": success|no_event|failed|running, "message"}``.
    """
    if not LOG_FILE.exists():
        return None
    try:
        size = LOG_FILE.stat().st_size
        with LOG_FILE.open("rb") as fh:
            fh.seek(max(0, size - LOG_TAIL_BYTES))
            chunk = fh.read().decode("utf-8", "replace")
    except OSError:
        return None
    lines = chunk.splitlines()
    if size > LOG_TAIL_BYTES and lines:
        lines = lines[1:]  # the first line is probably cut in half
    start: dict | None = None
    outcome: dict | None = None
    for line in lines:
        parsed = _parse_log_line(line)
        if parsed is None or parsed["name"] != "add_inventory":
            continue
        message = parsed["message"]
        if message.startswith("Starting inventory update"):
            start = parsed
            outcome = None
            continue
        if start is None:
            continue
        if message.startswith("Successfully processed"):
            outcome = {"outcome": "success", "message": message}
        elif message.startswith("No tickets or groups"):
            outcome = {"outcome": "no_event", "message": message}
        elif parsed["level"] == "ERROR" or message.startswith("Error:"):
            outcome = {"outcome": "failed", "message": message}
    if start is None:
        return None
    result = {"at": _iso(start["at"]), "outcome": "running", "message": start["message"]}
    if outcome:
        result.update(outcome)
    return result


def _parse_log_line(line: str) -> dict | None:
    """``"2026-10-08 06:01:02,123",add_inventory,INFO,message`` → dict."""
    import csv
    from io import StringIO

    try:
        parts = next(csv.reader(StringIO(line)))
    except (csv.Error, StopIteration):
        return None
    if len(parts) < 4:
        return None
    try:
        at = datetime.strptime(parts[0], "%Y-%m-%d %H:%M:%S,%f")
    except ValueError:
        return None
    return {"at": at, "name": parts[1], "level": parts[2], "message": ",".join(parts[3:])}


def system_status(*, with_errors: bool = False) -> dict:
    """``{mail: {last_synced_at, ok}, bank: {last_poll_at, ok},
    loyverse_sync: {scheduled, last_run, status}}``; ``with_errors`` adds a
    ``last_error`` to each (for the System page)."""
    folders = query("SELECT folder, last_synced_at, last_error FROM mail_sync_state")
    synced = [f["last_synced_at"] for f in folders if f.get("last_synced_at")]
    last_synced = max(synced) if synced else None
    mail_errors = [f["last_error"] for f in folders if f.get("last_error")]
    mail = {
        "last_synced_at": _iso(last_synced),
        "ok": bool(last_synced) and not mail_errors and _fresh(last_synced, MAIL_FRESH),
    }

    poll = bank_model.last_poll()
    last_poll_at = (poll.get("finished_at") or poll.get("started_at")) if poll else None
    bank = {
        "last_poll_at": _iso(last_poll_at),
        "ok": bool(poll) and poll.get("status") == "success" and _fresh(last_poll_at, BANK_FRESH),
    }

    profiles = [p.strip() for p in os.environ.get("COMPOSE_PROFILES", "").split(",") if p.strip()]
    scheduled = "scheduled" in profiles
    run = loyverse_last_run()
    if not scheduled:
        status = "off"
    elif run is None:
        status = "unknown"
    elif run["outcome"] == "failed":
        status = "failed"
    elif run["outcome"] == "running":
        status = "running"
    else:
        status = "ok"
    loyverse = {"scheduled": scheduled, "last_run": run, "status": status}

    if with_errors:
        mail["last_error"] = mail_errors[0] if mail_errors else None
        bank["last_error"] = poll.get("error") if poll else None
        loyverse["last_error"] = run["message"] if run and run["outcome"] == "failed" else None
    return {"mail": mail, "bank": bank, "loyverse_sync": loyverse}


# ------------------------------------------------------------------ today ---


def _group_card(item: dict) -> dict:
    finance = item.get("finance") or {}
    return {
        "id": item["id"],
        "reference": item["reference"],
        "group_name": item["group_name"],
        "status": item["status"],
        "people_booked": int(item.get("people_booked") or 0),
        "arrived_count": item.get("arrived_count"),
        "ticket_sent": bool(item.get("ticket_sent_at") or item.get("ticket_emailed_at")),
        "paid_total": finance.get("paid_total", 0.0),
        "balance_due": finance.get("balance_due", 0.0),
        "contact_name": item.get("contact_name"),
        "contact_mobile": item.get("contact_mobile"),
        "vehicles": int(item.get("vehicles") or 0),
        "gazebos": int(item.get("gazebos") or 0),
        "arrival_time": item.get("arrival_time"),
    }


def next_visit_day(after: date) -> dict | None:
    row = query_one(
        f"""
        SELECT visit_date, COUNT(*) AS group_count, COALESCE(SUM(people_booked), 0) AS people
        FROM bookings
        WHERE visit_date > %s AND status IN ({", ".join(["%s"] * len(ACTIVE_STATUSES))})
        GROUP BY visit_date
        ORDER BY visit_date
        LIMIT 1
        """,
        (after, *ACTIVE_STATUSES),
    )
    if row is None:
        return None
    return {
        "date": row["visit_date"].isoformat(),
        "groups": int(row["group_count"]),
        "people": int(row["people"]),
    }


def seven_day_strip(start: date) -> list[dict]:
    days = booking_service.calendar_days(start, start + timedelta(days=STRIP_DAYS - 1))
    return [
        {
            "date": d["date"],
            "groups": int(d["booking_count"]),
            "people": int(d["total_people"]),
            "confirmed_people": int(d["confirmed_people"]),
            "is_closed": bool(d["is_closed"]),
        }
        for d in days
    ]


def today(d: date | None = None, *, for_manager: bool = False) -> dict:
    """Everything the Today page shows. ``for_manager`` strips the money tile,
    the Needs-you tile and Up next (the manager cannot open Work)."""
    d = d or get_today()
    day = booking_service.day_detail(d)
    cards = [_group_card(item) for item in day["bookings"]]
    active = [c for c in cards if c["status"] in ACTIVE_STATUSES]
    arrived = sum(1 for c in active if c["arrived_count"] is not None and c["arrived_count"] > 0)
    owed = sum(Decimal(str(c["balance_due"] or 0)) for c in active)
    paid = sum(Decimal(str(c["paid_total"] or 0)) for c in active)
    tiles: dict[str, Any] = {
        "groups": {"total": len(active), "arrived": arrived},
        "people": {
            "total": int(day["totals"]["total_people"]),
            "confirmed": sum(c["people_booked"] for c in active if c["status"] in FIRM_STATUSES),
        },
    }
    out: dict[str, Any] = {
        "date": d.isoformat(),
        "label": day_label(d),
        "weekday": d.weekday(),
        "day_type": day["day_type"],
        "is_closed": bool(day["is_closed"]),
        "is_peak": bool(day["is_peak"]),
        "day_label": day.get("label"),
        "tiles": tiles,
        "groups": cards,
        "next_visit_day": next_visit_day(d) if (day["is_closed"] or not active) else None,
        "seven_day_strip": seven_day_strip(d),
        "system": system_status(),
    }
    if not for_manager:
        snap = work.snapshot(get_today())
        tiles["owed_at_gate"] = {"total": round(float(owed), 2), "paid": round(float(paid), 2)}
        tiles["needs_you"] = work.needs_you(snap)
        out["up_next"] = snap["up_next"][:UP_NEXT_ON_TODAY]
        out["work_counts"] = snap["counts"]
    return out
