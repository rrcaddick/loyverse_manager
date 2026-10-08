"""Persistence for the helpdesk: email_messages, email_attachments,
mail_sync_state and bounce_backs, plus the booking lookups the matcher needs.

Rows come back as plain dicts. ``to_api`` turns a row into the JSON shape the
inbox frontend builds against (docs/handoff/mail.md).

Column notes (migrations/007-booking-system.sql):
  gmail_msgid     X-GM-MSGID, unique; NULL only for an outbound row we sent
                  ourselves that the Sent-folder sync has not yet seen.
  gmail_thrid     X-GM-THRID; outbound rows borrow bookings.email_thread_id.
  folder/uid      the folder the row was last seen in and its UID there.
  sent_at         naive DATETIME in Africa/Johannesburg.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from src.models.base import (
    dumps,
    execute,
    loads,
    query,
    query_one,
    serialize_row,
    transaction,
)
from src.utils.date import get_today

ACTIVE_BOOKING_STATUSES = ("enquiry", "proforma_sent", "confirmed")
INACTIVE_BOOKING_STATUSES = ("cancelled", "lapsed")
VIEWS = ("review", "all", "unmatched", "booking")
REVIEW_STATUSES = ("none", "pending", "resolved", "not_booking")

JSON_COLUMNS = ("to_emails", "cc_emails", "attachments_meta")

INSERT_COLUMNS = (
    "gmail_msgid",
    "gmail_thrid",
    "gmail_uid",
    "folder",
    "message_id_header",
    "in_reply_to",
    "references_header",
    "direction",
    "kind",
    "from_name",
    "from_email",
    "to_emails",
    "cc_emails",
    "subject",
    "sent_at",
    "snippet",
    "body_text",
    "body_html",
    "has_attachments",
    "booking_id",
    "match_method",
    "review_status",
    "is_auto_generated",
    "send_status",
    "send_error",
    "sent_by",
    "attachments_meta",
)

# Columns the frontend list needs. The LEFT JOIN supplies the booking summary.
_LIST_SELECT = """
    SELECT m.id, m.gmail_msgid, m.gmail_thrid, m.direction, m.kind, m.from_name,
           m.from_email, m.to_emails, m.cc_emails, m.subject, m.snippet, m.sent_at,
           m.has_attachments, m.booking_id, m.match_method, m.review_status,
           m.is_auto_generated, m.send_status, m.bounce_back_sent_at,
           b.reference AS booking_reference, b.group_name AS booking_group_name
    FROM email_messages m
    LEFT JOIN bookings b ON b.id = m.booking_id
"""

_FULL_SELECT = """
    SELECT m.*, b.reference AS booking_reference, b.group_name AS booking_group_name
    FROM email_messages m
    LEFT JOIN bookings b ON b.id = m.booking_id
