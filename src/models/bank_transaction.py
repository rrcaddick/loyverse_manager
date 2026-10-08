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
# The list views of the Bank page (docs/redesign-spec.md §8).
VIEWS = ("needs_attention", "matched", "all")
IGNORE_REASONS = ("own_transfer", "card_settlement", "interest", "other")
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
    view: str | None = None,
) -> tuple[str, list]:
    clauses: list[str] = []
    params: list = []
    if view == "needs_attention":
        # Credits still waiting for a decision; debits and ignored rows never show.
        clauses.append("t.credit_debit = 'CREDIT'")
        clauses.append("t.match_status IN ('suggested', 'unmatched')")
    elif view == "matched":
        clauses.append("t.match_status = 'matched'")
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
    view: str | None = None,
) -> tuple[list[dict], int]:
    """Returns ``(rows, total)``.

    ``view="needs_attention"`` lists suggested credits first, then unmatched
    credits oldest first; every other view is newest first.
    """
    if view is not None and view not in VIEWS:
        raise ValueError(f"Unknown view: {view}")
    where, params = _where(status, date_from, date_to, q, credit_debit, view)
    total_row = query_one(
        f"SELECT COUNT(*) AS n FROM bank_transactions t "
        f"LEFT JOIN bookings b ON b.id = t.matched_booking_id {where}",
        tuple(params),
    )
    total = int(total_row["n"]) if total_row else 0
    offset = (max(page, 1) - 1) * page_size
    if view == "needs_attention":
        order = "ORDER BY (t.match_status = 'suggested') DESC, t.booking_date ASC, t.id ASC"
    else:
        order = "ORDER BY t.booking_date DESC, t.id DESC"
    rows = query(
        f"{_SELECT} {where} {order} LIMIT %s OFFSET %s",
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


def suggested_credit_count() -> int:
    row = query_one(
        "SELECT COUNT(*) AS n FROM bank_transactions "
        "WHERE credit_debit = 'CREDIT' AND match_status = 'suggested'"
    )
    return int(row["n"]) if row else 0


# ----------------------------------------------------------- ignore rules ---

def _like_prefix(pattern: str) -> str:
    """``pattern%`` with LIKE metacharacters escaped (ESCAPE '\\' is the default)."""
    escaped = pattern.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped + "%"


def list_ignore_rules() -> list[dict]:
    rows = query(
        """
        SELECT r.*, u.full_name AS created_by_name
        FROM bank_ignore_rules r
        LEFT JOIN users u ON u.id = r.created_by
        ORDER BY r.pattern
        """
    )
    return [serialize_row(r) for r in rows]


def get_ignore_rule(rule_id: int) -> dict | None:
    return serialize_row(query_one("SELECT * FROM bank_ignore_rules WHERE id = %s", (rule_id,)))


def find_ignore_rule(pattern: str) -> dict | None:
    return serialize_row(query_one("SELECT * FROM bank_ignore_rules WHERE pattern = %s", (pattern,)))


def insert_ignore_rule(pattern: str, reason: str, note: str | None, created_by: int | None) -> tuple[dict, bool]:
    """Insert the rule unless the pattern exists. Returns ``(rule, created)``."""
    if reason not in IGNORE_REASONS:
        raise ValueError(f"Unknown ignore reason: {reason}")
    try:
        rule_id = execute(
            "INSERT INTO bank_ignore_rules (pattern, reason, note, created_by) VALUES (%s, %s, %s, %s)",
            (pattern, reason, note, created_by),
        )
    except pymysql.err.IntegrityError as exc:
        if exc.args and exc.args[0] != MYSQL_DUPLICATE_KEY:
            raise
        existing = find_ignore_rule(pattern)
        if existing is None:  # pragma: no cover
            raise
        return existing, False
    rule = get_ignore_rule(int(rule_id))
    return rule or {"id": int(rule_id), "pattern": pattern, "reason": reason, "note": note}, True


def delete_ignore_rule(rule_id: int) -> int:
    return execute("DELETE FROM bank_ignore_rules WHERE id = %s", (rule_id,))


def credits_for_rule(pattern: str, statuses: tuple[str, ...] = ("unmatched", "suggested")) -> list[dict]:
    """Credits still in the queue whose description starts with ``pattern`` (case-insensitive)."""
    placeholders = ",".join(["%s"] * len(statuses))
    return query(
        f"""
        SELECT * FROM bank_transactions
        WHERE credit_debit = 'CREDIT'
          AND match_status IN ({placeholders})
          AND UPPER(description) LIKE UPPER(%s)
        ORDER BY booking_date, id
        """,
        (*statuses, _like_prefix(pattern)),
    )


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
    # Exactly one top candidate may be pre-selected; ties pre-select nothing
    # (the matcher sets the flag, see bank.rank_suggestions).
    preselected = [s.get("booking_id") for s in out["suggestions"] if s.get("preselected")]
    out["preselected_booking_id"] = preselected[0] if len(preselected) == 1 else None
    out["ignore"] = parse_ignore_reason(row.get("ignore_reason"))
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


IGNORE_REASON_LABELS = {
    "own_transfer": "Own transfer",
    "card_settlement": "Card settlement",
    "interest": "Interest",
    "other": "Other",
}


def format_ignore_reason(reason: str, note: str | None = None) -> str:
    """What goes into ``bank_transactions.ignore_reason``: ``code`` or ``code: note``."""
    if reason not in IGNORE_REASONS:
        raise ValueError(f"Unknown ignore reason: {reason}")
    note = (note or "").strip()
    text = f"{reason}: {note}" if note else reason
    return text[:255]


def parse_ignore_reason(stored: str | None) -> dict | None:
    """``{"reason", "label", "note"}`` from the stored text; legacy free text → other."""
    if not stored:
        return None
    text = str(stored).strip()
    code, _, note = text.partition(":")
    code = code.strip()
    if code in IGNORE_REASONS:
        note = note.strip() or None
    else:
        code, note = "other", text
    return {"reason": code, "label": IGNORE_REASON_LABELS[code], "note": note}
