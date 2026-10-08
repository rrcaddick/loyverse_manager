"""Users of the admin portal. Roles: admin (everything) and manager (calendar + day view)."""

from __future__ import annotations

from src.models.base import dumps, execute, loads, query, query_one, serialize_row

ROLES = ("admin", "manager")

# Appearance preferences (docs/research/07). Stored as JSON in users.preferences;
# missing keys fall back to these defaults. The frontend owns the theme list,
# so ``theme`` is any slug for now.
PREFERENCE_DEFAULTS = {"theme": "graphite", "mode": "system", "text_size": "large"}
PREFERENCE_MODES = ("light", "dark", "system")
PREFERENCE_TEXT_SIZES = ("default", "large", "xlarge")

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


def preferences(row: dict | None) -> dict:
    """The user's appearance preferences with defaults filled in."""
    stored = loads(row.get("preferences")) if row else None
    merged = dict(PREFERENCE_DEFAULTS)
    if isinstance(stored, dict):
        merged.update({k: v for k, v in stored.items() if k in PREFERENCE_DEFAULTS and v})
    return merged


def _public(row: dict | None) -> dict | None:
    if row is None:
        return None
    out = serialize_row({k: row.get(k) for k in PUBLIC_FIELDS})
    out["must_change_password"] = bool(out["must_change_password"])
    out["is_active"] = bool(out["is_active"])
    out["preferences"] = preferences(row)
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


def update_preferences(user_id: int, changes: dict) -> dict:
    """Merge ``changes`` over the stored preferences JSON; returns the merged dict."""
    row = get_by_id(user_id)
    if row is None:
        raise ValueError("Unknown user")
    merged = preferences(row)
    merged.update({k: v for k, v in changes.items() if k in PREFERENCE_DEFAULTS})
    execute("UPDATE users SET preferences = %s WHERE id = %s", (dumps(merged), user_id))
    return merged


def touch_login(user_id: int) -> None:
    execute("UPDATE users SET last_login_at = NOW() WHERE id = %s", (user_id,))