"""

# "Unmatched" = a real inbound message nobody has linked or dismissed yet.
_UNMATCHED_WHERE = (
    "m.booking_id IS NULL AND m.direction = 'inbound' AND m.is_auto_generated = 0 "
    "AND m.review_status <> 'not_booking'"
)


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def _prepare(data: dict) -> dict:
    out = dict(data)
    for col in JSON_COLUMNS:
        if col in out and out[col] is not None and not isinstance(out[col], str):
            out[col] = dumps(out[col])
    for col in ("has_attachments", "is_auto_generated"):
        if col in out and out[col] is not None:
            out[col] = int(bool(out[col]))
    return out


def _decode(row: dict | None) -> dict | None:
    if row is None:
        return None
    out = dict(row)
    for col in JSON_COLUMNS:
        if col in out:
            out[col] = loads(out[col]) if out[col] is not None else None
    return out


# ------------------------------------------------------------- shaping ---


def booking_summary(row: dict) -> dict | None:
    if not row.get("booking_id"):
        return None
    return {
        "id": row["booking_id"],
        "reference": row.get("booking_reference"),
        "group_name": row.get("booking_group_name"),
    }


def to_api(row: dict | None, full: bool = False) -> dict | None:
    """The list-item shape; ``full=True`` adds the bodies and send metadata."""
    if row is None:
        return None
    r = serialize_row(_decode(row)) or {}
    item: dict[str, Any] = {
        "id": r["id"],
        "direction": r.get("direction"),
        "kind": r.get("kind"),
        "from_name": r.get("from_name"),
        "from_email": r.get("from_email"),
        "to_emails": r.get("to_emails") or [],
        "cc_emails": r.get("cc_emails") or [],
        "subject": r.get("subject"),
        "snippet": r.get("snippet"),
        "sent_at": r.get("sent_at"),
        "has_attachments": bool(r.get("has_attachments")),
        "booking": booking_summary(r),
        "match_method": r.get("match_method"),
        "review_status": r.get("review_status"),
        "is_auto_generated": bool(r.get("is_auto_generated")),
        "gmail_thrid": str(r["gmail_thrid"]) if r.get("gmail_thrid") else None,
        "send_status": r.get("send_status"),
        "bounce_back_sent_at": r.get("bounce_back_sent_at"),
    }
    if full:
        item.update(
            {
                "gmail_msgid": str(r["gmail_msgid"]) if r.get("gmail_msgid") else None,
                "folder": r.get("folder"),
                "message_id_header": r.get("message_id_header"),
                "in_reply_to": r.get("in_reply_to"),
                "references_header": r.get("references_header"),
                "body_text": r.get("body_text"),
                "body_html": r.get("body_html"),
                "send_error": r.get("send_error"),
                "sent_by": r.get("sent_by"),
                "attachments_meta": r.get("attachments_meta") or [],
                "resolved_by": r.get("resolved_by"),
                "resolved_at": r.get("resolved_at"),
                "created_at": r.get("created_at"),
            }
        )
    return item


# -------------------------------------------------------------- reads ---


def get(message_id: int) -> dict | None:
    return _decode(query_one(_FULL_SELECT + " WHERE m.id = %s", (message_id,)))


def get_by_gmail_msgid(gmail_msgid: int) -> dict | None:
    return _decode(query_one("SELECT * FROM email_messages WHERE gmail_msgid = %s", (gmail_msgid,)))


def get_by_message_id_header(header: str) -> dict | None:
    if not header:
        return None
    return _decode(
        query_one(
            "SELECT * FROM email_messages WHERE message_id_header = %s ORDER BY id LIMIT 1",
            (header.strip(),),
        )
    )


def thread(gmail_thrid: int) -> list[dict]:
    rows = query(_FULL_SELECT + " WHERE m.gmail_thrid = %s ORDER BY m.sent_at, m.id", (gmail_thrid,))
    return [_decode(r) or {} for r in rows]


def thread_summary(gmail_thrid: int | None) -> dict | None:
    if not gmail_thrid:
        return None
    row = query_one(
        """
        SELECT COUNT(*) AS count,
               MIN(sent_at) AS first_at,
               MAX(sent_at) AS last_at,
               SUM(direction = 'inbound') AS inbound,
               SUM(direction = 'outbound') AS outbound,
               MAX(booking_id) AS booking_id
        FROM email_messages WHERE gmail_thrid = %s
        """,
        (gmail_thrid,),
    )
    out: dict[str, Any] = serialize_row(row) or {}
    out["gmail_thrid"] = str(gmail_thrid)
    for k in ("count", "inbound", "outbound"):
        out[k] = int(out.get(k) or 0)
    return out


def list_messages(
    view: str = "all",
    booking_id: int | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[dict], int]:
    """Return (items, total) for the inbox list. Items are ``to_api`` shaped."""
    where: list[str] = []
    params: list[Any] = []
    if view == "review":
        where.append("m.review_status = 'pending'")
    elif view == "unmatched":
        where.append(_UNMATCHED_WHERE)
    elif view == "booking":
        where.append("m.booking_id = %s")
        params.append(booking_id)
    elif view != "all":
        raise ValueError(f"Unknown view: {view}")
    if booking_id and view != "booking":
        where.append("m.booking_id = %s")
        params.append(booking_id)
    if q:
        like = f"%{q.strip()}%"
        where.append(
            "(m.subject LIKE %s OR m.from_name LIKE %s OR m.from_email LIKE %s "
            "OR m.snippet LIKE %s OR b.reference LIKE %s OR b.group_name LIKE %s)"
        )
        params.extend([like] * 6)
    where_sql = (" WHERE " + " AND ".join(where)) if where else ""
    total_row = query_one(
        "SELECT COUNT(*) AS n FROM email_messages m LEFT JOIN bookings b ON b.id = m.booking_id"
        + where_sql,
        tuple(params),
    )
    total = int(total_row["n"]) if total_row else 0
    offset = (max(1, page) - 1) * page_size
    rows = query(
        _LIST_SELECT + where_sql + " ORDER BY m.sent_at DESC, m.id DESC LIMIT %s OFFSET %s",
        tuple(params) + (page_size, offset),
    )
    return [to_api(r) or {} for r in rows], total


def counts() -> dict:
    row = query_one(
        f"""
        SELECT SUM(m.review_status = 'pending') AS review,
               SUM({_UNMATCHED_WHERE}) AS unmatched
        FROM email_messages m
        """
    )
    return {
        "review": int((row or {}).get("review") or 0),
        "unmatched": int((row or {}).get("unmatched") or 0),
    }


def list_for_booking(booking_id: int) -> list[dict]:
    rows = query(_LIST_SELECT + " WHERE m.booking_id = %s ORDER BY m.sent_at, m.id", (booking_id,))
    return [to_api(r) or {} for r in rows]


# ------------------------------------------------------------- writes ---


def insert(data: dict, conn=None) -> int:
    payload = _prepare({k: v for k, v in data.items() if k in INSERT_COLUMNS})
    cols = list(payload)
    sql = (
        f"INSERT INTO email_messages ({', '.join(cols)}) "
        f"VALUES ({', '.join(['%s'] * len(cols))})"
    )
    return execute(sql, tuple(payload[c] for c in cols), conn=conn)


def update(message_id: int, conn=None, **fields) -> None:
    payload = _prepare(fields)
    if not payload:
        return
    sets = ", ".join(f"{k} = %s" for k in payload)
    execute(
        f"UPDATE email_messages SET {sets} WHERE id = %s",
        tuple(payload.values()) + (message_id,),
        conn=conn,
    )


def upsert_by_gmail_msgid(data: dict) -> tuple[int, str]:
    """Store a fetched message. Returns (id, outcome) where outcome is
    ``inserted``, ``updated`` (seen before, gmail/folder fields refreshed) or
    ``claimed`` (a Sent-folder copy of a message we sent over SMTP).

    Booking links and review decisions on an existing row are never touched.
    """
    gmail_msgid = data.get("gmail_msgid")
    existing = get_by_gmail_msgid(gmail_msgid) if gmail_msgid else None
    if existing:
        fields: dict[str, Any] = {
            "gmail_uid": data.get("gmail_uid"),
            "folder": data.get("folder"),
        }
        if data.get("gmail_thrid") and not existing.get("gmail_thrid"):
            fields["gmail_thrid"] = data["gmail_thrid"]
        if data.get("direction") == "outbound" and existing.get("direction") != "outbound":
            fields["direction"] = "outbound"
        update(existing["id"], **fields)
        return existing["id"], "updated"

    header = (data.get("message_id_header") or "").strip()
    if header:
        own = query_one(
            """
            SELECT id FROM email_messages
            WHERE message_id_header = %s AND gmail_msgid IS NULL AND direction = 'outbound'
            ORDER BY id LIMIT 1
            """,
            (header,),
        )
        if own:
            update(
                own["id"],
                gmail_msgid=gmail_msgid,
                gmail_thrid=data.get("gmail_thrid"),
                gmail_uid=data.get("gmail_uid"),
                folder=data.get("folder"),
            )
            return own["id"], "claimed"

    return insert(data), "inserted"


def insert_outbound(data: dict) -> int:
    payload = {"direction": "outbound", "review_status": "none", **data}
    return insert(payload)


def link_to_booking(
    message_id: int, booking_id: int, method: str, whole_thread: bool = False
) -> list[int]:
    """Attach a message (optionally its whole Gmail thread) to a booking.

    Pending reviews on the linked rows become ``resolved``. Returns the ids
    that were changed.
    """
    msg = get(message_id)
    if msg is None:
        return []
    ids = [message_id]
    if whole_thread and msg.get("gmail_thrid"):
        rows = query(
            "SELECT id FROM email_messages WHERE gmail_thrid = %s AND (booking_id IS NULL OR booking_id <> %s)",
            (msg["gmail_thrid"], booking_id),
        )
        ids = sorted({message_id, *(r["id"] for r in rows)})
    placeholders = ",".join(["%s"] * len(ids))
    execute(
        f"""
        UPDATE email_messages
        SET booking_id = %s, match_method = %s,
            review_status = CASE WHEN review_status = 'pending' THEN 'resolved' ELSE review_status END
        WHERE id IN ({placeholders})
        """,
        (booking_id, method, *ids),
    )
    return ids


def detach(message_id: int, pending: bool) -> None:
    execute(
        "UPDATE email_messages SET booking_id = NULL, match_method = NULL, review_status = %s WHERE id = %s",
        ("pending" if pending else "none", message_id),
    )


def set_review_status(message_id: int, status: str, user_id: int | None) -> None:
    if status not in REVIEW_STATUSES:
        raise ValueError(f"Unknown review status: {status}")
    resolved = status in ("resolved", "not_booking")
    execute(
        """
        UPDATE email_messages
        SET review_status = %s, resolved_by = %s, resolved_at = %s
        WHERE id = %s
        """,
        (status, user_id if resolved else None, _now() if resolved else None, message_id),
    )


def mark_pending_reviews(window_days: int) -> int:
    """Flag inbound, unmatched, non-auto messages inside the review window."""
    cutoff = datetime.combine(get_today() - timedelta(days=window_days), datetime.min.time())
    return execute(
        f"""
        UPDATE email_messages m
        SET m.review_status = 'pending'
        WHERE {_UNMATCHED_WHERE} AND m.review_status = 'none' AND m.sent_at >= %s
        """,
        (cutoff,),
    )


def set_bounce_back_sent(message_id: int, when: datetime) -> None:
    execute("UPDATE email_messages SET bounce_back_sent_at = %s WHERE id = %s", (when, message_id))


# -------------------------------------------------------- attachments ---


def add_attachment(
    email_message_id: int, filename: str, content_type: str | None, size_bytes: int, file_path: str
) -> int:
    return execute(
        """
        INSERT INTO email_attachments (email_message_id, filename, content_type, size_bytes, file_path)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (email_message_id, filename[:255], (content_type or None), int(size_bytes), file_path[:255]),
    )


