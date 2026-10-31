"""Account management: creation with temporary passwords, authentication, resets."""

from __future__ import annotations

import hmac
import secrets

from werkzeug.security import check_password_hash, generate_password_hash

from src.models import user as user_model
from src.utils.logging import setup_logger

logger = setup_logger("users")

# A hash to run when the email is unknown, so a wrong email costs the same as
# a wrong password.
_DUMMY_HASH = generate_password_hash("not-a-real-password")

PASSWORD_MIN_LENGTH = 10


class UserError(ValueError):
    pass


def generate_temp_password() -> str:
    """Readable but strong: four lowercase groups and a number, e.g. 'tulip-forge-apron-92'."""
    words = [secrets.token_hex(3) for _ in range(3)]
    return "-".join(words) + f"-{secrets.randbelow(90) + 10}"


def validate_password(password: str) -> None:
    if not password or len(password) < PASSWORD_MIN_LENGTH:
        raise UserError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters.")
    if password.lower() in {"password", "farmyard", "farmyardpark"}:
        raise UserError("Choose a less obvious password.")


def create_user(email: str, full_name: str, role: str, password: str | None = None) -> tuple[dict, str]:
    """Create a user. Returns (public user, the password that was set)."""
    email = (email or "").strip().lower()
    if "@" not in email:
        raise UserError("A valid email address is required.")
    if role not in user_model.ROLES:
        raise UserError(f"Role must be one of {', '.join(user_model.ROLES)}.")
    if user_model.get_by_email(email):
        raise UserError("A user with that email already exists.")
    temp = password or generate_temp_password()
    user_id = user_model.insert(
        email, full_name or email, role, generate_password_hash(temp), must_change=password is None
    )
    logger.info(f"Created user {email} ({role})")
    return user_model.public(user_model.get_by_id(user_id)), temp


def authenticate(email: str, password: str) -> dict | None:
    row = user_model.get_by_email(email or "")
    if row is None or not row.get("is_active"):
        check_password_hash(_DUMMY_HASH, password or "")
        return None
    if not check_password_hash(row["password_hash"], password or ""):
        return None
    # compare_digest keeps the email comparison constant time too.
    if not hmac.compare_digest(row["email"], (email or "").strip().lower()):
        return None
    user_model.touch_login(row["id"])
    return row


def change_password(user_id: int, current_password: str, new_password: str) -> None:
    row = user_model.get_by_id(user_id)
    if row is None or not check_password_hash(row["password_hash"], current_password or ""):
        raise UserError("Current password is incorrect.")
    validate_password(new_password)
    if check_password_hash(row["password_hash"], new_password):
        raise UserError("The new password must differ from the current one.")
    user_model.update(user_id, password_hash=generate_password_hash(new_password), must_change_password=0)
    logger.info(f"Password changed for user id {user_id}")


def reset_password(user_id: int) -> str:
    row = user_model.get_by_id(user_id)
    if row is None:
        raise UserError("User not found.")
    temp = generate_temp_password()
    user_model.update(user_id, password_hash=generate_password_hash(temp), must_change_password=1)
    logger.info(f"Password reset for user id {user_id}")
    return temp


def update_user(user_id: int, *, full_name: str | None = None, role: str | None = None, is_active: bool | None = None) -> dict:
    fields = {}
    if full_name is not None:
        fields["full_name"] = full_name.strip()
    if role is not None:
        if role not in user_model.ROLES:
            raise UserError("Invalid role.")
        fields["role"] = role
    if is_active is not None:
        fields["is_active"] = int(bool(is_active))
    user_model.update(user_id, **fields)
    return user_model.public(user_model.get_by_id(user_id))
