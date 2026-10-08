"""Persistence for ``bank_transactions`` and ``bank_poll_log`` (docs/booking-system.md §4).

Rows are inserted once, keyed on the content fingerprint, and never updated
except for their match state. SQL only: the matching rules live in
``src/services/bank.py``. Rows come back with native DB types; ``serialize``
makes them JSON-safe and attaches the matched booking summary.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pymysql

from src.models.base import dumps, execute, loads, query, query_one, serialize_row
from src.utils.date import get_today

STATUSES = ("unmatched", "suggested", "matched", "ignored")
MYSQL_DUPLICATE_KEY = 1062

_SELECT = """
    SELECT t.*, b.reference AS booking_reference, b.group_name AS booking_group_name
    FROM bank_transactions t
    LEFT JOIN bookings b ON b.id = t.matched_booking_id
"""


# ----------------------------------------------------------------- writes ---

def upsert_by_fingerprint(row: dict) -> tuple[int, bool]:
    """Insert the row unless its fingerprint exists. Returns ``(id, created)``.

    Insert-only by design: a bank entry's content never changes, and the match
    columns belong to the operator, not the poller.
    """
    try:
        new_id = execute(
            """
            INSERT INTO bank_transactions
                (fingerprint, account_number, entry_id, booking_date, value_date,
                 description, end_to_end_id, amount, credit_debit, balance_after, raw)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                row["fingerprint"],
                row["account_number"],
                row.get("entry_id"),
                row["booking_date"],
                row.get("value_date"),
                row.get("description"),
                row.get("end_to_end_id"),
                row["amount"],
                row["credit_debit"],
                row.get("balance_after"),
                row.get("raw"),
            ),
        )
        return int(new_id), True
    except pymysql.err.IntegrityError as exc:
        if exc.args and exc.args[0] != MYSQL_DUPLICATE_KEY:
            raise
    existing = query_one(
        "SELECT id FROM bank_transactions WHERE fingerprint = %s", (row["fingerprint"],)
    )
    if existing is None:  # pragma: no cover - duplicate key on another unique column
        raise
    return int(existing["id"]), False


def set_match(
    tx_id: int,
    status: str,
    booking_id: int | None = None,
    method: str | None = None,
    matched_by: int | None = None,
    suggestions: list[dict] | None = None,
    ignore_reason: str | None = None,
) -> int:
    """Write the match state in one go. ``matched_at`` is set for matched/ignored."""
    if status not in STATUSES:
        raise ValueError(f"Unknown match status: {status}")
    stamped = status in ("matched", "ignored")
    return execute(
        """
        UPDATE bank_transactions
        SET match_status = %s,
            matched_booking_id = %s,
            match_method = %s,
            matched_by = %s,
            matched_at = %s,
            suggestions = %s,
            ignore_reason = %s
        WHERE id = %s
        """,
        (
            status,
            booking_id,
            method,
            matched_by,
            datetime.now() if stamped else None,
            dumps(suggestions) if suggestions else None,
            ignore_reason,
            tx_id,
        ),
    )


def set_suggestions(tx_id: int, suggestions: list[dict] | None) -> int:
    status = "suggested" if suggestions else "unmatched"
    return set_match(tx_id, status, suggestions=suggestions)


# ------------------------------------------------------------------ reads ---

def get(tx_id: int) -> dict | None:
    return query_one(_SELECT + " WHERE t.id = %s", (tx_id,))


def get_by_fingerprint(fp: str) -> dict | None:
    return query_one(_SELECT + " WHERE t.fingerprint = %s", (fp,))


def _where(
    status: str | None,
    date_from: date | None,
    date_to: date | None,
    q: str | None,
    credit_debit: str | None = None,
) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []
    if status:
        clauses.append("t.match_status = %s")
        params.append(status)
    if credit_debit:
        clauses.append("t.credit_debit = %s")
        params.append(credit_debit)
    if date_from:
        clauses.append("t.booking_date >= %s")
        params.append(date_from)
    if date_to:
        clauses.append("t.booking_date <= %s")
        params.append(date_to)
    if q:
        text = q.strip()
        like = f"%{text}%"
        ors = [
            "t.description LIKE %s",
            "t.end_to_end_id LIKE %s",
            "b.reference LIKE %s",
            "b.group_name LIKE %s",
        ]
        params.extend([like] * len(ors))
        try:
            amount = Decimal(text.replace(",", "").replace("R", "").strip())
            ors.append("t.amount = %s")
            params.append(amount)
        except Exception:  # noqa: BLE001 - not a number, text search only
            pass
        clauses.append("(" + " OR ".join(ors) + ")")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    return where, params


def list_transactions(
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
    credit_debit: str | None = None,
) -> tuple[list[dict], int]:
    """Newest first. Returns ``(rows, total)``."""
    where, params = _where(status, date_from, date_to, q, credit_debit)
    total_row = query_one(
        f"SELECT COUNT(*) AS n FROM bank_transactions t "
        f"LEFT JOIN bookings b ON b.id = t.matched_booking_id {where}",
        tuple(params),
    )
    total = int(total_row["n"]) if total_row else 0
    offset = (max(page, 1) - 1) * page_size
    rows = query(
        f"{_SELECT} {where} ORDER BY t.booking_date DESC, t.id DESC LIMIT %s OFFSET %s",
        (*params, page_size, offset),
    )
    return rows, total


