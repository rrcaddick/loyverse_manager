"""Thin SQL helpers shared by every model.

Keeps PyMySQL details in one place: DictCursor rows, explicit commits, and a
transaction context manager for multi-statement writes.

    rows = query("SELECT * FROM bookings WHERE status = %s", ("confirmed",))
    row = query_one("SELECT * FROM bookings WHERE id = %s", (booking_id,))
    new_id = execute("INSERT INTO ...", params)          # autocommits
    with transaction() as conn:                          # one commit at the end
        execute("UPDATE ...", params, conn=conn)
        execute("INSERT ...", params, conn=conn)
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterator

import pymysql

from src.repositories.mysql import get_db_connection

Params = tuple | list | dict | None


@contextmanager
def transaction() -> Iterator[pymysql.connections.Connection]:
    """Yield a connection; commit on success, roll back on any exception."""
    with get_db_connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def query(sql: str, params: Params = None, conn=None) -> list[dict]:
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())
    with get_db_connection() as c:
        with c.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())


def query_one(sql: str, params: Params = None, conn=None) -> dict | None:
    rows = query(sql, params, conn=conn)
    return rows[0] if rows else None


def execute(sql: str, params: Params = None, conn=None) -> int:
    """Run a write. Returns lastrowid for inserts, otherwise rowcount.

    Autocommits when no connection is supplied; inside ``transaction()`` pass
    ``conn`` so the caller controls the commit.
    """
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.lastrowid or cur.rowcount
    with get_db_connection() as c:
        with c.cursor() as cur:
            cur.execute(sql, params)
            result = cur.lastrowid or cur.rowcount
        c.commit()
        return result


def execute_many(sql: str, seq_of_params: list, conn=None) -> int:
    if conn is not None:
        with conn.cursor() as cur:
            return cur.executemany(sql, seq_of_params) or 0
    with get_db_connection() as c:
        with c.cursor() as cur:
            n = cur.executemany(sql, seq_of_params) or 0
        c.commit()
        return n


def json_default(value: Any):
    """json.dumps default that copes with DB value types."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def dumps(value: Any) -> str:
    return json.dumps(value, default=json_default, ensure_ascii=False)


def loads(value: Any) -> Any:
    """Decode a JSON column that PyMySQL may hand back as str, bytes or already parsed."""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def serialize_row(row: dict | None) -> dict | None:
    """Make a DB row JSON-safe (Decimal → float, dates → ISO strings)."""
    if row is None:
        return None
    out = {}
    for k, v in row.items():
        if isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, datetime):
            out[k] = v.isoformat(timespec="seconds")
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif isinstance(v, bytes):
            out[k] = v.decode("utf-8", "replace")
        else:
            out[k] = v
    return out