def list_attachments(email_message_id: int) -> list[dict]:
    rows = query(
        "SELECT id, email_message_id, filename, content_type, size_bytes, file_path "
        "FROM email_attachments WHERE email_message_id = %s ORDER BY id",
        (email_message_id,),
    )
    return [serialize_row(r) or {} for r in rows]


def get_attachment(attachment_id: int) -> dict | None:
    return serialize_row(query_one("SELECT * FROM email_attachments WHERE id = %s", (attachment_id,)))


def delete_attachments(email_message_id: int) -> int:
    return execute("DELETE FROM email_attachments WHERE email_message_id = %s", (email_message_id,))


# ---------------------------------------------------------- sync state ---


def get_sync_state(folder: str) -> dict | None:
    return query_one("SELECT * FROM mail_sync_state WHERE folder = %s", (folder,))


def set_sync_state(
    folder: str, uidvalidity: int | None, last_uid: int, error: str | None = None
) -> None:
    execute(
        """
        INSERT INTO mail_sync_state (folder, uidvalidity, last_uid, last_synced_at, last_error)
        VALUES (%s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE uidvalidity = VALUES(uidvalidity), last_uid = VALUES(last_uid),
            last_synced_at = VALUES(last_synced_at), last_error = VALUES(last_error)
        """,
        (folder, uidvalidity, int(last_uid), _now(), error),
    )


