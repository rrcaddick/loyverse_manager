"""The learned list of senders whose mail is never a booking
(``mail_ignored_senders``, migrations/010-ignored-senders.sql).

    normalise("Receipts@Messaging.Yoco.co.za")  -> ("receipts@messaging.yoco.co.za", "address")
    normalise("@mcsv.net")                       -> ("mcsv.net", "domain")
    matches("x@mail.mcsv.net")                   -> the domain row (suffix match) or None

A domain rule matches the exact host and every subdomain of it. The ingest
treats a match like a certain automated layer (docs/handoff/waiting-v3.md):
dropped unless the message belongs to a booking.
"""

from __future__ import annotations

import re
from typing import Any

from src.models.base import execute, query, query_one, serialize_row

KINDS = ("address", "domain")

_ADDRESS_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_HOST_RE = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")


def normalise(pattern: str | None) -> tuple[str, str]:
    """``name@host`` → (address, "address"); ``@host`` or ``host`` → (host, "domain").

    Lower-cased and trimmed. Raises ValueError for anything else.
    """
    text = (pattern or "").strip().lower()
    if not text:
        raise ValueError("A pattern is required")
    if text.startswith("@"):
        host = text[1:]
        if not _HOST_RE.match(host):
            raise ValueError("A domain pattern looks like @example.com")
        return host, "domain"
    if "@" in text:
        if not _ADDRESS_RE.match(text):
            raise ValueError("An address pattern looks like name@example.com")
        return text, "address"
    if _HOST_RE.match(text):
        return text, "domain"
    raise ValueError("Use name@example.com or @example.com")


def to_api(row: dict | None) -> dict | None:
    if row is None:
        return None
    r = serialize_row(row) or {}
    return {
        "id": int(r["id"]),
        "pattern": r["pattern"] if r.get("kind") == "address" else f"@{r['pattern']}",
        "kind": r.get("kind"),
        "reason": r.get("reason"),
        "created_by": r.get("created_by"),
        "created_at": r.get("created_at"),
    }


# ------------------------------------------------------------------ reads ---


def list_all() -> list[dict]:
    return query("SELECT * FROM mail_ignored_senders ORDER BY kind, pattern")


def get(rule_id: int) -> dict | None:
    return query_one("SELECT * FROM mail_ignored_senders WHERE id = %s", (int(rule_id),))


def get_by_pattern(pattern: str) -> dict | None:
    normalised, _kind = normalise(pattern)
    return query_one("SELECT * FROM mail_ignored_senders WHERE pattern = %s", (normalised,))


def rule_matches(rule: dict, address: str | None) -> bool:
    """Pure: does one rule cover ``address``?"""
    addr = (address or "").strip().lower()
    if not addr or "@" not in addr:
        return False
    pattern = (rule.get("pattern") or "").lower()
    if rule.get("kind") == "address":
        return addr == pattern
    domain = addr.rsplit("@", 1)[1]
    return domain == pattern or domain.endswith("." + pattern)


def matches(address: str | None, rules: list[dict] | None = None) -> dict | None:
    """The first rule covering ``address`` (exact address, or domain suffix),
    else None. Pass ``rules`` (``list_all()``) to avoid a query per call."""
    if not address or "@" not in address:
        return None
    for rule in rules if rules is not None else list_all():
        if rule_matches(rule, address):
            return rule
    return None


# ----------------------------------------------------------------- writes ---


def add(pattern: str, reason: str | None = None, created_by: int | None = None) -> dict:
    """Insert (or return the existing) rule for ``pattern``."""
    normalised, kind = normalise(pattern)
    existing = query_one("SELECT * FROM mail_ignored_senders WHERE pattern = %s", (normalised,))
    if existing:
        return existing
    rule_id = execute(
        "INSERT INTO mail_ignored_senders (pattern, kind, reason, created_by) VALUES (%s, %s, %s, %s)",
        (normalised, kind, (reason or None), created_by),
    )
    return get(int(rule_id)) or {"id": rule_id, "pattern": normalised, "kind": kind, "reason": reason}


def delete(rule_id: int) -> int:
    return execute("DELETE FROM mail_ignored_senders WHERE id = %s", (int(rule_id),))


__all__: list[str] = [name for name in dir() if not name.startswith("_") and name not in ("Any",)]
