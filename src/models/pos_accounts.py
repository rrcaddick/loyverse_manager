"""Which Loyverse account a terminal row belongs to, and the scope every query runs in.

Each patched terminal tags its requests with the Loyverse owner id of the account it is signed
into (header ``X-Loyverse-Account``; the registration and roster calls add the business name and
e-mail). The bridge auth binds that id to the request; outside a terminal request (web pages,
scheduled reports, the CLI) the scope is the *live* account, the one whose e-mail matches the
merchant behind this back office's Loyverse API token (``src/services/pos_accounts.py`` keeps the
``live`` flag current), or an explicit ``scope(...)``. Models call ``account_clause`` on reads and
``account_value`` on writes, so a training terminal only ever sees and touches its own rows.
"""
import contextlib
import contextvars
import time
from datetime import datetime

from src.repositories.mysql import get_db_connection

# Tables that carry a terminal's rows (and so an account_id).
ACCOUNT_TABLES = (
    "open_tickets_current",
    "open_tickets_history",
    "pos_employee_events",
    "pos_refund_disputes",
    "pos_group_conversions",
    "pos_group_payments",
)

_REQUEST_KEY = "pos_account"
_override = contextvars.ContextVar("pos_account_scope", default=None)
_LIVE_CACHE_SECONDS = 30
_live_cache = {"at": 0.0, "id": None}


def normalise_account_id(value):
    """The owner id as the terminals send it: decimal digits, else ''."""
    text = str(value or "").strip()
    return text[:32] if text.isdigit() else ""


def bind_request(account_id):
    """Called by the bridge auth: the account the current terminal request belongs to ('' = untagged)."""
    from flask import g

    g.pos_account = normalise_account_id(account_id)


@contextlib.contextmanager
def scope(account_id):
    """Run a block in a given account's scope; ``scope(None)`` means every account."""
    token = _override.set("" if account_id is None else normalise_account_id(account_id) or "")
    try:
        yield
    finally:
        _override.reset(token)


def current_account():
    """The account id rows are read and written for, or None for no filter at all:
    the terminal's own in a bridge request, an explicit ``scope``, else the live account."""
    try:
        from flask import g, has_request_context

        if has_request_context() and _REQUEST_KEY in g:
            return g.get(_REQUEST_KEY) or ""
    except ImportError:  # the CLI has no Flask on its path only in theory; be safe
        pass
    override = _override.get()
    if override is not None:
        return override or None
    return PosAccount.live_id()


def account_value():
    """What a new row is stamped with."""
    return current_account() or ""


def account_clause(alias=""):
    """``(" AND [alias.]account_id = %s", [id])`` for the current scope, or ``("", [])`` when unfiltered."""
    account = current_account()
    if account is None:
        return "", []
    column = f"{alias}.account_id" if alias else "account_id"
    return f" AND {column} = %s", [account]


class PosAccount:
    @classmethod
    def all(cls):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_accounts ORDER BY live DESC, last_seen_at DESC")
                return cursor.fetchall()

    @classmethod
    def get(cls, account_id):
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT * FROM pos_accounts WHERE account_id = %s", (account_id,))
                return cursor.fetchone()

    @classmethod
    def seen(cls, account_id, business_name="", email=""):
        """A terminal reported being signed into this account."""
        now = datetime.now()
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO pos_accounts (account_id, business_name, email, first_seen_at, last_seen_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON DUPLICATE KEY UPDATE
                        business_name = IF(VALUES(business_name) = '', business_name, VALUES(business_name)),
                        email = IF(VALUES(email) = '', email, VALUES(email)),
                        last_seen_at = VALUES(last_seen_at)
                    """,
                    (account_id, (business_name or "")[:255], (email or "")[:160], now, now),
                )
            conn.commit()

    @classmethod
    def set_live(cls, account_id):
        """Mark one account live (None = none); the cached answer is dropped."""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("UPDATE pos_accounts SET live = 0 WHERE live = 1 AND account_id <> %s", (account_id or "",))
                if account_id:
                    cursor.execute("UPDATE pos_accounts SET live = 1 WHERE account_id = %s", (account_id,))
            conn.commit()
        _live_cache.update(at=0.0, id=None)

    @classmethod
    def live_id(cls):
        """The live account's id, or None when none is marked (cached briefly)."""
        now = time.monotonic()
        if now - _live_cache["at"] < _LIVE_CACHE_SECONDS:
            return _live_cache["id"]
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT account_id FROM pos_accounts WHERE live = 1 LIMIT 1")
                    row = cursor.fetchone()
        except Exception:  # a DB hiccup must not turn into an unfiltered query; keep the last answer
            return _live_cache["id"]
        _live_cache.update(at=now, id=row["account_id"] if row else None)
        return _live_cache["id"]

    @classmethod
    def counts(cls):
        """Row counts per account per table, plus the devices reporting each account."""
        result = {}
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                for table in ACCOUNT_TABLES:
                    cursor.execute(f"SELECT account_id, COUNT(*) AS n FROM {table} GROUP BY account_id")
                    for row in cursor.fetchall():
                        result.setdefault(row["account_id"], {})[table] = int(row["n"])
                cursor.execute("SELECT account_id, device_id FROM pos_devices WHERE active = 1 ORDER BY device_id")
                for row in cursor.fetchall():
                    result.setdefault(row["account_id"], {}).setdefault("devices", []).append(row["device_id"])
        return result

    @classmethod
    def purge(cls, account_id):
        """Delete every terminal row of one account ('' = the untagged rows). Returns counts per table."""
        deleted = {}
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                for table in ACCOUNT_TABLES:
                    cursor.execute(f"DELETE FROM {table} WHERE account_id = %s", (account_id,))
                    deleted[table] = cursor.rowcount
            conn.commit()
        return deleted

    @classmethod
    def adopt_untagged(cls, account_id):
        """Tag the rows terminals wrote before they sent an account (older builds) as this account's."""
        changed = {}
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                for table in ACCOUNT_TABLES:
                    cursor.execute(f"UPDATE {table} SET account_id = %s WHERE account_id = ''", (account_id,))
                    changed[table] = cursor.rowcount
                cursor.execute("UPDATE pos_devices SET account_id = %s WHERE account_id = ''", (account_id,))
                changed["pos_devices"] = cursor.rowcount
            conn.commit()
        return changed
