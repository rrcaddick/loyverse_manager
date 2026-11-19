"""Groups: the thing that comes back; a booking is one visit (migration 028).

A group keeps every spelling it has been booked under (aliases); its contacts
are the contacts of its bookings, so linking a booking teaches the group.
"""

from __future__ import annotations

from src.models.base import execute, query, query_one


def insert(name: str, group_type: str | None = None, area: str | None = None, conn=None) -> int:
    return execute(
        "INSERT INTO booking_groups (name, group_type, area) VALUES (%s, %s, %s)",
        (name[:255], group_type, area),
        conn=conn,
    )


def get(group_id: int, conn=None) -> dict | None:
    return query_one("SELECT * FROM booking_groups WHERE id = %s", (int(group_id),), conn=conn)


def update(group_id: int, conn=None, **fields) -> int:
    allowed = {k: v for k, v in fields.items() if k in ("name", "group_type", "area", "notes")}
    if not allowed:
        return 0
    assignments = ", ".join(f"{k} = %s" for k in allowed)
    return execute(f"UPDATE booking_groups SET {assignments} WHERE id = %s", (*allowed.values(), int(group_id)), conn=conn)


def delete(group_id: int, conn=None) -> int:
    return execute("DELETE FROM booking_groups WHERE id = %s", (int(group_id),), conn=conn)


def delete_if_empty(group_id: int, conn=None) -> bool:
    if query_one("SELECT 1 AS x FROM bookings WHERE group_id = %s LIMIT 1", (int(group_id),), conn=conn):
        return False
    return delete(group_id, conn=conn) > 0


def delete_empty(prefix: str | None = None, conn=None) -> int:
    """Groups with no bookings left (test clean-up, the pass script)."""
    where = " AND name LIKE %s" if prefix else ""
    params = (f"{prefix}%",) if prefix else ()
    return execute(
        f"DELETE FROM booking_groups WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.group_id = booking_groups.id){where}",
        params,
        conn=conn,
    )


def add_alias(group_id: int, name: str, *, source: str = "booked", booking_id: int | None = None, selected: bool = False, conn=None) -> int | None:
    """Record a spelling (idempotent on the name). Returns the alias id."""
    n = (name or "").strip()
    if not n:
        return None
    execute(
        "INSERT IGNORE INTO booking_group_aliases (group_id, name, is_selected, source, booking_id) VALUES (%s, %s, %s, %s, %s)",
        (int(group_id), n[:255], 1 if selected else 0, source, booking_id),
        conn=conn,
    )
    row = query_one("SELECT id FROM booking_group_aliases WHERE group_id = %s AND name = %s", (int(group_id), n[:255]), conn=conn)
    if row and booking_id and source == "booked":
        execute("UPDATE booking_group_aliases SET booking_id = COALESCE(booking_id, %s) WHERE id = %s", (int(booking_id), int(row["id"])), conn=conn)
    return int(row["id"]) if row else None


def aliases(group_id: int, conn=None) -> list[dict]:
    """Every spelling with where it came from and how many bookings used it; the selected one first."""
    return query(
        """
        SELECT a.id, a.name, a.is_selected, a.source, a.booking_id, a.created_at,
               b.reference AS booking_reference, b.visit_date AS booking_visit_date,
               (SELECT COUNT(*) FROM bookings x WHERE x.group_id = a.group_id AND x.group_name = a.name) AS bookings
        FROM booking_group_aliases a
        LEFT JOIN bookings b ON b.id = a.booking_id
        WHERE a.group_id = %s
        ORDER BY a.is_selected DESC, a.created_at, a.id
        """,
        (int(group_id),),
        conn=conn,
    )


def alias_names(group_id: int, conn=None) -> list[str]:
    return [r["name"] for r in aliases(group_id, conn=conn)]


def get_alias(alias_id: int, conn=None) -> dict | None:
    return query_one("SELECT * FROM booking_group_aliases WHERE id = %s", (int(alias_id),), conn=conn)


def select_alias(group_id: int, alias_id: int, conn=None) -> bool:
    """Make this spelling the group's name."""
    a = get_alias(alias_id, conn=conn)
    if a is None or int(a["group_id"]) != int(group_id):
        return False
    execute("UPDATE booking_group_aliases SET is_selected = 0 WHERE group_id = %s", (int(group_id),), conn=conn)
    execute("UPDATE booking_group_aliases SET is_selected = 1 WHERE id = %s", (int(alias_id),), conn=conn)
    execute("UPDATE booking_groups SET name = %s WHERE id = %s", (a["name"], int(group_id)), conn=conn)
    return True


