"""The ``booking_events`` timeline: one row per state change on a booking.

Kinds (docs/booking-system.md §4): created, updated, status_changed, override,
note, document_issued, email_sent, email_received, email_failed,
payment_recorded, payment_deleted, payment_matched, ticket_sent,
arrivals_recorded, reminder_dismissed.
"""

from __future__ import annotations

from src.models.base import dumps, execute, loads, query, serialize_row

SUMMARY_MAX = 255


def add(
    booking_id: int,
    kind: str,
    summary: str,
    data: dict | None = None,
    actor: int | None = None,
    conn=None,
) -> int:
    return execute(
        """
        INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (booking_id, kind, (summary or kind)[:SUMMARY_MAX], dumps(data) if data else None, actor),
        conn=conn,
    )


def list_for_booking(booking_id: int, limit: int | None = None) -> list[dict]:
    sql = """
        SELECT e.*, u.full_name AS actor_name
        FROM booking_events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.booking_id = %s
        ORDER BY e.created_at, e.id
    """
    params: tuple = (booking_id,)
    if limit:
        sql += " LIMIT %s"
        params = (booking_id, int(limit))
    return [serialize(r) for r in query(sql, params)]


def serialize(row: dict) -> dict:
    out = serialize_row(row)
    out["data"] = loads(row.get("data"))
    return out
