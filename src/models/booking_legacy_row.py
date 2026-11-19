"""The original sheet row behind an imported booking, kept whole for
completeness and never read by the app (``booking_legacy_rows``)."""

from __future__ import annotations

from src.models.base import dumps, execute, loads, query_one


def set_row(booking_id: int, row: dict, conn=None) -> None:
    execute(
        """
        INSERT INTO booking_legacy_rows (booking_id, sheet_row) VALUES (%s, %s)
        ON DUPLICATE KEY UPDATE sheet_row = VALUES(sheet_row)
        """,
        (int(booking_id), dumps(row)),
        conn=conn,
    )


def get_row(booking_id: int) -> dict | None:
    r = query_one("SELECT sheet_row FROM booking_legacy_rows WHERE booking_id = %s", (int(booking_id),))
    return loads(r["sheet_row"]) if r else None
