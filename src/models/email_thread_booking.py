"""Which bookings a conversation belongs to (migration 030).

One thread, several bookings: the Potters House contact writes once about
nine congregations' visits. ``email_threads.booking_id`` stays the home
booking; this table carries every booking the conversation concerns.
"""

from __future__ import annotations

from src.models.base import execute, query

CHIP_COLS = "b.id, b.reference, b.group_name, b.status, b.visit_date, b.contact_name"


def link(gmail_thrid: int, booking_id: int, method: str | None = None, conn=None) -> bool:
    return execute(
        "INSERT IGNORE INTO email_thread_bookings (gmail_thrid, booking_id, method) VALUES (%s, %s, %s)",
        (int(gmail_thrid), int(booking_id), (method or None) and str(method)[:30]),
        conn=conn,
    ) > 0


def link_many(gmail_thrid: int, booking_ids, method: str | None = None, conn=None) -> int:
    return sum(1 for b in booking_ids if link(gmail_thrid, int(b), method, conn=conn))


def unlink(gmail_thrid: int, booking_id: int, conn=None) -> int:
    return execute("DELETE FROM email_thread_bookings WHERE gmail_thrid = %s AND booking_id = %s", (int(gmail_thrid), int(booking_id)), conn=conn)


def unlink_all(gmail_thrid: int, conn=None) -> int:
    return execute("DELETE FROM email_thread_bookings WHERE gmail_thrid = %s", (int(gmail_thrid),), conn=conn)


def booking_ids_for_thread(gmail_thrid: int, conn=None) -> list[int]:
    return [int(r["booking_id"]) for r in query("SELECT booking_id FROM email_thread_bookings WHERE gmail_thrid = %s ORDER BY linked_at, booking_id", (int(gmail_thrid),), conn=conn)]


def bookings_for_thread(gmail_thrid: int, conn=None) -> list[dict]:
    return query(
        f"""
        SELECT {CHIP_COLS}, l.method FROM email_thread_bookings l JOIN bookings b ON b.id = l.booking_id
        WHERE l.gmail_thrid = %s ORDER BY b.visit_date, b.id
        """,
        (int(gmail_thrid),),
        conn=conn,
    )


def bookings_for_threads(gmail_thrids, conn=None) -> dict[int, list[dict]]:
    ids = sorted({int(t) for t in gmail_thrids if t})
    if not ids:
        return {}
    marks = ",".join(["%s"] * len(ids))
    out: dict[int, list[dict]] = {i: [] for i in ids}
    for r in query(
        f"""
        SELECT l.gmail_thrid, {CHIP_COLS} FROM email_thread_bookings l JOIN bookings b ON b.id = l.booking_id
        WHERE l.gmail_thrid IN ({marks}) ORDER BY b.visit_date, b.id
        """,
        tuple(ids),
        conn=conn,
    ):
        out[int(r["gmail_thrid"])].append(r)
    return out


def thrids_for_booking(booking_id: int, conn=None) -> list[int]:
    return [int(r["gmail_thrid"]) for r in query("SELECT gmail_thrid FROM email_thread_bookings WHERE booking_id = %s", (int(booking_id),), conn=conn)]
