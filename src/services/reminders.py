"""Reminder schedule and the admin action queue.

``recompute_reminders`` turns booking state plus the ``reminders`` settings
into ``booking_reminders`` rows; it is idempotent and safe to run every time
something changes (cron runs it daily, the ops page on demand). Rows that were
already sent are never touched; dismissed rows stay dismissed while their
condition holds and are dropped when it stops holding.

``build_queue`` is the one query behind ``GET /queue`` (docs/booking-system.md
§8). Each section's SQL is written against the fixed tables and leans on the
indexes the migration created (bookings.status/visit_date, email_messages
review/booking, bank_transactions status/date, booking_reminders status/due).

Stale rule (docs/research/01, "Reminders over 30 days old go to a Stale view"):
a due reminder is flagged ``stale = 1`` when its ``due_on`` is more than
``STALE_AFTER_DAYS`` in the past, or when the booking's proforma went out more
than ``STALE_PROFORMA_DAYS`` ago and nothing has been paid. Live counts and the
Work views exclude stale rows; the Stale view lists them for bulk dismissal.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Mapping
from zoneinfo import ZoneInfo

from src.models.base import dumps, execute, loads, query, query_one, serialize_row, transaction
from src.services.settings import get_settings
from src.utils.date import get_today
from src.utils.logging import setup_logger

logger = setup_logger("reminders")

ACTIVE_STATUSES = ("enquiry", "proforma_sent", "confirmed")
UNPAID_STATUSES = ("enquiry", "proforma_sent")
REMINDER_KINDS = ("still_interested", "deposit_reminder", "final_details", "lapse")

# Stale rule thresholds (days).
STALE_AFTER_DAYS = 30
STALE_PROFORMA_DAYS = 60

# Due, not stale, and due today or earlier: the only rows a person must act on.
LIVE_DUE_SQL = "r.status = 'due' AND r.stale = 0 AND r.due_on <= %s"

KIND_TITLES = {
    "still_interested": "Still interested?",
    "deposit_reminder": "Deposit reminder",
    "final_details": "Final details",
    "lapse": "Hold expiring",
}

SECTION_TITLES = {
    "needs_reply": "Needs a reply",
    "unmatched_emails": "Emails to review",
    "new_requests": "New requests",
    "payments_to_confirm": "Payments to confirm",
    "unmatched_credits": "Unmatched credits",
    "reminders_due": "Reminders due",
    "tickets_to_send": "Tickets to send",
    "visits_this_week": "Visits this week",
    "arrivals_to_record": "Arrivals to record",
    "lapsing": "Lapsing holds",
}

BOOKING_COLUMNS = (
    "b.id AS booking_id, b.reference, b.group_name, b.contact_name, b.visit_date, "
    "b.status, b.people_booked"
)
PAID_TOTAL_SQL = "(SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.booking_id = b.id)"


# ------------------------------------------------------------ due dates ---


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def compute_due_dates(
    booking: Mapping[str, Any], paid_total: Decimal | float | int, cfg: Mapping[str, Any]
) -> dict[str, date]:
    """Which reminders apply to one booking and when each falls due. Pure.

    ``booking`` needs status, visit_date, proforma_sent_at, hold_expires_on,
    deposit_due and deposit_waived; ``cfg`` is ``settings.reminders``.
    """
    status = booking.get("status")
    visit = _as_date(booking.get("visit_date"))
    if status not in ACTIVE_STATUSES or visit is None:
        return {}
    paid = Decimal(str(paid_total or 0))
    deposit_due = Decimal(str(booking.get("deposit_due") or 0))
    waived = bool(booking.get("deposit_waived"))
    unpaid = paid <= 0
    deposit_outstanding = not waived and paid < deposit_due

    due: dict[str, date] = {}
    if status == "proforma_sent" and unpaid:
        sent = _as_date(booking.get("proforma_sent_at"))
        if sent is not None:
            due["still_interested"] = sent + timedelta(days=int(cfg["still_interested_days"]))
    if status in UNPAID_STATUSES and deposit_outstanding:
        due["deposit_reminder"] = visit - timedelta(days=int(cfg["deposit_reminder_days_before"]))
    if status == "confirmed":
        due["final_details"] = visit - timedelta(days=int(cfg["final_details_days_before"]))
    if status in UNPAID_STATUSES and unpaid:
        hold = _as_date(booking.get("hold_expires_on"))
        due["lapse"] = hold or (visit - timedelta(days=int(cfg["lapse_days_before"])))
    return due


def recompute_reminders() -> int:
    """Fill ``booking_reminders`` from booking state. Returns the number of
    reminders that currently apply (rows upserted)."""
    today = get_today()
    cfg = get_settings()["reminders"]
    placeholders = ",".join(["%s"] * len(ACTIVE_STATUSES))
    rows = query(
        f"""
        SELECT b.id, b.status, b.visit_date, b.proforma_sent_at, b.hold_expires_on,
               b.deposit_due, b.deposit_waived, {PAID_TOTAL_SQL} AS paid_total
        FROM bookings b
        WHERE b.status IN ({placeholders}) AND b.visit_date >= %s
        """,
        (*ACTIVE_STATUSES, today - timedelta(days=1)),
    )
    desired: dict[tuple[int, str], date] = {}
    for b in rows:
        for kind, due_on in compute_due_dates(b, b["paid_total"], cfg).items():
            desired[(int(b["id"]), kind)] = due_on

    with transaction() as conn:
        for (booking_id, kind), due_on in desired.items():
            execute(
                """
                INSERT INTO booking_reminders (booking_id, kind, due_on, status)
                VALUES (%s, %s, %s, 'due')
                ON DUPLICATE KEY UPDATE due_on = IF(status = 'due', VALUES(due_on), due_on)
                """,
                (booking_id, kind, due_on),
                conn=conn,
            )
        if desired:
            tuples = ",".join(["(%s, %s)"] * len(desired))
            flat = [v for key in desired for v in key]
            removed = execute(
                f"""
                DELETE FROM booking_reminders
                WHERE status <> 'sent' AND (booking_id, kind) NOT IN ({tuples})
                """,
                flat,
                conn=conn,
            )
        else:
            removed = execute("DELETE FROM booking_reminders WHERE status <> 'sent'", conn=conn)
        stale = flag_stale(today, conn=conn)
    logger.info(
        f"Reminders recomputed: {len(desired)} applicable, {removed} removed, {stale} stale"
    )
    return len(desired)


def flag_stale(today: date | None = None, conn=None) -> int:
    """Apply the stale rule to every reminder due today or earlier; returns how
    many are stale.

    Only rows that are due *now* can be stale (a future reminder is on nobody's
    list). Idempotent: rows that no longer meet the rule (a hold extended, a
    payment recorded) are un-flagged so they come back into the live counts.
    """
    today = today or get_today()
    execute(
        """
        UPDATE booking_reminders r
        JOIN bookings b ON b.id = r.booking_id
        SET r.stale = (
            r.status = 'due' AND r.due_on <= %s AND (
                r.due_on < %s
                OR (
                    r.kind = 'still_interested'
                    AND b.proforma_sent_at IS NOT NULL AND b.proforma_sent_at < %s
                    AND NOT EXISTS (
                        SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.amount > 0
                    )
                )
            )
        )
        """,
        (
            today,
            today - timedelta(days=STALE_AFTER_DAYS),
            datetime.combine(today - timedelta(days=STALE_PROFORMA_DAYS), datetime.min.time()),
        ),
        conn=conn,
    )
    row = query_one(
        "SELECT COUNT(*) AS n FROM booking_reminders WHERE status = 'due' AND stale = 1",
        conn=conn,
    )
    return int(row["n"]) if row else 0


def mark_sent(booking_id: int, kind: str) -> None:
    """Record that the reminder email went out (called by the send action)."""
    if kind not in REMINDER_KINDS:
        raise ValueError(f"Unknown reminder kind: {kind}")
    execute(
        """
        INSERT INTO booking_reminders (booking_id, kind, due_on, status)
        VALUES (%s, %s, %s, 'sent')
        ON DUPLICATE KEY UPDATE status = 'sent', dismissed_by = NULL, dismissed_at = NULL
        """,
        (booking_id, kind, get_today()),
    )


def get_reminder(reminder_id: int) -> dict | None:
    return query_one("SELECT * FROM booking_reminders WHERE id = %s", (reminder_id,))


def _dismiss_row(row: Mapping[str, Any], actor: int | None, conn) -> bool:
    """Dismiss one due reminder inside ``conn``; False when it was not due."""
    if row["status"] != "due":
        return False
    execute(
        """
        UPDATE booking_reminders
        SET status = 'dismissed', stale = 0, dismissed_by = %s, dismissed_at = NOW()
        WHERE id = %s AND status = 'due'
        """,
        (actor, row["id"]),
        conn=conn,
    )
    execute(
        """
        INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
        VALUES (%s, 'reminder_dismissed', %s, %s, %s)
        """,
        (
            row["booking_id"],
            f"Dismissed the '{KIND_TITLES.get(row['kind'], row['kind'])}' reminder",
            dumps({"reminder_id": row["id"], "kind": row["kind"], "due_on": row["due_on"]}),
            actor,
        ),
        conn=conn,
    )
    return True


def dismiss_reminder(reminder_id: int, actor: int | None) -> dict | None:
    """Dismiss a due reminder. Returns the updated row, or None when unknown."""
    row = get_reminder(reminder_id)
    if row is None:
        return None
    with transaction() as conn:
        _dismiss_row(row, actor, conn)
    return _ser(get_reminder(reminder_id))


def bulk_dismiss(reminder_ids: list[int], actor: int | None) -> dict:
    """Dismiss many due reminders in one transaction (the Stale view's button).

    Unknown ids and rows that are not ``due`` are skipped, not errors. Returns
    ``{"dismissed": n, "ids": [...], "skipped": [...]}``.
    """
    wanted = sorted({int(i) for i in reminder_ids})
    if not wanted:
        return {"dismissed": 0, "ids": [], "skipped": []}
    marks = ",".join(["%s"] * len(wanted))
    rows = query(f"SELECT * FROM booking_reminders WHERE id IN ({marks})", wanted)
    done: list[int] = []
    with transaction() as conn:
        for row in rows:
            if _dismiss_row(row, actor, conn):
                done.append(int(row["id"]))
    logger.info(f"Dismissed {len(done)} of {len(wanted)} reminders in bulk")
    return {"dismissed": len(done), "ids": done, "skipped": [i for i in wanted if i not in done]}


def stale_reminder_ids() -> list[int]:
    return [int(r["id"]) for r in query(
        "SELECT id FROM booking_reminders WHERE status = 'due' AND stale = 1 ORDER BY id"
    )]


def reschedule_lapse(booking_id: int, due_on: date, conn=None) -> int:
    """Move the booking's ``lapse`` reminder to a new date after a hold is extended.

    A dismissed row is revived (the new date is a new promise); a sent row is
    left alone. The stale flag is cleared so the hold is live again; the daily
    recompute re-evaluates it.
    """
    return execute(
        """
        UPDATE booking_reminders
        SET due_on = %s, status = 'due', stale = 0, dismissed_by = NULL, dismissed_at = NULL
        WHERE booking_id = %s AND kind = 'lapse' AND status <> 'sent'
        """,
        (due_on, booking_id),
        conn=conn,
    )


# ---------------------------------------------------------------- queue ---


def _money(value: Any) -> float:
    return round(float(value or 0), 2)


def _ser(row: Mapping[str, Any] | None) -> dict:
    return serialize_row(dict(row)) or {} if row is not None else {}


def _booking(row: Mapping[str, Any]) -> dict:
    return _ser(
        {
            "id": row["booking_id"],
            "reference": row["reference"],
            "group_name": row["group_name"],
            "contact_name": row["contact_name"],
            "visit_date": row["visit_date"],
            "status": row["status"],
            "people_booked": row["people_booked"],
        }
    )


def _section(key: str, items: list[dict], count: int | None = None) -> dict:
    return {
        "key": key,
        "title": SECTION_TITLES[key],
        "count": len(items) if count is None else count,
        "items": items,
    }


def _needs_reply(today: date) -> list[dict]:
    # The newest non-automatic message on the booking is inbound <=> the last
    # inbound is newer than the last outbound. Old completed bookings drop out
    # two weeks after the visit so a final "thank you" does not sit here forever.
    rows = query(
        f"""
        WITH ranked AS (
            SELECT m.id, m.booking_id, m.direction, m.subject, m.from_name, m.from_email,
                   m.sent_at, m.snippet, m.has_attachments,
                   ROW_NUMBER() OVER (PARTITION BY m.booking_id ORDER BY m.sent_at DESC, m.id DESC) AS rn
            FROM email_messages m
            WHERE m.booking_id IS NOT NULL AND m.is_auto_generated = 0
        )
        SELECT {BOOKING_COLUMNS}, r.id AS message_id, r.subject, r.from_name, r.from_email,
               r.sent_at, r.snippet, r.has_attachments
        FROM ranked r
        JOIN bookings b ON b.id = r.booking_id
        WHERE r.rn = 1 AND r.direction = 'inbound'
          AND (b.status IN ('enquiry', 'proforma_sent', 'confirmed') OR b.visit_date >= %s)
        ORDER BY r.sent_at
        """,
        (today - timedelta(days=14),),
    )
    return [
        {
            "booking": _booking(r),
            "message": _ser(
                {
                    "id": r["message_id"],
                    "subject": r["subject"],
                    "from_name": r["from_name"],
                    "from_email": r["from_email"],
                    "sent_at": r["sent_at"],
                    "snippet": r["snippet"],
                    "has_attachments": bool(r["has_attachments"]),
                }
            ),
        }
        for r in rows
    ]


def _unmatched_emails() -> list[dict]:
    rows = query(
        """
        SELECT id, from_name, from_email, subject, sent_at, snippet, has_attachments, gmail_thrid
        FROM email_messages
        WHERE review_status = 'pending'
        ORDER BY sent_at DESC, id DESC
        """
    )
    out = []
    for r in rows:
        item = _ser(r)
        item["has_attachments"] = bool(r["has_attachments"])
        out.append(item)
    return out


def _new_requests() -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLUMNS}, b.source, b.created_at, b.enquiry_date, b.contact_email,
               b.contact_mobile, b.group_type, b.alternative_date,
               (SELECT COUNT(*) FROM booking_questions q WHERE q.booking_id = b.id) AS questions_count,
               (SELECT COUNT(*) FROM booking_questions q
                 WHERE q.booking_id = b.id AND q.answer IS NULL) AS unanswered_count
        FROM bookings b
        WHERE b.status = 'enquiry' AND b.proforma_sent_at IS NULL
        ORDER BY b.created_at
        """
    )
    return [
        {
            "booking": _booking(r),
            **_ser(
                {
                    "source": r["source"],
                    "created_at": r["created_at"],
                    "enquiry_date": r["enquiry_date"],
                    "contact_email": r["contact_email"],
                    "contact_mobile": r["contact_mobile"],
                    "group_type": r["group_type"],
                    "alternative_date": r["alternative_date"],
                    "questions_count": int(r["questions_count"]),
                    "unanswered_count": int(r["unanswered_count"]),
                }
            ),
        }
        for r in rows
    ]