def all_sync_state() -> list[dict]:
    return [serialize_row(r) or {} for r in query("SELECT * FROM mail_sync_state ORDER BY folder")]


# -------------------------------------------------------- bounce backs ---


def get_bounce_back(sender_email: str) -> dict | None:
    return serialize_row(
        query_one("SELECT * FROM bounce_backs WHERE sender_email = %s", (sender_email.lower(),))
    )


def set_bounce_back(sender_email: str, when: datetime) -> None:
    execute(
        """
        INSERT INTO bounce_backs (sender_email, last_sent_at) VALUES (%s, %s)
        ON DUPLICATE KEY UPDATE last_sent_at = VALUES(last_sent_at)
        """,
        (sender_email.lower(), when),
    )


# ------------------------------------------------- threading helpers ---


def latest_message_id_for_booking(booking_id: int) -> str | None:
    """Message-ID header of the newest message on the booking (for In-Reply-To)."""
    row = query_one(
        """
        SELECT message_id_header FROM email_messages
        WHERE booking_id = %s AND message_id_header IS NOT NULL AND message_id_header <> ''
          AND (send_status IS NULL OR send_status = 'sent')
        ORDER BY sent_at DESC, id DESC LIMIT 1
        """,
        (booking_id,),
    )
    return row["message_id_header"] if row else None


