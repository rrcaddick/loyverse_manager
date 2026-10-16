"""Group payments: money a group paid at a terminal, tied to the booking by its ticket's barcode."""
import json

from src.models.pos_accounts import account_clause, account_value
from src.repositories.mysql import get_db_connection


def _json(value):
    if value is None or isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


class PosGroupPayment:
    COLUMNS = (
        "event_uuid", "device_id", "employee_id", "employee_name", "barcode", "group_name",
        "receipt_id", "printed_no", "amount_cents", "payment_summary", "paid_at", "detail", "account_id",
    )

    @classmethod
    def _row(cls, row):
        if row:
            row["detail"] = _json(row.get("detail"))
        return row

    @classmethod
    def create(cls, values):
        """Insert one payment; a repeat of the same event (outbox retry) is ignored. True when inserted."""
        values = {**values, "account_id": values.get("account_id") or account_value()}
        cols = [c for c in cls.COLUMNS if c in values]
        params = [json.dumps(values[c]) if c == "detail" and values[c] is not None else values[c] for c in cols]
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"INSERT IGNORE INTO pos_group_payments ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
                    params,
                )
                inserted = cursor.rowcount
            conn.commit()
        return inserted == 1

    @classmethod
    def for_barcode(cls, barcode, start=None, end=None):
        """Payments against one ticket, oldest first (optionally within [start, end))."""
        where, params = ["barcode = %s"], [barcode]
        if start is not None:
            where.append("paid_at >= %s")
            params.append(start)
        if end is not None:
            where.append("paid_at < %s")
            params.append(end)
        clause, scope = account_clause()
        if clause:
            where.append(clause[len(" AND "):])
            params.extend(scope)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT * FROM pos_group_payments WHERE {' AND '.join(where)} ORDER BY paid_at, id", params)
                return [cls._row(r) for r in cursor.fetchall()]

    @classmethod
    def list(cls, since=None, limit=200):
        where, params = [], []
        if since is not None:
            where.append("paid_at >= %s")
            params.append(since)
        clause, scope = account_clause()
        if clause:
            where.append(clause[len(" AND "):])
            params.extend(scope)
        sql = "SELECT * FROM pos_group_payments"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY paid_at DESC, id DESC LIMIT %s"
        params.append(int(limit))
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql, params)
                return [cls._row(r) for r in cursor.fetchall()]