def _payments_to_confirm() -> list[dict]:
    rows = query(
        """
        SELECT id, amount, description, booking_date, value_date, first_seen_at, suggestions
        FROM bank_transactions
        WHERE match_status = 'suggested' AND credit_debit = 'CREDIT'
        ORDER BY booking_date DESC, id DESC
        """
    )
    out = []
    for r in rows:
        item = _ser(r)
        item["amount"] = _money(r["amount"])
        item["suggestions"] = loads(r["suggestions"]) or []
        out.append(item)
    return out


def _unmatched_credits(today: date) -> list[dict]:
    rows = query(
        """
        SELECT id, amount, description, booking_date, value_date, first_seen_at
        FROM bank_transactions
        WHERE match_status = 'unmatched' AND credit_debit = 'CREDIT' AND booking_date >= %s
        ORDER BY booking_date DESC, id DESC
        """,
        (today - timedelta(days=30),),
    )
    out = []
    for r in rows:
        item = _ser(r)
        item["amount"] = _money(r["amount"])
        out.append(item)
    return out


def _reminders_due(today: date) -> tuple[list[dict], int]:
    rows = query(
        f"""
        SELECT {BOOKING_COLUMNS}, r.id AS reminder_id, r.kind, r.due_on, b.contact_email,
               b.hold_expires_on, b.deposit_due
        FROM booking_reminders r
        JOIN bookings b ON b.id = r.booking_id
        WHERE {LIVE_DUE_SQL}
        ORDER BY FIELD(r.kind, 'lapse', 'deposit_reminder', 'still_interested', 'final_details'),
                 r.due_on, b.visit_date
        """,
        (today,),
    )
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["kind"], []).append(
            {
                "reminder_id": r["reminder_id"],
                "kind": r["kind"],
                "due_on": r["due_on"].isoformat(),
                "days_overdue": (today - r["due_on"]).days,
                "booking": _booking(r),
                "contact_email": r["contact_email"],
                "hold_expires_on": r["hold_expires_on"].isoformat() if r["hold_expires_on"] else None,
                "deposit_due": _money(r["deposit_due"]),
            }
        )
    items = [
        {"kind": kind, "title": KIND_TITLES.get(kind, kind), "count": len(group), "items": group}
        for kind, group in groups.items()
    ]
    return items, len(rows)


