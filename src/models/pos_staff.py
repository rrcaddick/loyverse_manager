"""Persistence for self-managed POS staff (migration 007).

Tables: pos_auth_params (site PIN-hash parameters), pos_roles, pos_employees, pos_devices
(enrolled terminals) and pos_employee_events (append-only audit trail from the terminals).
No hashing or policy lives here; see ``src/services/pos_staff.py``.
"""

import json
from datetime import datetime

from src.repositories.mysql import get_db_connection


def _json(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


class PosAuthParams:
    """The single row describing how PINs are hashed. Created once, never changed in place
    (changing it would invalidate every stored hash)."""

    @classmethod
    def get(cls):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_auth_params WHERE id = 1")
                return cursor.fetchone()

    @classmethod
    def create(cls, algorithm, salt_hex, iterations, key_length):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO pos_auth_params (id, algorithm, salt_hex, iterations, key_length)
                    VALUES (1, %s, %s, %s, %s)
                    """,
                    (algorithm, salt_hex, iterations, key_length),
                )
            conn.commit()
        return cls.get()


class PosRole:
    @classmethod
    def all(cls):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_roles ORDER BY name")
                rows = cursor.fetchall()
        for row in rows:
            row["permissions"] = _json(row["permissions"]) or []
        return rows

    @classmethod
    def get(cls, role_id):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_roles WHERE id = %s", (role_id,))
                row = cursor.fetchone()
        if row:
            row["permissions"] = _json(row["permissions"]) or []
        return row

    @classmethod
    def get_by_name(cls, name):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_roles WHERE name = %s", (name,))
                row = cursor.fetchone()
        if row:
            row["permissions"] = _json(row["permissions"]) or []
        return row

    @classmethod
    def create(cls, name, description, permissions):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO pos_roles (name, description, permissions) VALUES (%s, %s, %s)",
                    (name, description, json.dumps(sorted(permissions))),
                )
                role_id = cursor.lastrowid
            conn.commit()
        return cls.get(role_id)

    @classmethod
    def update(cls, role_id, name=None, description=None, permissions=None):
        sets, params = [], []
        if name is not None:
            sets.append("name = %s")
            params.append(name)
        if description is not None:
            sets.append("description = %s")
            params.append(description)
        if permissions is not None:
            sets.append("permissions = %s")
            params.append(json.dumps(sorted(permissions)))
        if not sets:
            return cls.get(role_id)
        params.append(role_id)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"UPDATE pos_roles SET {', '.join(sets)} WHERE id = %s", params)
            conn.commit()
        return cls.get(role_id)

    @classmethod
    def delete(cls, role_id):
        """Fails (IntegrityError) while employees still hold the role; that is intended."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("DELETE FROM pos_roles WHERE id = %s", (role_id,))
                deleted = cursor.rowcount
            conn.commit()
        return deleted == 1


class PosEmployee:
    SELECT = """
        SELECT e.id, e.name, e.role_id, r.name AS role_name, r.permissions AS role_permissions,
               e.pin_hash, e.pin_set_at, e.active, e.loyverse_merchant_id, e.created_at, e.updated_at
        FROM pos_employees e
        JOIN pos_roles r ON r.id = e.role_id
    """

    @classmethod
    def _rows(cls, rows):
        for row in rows:
            row["permissions"] = _json(row.pop("role_permissions")) or []
            row["has_pin"] = row["pin_hash"] is not None
        return rows

    @classmethod
    def all(cls, include_inactive=False):
        where = "" if include_inactive else "WHERE e.active = 1"
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"{cls.SELECT} {where} ORDER BY e.name")
                rows = cursor.fetchall()
        return cls._rows(rows)

    @classmethod
    def get(cls, employee_id):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"{cls.SELECT} WHERE e.id = %s", (employee_id,))
                row = cursor.fetchone()
        return cls._rows([row])[0] if row else None

    @classmethod
    def get_by_pin_hash(cls, pin_hash):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"{cls.SELECT} WHERE e.pin_hash = %s", (pin_hash,))
                row = cursor.fetchone()
        return cls._rows([row])[0] if row else None

    @classmethod
    def create(cls, name, role_id, pin_hash=None, loyverse_merchant_id=None):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO pos_employees (name, role_id, pin_hash, pin_set_at, loyverse_merchant_id)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        name,
                        role_id,
                        pin_hash,
                        datetime.now() if pin_hash else None,
                        loyverse_merchant_id,
                    ),
                )
                employee_id = cursor.lastrowid
            conn.commit()
        return cls.get(employee_id)

    @classmethod
    def update(cls, employee_id, name=None, role_id=None, active=None, loyverse_merchant_id=None):
        sets, params = [], []
        if name is not None:
            sets.append("name = %s")
            params.append(name)
        if role_id is not None:
            sets.append("role_id = %s")
            params.append(role_id)
        if active is not None:
            sets.append("active = %s")
            params.append(1 if active else 0)
        if loyverse_merchant_id is not None:
            sets.append("loyverse_merchant_id = %s")
            params.append(loyverse_merchant_id)
        if not sets:
            return cls.get(employee_id)
        params.append(employee_id)
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(f"UPDATE pos_employees SET {', '.join(sets)} WHERE id = %s", params)
            conn.commit()
        return cls.get(employee_id)

    @classmethod
    def set_pin_hash(cls, employee_id, pin_hash):
        """None clears the PIN (the employee can no longer log in)."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE pos_employees SET pin_hash = %s, pin_set_at = %s WHERE id = %s",
                    (pin_hash, datetime.now() if pin_hash else None, employee_id),
                )
                updated = cursor.rowcount
            conn.commit()
        return updated == 1

    @classmethod
    def roster(cls):
        """Active employees that can log in, with their role's permissions."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"{cls.SELECT} WHERE e.active = 1 AND e.pin_hash IS NOT NULL ORDER BY e.id"
                )
                rows = cursor.fetchall()
        return cls._rows(rows)


