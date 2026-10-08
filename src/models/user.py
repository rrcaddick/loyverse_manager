"""Users of the admin portal. Roles: admin (everything) and manager (calendar + day view)."""

from __future__ import annotations

from src.models.base import execute, query, query_one, serialize_row

ROLES = ("admin", "manager")

PUBLIC_FIELDS = (
    "id",
    "email",
    "full_name",
    "role",
    "must_change_password",
    "is_active",
    "last_login_at",
    "created_at",
)


def _public(row: dict | None) -> dict | None:
    if row is None:
        return None
    out = serialize_row({k: row.get(k) for k in PUBLIC_FIELDS})
    out["must_change_password"] = bool(out["must_change_password"])
    out["is_active"] = bool(out["is_active"])
    return out


def get_by_id(user_id: int) -> dict | None:
    return query_one("SELECT * FROM users WHERE id = %s", (user_id,))


def get_by_email(email: str) -> dict | None:
    return query_one("SELECT * FROM users WHERE email = %s", (email.strip().lower(),))


def list_users() -> list[dict]:
    rows = query("SELECT * FROM users ORDER BY role, full_name")
    return [_public(r) for r in rows]


def public(row: dict | None) -> dict | None:
    return _public(row)


def insert(email: str, full_name: str, role: str, password_hash: str, must_change: bool) -> int:
    return execute(
        """
        INSERT INTO users (email, full_name, role, password_hash, must_change_password)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (email.strip().lower(), full_name.strip(), role, password_hash, int(must_change)),
    )


def update(user_id: int, **fields) -> None:
    allowed = {"full_name", "role", "is_active", "password_hash", "must_change_password"}
    cols = {k: v for k, v in fields.items() if k in allowed}
    if not cols:
        return
    assignments = ", ".join(f"{k} = %s" for k in cols)
    execute(f"UPDATE users SET {assignments} WHERE id = %s", (*cols.values(), user_id))


def touch_login(user_id: int) -> None:
    execute("UPDATE users SET last_login_at = NOW() WHERE id = %s", (user_id,))