def _tickets_to_send(today: date) -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLUMNS}, b.contact_mobile, b.contact_email, b.vehicles, b.confirmed_at
        FROM bookings b
        WHERE b.status = 'confirmed' AND b.ticket_sent_at IS NULL AND b.ticket_emailed_at IS NULL
          AND b.visit_date >= %s
        ORDER BY b.visit_date, b.group_name
        """,
        (today,),
    )
    return [
        {
            "booking": _booking(r),
            **_ser(
                {
                    "contact_mobile": r["contact_mobile"],
                    "contact_email": r["contact_email"],
                    "vehicles": r["vehicles"],
                    "confirmed_at": r["confirmed_at"],
                    "days_to_visit": (r["visit_date"] - today).days,
                }
            ),
        }
        for r in rows
    ]


def _visits_this_week(today: date) -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLUMNS}, b.price_per_person, b.deposit_due, b.deposit_waived,
               b.arrival_time, b.vehicles, b.gazebos, b.group_type, b.contact_mobile,
               b.arrived_count, b.ticket_sent_at, b.ticket_emailed_at,
               {PAID_TOTAL_SQL} AS paid_total
        FROM bookings b
        WHERE b.status IN ('confirmed', 'proforma_sent', 'enquiry')
          AND b.visit_date BETWEEN %s AND %s
        ORDER BY b.visit_date, b.arrival_time, b.group_name
        """,
        (today, today + timedelta(days=7)),
    )
    out = []
    for r in rows:
        total = Decimal(r["people_booked"] or 0) * Decimal(r["price_per_person"] or 0)
        paid = Decimal(r["paid_total"] or 0)
        out.append(
            {
                "booking": _booking(r),
                "group_type": r["group_type"],
                "arrival_time": r["arrival_time"],
                "vehicles": r["vehicles"],
                "gazebos": r["gazebos"],
                "contact_mobile": r["contact_mobile"],
                "arrived_count": r["arrived_count"],
                "ticket_sent": bool(r["ticket_sent_at"] or r["ticket_emailed_at"]),
                "finance": {
                    "price_per_person": _money(r["price_per_person"]),
                    "total_amount": _money(total),
                    "deposit_due": _money(r["deposit_due"]),
                    "deposit_waived": bool(r["deposit_waived"]),
                    "paid_total": _money(paid),
                    "balance_due": _money(total - paid),
                },
            }
        )
    return out


