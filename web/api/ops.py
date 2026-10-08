"""Operations: run a job now, see the state of the background work, read logs.

    POST /api/v1/ops/run {name}      synchronous; add_inventory can take minutes
    GET  /api/v1/ops/status          includes the compact ``system`` block Today shows
    GET  /api/v1/ops/logs?lines=200

Jobs are imported lazily so the API boots even while a sibling module is still
being built; a missing module comes back as ``ok: false`` with the reason.
"""

from __future__ import annotations

import importlib
import os
import time
from collections import deque
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from flask import request

from config.settings import BASE_DIR
from src.models.base import query, query_one, serialize_row
from src.services import reminders
from src.services import today as today_service
from src.utils.date import get_today
from src.utils.logging import setup_logger
from web.api import ApiError, current_user, make_blueprint, ok, parse_json, require_role

logger = setup_logger("ops")
bp = make_blueprint("ops", "/ops")

# name -> (module, callable). Each callable takes no arguments.
RUNNABLE: dict[str, tuple[str, str]] = {
    "add_inventory": ("scripts.add_inventory", "add_inventory"),
    "clear_inventory": ("scripts.clear_inventory", "clear_inventory"),
    "hide_quicket_event": ("scripts.hide_quicket_event", "hide_quicket_event"),
    "sync_mail": ("src.services.mail_ingest", "sync_mailbox"),
    "poll_bank": ("src.services.bank", "poll_transactions"),
    "recompute_reminders": ("src.services.reminders", "recompute_reminders"),
}

BOOKING_STATUSES = (
    "enquiry",
    "proforma_sent",
    "confirmed",
    "completed",
    "cancelled",
    "lapsed",
    "no_show",
)

LOG_FILE = BASE_DIR / "logs" / "inventory_updates.log"
MAX_LOG_LINES = 2000


def _summary(result: Any) -> Any:
    if result is None:
        return "ok"
    if isinstance(result, dict):
        return serialize_row(result)
    if isinstance(result, (list, tuple)):
        return [serialize_row(r) if isinstance(r, dict) else r for r in result]
    if isinstance(result, (int, float, str, bool)):
        return result
    return str(result)


@bp.post("/run")
@require_role("admin")
def run_job():
    data = parse_json(("name",))
    name = str(data["name"])
    if name not in RUNNABLE:
        raise ApiError(
            "validation_error",
            "Unknown job",
            422,
            {"name": f"Choose one of: {', '.join(sorted(RUNNABLE))}"},
        )
    module_name, func_name = RUNNABLE[name]
    user = current_user()
    logger.info(f"Job '{name}' started by {user['email'] if user else '?'}")
    started = time.monotonic()
    try:
        module = importlib.import_module(module_name)
        func = getattr(module, func_name)
        result = func()
    except ModuleNotFoundError as exc:
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.warning(f"Job '{name}' unavailable: {exc}")
        return ok(
            {
                "ok": False,
                "name": name,
                "duration_ms": duration_ms,
                "error": f"Not available on this build: {exc.name} is missing",
            }
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the operator
        duration_ms = int((time.monotonic() - started) * 1000)
        logger.error(f"Job '{name}' failed after {duration_ms} ms: {type(exc).__name__}: {exc}", exc_info=True)
        return ok(
            {
                "ok": False,
                "name": name,
                "duration_ms": duration_ms,
                "error": f"{type(exc).__name__}: {exc}",
            }
        )
    duration_ms = int((time.monotonic() - started) * 1000)
    logger.info(f"Job '{name}' finished in {duration_ms} ms")
    return ok({"ok": True, "name": name, "duration_ms": duration_ms, "summary": _summary(result)})


@bp.get("/status")
@require_role("admin")
def status():
    today = get_today()
    folders = [
        serialize_row(r)
        for r in query(
            "SELECT folder, uidvalidity, last_uid, last_synced_at, last_error FROM mail_sync_state ORDER BY folder"
        )
    ]
    last_poll = serialize_row(
        query_one("SELECT * FROM bank_poll_log ORDER BY started_at DESC, id DESC LIMIT 1")
    )
    counts = {s: 0 for s in BOOKING_STATUSES}
    for r in query("SELECT status, COUNT(*) AS n FROM bookings GROUP BY status"):
        counts[r["status"]] = int(r["n"])
    reminder_row = query_one(
        """
        SELECT SUM(status = 'due' AND due_on <= %s) AS due_now,
               SUM(status = 'due') AS due_total,
               SUM(status = 'sent') AS sent,
               SUM(status = 'dismissed') AS dismissed
        FROM booking_reminders
        """,
        (today,),
    ) or {}
    last_import = serialize_row(
        query_one("SELECT * FROM import_runs ORDER BY started_at DESC, id DESC LIMIT 1")
    )
    if last_import and isinstance(last_import.get("summary"), (str, bytes)):
        from src.models.base import loads

        last_import["summary"] = loads(last_import["summary"])
    pending_mail = query_one("SELECT COUNT(*) AS n FROM email_messages WHERE review_status = 'pending'")
    suggested = query_one("SELECT COUNT(*) AS n FROM bank_transactions WHERE match_status = 'suggested'")
    profiles = os.environ.get("COMPOSE_PROFILES", "")
    now = datetime.now(ZoneInfo("Africa/Johannesburg"))
    return ok(
        {
            "server_time": now.isoformat(timespec="seconds"),
            "today": today.isoformat(),
            "mail": {"folders": folders, "pending_review": int(pending_mail["n"]) if pending_mail else 0},
            "bank": {"last_poll": last_poll, "suggested": int(suggested["n"]) if suggested else 0},
            "reminders": {
                "due_count": int(reminder_row.get("due_now") or 0),
                "due_total": int(reminder_row.get("due_total") or 0),
                "sent": int(reminder_row.get("sent") or 0),
                "dismissed": int(reminder_row.get("dismissed") or 0),
            },
            "bookings": {"counts": counts, "total": sum(counts.values())},
            "imports": {"last_run": last_import},
            "scheduler": {
                "add_inventory_cron": os.environ.get("ADD_INVENTORY_CRON", "1 6 * * *"),
                "clear_inventory_cron": os.environ.get("CLEAR_INVENTORY_CRON", "0 18 * * *"),
                "profile_enabled": "scheduled" in [p.strip() for p in profiles.split(",") if p.strip()],
                "timezone": os.environ.get("TZ", "Africa/Johannesburg"),
            },
            "jobs": sorted(RUNNABLE),
            # The same block the Today page shows, plus last_error per job.
            "system": today_service.system_status(with_errors=True),
        }
    )


@bp.get("/logs")
@require_role("admin")
def logs():
    try:
        wanted = int(request.args.get("lines", 200))
    except ValueError:
        raise ApiError("validation_error", "lines must be an integer", 422)
    wanted = max(1, min(MAX_LOG_LINES, wanted))
    lines: list[str] = []
    if LOG_FILE.exists():
        with LOG_FILE.open("r", encoding="utf-8", errors="replace") as fh:
            lines = [line.rstrip("\r\n") for line in deque(fh, maxlen=wanted)]
    return ok({"path": str(LOG_FILE), "lines": lines, "count": len(lines), "requested": wanted})
