"""Persistence for group conversions (migration 009).

One row per conversion the terminals record before refunding a public sale that belongs to a
group. What a conversion means, how it is validated and how its stage moves lives in
``src/services/pos_conversions.py``.
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


class PosGroupConversion:
    COLUMNS = (
        "conversion_id", "device_id", "employee_id", "employee_name", "recorded_at",
        "receipt_id", "printed_no", "plate", "sale_at", "sold_by",
        "group_name", "group_item_id", "heads", "amount_cents", "payment_summary",
        "person", "surname", "names", "id_number", "id_source", "id_manual",
        "stage", "refund_receipt_no", "refunded_at", "group_ticket_sync_id", "group_receipt_no", "admitted_at", "error",
        "detail",
    )
    UPDATABLE = (
        "stage", "refund_receipt_no", "refunded_at", "group_ticket_sync_id", "group_receipt_no", "admitted_at", "error", "heads",
    )

    @classmethod
    def _row(cls, row):
        if row:
            row["detail"] = _json(row.get("detail"))
        return row

    @classmethod
    def create(cls, values):
        """Insert one conversion; a repeat of the same conversion_id is ignored. Returns True when inserted."""
        cols = [c for c in cls.COLUMNS if c in values]
        params = [json.dumps(values[c]) if c == "detail" and values[c] is not None else values[c] for c in cols]
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"INSERT IGNORE INTO pos_group_conversions ({', '.join(cols)}) VALUES ({', '.join(['%s'] * len(cols))})",
                    params,
                )
                inserted = cursor.rowcount
            conn.commit()
        return inserted == 1

    @classmethod
    def get(cls, conversion_id):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_group_conversions WHERE conversion_id = %s", (conversion_id,))
                return cls._row(cursor.fetchone())

    @classmethod
    def for_receipt(cls, receipt_id):
        """Every conversion ever recorded for the receipt, newest first."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM pos_group_conversions WHERE receipt_id = %s ORDER BY recorded_at DESC, id DESC",
                    (receipt_id,),
                )
                return [cls._row(r) for r in cursor.fetchall()]

    @classmethod
    def update(cls, conversion_id, values):
        cols = [c for c in cls.UPDATABLE if c in values]
        if not cols:
            return False
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"UPDATE pos_group_conversions SET {', '.join(f'{c} = %s' for c in cols)} WHERE conversion_id = %s",
                    [values[c] for c in cols] + [conversion_id],
                )
                changed = cursor.rowcount
            conn.commit()
        return changed == 1

    @classmethod
    def list(cls, stages=None, since=None, group_name=None, limit=200):
        where, params = [], []
        if stages:
            where.append(f"stage IN ({', '.join(['%s'] * len(stages))})")
            params.extend(stages)
        if since is not None:
            where.append("recorded_at >= %s")
            params.append(since)
        if group_name:
            where.append("group_name = %s")
            params.append(group_name)
        sql = "SELECT * FROM pos_group_conversions"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY recorded_at DESC, id DESC LIMIT %s"
        params.append(int(limit))
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(sql, params)
                return [cls._row(r) for r in cursor.fetchall()]

    @classmethod
    def heads_for_group(cls, group_name, start, end, stages):
        """Converted heads the group is invoiced for in [start, end)."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"""
                    SELECT COALESCE(SUM(heads), 0) AS heads FROM pos_group_conversions
                    WHERE group_name = %s AND recorded_at >= %s AND recorded_at < %s
                      AND stage IN ({', '.join(['%s'] * len(stages))})
                    """,
                    [group_name, start, end, *stages],
                )
                row = cursor.fetchone()
        return int(row["heads"] or 0) if row else 0