def delete_alias(group_id: int, alias_id: int, conn=None) -> bool:
    """Remove a spelling. The selected one cannot go: pick another first."""
    a = get_alias(alias_id, conn=conn)
    if a is None or int(a["group_id"]) != int(group_id) or a.get("is_selected"):
        return False
    return execute("DELETE FROM booking_group_aliases WHERE id = %s", (int(alias_id),), conn=conn) > 0


def bookings(group_id: int, conn=None) -> list[dict]:
    return query("SELECT * FROM bookings WHERE group_id = %s ORDER BY visit_date DESC, id DESC", (int(group_id),), conn=conn)


def set_booking_group(booking_id: int, group_id: int | None, conn=None) -> int:
    return execute("UPDATE bookings SET group_id = %s WHERE id = %s", (group_id, int(booking_id)), conn=conn)


# ------------------------------------------------------------ profiles ---

def all_groups(conn=None) -> list[dict]:
    return query("SELECT id, name, group_type, area FROM booking_groups ORDER BY id", conn=conn)


def all_aliases(conn=None) -> list[dict]:
    return query("SELECT group_id, name FROM booking_group_aliases ORDER BY id", conn=conn)


def linked_bookings(conn=None) -> list[dict]:
    """Every booking that belongs to a group, with the signals a profile needs."""
    return query(
        """
        SELECT id, group_id, reference, doc_number, visit_date, status, people_booked, group_name,
               group_type, area, contact_name, contact_email, contact_mobile
        FROM bookings WHERE group_id IS NOT NULL ORDER BY visit_date DESC, id DESC
        """,
        conn=conn,
    )


def linked_contacts(conn=None) -> list[dict]:
    return query(
        """
        SELECT b.group_id, c.email, c.mobile
        FROM booking_contacts c JOIN bookings b ON b.id = c.booking_id
        WHERE b.group_id IS NOT NULL
        """,
        conn=conn,
    )


def search(q: str | None, limit: int = 20) -> list[dict]:
    """Groups by name, alias, a booking's name, reference, contact name,
    address or number; newest visit first, with the last booking's contact
    (the office's pick prefills it)."""
    text = (q or "").strip()
    like = f"%{text}%"
    return query(
        """
        SELECT g.id, g.name, g.group_type, g.area,
               COUNT(b.id) AS bookings,
               MAX(b.visit_date) AS last_visit_date,
               SUBSTRING_INDEX(GROUP_CONCAT(b.reference ORDER BY b.visit_date DESC, b.id DESC SEPARATOR ','), ',', 1) AS last_reference,
               SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(b.contact_name, '') ORDER BY b.visit_date DESC, b.id DESC SEPARATOR '\n'), '\n', 1) AS last_contact_name,
               SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(b.contact_email, '') ORDER BY b.visit_date DESC, b.id DESC SEPARATOR '\n'), '\n', 1) AS last_contact_email,
               SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(b.contact_mobile, '') ORDER BY b.visit_date DESC, b.id DESC SEPARATOR '\n'), '\n', 1) AS last_contact_mobile
        FROM booking_groups g
        LEFT JOIN bookings b ON b.group_id = g.id
        WHERE %s = 1 OR g.name LIKE %s
           OR EXISTS (SELECT 1 FROM booking_group_aliases a WHERE a.group_id = g.id AND a.name LIKE %s)
           OR EXISTS (SELECT 1 FROM bookings x WHERE x.group_id = g.id
                      AND (x.group_name LIKE %s OR x.reference LIKE %s OR x.contact_name LIKE %s OR x.contact_email LIKE %s OR x.contact_mobile LIKE %s))
           OR EXISTS (SELECT 1 FROM bookings y JOIN booking_contacts c ON c.booking_id = y.id
                      WHERE y.group_id = g.id AND (c.email LIKE %s OR c.mobile LIKE %s OR c.name LIKE %s))
        GROUP BY g.id
        ORDER BY last_visit_date DESC, g.name
        LIMIT %s
        """,
        (0 if text else 1, like, like, like, like, like, like, like, like, like, like, int(limit)),
    )
