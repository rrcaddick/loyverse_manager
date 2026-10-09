"""Persistence for conversations: ``email_threads`` (one row per Gmail
thread) and ``email_thread_notes`` (internal notes on a thread).

The derived columns on ``email_threads`` (counts, timestamps, counterpart,
snippet) are recomputed from ``email_messages`` by
``src.services.conversations.refresh_thread``; this module only stores what
it is given. ``status``, ``done_*`` and ``not_booking`` are operator state
and survive every refresh.

Column notes (migrations/008-conversations-themes.sql):
  gmail_thrid       X-GM-THRID, primary key; JSON callers get it as a string.
  last_direction    direction of the newest message that counts for the work
                    queues (not automated, not a failed send); when every
                    message is automated, the newest one.
  last_snippet      first ~200 chars of the newest message's NEW text,
                    prefixed "You: " when it is ours.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.models.base import execute, query, query_one, serialize_row

VIEWS = ("needs_reply", "unmatched", "waiting", "done", "all")
CHIPS = ("inbound", "sent", "failed", "automated")
STATUSES = ("open", "done")

DERIVED_COLUMNS = (
    "booking_id",
    "subject",
    "counterpart_name",
    "counterpart_email",
    "message_count",
    "last_message_at",
    "last_inbound_at",
    "last_outbound_at",
    "last_direction",
    "last_snippet",
    "has_automated_only",
)

_SELECT = """
    SELECT t.*,
           b.reference AS booking_reference, b.group_name AS booking_group_name,
           b.status AS booking_status, b.visit_date AS booking_visit_date,
           b.contact_name AS booking_contact_name,
           EXISTS (SELECT 1 FROM email_messages a
                   WHERE a.gmail_thrid = t.gmail_thrid AND a.has_attachments = 1) AS has_attachments
    FROM email_threads t
    LEFT JOIN bookings b ON b.id = t.booking_id
