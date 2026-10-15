"""Persistence for refund disputes (migration 008).

One row per dispute logged at a terminal, mirrored from the ``refund_disputed`` audit event.
What a dispute means, how it is resolved and answered lives in ``src/services/pos_disputes.py``.
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


class PosRefundDispute:
    COLUMNS = (
        "dispute_number", "event_uuid", "device_id", "employee_id", "employee_name", "logged_at",
        "trigger_kind", "refusal", "receipt_id", "printed_no", "order_number", "plate", "sale_at",
        "register", "sold_by", "amount_cents", "payment_summary", "transaction_code",
        "customer_name", "customer_email", "customer_mobile", "reason", "detail",
    )

    @classmethod
    def _row(cls, row):
        if row:
            row["detail"] = _json(row.get("detail"))
        return row

    @classmethod
    def create(cls, values):
        """Insert one dispute; a repeat of the same event (outbox retry) is ignored. Returns True when inserted."""
        cols = [c for c in cls.COLUMNS if c in values]
        params = [json.dumps(values[c]) if c == "detail" and values[c] is not None else values[c] for c in cols]
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"INSERT IGNORE INTO pos_refund_disputes ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
                    params,
                )
                inserted = cursor.rowcount
            conn.commit()
        return inserted == 1

    @classmethod
    def get(cls, dispute_number):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_refund_disputes WHERE dispute_number = %s", (dispute_number,))
                return cls._row(cursor.fetchone())

    @classmethod
    def list(cls, statuses=None, since=None, limit=200):
        where, params = [], []
        if statuses:
            where.append(f"status IN ({', '.join(['%s'] * len(statuses))})")
            params.extend(statuses)
        if since is not None:
            where.append("logged_at >= %s")
            params.append(since)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        params.append(int(limit))
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT * FROM pos_refund_disputes {clause} ORDER BY logged_at DESC, id DESC LIMIT %s", params)
                return [cls._row(r) for r in cursor.fetchall()]

    @classmethod
    def update(cls, dispute_number, **fields):
        if not fields:
            return False
        sets = ", ".join(f"{k} = %s" for k in fields)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"UPDATE pos_refund_disputes SET {sets} WHERE dispute_number = %s",
                               [*fields.values(), dispute_number])
                changed = cursor.rowcount
            conn.commit()
        return changed == 1

    @classmethod
    def events_for_plate(cls, plate, start, end):
        """Everything the terminals reported about this plate's ticket in [start, end): reductions,
        voids, re-entries, the sale and any refund. The event detail names the ticket as `name`,
        `ticket` or `plate` depending on the event."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT id, device_id, employee_id, employee_name, event, detail, occurred_at
                    FROM pos_employee_events
                    WHERE occurred_at >= %s AND occurred_at < %s
                      AND (JSON_UNQUOTE(JSON_EXTRACT(detail, '$.name')) = %s
                           OR JSON_UNQUOTE(JSON_EXTRACT(detail, '$.ticket')) = %s
                           OR JSON_UNQUOTE(JSON_EXTRACT(detail, '$.plate')) = %s)
                    ORDER BY occurred_at, id
                    """,
                    (start, end, plate, plate, plate),
                )
                rows = cursor.fetchall()
        for row in rows:
            row["detail"] = _json(row["detail"])
        return rows
