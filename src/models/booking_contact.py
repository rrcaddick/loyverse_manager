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
                "UPDATE booking_contacts SET name = COALESCE(%s, name), mobile = COALESCE(%s, mobile), role = IF(%s = 'primary', 'primary', role) WHERE id = %s",
                (name, mobile, role, existing["id"]),
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


def upsert_primary_without_email(booking_id: int, *, name: str | None, mobile: str | None, source: str = "booking") -> bool:
    """The booking's own contact when it has no email address (migration 015
    made email optional): one primary row with a NULL email. True when new."""
    existing = query_one(
        "SELECT id FROM booking_contacts WHERE booking_id = %s AND role = 'primary' AND email IS NULL", (int(booking_id),)
    )
    if existing:
        execute("UPDATE booking_contacts SET name = %s, mobile = %s WHERE id = %s", (name, mobile, existing["id"]))
        return False
    execute(
        "INSERT INTO booking_contacts (booking_id, email, name, mobile, role, source) VALUES (%s, NULL, %s, %s, 'primary', %s)",
        (int(booking_id), name, mobile, source),
    )
    return True


def adopt_email_on_primary(booking_id: int, email: str, *, name: str | None, mobile: str | None) -> bool:
    """The booking's own contact gained an email address. Put it on the primary
    row that had none, or, when a row with that address already exists (a
    learned contact), promote that row and fold the address-less one into it,
    keeping "on site". True when a row was merged or adopted."""
    address = (email or "").strip().lower()
    if not address:
        return False
    blank = query_one(
        "SELECT id, on_site FROM booking_contacts WHERE booking_id = %s AND role = 'primary' AND email IS NULL",
        (int(booking_id),),
    )
    if not blank:
        return False
    same = query_one("SELECT id FROM booking_contacts WHERE booking_id = %s AND email = %s", (int(booking_id), address))
    if same:
        execute(
            "UPDATE booking_contacts SET role = 'primary', source = 'booking', name = COALESCE(%s, name), "
            "mobile = COALESCE(%s, mobile), on_site = GREATEST(on_site, %s) WHERE id = %s",
            (name, mobile, int(blank["on_site"] or 0), same["id"]),
        )
        execute("DELETE FROM booking_contacts WHERE id = %s", (blank["id"],))
    else:
        execute(
            "UPDATE booking_contacts SET email = %s, name = COALESCE(%s, name), mobile = COALESCE(%s, mobile) WHERE id = %s",
            (address, name, mobile, blank["id"]),
        )
    return True


def dedupe_primary_rows() -> int:
    """Every booking with both an address-less primary row and a row for its
    own address: fold them together (the state the migration of 30 Oct 2026
    left behind). Returns the number of bookings touched."""
    rows = query(
        """
        SELECT b.id, b.contact_email, b.contact_name, b.contact_mobile
        FROM bookings b
        WHERE b.contact_email IS NOT NULL
          AND EXISTS (SELECT 1 FROM booking_contacts c WHERE c.booking_id = b.id AND c.role = 'primary' AND c.email IS NULL)
        """
    )
    touched = 0
    for r in rows:
        if adopt_email_on_primary(int(r["id"]), r["contact_email"], name=r.get("contact_name"), mobile=r.get("contact_mobile")):
            touched += 1
    return touched


def update(booking_id: int, contact_id: int, *, name: str | None = None, mobile: str | None = None,
           on_site: bool | None = None, role: str | None = None, email: str | None = None) -> int:
    """Edit a contact's name, mobile, email or role, or mark it as the one on
    site on the day (which clears the flag on the booking's other contacts)."""
    sets: list[str] = []
    args: list = []
    if name is not None:
        sets.append("name = %s"); args.append(name.strip() or None)
    if mobile is not None:
        sets.append("mobile = %s"); args.append(mobile.strip() or None)
    if email is not None:
        sets.append("email = %s"); args.append(email.strip().lower())
    if role is not None:
        sets.append("role = %s"); args.append(role)
    if on_site is not None:
        if on_site:
            execute("UPDATE booking_contacts SET on_site = 0 WHERE booking_id = %s", (int(booking_id),))
        sets.append("on_site = %s"); args.append(1 if on_site else 0)
    if not sets:
        return 0
    args.extend([int(booking_id), int(contact_id)])
    return execute(f"UPDATE booking_contacts SET {', '.join(sets)} WHERE booking_id = %s AND id = %s", tuple(args))


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
        UNION SELECT email FROM booking_contacts WHERE booking_id = %s AND email IS NOT NULL
        """,
        (int(booking_id), int(booking_id)),
    )
    return {r["e"] for r in rows if r.get("e")}