def latest_booking_date() -> date | None:
    row = query_one("SELECT MAX(booking_date) AS d FROM bank_transactions")
    return row["d"] if row else None


def credits_to_match(
    since_days: int,
    statuses: tuple[str, ...] = ("unmatched",),
) -> list[dict]:
    """Credits still needing a decision, oldest first."""
    since = get_today() - timedelta(days=since_days)
    placeholders = ",".join(["%s"] * len(statuses))
    return query(
        f"""
        SELECT * FROM bank_transactions
        WHERE credit_debit = 'CREDIT'
          AND match_status IN ({placeholders})
          AND booking_date >= %s
        ORDER BY booking_date, id
        """,
        (*statuses, since),
    )


def unmatched_credits_since(days: int) -> list[dict]:
    since = get_today() - timedelta(days=days)
    return query(
        """
        SELECT * FROM bank_transactions
        WHERE credit_debit = 'CREDIT' AND match_status = 'unmatched' AND booking_date >= %s
        ORDER BY booking_date DESC, id DESC
        """,
        (since,),
    )


def unmatched_credits_summary(days: int) -> dict:
    since = get_today() - timedelta(days=days)
    row = query_one(
        """
        SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
        FROM bank_transactions
        WHERE credit_debit = 'CREDIT' AND match_status = 'unmatched' AND booking_date >= %s
        """,
        (since,),
    )
    return {
        "count": int(row["n"]) if row else 0,
        "amount": float(row["total"]) if row else 0.0,
    }


def status_counts() -> dict[str, int]:
    rows = query(
        "SELECT match_status, COUNT(*) AS n FROM bank_transactions GROUP BY match_status"
    )
    counts = {status: 0 for status in STATUSES}
    for r in rows:
        counts[r["match_status"]] = int(r["n"])
    return counts


# --------------------------------------------------------- booking lookups ---

def match_candidates() -> list[dict]:
    """Every booking with the figures the matcher needs, plus Σ payments.

    Reads the bookings agent's tables; kept here so the bank service has one
    read model to match against (see docs/handoff/payments.md).
    """
    return query(
        """
        SELECT b.id, b.reference, b.doc_number, b.status, b.group_name, b.contact_name,
               b.visit_date, b.people_booked, b.price_per_person, b.deposit_due,
               b.deposit_waived,
               COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id), 0)
                   AS paid_total
        FROM bookings b
        ORDER BY b.visit_date, b.id
        """
    )


def payment_for_transaction(tx_id: int) -> dict | None:
    return query_one("SELECT * FROM payments WHERE bank_transaction_id = %s", (tx_id,))


# --------------------------------------------------------------- poll log ---

def start_poll(window_from: date, window_to: date) -> int:
    return execute(
        """
        INSERT INTO bank_poll_log (started_at, window_from, window_to, status)
        VALUES (%s, %s, %s, 'running')
        """,
        (datetime.now(), window_from, window_to),
    )


def finish_poll(
    poll_id: int,
    status: str,
    entries: int = 0,
    new_entries: int = 0,
    error: str | None = None,
) -> int:
    return execute(
        """
        UPDATE bank_poll_log
        SET finished_at = %s, status = %s, entries = %s, new_entries = %s, error = %s
        WHERE id = %s
        """,
        (datetime.now(), status, entries, new_entries, error, poll_id),
    )


def poll_count() -> int:
    row = query_one("SELECT COUNT(*) AS n FROM bank_poll_log")
    return int(row["n"]) if row else 0


def last_poll() -> dict | None:
    row = query_one("SELECT * FROM bank_poll_log ORDER BY id DESC LIMIT 1")
    return serialize_row(row)


def last_successful_poll() -> dict | None:
    row = query_one(
        "SELECT * FROM bank_poll_log WHERE status = 'success' ORDER BY id DESC LIMIT 1"
    )
    return serialize_row(row)


# -------------------------------------------------------------- serialize ---

def serialize(row: dict | None, include_raw: bool = False) -> dict | None:
    """JSON-safe view with ``matched_booking`` folded in and ``raw`` left out."""
    if row is None:
        return None
    out: dict = serialize_row(
        {k: v for k, v in row.items() if k not in ("raw", "booking_reference", "booking_group_name")}
    ) or {}
    out["amount"] = round(float(row["amount"]), 2)
    if row.get("balance_after") is not None:
        out["balance_after"] = round(float(row["balance_after"]), 2)
    out["suggestions"] = loads(row.get("suggestions")) or []
    if row.get("matched_booking_id"):
        out["matched_booking"] = {
            "id": row["matched_booking_id"],
            "reference": row.get("booking_reference"),
            "group_name": row.get("booking_group_name"),
        }
    else:
        out["matched_booking"] = None
    if include_raw:
        out["raw"] = loads(row.get("raw"))
    return out