class PosDevice:
    @classmethod
    def all(cls):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_devices ORDER BY device_id")
                return cursor.fetchall()

    @classmethod
    def get_by_device_id(cls, device_id):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_devices WHERE device_id = %s", (device_id,))
                return cursor.fetchone()

    @classmethod
    def enrol(cls, device_id, secret_hex, note=""):
        """Insert, or re-key an existing device (its old secret stops working at once)."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO pos_devices (device_id, secret_hex, note, active, enrolled_at)
                    VALUES (%s, %s, %s, 1, %s)
                    ON DUPLICATE KEY UPDATE secret_hex = VALUES(secret_hex), note = VALUES(note),
                                            active = 1, enrolled_at = VALUES(enrolled_at),
                                            roster_version = NULL
                    """,
                    (device_id, secret_hex, note, datetime.now()),
                )
            conn.commit()
        return cls.get_by_device_id(device_id)

    @classmethod
    def set_active(cls, device_id, active):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "UPDATE pos_devices SET active = %s WHERE device_id = %s",
                    (1 if active else 0, device_id),
                )
                updated = cursor.rowcount
            conn.commit()
        return updated == 1

    @classmethod
    def touch(cls, device_id, roster_version=None):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                if roster_version is None:
                    cursor.execute(
                        "UPDATE pos_devices SET last_seen_at = %s WHERE device_id = %s",
                        (datetime.now(), device_id),
                    )
                else:
                    cursor.execute(
                        "UPDATE pos_devices SET last_seen_at = %s, roster_version = %s WHERE device_id = %s",
                        (datetime.now(), roster_version, device_id),
                    )
            conn.commit()


class PosEmployeeEvent:
    @classmethod
    def record(cls, event_uuid, device_id, employee_id, employee_name, event, detail, occurred_at, received_at):
        """Append one event; a repeat of the same event_uuid (outbox retry) is ignored."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT IGNORE INTO pos_employee_events
                    (event_uuid, device_id, employee_id, employee_name, event, detail, occurred_at, received_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        event_uuid,
                        device_id,
                        employee_id,
                        employee_name,
                        event,
                        json.dumps(detail) if detail is not None else None,
                        occurred_at,
                        received_at,
                    ),
                )
                inserted = cursor.rowcount
            conn.commit()
        return inserted == 1

    @classmethod
    def recent(cls, limit=200, employee_id=None, device_id=None, event=None, since=None):
        where, params = [], []
        if employee_id is not None:
            where.append("employee_id = %s")
            params.append(employee_id)
        if device_id is not None:
            where.append("device_id = %s")
            params.append(device_id)
        if event is not None:
            where.append("event = %s")
            params.append(event)
        if since is not None:
            where.append("occurred_at >= %s")
            params.append(since)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        params.append(int(limit))
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    f"SELECT * FROM pos_employee_events {clause} ORDER BY occurred_at DESC, id DESC LIMIT %s",
                    params,
                )
                rows = cursor.fetchall()
        for row in rows:
            row["detail"] = _json(row["detail"])
        return rows


class PosReductionReport:
    """Raw material for the reductions report: ticket versions and the staff events around them."""

    @classmethod
    def ticket_versions(cls, since, until):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT ticket_id, event_type, receipt_json, observed_at
                    FROM open_tickets_history
                    WHERE observed_at BETWEEN %s AND %s AND receipt_json IS NOT NULL
                    ORDER BY ticket_id, observed_at, id
                    """,
                    (since, until),
                )
                rows = cursor.fetchall()
        for row in rows:
            row["receipt_json"] = _json(row["receipt_json"])
        return rows

    @classmethod
    def staff_events(cls, since, until):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT * FROM pos_employee_events
                    WHERE occurred_at BETWEEN %s AND %s
                      AND event IN ('sale', 'ticket_reduced', 'ticket_replaced')
                    ORDER BY occurred_at, id
                    """,
                    (since, until),
                )
                rows = cursor.fetchall()
        for row in rows:
            row["detail"] = _json(row["detail"])
        return rows

