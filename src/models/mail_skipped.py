"""The log of inbox mail the automated filter stopped (migration 011).
Headers only, never the mail: the message stays in Gmail untouched."""

from __future__ import annotations

from datetime import datetime, timedelta

from src.models.base import execute, query, query_one


def record(
    gmail_msgid: int | None, gmail_thrid: int | None, gmail_uid: int | None, from_email: str | None,
    from_name: str | None, subject: str | None, sent_at: datetime | None, grade: str, reason: str,
) -> int | None:
    if not gmail_msgid:
        return None
    return execute(
        """
        INSERT INTO mail_skipped (gmail_msgid, gmail_thrid, gmail_uid, from_email, from_name, subject, sent_at, grade, reason)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON DUPLICATE KEY UPDATE reason = VALUES(reason), grade = VALUES(grade), gmail_uid = VALUES(gmail_uid)
        """,
        (int(gmail_msgid), gmail_thrid, gmail_uid, (from_email or "")[:255] or None, (from_name or "")[:255] or None,
         (subject or "")[:500] or None, sent_at, grade, reason[:255]),
    )


def get(skipped_id: int) -> dict | None:
    return query_one("SELECT * FROM mail_skipped WHERE id = %s", (int(skipped_id),))


def list_recent(days: int = 7, include_rescued: bool = False) -> list[dict]:
    since = datetime.now() - timedelta(days=int(days))
    where = "created_at >= %s" + ("" if include_rescued else " AND rescued_at IS NULL")
    return query(f"SELECT * FROM mail_skipped WHERE {where} ORDER BY COALESCE(sent_at, created_at) DESC", (since,))


def count_recent(days: int = 7) -> int:
    since = datetime.now() - timedelta(days=int(days))
    return int(query_one("SELECT COUNT(*) AS n FROM mail_skipped WHERE created_at >= %s AND rescued_at IS NULL", (since,))["n"])


def mark_rescued(skipped_id: int, actor: int | None) -> None:
    execute(
        "UPDATE mail_skipped SET rescued_at = %s, rescued_by = %s WHERE id = %s",
        (datetime.now().replace(microsecond=0), actor, int(skipped_id)),
    )
