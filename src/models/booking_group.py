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


def add_alias(group_id: int, name: str, conn=None) -> bool:
    n = (name or "").strip()
    if not n:
        return False
    return execute("INSERT IGNORE INTO booking_group_aliases (group_id, name) VALUES (%s, %s)", (int(group_id), n[:255]), conn=conn) > 0


def aliases(group_id: int, conn=None) -> list[str]:
    return [r["name"] for r in query("SELECT name FROM booking_group_aliases WHERE group_id = %s ORDER BY id", (int(group_id),), conn=conn)]


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
    """Groups by name, alias, a booking's name, reference or contact; newest visit first."""
    text = (q or "").strip()
    like = f"%{text}%"
    return query(
        """
        SELECT g.id, g.name, g.group_type, g.area,
               COUNT(b.id) AS bookings,
               MAX(b.visit_date) AS last_visit_date,
               SUBSTRING_INDEX(GROUP_CONCAT(b.reference ORDER BY b.visit_date DESC, b.id DESC SEPARATOR ','), ',', 1) AS last_reference
        FROM booking_groups g
        LEFT JOIN bookings b ON b.group_id = g.id
        WHERE %s = 1 OR g.name LIKE %s
           OR EXISTS (SELECT 1 FROM booking_group_aliases a WHERE a.group_id = g.id AND a.name LIKE %s)
           OR EXISTS (SELECT 1 FROM bookings x WHERE x.group_id = g.id AND (x.group_name LIKE %s OR x.reference LIKE %s OR x.contact_name LIKE %s))
        GROUP BY g.id
        ORDER BY last_visit_date DESC, g.name
        LIMIT %s
        """,
        (0 if text else 1, like, like, like, like, like, int(limit)),
    )