"""

# Queue predicates. "Done" leaves every queue; automated-only threads never enter one.
_VIEW_WHERE = {
    "needs_reply": "t.status = 'open' AND t.last_direction = 'inbound' AND t.has_automated_only = 0",
    "unmatched": "t.status = 'open' AND t.booking_id IS NULL AND t.not_booking = 0 AND t.has_automated_only = 0",
    "waiting": "t.status = 'open' AND t.last_direction = 'outbound' AND t.has_automated_only = 0",
    "done": "t.status = 'done'",
    "all": "1 = 1",
}

_CHIP_EXISTS = {
    "inbound": "m.direction = 'inbound' AND m.is_auto_generated = 0",
    "sent": "m.direction = 'outbound' AND (m.send_status IS NULL OR m.send_status = 'sent')",
    "failed": "m.send_status = 'failed'",
    "automated": "m.is_auto_generated = 1",
}


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


# ------------------------------------------------------------------ reads ---


def get(gmail_thrid: int) -> dict | None:
    return query_one(_SELECT + " WHERE t.gmail_thrid = %s", (int(gmail_thrid),))


def exists(gmail_thrid: int) -> bool:
    return query_one("SELECT 1 AS ok FROM email_threads WHERE gmail_thrid = %s", (int(gmail_thrid),)) is not None


def list_for_booking(booking_id: int) -> list[dict]:
    """Threads linked to the booking, plus threads holding a message linked to it."""
    return query(
        _SELECT
        + """
        WHERE t.booking_id = %s
           OR t.gmail_thrid IN (SELECT DISTINCT m.gmail_thrid FROM email_messages m
                                WHERE m.booking_id = %s AND m.gmail_thrid IS NOT NULL)
        ORDER BY t.last_message_at, t.gmail_thrid
        """,
        (int(booking_id), int(booking_id)),
    )


def all_thrids() -> list[int]:
    rows = query("SELECT DISTINCT gmail_thrid FROM email_messages WHERE gmail_thrid IS NOT NULL ORDER BY gmail_thrid")
    return [int(r["gmail_thrid"]) for r in rows]


def all_rows() -> list[dict]:
    """Every thread row (with the booking columns), for the party snapshot."""
    return query(_SELECT + " ORDER BY t.last_message_at, t.gmail_thrid")


def get_many(gmail_thrids: list[int] | tuple[int, ...] | set[int]) -> list[dict]:
    ids = sorted({int(t) for t in gmail_thrids})
    if not ids:
        return []
    placeholders = ",".join(["%s"] * len(ids))
    return query(_SELECT + f" WHERE t.gmail_thrid IN ({placeholders}) ORDER BY t.last_message_at, t.gmail_thrid", tuple(ids))


def list_for_counterpart(address: str, domain: bool = False, unlinked_only: bool = False) -> list[dict]:
    """Threads whose counterpart is ``address`` (or, with ``domain``, any
    address at that host or a subdomain of it)."""
    addr = (address or "").strip().lower()
    if not addr:
        return []
    if domain:
        host = addr.rsplit("@", 1)[-1]
        where = "(LOWER(t.counterpart_email) LIKE %s OR LOWER(t.counterpart_email) LIKE %s)"
        params: list[Any] = [f"%@{host}", f"%.{host}"]
    else:
        where = "LOWER(t.counterpart_email) = %s"
        params = [addr]
    if unlinked_only:
        where += " AND t.booking_id IS NULL"
    return query(_SELECT + f" WHERE {where} ORDER BY t.last_message_at, t.gmail_thrid", tuple(params))


def messages_for_thread(gmail_thrid: int) -> list[dict]:
    """The columns ``conversations.derive_thread`` needs, oldest first."""
    return query(
        """
        SELECT id, gmail_thrid, direction, kind, from_name, from_email, to_emails, cc_emails, subject,
               sent_at, snippet, body_new_text, body_text, is_auto_generated, send_status,
               booking_id, has_attachments
        FROM email_messages
        WHERE gmail_thrid = %s
        ORDER BY sent_at, id
        """,
        (int(gmail_thrid),),
    )


def _search_clause(q: str | None) -> tuple[str, list[Any]]:
    if not q or not q.strip():
        return "", []
    like = f"%{q.strip()}%"
    clause = (
        "(t.subject LIKE %s OR t.counterpart_name LIKE %s OR t.counterpart_email LIKE %s "
        "OR t.last_snippet LIKE %s OR b.reference LIKE %s OR b.group_name LIKE %s "
        "OR EXISTS (SELECT 1 FROM email_messages s WHERE s.gmail_thrid = t.gmail_thrid "
        "           AND (s.subject LIKE %s OR s.body_new_text LIKE %s OR s.from_name LIKE %s)))"
    )
    return clause, [like] * 9


def list_conversations(
    view: str = "needs_reply",
    q: str | None = None,
    chip: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[dict], int]:
    """(rows, total) for a view, newest activity first. Rows are raw (use
    ``conversations.thread_to_api``)."""
    if view not in VIEWS:
        raise ValueError(f"Unknown view: {view}")
    if chip is not None and chip not in CHIPS:
        raise ValueError(f"Unknown chip: {chip}")
    where = [_VIEW_WHERE[view]]
    params: list[Any] = []
    if chip:
        where.append(f"EXISTS (SELECT 1 FROM email_messages m WHERE m.gmail_thrid = t.gmail_thrid AND {_CHIP_EXISTS[chip]})")
    search_sql, search_params = _search_clause(q)
    if search_sql:
        where.append(search_sql)
        params.extend(search_params)
    where_sql = " WHERE " + " AND ".join(where)
    total_row = query_one(
        "SELECT COUNT(*) AS n FROM email_threads t LEFT JOIN bookings b ON b.id = t.booking_id" + where_sql,
        tuple(params),
    )
    total = int(total_row["n"]) if total_row else 0
    offset = (max(1, int(page)) - 1) * int(page_size)
    rows = query(
        _SELECT + where_sql + " ORDER BY t.last_message_at DESC, t.gmail_thrid DESC LIMIT %s OFFSET %s",
        tuple(params) + (int(page_size), offset),
    )
    return rows, total


def counts() -> dict[str, int]:
    # "all" is a reserved word in MySQL, so every alias is prefixed.
    row = query_one(
        "SELECT "
        + ", ".join(f"SUM({_VIEW_WHERE[v]}) AS n_{v}" for v in VIEWS)
        + " FROM email_threads t"
    )
    return {v: int((row or {}).get(f"n_{v}") or 0) for v in VIEWS}


# ----------------------------------------------------------------- writes ---


def upsert(gmail_thrid: int, derived: dict) -> None:
    """Insert or refresh the derived columns; operator state is untouched.

    ``derived["booking_id"]`` of None keeps an existing booking link (a thread
    attached by hand must not lose it when its messages are re-derived).
    """
    cols = [c for c in DERIVED_COLUMNS if c in derived]
    values = [derived[c] for c in cols]
    updates = []
    for c in cols:
        if c == "booking_id":
            updates.append("booking_id = COALESCE(VALUES(booking_id), booking_id)")
        else:
            updates.append(f"{c} = VALUES({c})")
    execute(
        f"""
        INSERT INTO email_threads (gmail_thrid, {', '.join(cols)})
        VALUES (%s, {', '.join(['%s'] * len(cols))})
        ON DUPLICATE KEY UPDATE {', '.join(updates)}
        """,
        (int(gmail_thrid), *values),
    )


def delete(gmail_thrid: int) -> int:
    execute("DELETE FROM email_thread_notes WHERE gmail_thrid = %s", (int(gmail_thrid),))
    return execute("DELETE FROM email_threads WHERE gmail_thrid = %s", (int(gmail_thrid),))


def set_status(gmail_thrid: int, status: str, actor: int | None, keep_mark: bool = False) -> None:
    """Set the thread status. Done stamps ``done_at``/``done_by``; open clears
    them unless ``keep_mark`` (a new inbound reopening a done thread keeps
    the mark so the party computation still knows what was handled)."""
    set_status_many([gmail_thrid], status, actor, keep_mark=keep_mark)


def set_status_many(
    gmail_thrids: list[int] | tuple[int, ...] | set[int], status: str, actor: int | None,
    keep_mark: bool = False, when: datetime | None = None,
) -> int:
    if status not in STATUSES:
        raise ValueError(f"Unknown status: {status}")
    ids = sorted({int(t) for t in gmail_thrids})
    if not ids:
        return 0
    placeholders = ",".join(["%s"] * len(ids))
    if status == "open" and keep_mark:
        return execute(f"UPDATE email_threads SET status = 'open' WHERE gmail_thrid IN ({placeholders})", tuple(ids))
    done = status == "done"
    return execute(
        f"UPDATE email_threads SET status = %s, done_at = %s, done_by = %s WHERE gmail_thrid IN ({placeholders})",
        (status, (when or _now()) if done else None, actor if done else None, *ids),
    )


def set_not_booking_many(gmail_thrids: list[int] | tuple[int, ...] | set[int], value: bool) -> int:
    ids = sorted({int(t) for t in gmail_thrids})
    if not ids:
        return 0
    placeholders = ",".join(["%s"] * len(ids))
    return execute(
        f"UPDATE email_threads SET not_booking = %s WHERE gmail_thrid IN ({placeholders})",
        (int(bool(value)), *ids),
    )


def set_not_booking(gmail_thrid: int, value: bool) -> None:
    execute(
        "UPDATE email_threads SET not_booking = %s WHERE gmail_thrid = %s",
        (int(bool(value)), int(gmail_thrid)),
    )


def set_booking(gmail_thrid: int, booking_id: int | None) -> None:
    execute("UPDATE email_threads SET booking_id = %s WHERE gmail_thrid = %s", (booking_id, int(gmail_thrid)))


# ------------------------------------------------------------------ notes ---


def add_note(gmail_thrid: int, body: str, author_user_id: int | None) -> int:
    return execute(
        "INSERT INTO email_thread_notes (gmail_thrid, body, author_user_id) VALUES (%s, %s, %s)",
        (int(gmail_thrid), body, author_user_id),
    )


def get_note(note_id: int) -> dict | None:
    return query_one(
        """
        SELECT n.*, u.full_name AS author_name
        FROM email_thread_notes n LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.id = %s
        """,
        (int(note_id),),
    )


def list_notes(gmail_thrids: list[int] | tuple[int, ...]) -> list[dict]:
    ids = [int(t) for t in gmail_thrids]
    if not ids:
        return []
    placeholders = ",".join(["%s"] * len(ids))
    return query(
        f"""
        SELECT n.*, u.full_name AS author_name
        FROM email_thread_notes n LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.gmail_thrid IN ({placeholders})
        ORDER BY n.created_at, n.id
        """,
        tuple(ids),
    )


def serialize(row: dict | None) -> dict | None:
    return serialize_row(row)


__all__ = [name for name in dir() if not name.startswith("_")]
