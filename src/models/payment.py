"""Payments received against a booking (EFT matched from the bank, cash or card
at the gate, or anything else). ``paid_total`` is always Σ amount; nothing on
the booking row caches it.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from src.models.base import execute, query, query_one, serialize_row

KINDS = ("eft", "cash", "card", "other")


def insert(
    booking_id: int,
    kind: str,
    amount: Decimal,
    paid_on: date,
    reference: str | None = None,
    note: str | None = None,
    recorded_by: int | None = None,
    bank_transaction_id: int | None = None,
    conn=None,
) -> int:
    return execute(
        """
        INSERT INTO payments
            (booking_id, kind, amount, paid_on, reference, bank_transaction_id, note, recorded_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (booking_id, kind, amount, paid_on, reference, bank_transaction_id, note, recorded_by),
        conn=conn,
    )


def get(payment_id: int, conn=None) -> dict | None:
    return query_one("SELECT * FROM payments WHERE id = %s", (payment_id,), conn=conn)


def list_for_booking(booking_id: int, conn=None) -> list[dict]:
    rows = query(
        """
        SELECT p.*, u.full_name AS recorded_by_name
        FROM payments p
        LEFT JOIN users u ON u.id = p.recorded_by
        WHERE p.booking_id = %s
        ORDER BY p.paid_on, p.id
        """,
        (booking_id,),
        conn=conn,
    )
    return [serialize_row(r) for r in rows]


def latest_for_booking(booking_id: int) -> dict | None:
    row = query_one(
        "SELECT * FROM payments WHERE booking_id = %s ORDER BY paid_on DESC, id DESC LIMIT 1",
        (booking_id,),
    )
    return serialize_row(row)


def sum_for_booking(booking_id: int, conn=None) -> Decimal:
    row = query_one(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE booking_id = %s",
        (booking_id,),
        conn=conn,
    )
    return Decimal(str(row["total"])) if row else Decimal("0")


def count_for_booking(booking_id: int) -> int:
    row = query_one("SELECT COUNT(*) AS n FROM payments WHERE booking_id = %s", (booking_id,))
    return int(row["n"]) if row else 0


def delete(payment_id: int, conn=None) -> int:
    return execute("DELETE FROM payments WHERE id = %s", (payment_id,), conn=conn)