def latest_inbound_after_outbound(booking_id: int) -> dict | None:
    """The newest inbound message on a booking if it is newer than our last
    successful outbound one, else None. Single-booking form of the queue SQL."""
    row = query_one(
        """
        SELECT m.id, m.subject, m.from_name, m.from_email, m.sent_at, m.snippet
        FROM email_messages m
        WHERE m.booking_id = %s AND m.direction = 'inbound' AND m.is_auto_generated = 0
          AND m.sent_at > COALESCE(
              (SELECT MAX(o.sent_at) FROM email_messages o
               WHERE o.booking_id = m.booking_id AND o.direction = 'outbound'
                 AND (o.send_status IS NULL OR o.send_status = 'sent')),
              '1970-01-01')
        ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
        """,
        (booking_id,),
    )
    return serialize_row(row)


def bookings_needing_reply() -> list[dict]:
    """Bookings whose latest message is inbound and newer than the last outbound.

    Reusable by the ops agent's ``needs_reply`` queue section. One row per
    booking with the triggering message.
    """
    rows = query(
        """
        SELECT b.id AS booking_id, b.reference, b.group_name, b.status, b.visit_date,
               m.id AS message_id, m.subject, m.from_name, m.from_email, m.sent_at, m.snippet
        FROM bookings b
        JOIN email_messages m ON m.booking_id = b.id
        WHERE b.status NOT IN ('cancelled', 'lapsed', 'completed', 'no_show')
          AND m.direction = 'inbound' AND m.is_auto_generated = 0
          AND m.sent_at = (
              SELECT MAX(i.sent_at) FROM email_messages i
              WHERE i.booking_id = b.id AND i.direction = 'inbound' AND i.is_auto_generated = 0)
          AND m.sent_at > COALESCE(
              (SELECT MAX(o.sent_at) FROM email_messages o
               WHERE o.booking_id = b.id AND o.direction = 'outbound'
                 AND (o.send_status IS NULL OR o.send_status = 'sent')),
              '1970-01-01')
        ORDER BY m.sent_at DESC
        """
    )
    return [serialize_row(r) or {} for r in rows]


# ------------------------------------------ booking lookups (matching) ---

_BOOKING_COLS = (
    "id, reference, doc_number, status, group_name, group_type, contact_name, contact_email, "
    "contact_mobile, visit_date, email_thread_id"
)


def booking_by_id(booking_id: int) -> dict | None:
    return query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,))


def booking_by_doc_number(doc_number: int) -> dict | None:
    return query_one(f"SELECT {_BOOKING_COLS} FROM bookings WHERE doc_number = %s", (doc_number,))


def booking_by_reference(reference: str) -> dict | None:
    return query_one(f"SELECT {_BOOKING_COLS} FROM bookings WHERE reference = %s", (reference,))


def booking_by_thread(gmail_thrid: int) -> dict | None:
    row = query_one(
        f"SELECT {_BOOKING_COLS} FROM bookings WHERE email_thread_id = %s ORDER BY id DESC LIMIT 1",
        (gmail_thrid,),
    )
    if row:
        return row
    linked = query_one(
        """
        SELECT b.id, b.reference, b.doc_number, b.status, b.group_name, b.group_type,
               b.contact_name, b.contact_email, b.contact_mobile, b.visit_date, b.email_thread_id
        FROM email_messages m JOIN bookings b ON b.id = m.booking_id
        WHERE m.gmail_thrid = %s AND m.booking_id IS NOT NULL
        ORDER BY m.sent_at DESC, m.id DESC LIMIT 1
        """,
        (gmail_thrid,),
    )
    return linked


