"""People attached to a booking beyond the primary contact (migration 011)."""

from __future__ import annotations

from src.models.base import execute, query, query_one


def list_for_booking(booking_id: int) -> list[dict]:
    return query(
        "SELECT * FROM booking_contacts WHERE booking_id = %s ORDER BY role = 'primary' DESC, id",
        (int(booking_id),),
    )


def upsert(booking_id: int, email: str, *, name: str | None = None, mobile: str | None = None,
           role: str = "learned", source: str | None = None) -> bool:
    """True when the row was new."""
    address = (email or "").strip().lower()
    if not address:
        return False
    existing = query_one(
        "SELECT id FROM booking_contacts WHERE booking_id = %s AND email = %s", (int(booking_id), address)
    )
    if existing:
        if name or mobile:
            execute(
                "UPDATE booking_contacts SET name = COALESCE(%s, name), mobile = COALESCE(%s, mobile) WHERE id = %s",
                (name, mobile, existing["id"]),
            )
        return False
    execute(
        "INSERT INTO booking_contacts (booking_id, email, name, mobile, role, source) VALUES (%s, %s, %s, %s, %s, %s)",
        (int(booking_id), address, name, mobile, role, source),
    )
    others = query(
        "SELECT booking_id FROM booking_contacts WHERE email = %s AND booking_id <> %s", (address, int(booking_id))
    )
    if others:
        execute("UPDATE booking_contacts SET shared = 1 WHERE email = %s", (address,))
    return True


def delete(booking_id: int, contact_id: int) -> int:
    return execute("DELETE FROM booking_contacts WHERE id = %s AND booking_id = %s", (int(contact_id), int(booking_id)))


def bookings_for_address(address: str, statuses: tuple[str, ...] | None = None) -> list[dict]:
    """Bookings that know this address: as primary contact or as a contact row."""
    a = (address or "").strip().lower()
    if not a:
        return []
    where = ""
    params: list = [a, a]
    if statuses:
        where = f" AND b.status IN ({','.join(['%s'] * len(statuses))})"
        params += list(statuses)
    return query(
        f"""
        SELECT DISTINCT b.id, b.reference, b.doc_number, b.group_name, b.contact_name, b.contact_email,
               b.contact_mobile, b.visit_date, b.status, b.enquiry_date, b.email_thread_id
        FROM bookings b
        LEFT JOIN booking_contacts c ON c.booking_id = b.id
        WHERE (LOWER(b.contact_email) = %s OR c.email = %s){where}
        ORDER BY b.visit_date, b.id
        """,
        tuple(params),
    )


def addresses_for_booking(booking_id: int) -> set[str]:
    rows = query(
        """
        SELECT LOWER(contact_email) AS e FROM bookings WHERE id = %s AND contact_email IS NOT NULL
        UNION SELECT email FROM booking_contacts WHERE booking_id = %s
        """,
        (int(booking_id), int(booking_id)),
    )
    return {r["e"] for r in rows if r.get("e")}