def _arrivals_to_record(today: date) -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLUMNS}, b.barcode
        FROM bookings b
        WHERE b.status = 'confirmed' AND b.visit_date <= %s AND b.arrived_count IS NULL
        ORDER BY b.visit_date DESC, b.group_name
        """,
        (today,),
    )
    return [
        {"booking": _booking(r), "barcode": r["barcode"], "days_ago": (today - r["visit_date"]).days}
        for r in rows
    ]


def _lapsing(today: date, lapse_days_before: int) -> list[dict]:
    rows = query(
        f"""
        SELECT {BOOKING_COLUMNS}, b.deposit_due, b.proforma_sent_at, b.contact_email,
               COALESCE(b.hold_expires_on, DATE_SUB(b.visit_date, INTERVAL %s DAY)) AS hold_on,
               {PAID_TOTAL_SQL} AS paid_total
        FROM bookings b
        WHERE b.status IN ('enquiry', 'proforma_sent')
          AND COALESCE(b.hold_expires_on, DATE_SUB(b.visit_date, INTERVAL %s DAY)) <= %s
          AND b.visit_date >= %s
          AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.booking_id = b.id AND p.amount > 0)
        ORDER BY hold_on, b.visit_date
        """,
        (lapse_days_before, lapse_days_before, today + timedelta(days=3), today),
    )
    return [
        {
            "booking": _booking(r),
            **_ser(
                {
                    "hold_expires_on": r["hold_on"],
                    "days_left": (r["hold_on"] - today).days,
                    "deposit_due": _money(r["deposit_due"]),
                    "proforma_sent_at": r["proforma_sent_at"],
                    "contact_email": r["contact_email"],
                }
            ),
        }
        for r in rows
    ]


def build_queue() -> dict:
    """Everything the admin queue page shows, in display order (§8)."""
    today = get_today()
    cfg = get_settings()["reminders"]
    reminder_groups, reminder_count = _reminders_due(today)
    sections = [
        _section("needs_reply", _needs_reply(today)),
        _section("unmatched_emails", _unmatched_emails()),
        _section("new_requests", _new_requests()),
        _section("payments_to_confirm", _payments_to_confirm()),
        _section("unmatched_credits", _unmatched_credits(today)),
        _section("reminders_due", reminder_groups, count=reminder_count),
        _section("tickets_to_send", _tickets_to_send(today)),
        _section("visits_this_week", _visits_this_week(today)),
        _section("arrivals_to_record", _arrivals_to_record(today)),
        _section("lapsing", _lapsing(today, int(cfg["lapse_days_before"]))),
    ]
    now = datetime.now(ZoneInfo("Africa/Johannesburg"))
    return {
        "sections": sections,
        "total": sum(s["count"] for s in sections),
        "today": today.isoformat(),
        "generated_at": now.isoformat(timespec="seconds"),
    }


def due_reminder_count(today: date | None = None) -> int:
    """Live reminders: due today or earlier and not stale."""
    row = query_one(
        f"SELECT COUNT(*) AS n FROM booking_reminders r WHERE {LIVE_DUE_SQL}",
        (today or get_today(),),
    )
    return int(row["n"]) if row else 0