def _active_order() -> str:
    # Active + upcoming first, then the most recent visit.
    return (
        "ORDER BY (status NOT IN ('cancelled', 'lapsed') AND visit_date >= %s) DESC, "
        "visit_date DESC, id DESC LIMIT 1"
    )


def booking_by_contact_email(email: str) -> dict | None:
    if not email:
        return None
    return query_one(
        f"SELECT {_BOOKING_COLS} FROM bookings WHERE LOWER(contact_email) = %s " + _active_order(),
        (email.strip().lower(), get_today()),
    )


def booking_by_contact_mobile(digits: str) -> dict | None:
    if not digits:
        return None
    return query_one(
        f"SELECT {_BOOKING_COLS} FROM bookings WHERE contact_mobile = %s " + _active_order(),
        (digits, get_today()),
    )


def set_booking_thread_if_null(booking_id: int, gmail_thrid: int) -> bool:
    n = execute(
        "UPDATE bookings SET email_thread_id = %s WHERE id = %s AND email_thread_id IS NULL",
        (gmail_thrid, booking_id),
    )
    return bool(n)


def set_booking_thread(booking_id: int, gmail_thrid: int) -> None:
    execute("UPDATE bookings SET email_thread_id = %s WHERE id = %s", (gmail_thrid, booking_id))


def candidate_bookings(days_back: int = 45, limit: int = 400) -> list[dict]:
    """Bookings worth scoring for suggestions / import linking: not cancelled or
    lapsed, visiting within ``days_back`` days ago or later."""
    since = get_today() - timedelta(days=days_back)
    return query(
        f"""
        SELECT {_BOOKING_COLS} FROM bookings
        WHERE status NOT IN ('cancelled', 'lapsed') AND visit_date >= %s
        ORDER BY visit_date, id LIMIT %s
        """,
        (since, limit),
    )


def current_bookings() -> list[dict]:
    """Status not cancelled/lapsed and visit_date >= today (import linking)."""
    return query(
        f"""
        SELECT {_BOOKING_COLS} FROM bookings
        WHERE status NOT IN ('cancelled', 'lapsed') AND visit_date >= %s
        ORDER BY visit_date, id
        """,
        (get_today(),),
    )


def messages_for_linking() -> list[dict]:
    """Lightweight rows for the import's thread-linking pass."""
    return query(
        """
        SELECT id, gmail_thrid, direction, from_name, from_email, to_emails, cc_emails,
               subject, sent_at, body_text, booking_id, is_auto_generated
        FROM email_messages WHERE gmail_thrid IS NOT NULL
        ORDER BY sent_at, id
        """
    )


def link_thread(gmail_thrid: int, booking_id: int, method: str) -> int:
    return execute(
        """
        UPDATE email_messages
        SET booking_id = %s, match_method = %s,
            review_status = CASE WHEN review_status = 'pending' THEN 'resolved' ELSE review_status END
        WHERE gmail_thrid = %s AND (booking_id IS NULL OR booking_id <> %s)
        """,
        (booking_id, method, gmail_thrid, booking_id),
    )


def insert_booking_event(
    booking_id: int, kind: str, summary: str, data: dict | None, actor_user_id: int | None
) -> int:
    """Fallback used when src.services.booking.add_event is not importable."""
    return execute(
        """
        INSERT INTO booking_events (booking_id, kind, summary, data, actor_user_id)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (booking_id, kind, summary[:255], dumps(data) if data is not None else None, actor_user_id),
    )


# --------------------------------------------------------- import runs ---


def start_import_run(kind: str) -> int:
    return execute(
        "INSERT INTO import_runs (kind, started_at, status) VALUES (%s, %s, 'running')",
        (kind, _now()),
    )


def finish_import_run(run_id: int, summary: dict, status: str = "done") -> None:
    execute(
        "UPDATE import_runs SET finished_at = %s, summary = %s, status = %s WHERE id = %s",
        (_now(), dumps(summary), status, run_id),
    )


__all__ = [name for name in dir() if not name.startswith("_")]
