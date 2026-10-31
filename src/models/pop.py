"""Proof-of-payment candidates found on customer mail (migration 011)."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from src.models.base import execute, query, query_one


def insert(
    booking_id: int | None, email_message_id: int, attachment_id: int | None, document_id: int | None, *,
    parsed: bool, text_signal: bool, bank_name: str | None, reference: str | None, amount: Decimal | None,
    paid_on: Any,
) -> int:
    existing = query_one(
        "SELECT id FROM pop_candidates WHERE email_message_id = %s AND attachment_id <=> %s",
        (int(email_message_id), attachment_id),
    )
    if existing:
        return int(existing["id"])
    return execute(
        """
        INSERT INTO pop_candidates (booking_id, email_message_id, attachment_id, document_id, parsed, text_signal,
                                    bank_name, reference, amount, paid_on)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (booking_id, int(email_message_id), attachment_id, document_id, int(parsed), int(text_signal),
         (bank_name or "")[:60] or None, (reference or "")[:120] or None, amount, paid_on),
    )


def get(candidate_id: int) -> dict | None:
    return query_one("SELECT * FROM pop_candidates WHERE id = %s", (int(candidate_id),))


def list_for_booking(booking_id: int) -> list[dict]:
    return query(
        "SELECT * FROM pop_candidates WHERE booking_id = %s ORDER BY status = 'pending' DESC, created_at DESC",
        (int(booking_id),),
    )


def list_pending() -> list[dict]:
    return query(
        """
        SELECT p.*, b.reference, b.group_name, b.visit_date, b.status AS booking_status
        FROM pop_candidates p JOIN bookings b ON b.id = p.booking_id
        WHERE p.status = 'pending' ORDER BY p.created_at
        """
    )


def set_status(candidate_id: int, status: str, actor: int | None, **fields: Any) -> None:
    sets = ["status = %s", "resolved_at = %s", "resolved_by = %s"]
    params: list[Any] = [status, datetime.now().replace(microsecond=0), actor]
    for k, v in fields.items():
        sets.append(f"{k} = %s")
        params.append(v)
    params.append(int(candidate_id))
    execute(f"UPDATE pop_candidates SET {', '.join(sets)} WHERE id = %s", tuple(params))
