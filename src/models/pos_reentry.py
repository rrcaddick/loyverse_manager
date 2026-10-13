"""Raw material for re-entry decisions: the ticket feed's rows, nothing derived.

The feed tables (``open_tickets_current`` / ``open_tickets_history``) are owned by the
open-ticket feed; this module only reads them.  Everything about what a row *means* lives in
``src/services/pos_reentry.py``.
"""

import json

from src.repositories.mysql import get_db_connection


def _json(value):
    if value is None or isinstance(value, dict):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


class PosReentryData:
    """Three reads: today's closed receipts, the open tickets, and a window of ticket history."""

    @classmethod
    def closed_receipts(cls, start, end):
        """Closed rows in [start, end) that carry a receipt, with the ticket's vehicle source."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT h.ticket_id, h.observed_at, h.receipt_json, c.vehicle_source
                    FROM open_tickets_history h
                    LEFT JOIN open_tickets_current c ON c.ticket_id = h.ticket_id
                    WHERE h.event_type = 'closed' AND h.receipt_json IS NOT NULL
                      AND h.observed_at >= %s AND h.observed_at < %s
                    ORDER BY h.observed_at, h.id
                    """,
                    (start, end),
                )
                rows = cursor.fetchall()
        for row in rows:
            row["receipt_json"] = _json(row["receipt_json"])
        return rows

    @classmethod
    def open_tickets(cls):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT ticket_id, receipt_json, plate, vehicle_source, opened_at, last_modified_at
                    FROM open_tickets_current
                    WHERE status = 'open'
                    """
                )
                rows = cursor.fetchall()
        for row in rows:
            row["receipt_json"] = _json(row["receipt_json"])
        return rows

    @classmethod
    def history(cls, since, until):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT ticket_id, event_type, observed_at, receipt_json
                    FROM open_tickets_history
                    WHERE observed_at BETWEEN %s AND %s
                    ORDER BY ticket_id, observed_at, id
                    """,
                    (since, until),
                )
                rows = cursor.fetchall()
        for row in rows:
            row["receipt_json"] = _json(row["receipt_json"])
        return rows
