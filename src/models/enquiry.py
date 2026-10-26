"""Enquiries: a wrapper around an unmatched inbox conversation (migration 011)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from src.models.base import dumps, execute, query, query_one

OPEN_STATUSES = ("open", "replied")
STATUSES = ("open", "replied", "converted", "attached", "resolved", "not_booking")


def _now() -> datetime:
    return datetime.now().replace(microsecond=0)


def get(enquiry_id: int) -> dict | None:
    return query_one("SELECT * FROM enquiries WHERE id = %s", (int(enquiry_id),))


def get_by_thread(gmail_thrid: int) -> dict | None:
    return query_one("SELECT * FROM enquiries WHERE gmail_thrid = %s", (int(gmail_thrid),))


def get_by_token(token: str) -> dict | None:
    return query_one("SELECT * FROM enquiries WHERE convert_token = %s", (token,)) if token else None


def open_for_sender(address: str) -> dict | None:
    a = (address or "").strip().lower()
    if not a:
        return None
    return query_one(
        "SELECT * FROM enquiries WHERE sender_email = %s AND status IN ('open','replied') "
        "ORDER BY last_inbound_at DESC, id DESC LIMIT 1",
        (a,),
    )


def create(
    gmail_thrid: int, sender_email: str, sender_name: str | None, subject: str | None,
    first_message_at: datetime | None, last_inbound_at: datetime | None, snippet: str | None,
    message_count: int = 1,
) -> int:
    return execute(
        """
        INSERT INTO enquiries (gmail_thrid, sender_email, sender_name, subject, status, first_message_at,
                               last_inbound_at, message_count, snippet)
        VALUES (%s, %s, %s, %s, 'open', %s, %s, %s, %s)
        """,
        (int(gmail_thrid), (sender_email or "").lower(), sender_name, (subject or "")[:500] or None,
         first_message_at, last_inbound_at, int(message_count), (snippet or "")[:255] or None),
    )


def update(enquiry_id: int, **fields: Any) -> None:
    if not fields:
        return
    if "extracted" in fields and fields["extracted"] is not None and not isinstance(fields["extracted"], str):
        fields["extracted"] = dumps(fields["extracted"])
    sets = ", ".join(f"{k} = %s" for k in fields)
    execute(f"UPDATE enquiries SET {sets} WHERE id = %s", (*fields.values(), int(enquiry_id)))


def set_status(enquiry_id: int, status: str, actor: int | None = None) -> None:
    if status not in STATUSES:
        raise ValueError(f"Unknown enquiry status {status}")
    closing = status in ("resolved", "not_booking", "converted", "attached")
    execute(
        "UPDATE enquiries SET status = %s, resolved_at = %s, resolved_by = %s WHERE id = %s",
        (status, _now() if closing else None, actor if closing else None, int(enquiry_id)),
    )


def touch_inbound(enquiry_id: int, when: datetime | None, snippet: str | None) -> None:
    execute(
        """
        UPDATE enquiries
        SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, %s), %s), snippet = %s,
            message_count = message_count + 1,
            status = CASE WHEN status IN ('replied','resolved') THEN 'open' ELSE status END,
            resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END
        WHERE id = %s
        """,
        (when, when, (snippet or "")[:255] or None, int(enquiry_id)),
    )


def touch_outbound(enquiry_id: int, when: datetime | None) -> None:
    execute(
        "UPDATE enquiries SET last_outbound_at = %s, message_count = message_count + 1, "
        "status = CASE WHEN status = 'open' THEN 'replied' ELSE status END WHERE id = %s",
        (when, int(enquiry_id)),
    )


def list_enquiries(status: str | None = "open", q: str | None = None, page: int = 1, page_size: int = 50) -> dict:
    where = ["1=1"]
    params: list[Any] = []
    if status == "open":
        where.append("status IN ('open','replied')")
    elif status and status != "all":
        where.append("status = %s")
        params.append(status)
    if q:
        like = f"%{q.strip()}%"
        where.append("(sender_email LIKE %s OR sender_name LIKE %s OR subject LIKE %s)")
        params += [like, like, like]
    sql_where = " AND ".join(where)
    total = query_one(f"SELECT COUNT(*) AS n FROM enquiries WHERE {sql_where}", tuple(params))["n"]
    offset = (max(1, page) - 1) * page_size
    rows = query(
        f"SELECT * FROM enquiries WHERE {sql_where} ORDER BY COALESCE(last_inbound_at, created_at) ASC, id "
        f"LIMIT %s OFFSET %s",
        (*params, int(page_size), int(offset)),
    )
    return {"items": rows, "total": int(total), "page": page, "page_size": page_size}


def counts() -> dict:
    rows = query("SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status")
    out = {s: 0 for s in STATUSES}
    for r in rows:
        out[r["status"]] = int(r["n"])
    out["waiting"] = out["open"] + out["replied"]
    return out
